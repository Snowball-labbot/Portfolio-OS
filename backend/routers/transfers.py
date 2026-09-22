from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session as DbSession

from ..database import get_db
from ..dependencies import get_current_user
from ..models import CashTransfer, Holding, User
from ..ledger import utc
from ..schemas import CashTransferCreateIn, CashTransferOut
from ..services import create_transaction_record, recalculate_holding, write_transaction_snapshots

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


def _cash_holding(db: DbSession, user_id: str, holding_id: str) -> Holding:
    holding = db.get(Holding, holding_id)
    if not holding or holding.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cash account not found")
    if holding.type != "cash" or holding.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transfers require cash assets")
    return holding


@router.get("", response_model=list[CashTransferOut])
def list_cash_transfers(
    holding_id: str | None = None,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[CashTransfer]:
    filters = [CashTransfer.user_id == user.id]
    if holding_id:
        filters.append(or_(
            CashTransfer.source_holding_id == holding_id,
            CashTransfer.destination_holding_id == holding_id,
        ))
    return db.scalars(
        select(CashTransfer).where(*filters).order_by(CashTransfer.trade_date.desc())
    ).all()


@router.post("", response_model=CashTransferOut)
def create_cash_transfer(
    payload: CashTransferCreateIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> CashTransfer:
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    if payload.source_holding_id == payload.destination_holding_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and destination must differ")

    source = _cash_holding(db, user.id, payload.source_holding_id)
    destination = _cash_holding(db, user.id, payload.destination_holding_id)
    source_amount = Decimal(payload.source_amount)
    destination_amount = Decimal(payload.destination_amount)
    fee = Decimal(payload.fee)
    trade_date = utc(payload.trade_date or datetime.now(timezone.utc))
    if trade_date > datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Transfer date cannot be in the future")
    transfer = CashTransfer(
        user_id=user.id,
        source_holding_id=source.id,
        destination_holding_id=destination.id,
        source_amount=source_amount,
        destination_amount=destination_amount,
        source_currency=source.currency,
        destination_currency=destination.currency,
        source_exchange_rate_to_cny=payload.source_exchange_rate_to_cny,
        destination_exchange_rate_to_cny=payload.destination_exchange_rate_to_cny,
        fee=fee,
        trade_date=trade_date,
        note=payload.note,
    )
    db.add(transfer)
    db.flush()

    create_transaction_record(
        db,
        user_id=user.id,
        holding_id=source.id,
        transaction_type="transfer_out",
        trade_date=trade_date,
        quantity=source_amount,
        unit_price=Decimal("1"),
        fee=fee,
        currency=source.currency,
        exchange_rate_to_cny=payload.source_exchange_rate_to_cny,
        operation_id=transfer.id,
        related_holding_id=destination.id,
        flow_class="internal_transfer",
        note=payload.note or f"转至 {destination.name}",
    )
    create_transaction_record(
        db,
        user_id=user.id,
        holding_id=destination.id,
        transaction_type="transfer_in",
        trade_date=trade_date,
        quantity=destination_amount,
        unit_price=Decimal("1"),
        fee=Decimal("0"),
        currency=destination.currency,
        exchange_rate_to_cny=payload.destination_exchange_rate_to_cny,
        operation_id=transfer.id,
        related_holding_id=source.id,
        flow_class="internal_transfer",
        note=payload.note or f"来自 {source.name}",
    )

    try:
        recalculate_holding(db, source, strict=True)
        recalculate_holding(db, destination, strict=True)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    write_transaction_snapshots(db, source, trade_date)
    write_transaction_snapshots(db, destination, trade_date)
    db.commit()
    db.refresh(transfer)
    return transfer
