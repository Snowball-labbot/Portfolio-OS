from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..database import get_db
from ..dependencies import get_current_user
from ..exposure_templates import replace_manual_mappings, seed_profiles
from ..models import Holding, HoldingExposure, PortfolioImportBatch, Transaction, User
from ..schemas import (
    PortfolioBackupHolding,
    PortfolioBackupImportIn,
    PortfolioBackupImportOut,
    PortfolioBackupPreviewOut,
    PortfolioBackupOut,
    PortfolioBackupTransaction,
)
from ..services import VALID_TRANSACTION_TYPES, apply_market_price, recalculate_holding, write_snapshot

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _transaction_payload(transaction: Transaction) -> PortfolioBackupTransaction:
    return PortfolioBackupTransaction(
        type=transaction.type,
        trade_date=transaction.trade_date,
        quantity=transaction.quantity,
        unit_price=transaction.unit_price,
        fee=transaction.fee,
        currency=transaction.currency,
        exchange_rate_to_cny=transaction.exchange_rate_to_cny,
        operation_id=transaction.operation_id,
        related_holding_id=transaction.related_holding_id,
        realized_gain_native=transaction.realized_gain_native,
        realized_gain_cny=transaction.realized_gain_cny,
        note=transaction.note,
        flow_class=transaction.flow_class,
    )


def _holding_payload(
    holding: Holding,
    transactions: list[Transaction],
    exposures: list[HoldingExposure],
) -> PortfolioBackupHolding:
    return PortfolioBackupHolding(
        backup_id=holding.id,
        type=holding.type,
        name=holding.name,
        group=holding.group,
        market=holding.market,
        symbol=holding.symbol,
        instrument_name=holding.instrument_name,
        quote_source=holding.quote_source,
        currency=holding.currency,
        quantity=holding.quantity,
        avg_cost=holding.avg_cost,
        current_price=holding.current_price,
        exchange_rate_to_cny=holding.exchange_rate_to_cny,
        price_updated_at=holding.price_updated_at,
        archived_at=holding.archived_at,
        source_backup_id=holding.source_backup_id,
        exposures=[
            {"profile_code": item.profile_code, "weight_pct": item.weight_pct}
            for item in exposures if item.mapping_source == "manual"
        ],
        transactions=[_transaction_payload(item) for item in transactions],
    )


