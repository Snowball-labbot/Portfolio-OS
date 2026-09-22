from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..database import get_db
from ..dependencies import get_current_user
from ..market_data import MarketDataError, get_currency_cny_rate, get_quote, resolve_quote_exchange_rate
from ..models import Holding, Transaction, User, now_utc
from ..ledger import utc
from ..schemas import HoldingCreateIn, HoldingOut, HoldingUpdateIn, TransactionCreateIn, TransactionOut
from ..services import (
    VALID_FLOW_CLASSES,
    VALID_TRANSACTION_TYPES,
    apply_market_price,
    create_holding_record,
    create_transaction_record,
    normalize_currency,
    recalculate_holding,
    trend_points,
    write_snapshot,
    write_transaction_snapshots,
)

router = APIRouter(prefix="/api", tags=["holdings"])


def get_user_holding(db: DbSession, user_id: str, holding_id: str) -> Holding:
    holding = db.get(Holding, holding_id)
    if not holding or holding.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holding not found")
    return holding


def get_cash_holding(db: DbSession, user_id: str, holding_id: str) -> Holding:
    holding = get_user_holding(db, user_id, holding_id)
    if holding.type != "cash":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Settlement holding must be a cash asset")
    if holding.archived_at is not None:
        raise HTTPException(status_code=400, detail="请先恢复已归档的现金账户")
    return holding