@router.get("/export", response_model=PortfolioBackupOut)
def export_portfolio(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> PortfolioBackupOut:
    holdings = db.scalars(
        select(Holding).where(Holding.user_id == user.id).order_by(Holding.created_at.asc())
    ).all()
    holding_ids = [holding.id for holding in holdings]
    transactions_by_holding: dict[str, list[Transaction]] = {holding.id: [] for holding in holdings}
    exposures_by_holding: dict[str, list[HoldingExposure]] = {holding.id: [] for holding in holdings}
    if holding_ids:
        transactions = db.scalars(
            select(Transaction)
            .where(Transaction.user_id == user.id, Transaction.holding_id.in_(holding_ids))
            .order_by(Transaction.trade_date.asc())
        ).all()
        for transaction in transactions:
            transactions_by_holding.setdefault(transaction.holding_id, []).append(transaction)
        exposures = db.scalars(select(HoldingExposure).where(HoldingExposure.holding_id.in_(holding_ids))).all()
        for exposure in exposures:
            exposures_by_holding.setdefault(exposure.holding_id, []).append(exposure)

    return PortfolioBackupOut(
        backup_key=str(uuid4()),
        exported_at=datetime.now(timezone.utc),
        holdings=[
            _holding_payload(
                holding,
                transactions_by_holding.get(holding.id, []),
                exposures_by_holding.get(holding.id, []),
            )
            for holding in holdings
        ],
    )


def _duplicate_key(item: PortfolioBackupHolding) -> tuple[str, str, str, str]:
    identity = (item.symbol or item.name).strip().upper()
    return ((item.market or "").upper(), identity, (item.group or "").strip().lower(), item.currency.upper())


def _existing_duplicate_keys(db: DbSession, user_id: str) -> set[tuple[str, str, str, str]]:
    holdings = db.scalars(select(Holding).where(Holding.user_id == user_id)).all()
    return {
        ((item.market or "").upper(), (item.symbol or item.name).strip().upper(), (item.group or "").strip().lower(), item.currency.upper())
        for item in holdings
    }


@router.post("/import-preview", response_model=PortfolioBackupPreviewOut)
def preview_import(payload: PortfolioBackupImportIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    seen = _existing_duplicate_keys(db, user.id)
    duplicates = []
    for item in payload.holdings:
        key = _duplicate_key(item)
        if key in seen:
            duplicates.append({"backup_id": item.backup_id, "name": item.name, "symbol": item.symbol, "group": item.group})
        else:
            seen.add(key)
    return PortfolioBackupPreviewOut(
        total=len(payload.holdings),
        new_count=len(payload.holdings) - len(duplicates),
        duplicate_count=len(duplicates),
        duplicates=duplicates,
    )


@router.post("/import", response_model=PortfolioBackupImportOut)
def import_portfolio(
    payload: PortfolioBackupImportIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> PortfolioBackupImportOut:
    if payload.schema_version and payload.schema_version not in {"portfolio_backup_v1", "portfolio_backup_v2", "portfolio_backup_v3"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported portfolio backup version")

    existing = _existing_duplicate_keys(db, user.id)
    seed_profiles(db)
    skipped = 0
    batch = PortfolioImportBatch(user_id=user.id, backup_key=payload.backup_key)
    db.add(batch)
    db.flush()
    imported_holdings: list[tuple[PortfolioBackupHolding, Holding]] = []
    holding_id_map: dict[str, str] = {}
    for item in payload.holdings:
        if payload.skip_duplicates and _duplicate_key(item) in existing:
            skipped += 1
            continue
        holding = Holding(
            user_id=user.id,
            type=item.type,
            name=item.name,
            group=item.group or None,
            market=item.market or None,
            symbol=item.symbol or None,
            instrument_name=item.instrument_name or item.name,
            quote_source=item.quote_source or "portfolio_import",
            currency=item.currency.upper(),
            exchange_rate_to_cny=item.exchange_rate_to_cny,
            price_updated_at=item.price_updated_at,
            archived_at=item.archived_at,
            source_backup_id=item.source_backup_id or item.backup_id,
            import_batch_id=batch.id,
        )
        db.add(holding)
        db.flush()
        existing.add(_duplicate_key(item))
        imported_holdings.append((item, holding))
        if item.backup_id:
            holding_id_map[item.backup_id] = holding.id
        if item.exposures:
            replace_manual_mappings(db, holding, [exposure.model_dump() for exposure in item.exposures])

    operation_id_map: dict[str, str] = {}
    for item, holding in imported_holdings:
        transactions = item.transactions
        if not transactions and (item.quantity > 0 or item.avg_cost > 0):
            transactions = [
                PortfolioBackupTransaction(
                    type="cash_in" if item.type == "cash" else "buy",
                    trade_date=item.price_updated_at,
                    quantity=item.quantity,
                    unit_price=item.avg_cost,
                    fee=Decimal("0"),
                    currency=item.currency.upper(),
                    exchange_rate_to_cny=item.exchange_rate_to_cny,
                    note="Portfolio backup import",
                    flow_class="opening_balance",
                )
            ]

        for transaction in transactions:
            if transaction.type not in VALID_TRANSACTION_TYPES:
                continue
            operation_id = None
            if transaction.operation_id:
                operation_id = operation_id_map.setdefault(transaction.operation_id, str(uuid4()))
            db.add(
                Transaction(
                    user_id=user.id,
                    holding_id=holding.id,
                    type=transaction.type,
                    trade_date=transaction.trade_date or datetime.now(timezone.utc),
                    quantity=transaction.quantity,
                    unit_price=transaction.unit_price,
                    fee=transaction.fee,
                    currency=transaction.currency.upper(),
                    exchange_rate_to_cny=transaction.exchange_rate_to_cny,
                    operation_id=operation_id,
                    related_holding_id=holding_id_map.get(transaction.related_holding_id or ""),
                    flow_class=transaction.flow_class,
                    realized_gain_native=transaction.realized_gain_native,
                    realized_gain_cny=transaction.realized_gain_cny,
                    note=transaction.note,
                )
            )

        db.flush()
        recalculate_holding(db, holding)
        if item.current_price > 0:
            apply_market_price(
                db,
                holding,
                item.current_price,
                item.exchange_rate_to_cny,
                source=item.quote_source or "portfolio_import",
                when=item.price_updated_at,
                instrument_name=item.instrument_name or item.name,
            )
        else:
            write_snapshot(db, holding)
    db.commit()
    batch.imported_count = len(imported_holdings)
    batch.skipped_count = skipped
    db.commit()
    return PortfolioBackupImportOut(imported=len(imported_holdings), skipped=skipped, batch_id=batch.id)


@router.get("/import-batches/latest")
def latest_import_batch(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict | None:
    batch = db.scalar(
        select(PortfolioImportBatch)
        .where(PortfolioImportBatch.user_id == user.id, PortfolioImportBatch.status == "active")
        .order_by(PortfolioImportBatch.created_at.desc())
    )
    if batch is None:
        return None
    return {
        "id": batch.id,
        "imported_count": batch.imported_count,
        "skipped_count": batch.skipped_count,
        "created_at": batch.created_at,
    }


@router.delete("/import-batches/{batch_id}")
def undo_import_batch(batch_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    batch = db.get(PortfolioImportBatch, batch_id)
    if not batch or batch.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")
    if batch.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import batch already reverted")
    holdings = db.scalars(select(Holding).where(Holding.user_id == user.id, Holding.import_batch_id == batch.id)).all()
    for holding in holdings:
        db.delete(holding)
    batch.status = "reverted"
    db.commit()
    return {"ok": True, "removed": len(holdings)}