@router.get("/holdings", response_model=list[HoldingOut])
def list_holdings(include_archived: bool = False, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> list[Holding]:
    query = select(Holding).where(Holding.user_id == user.id)
    if not include_archived:
        query = query.where(Holding.archived_at.is_(None))
    return db.scalars(query.order_by(Holding.created_at.desc())).all()


@router.post("/holdings", response_model=HoldingOut)
def create_holding(payload: HoldingCreateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> Holding:
    holding = create_holding_record(
        db,
        user_id=user.id,
        asset_type=payload.type,
        name=payload.name,
        group=payload.group,
        market=payload.market,
        symbol=payload.symbol,
        currency=payload.currency,
        exchange_rate_to_cny=payload.exchange_rate_to_cny,
    )

    has_initial_transaction = payload.quantity > 0
    if has_initial_transaction:
        create_transaction_record(
            db,
            user_id=user.id,
            holding_id=holding.id,
            transaction_type="cash_in" if payload.type == "cash" else "buy",
            trade_date=payload.trade_date,
            quantity=payload.quantity,
            unit_price=payload.unit_price,
            fee=payload.fee,
            currency=payload.currency,
            exchange_rate_to_cny=payload.exchange_rate_to_cny,
            flow_class=payload.flow_class,
            note=payload.note or "初始持仓",
        )
        recalculate_holding(db, holding)
    if payload.current_price is not None:
        apply_market_price(
            db,
            holding,
            payload.current_price,
            payload.exchange_rate_to_cny,
            source="initial_quote",
            when=None,
            instrument_name=payload.name,
        )
    elif has_initial_transaction:
        write_snapshot(db, holding, when=payload.trade_date)
    db.commit()
    db.refresh(holding)
    return holding


@router.patch("/holdings/{holding_id}", response_model=HoldingOut)
def update_holding(holding_id: str, payload: HoldingUpdateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> Holding:
    holding = get_user_holding(db, user.id, holding_id)
    for field in ["name", "group", "market", "symbol", "currency", "exchange_rate_to_cny"]:
        value = getattr(payload, field)
        if value is not None:
            setattr(holding, field, normalize_currency(value) if field == "currency" else value)
    recalculate_holding(db, holding)
    write_snapshot(db, holding)
    db.commit()
    db.refresh(holding)
    return holding


@router.delete("/holdings/{holding_id}")
def delete_holding(holding_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    holding = get_user_holding(db, user.id, holding_id)
    holding.archived_at = now_utc()
    holding.updated_at = now_utc()
    db.commit()
    return {"ok": True, "archived": True}


@router.post("/holdings/{holding_id}/restore", response_model=HoldingOut)
def restore_holding(holding_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> Holding:
    holding = get_user_holding(db, user.id, holding_id)
    holding.archived_at = None
    holding.updated_at = now_utc()
    db.commit()
    db.refresh(holding)
    return holding


@router.get("/holdings/{holding_id}/transactions", response_model=list[TransactionOut])
def list_transactions(holding_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> list[Transaction]:
    get_user_holding(db, user.id, holding_id)
    return db.scalars(
        select(Transaction).where(Transaction.holding_id == holding_id).order_by(Transaction.trade_date.desc())
    ).all()


@router.post("/holdings/{holding_id}/transactions", response_model=TransactionOut)
def create_transaction(holding_id: str, payload: TransactionCreateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> Transaction:
    # Serialize both legs of an operation, including concurrent browser tabs.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    if payload.client_request_id:
        existing = db.scalar(select(Transaction).where(
            Transaction.user_id == user.id, Transaction.client_request_id == payload.client_request_id,
        ))
        if existing:
            if existing.holding_id != holding_id or existing.type != payload.type:
                raise HTTPException(status_code=409, detail="该提交编号已用于另一笔交易")
            return existing
    holding = get_user_holding(db, user.id, holding_id)
    db.refresh(holding)
    if holding.archived_at is not None:
        raise HTTPException(status_code=400, detail="请先恢复已归档的持仓")
    trade_date = utc(payload.trade_date or now_utc())
    if trade_date > now_utc():
        raise HTTPException(status_code=400, detail="交易时间不能晚于当前时间")
    if payload.type not in VALID_TRANSACTION_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid transaction type")
    if payload.flow_class not in VALID_FLOW_CLASSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid flow class")
    if payload.currency.upper() != holding.currency.upper():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transaction currency must be {holding.currency.upper()}",
        )
    if payload.type in {"transfer_in", "transfer_out"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use the cash transfer endpoint for internal transfers",
        )

    quantity = Decimal(payload.quantity)
    unit_price = Decimal(payload.unit_price)
    fee = Decimal(payload.fee)
    exchange_rate = Decimal(payload.exchange_rate_to_cny)
    if holding.type == "cash" and payload.type in {"buy", "sell", "adjustment"}:
        raise HTTPException(status_code=400, detail="现金账户请使用存入、取出或资金划转")
    if payload.type in {"income", "cash_in", "cash_out"}:
        unit_price = Decimal("1")
    if payload.type in {"buy", "sell"} and unit_price <= 0:
        raise HTTPException(status_code=400, detail="成交单价必须大于零")
    if payload.type == "adjustment" and quantity != 0:
        raise HTTPException(status_code=400, detail="价格修正仅更新估值，份额变化请记录买入或卖出")
    if payload.type in {"buy", "sell", "income"} and quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Trade quantity must be greater than zero")
    if payload.type in {"cash_in", "cash_out"} and holding.type != "cash":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cash flow entries require a cash asset")
    if payload.type == "income" and holding.type == "cash":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Income entries must belong to an investment holding")
    if payload.type in {"cash_in", "cash_out"} and quantity <= 0:
        raise HTTPException(status_code=400, detail="现金金额必须大于零")

    cash_holding = None
    operation_id = None
    if payload.settle_cash:
        if payload.type not in {"buy", "sell", "income"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cash settlement is only available for buy, sell and income transactions",
            )
        if not payload.cash_holding_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select a cash settlement account")
        cash_holding = get_cash_holding(db, user.id, payload.cash_holding_id)
        operation_id = str(uuid4())
    elif payload.type == "income":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select a cash account for dividend or interest income")

    transaction_exchange_rate = exchange_rate
    cash_exchange_rate = exchange_rate
    settlement_ratio = Decimal("1")
    if cash_holding and cash_holding.currency.upper() != payload.currency.upper():
        try:
            # The displayed trade FX rate is authoritative. Historical records
            # must never silently fetch today's rates at submit time.
            cash_exchange_rate = payload.cash_exchange_rate_to_cny
            if cash_exchange_rate is None:
                local_date = trade_date.astimezone(ZoneInfo("Asia/Shanghai")).date()
                if local_date < now_utc().astimezone(ZoneInfo("Asia/Shanghai")).date():
                    cash_exchange_rate, _ = get_currency_cny_rate(cash_holding.currency, local_date)
                else:
                    cash_exchange_rate, _ = get_currency_cny_rate(cash_holding.currency)
        except MarketDataError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Unable to obtain settlement FX rate: {exc}",
            ) from exc
        if transaction_exchange_rate <= 0 or cash_exchange_rate <= 0:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Settlement FX rate must be greater than zero",
            )
        settlement_ratio = transaction_exchange_rate / cash_exchange_rate

    realized_gain_native = Decimal("0")
    realized_gain_cny = Decimal("0")
    if payload.type == "sell":
        proceeds = quantity * unit_price - fee
        if proceeds < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fee exceeds sale proceeds")
        realized_gain_native = proceeds - quantity * (holding.avg_cost or Decimal("0"))
        average_cost_cny = (holding.cost_basis_cny or Decimal("0")) / holding.quantity if holding.quantity > 0 else Decimal("0")
        realized_gain_cny = proceeds * transaction_exchange_rate - quantity * average_cost_cny
    elif payload.type == "income":
        proceeds = quantity - fee
        if proceeds <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fee must be lower than income")
        realized_gain_native = proceeds
        realized_gain_cny = proceeds * transaction_exchange_rate

    if payload.type == "income" and not cash_holding:
        raise HTTPException(status_code=400, detail="分红和利息需要选择到账现金账户")
    flow_class = "internal_trade" if cash_holding else payload.flow_class
    if payload.type == "adjustment":
        flow_class = "valuation_correction"
    elif not cash_holding and flow_class == "internal_trade":
        flow_class = "external_withdrawal" if payload.type in {"sell", "cash_out"} else "external_contribution"
    allowed_flows = {"internal_trade"} if cash_holding else (
        {"valuation_correction"} if payload.type == "adjustment" else
        {"external_withdrawal"} if payload.type in {"sell", "cash_out"} else
        {"opening_balance", "external_contribution"}
    )
    if flow_class not in allowed_flows:
        raise HTTPException(status_code=400, detail="资金性质与本次操作不一致")

    transaction = create_transaction_record(
        db,
        user_id=user.id,
        holding_id=holding.id,
        transaction_type=payload.type,
        trade_date=trade_date,
        quantity=payload.quantity,
        unit_price=unit_price,
        fee=payload.fee,
        currency=payload.currency,
        exchange_rate_to_cny=transaction_exchange_rate,
        operation_id=operation_id,
        related_holding_id=cash_holding.id if cash_holding else None,
        flow_class=flow_class,
        realized_gain_native=realized_gain_native,
        realized_gain_cny=realized_gain_cny,
        note=payload.note,
    )
    transaction.client_request_id = payload.client_request_id

    if cash_holding:
        if payload.type == "buy":
            cash_type = "cash_out"
            cash_quantity = (quantity * unit_price + fee) * settlement_ratio
            cash_note = f"买入 {holding.name} 自动扣款"
        elif payload.type == "sell":
            cash_type = "cash_in"
            cash_quantity = (quantity * unit_price - fee) * settlement_ratio
            cash_note = f"卖出 {holding.name} 自动入账"
        else:
            cash_type = "cash_in"
            cash_quantity = (quantity - fee) * settlement_ratio
            cash_note = f"{holding.name} 分红/利息自动入账"
        if cash_holding.currency.upper() != payload.currency.upper():
            cash_note += (
                f"（{payload.currency.upper()}→{cash_holding.currency.upper()}，"
                f"换算率 {settlement_ratio:.8f}）"
            )
        create_transaction_record(
            db,
            user_id=user.id,
            holding_id=cash_holding.id,
            transaction_type=cash_type,
            trade_date=trade_date,
            quantity=cash_quantity.quantize(Decimal("0.00000001")),
            unit_price=Decimal("1"),
            fee=Decimal("0"),
            currency=cash_holding.currency,
            exchange_rate_to_cny=cash_exchange_rate,
            operation_id=operation_id,
            related_holding_id=holding.id,
            flow_class="internal_trade",
            note=cash_note,
        )

    try:
        recalculate_holding(db, holding, strict=True)
        if cash_holding:
            recalculate_holding(db, cash_holding, strict=True)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    write_transaction_snapshots(db, holding, trade_date)
    if cash_holding:
        write_transaction_snapshots(db, cash_holding, trade_date)
    db.commit()
    db.refresh(transaction)
    return transaction


@router.post("/holdings/{holding_id}/refresh-price", response_model=HoldingOut)
def refresh_holding_price(holding_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> Holding:
    holding = get_user_holding(db, user.id, holding_id)
    if not holding.market or not holding.symbol:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Holding has no market symbol")
    kind = "stock" if holding.market.upper() == "US" else "fund"
    try:
        quote = get_quote(holding.market, holding.symbol, kind)
    except MarketDataError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    exchange_rate = resolve_quote_exchange_rate(
        quote.get("currency") or holding.currency,
        quote.get("exchange_rate_to_cny"),
        holding.exchange_rate_to_cny,
    )
    apply_market_price(
        db,
        holding,
        quote["price"],
        exchange_rate,
        source=quote["quote_source"],
        when=quote["price_updated_at"],
        instrument_name=quote["name"],
    )
    holding.currency = quote["currency"]
    db.commit()
    db.refresh(holding)
    return holding


@router.get("/holdings/{holding_id}/trend")
def holding_trend(holding_id: str, range: str = "week", user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> list[dict]:
    get_user_holding(db, user.id, holding_id)
    return trend_points(db, user.id, range, holding_id)
