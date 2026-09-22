from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from ..ledger import replay_ledger, utc
from ..models import Transaction, ValuationObservation, ValuationSnapshot


ZERO = Decimal("0")


def transaction_value(item: Transaction) -> Decimal:
    amount = item.quantity if item.type in {"income", "cash_in", "cash_out", "transfer_in", "transfer_out"} else item.quantity * item.unit_price
    return amount - item.fee if item.type in {"sell", "income"} else amount + item.fee


def external_flow(item: Transaction) -> Decimal:
    amount = transaction_value(item) * item.exchange_rate_to_cny
    if item.type in {"cash_in", "cash_out"}:
        amount = item.quantity * item.exchange_rate_to_cny
    if item.flow_class == "external_contribution":
        return amount
    if item.flow_class == "external_withdrawal":
        return -amount
    return ZERO


def review_metrics(db, user_id: str, holdings, start: datetime, end: datetime, events: list[dict]) -> dict:
    """Build a usable review from exact observations or the nearest comparable pair.

    Exact report-boundary observations remain preferred. When they are not
    available, a report may use the first and last comparable observations in
    the window, or legacy daily snapshots, as an explicitly labelled estimate.
    This keeps the review useful without presenting stale values as exact P&L.
    """
    observations = db.scalars(select(ValuationObservation).where(
        ValuationObservation.user_id == user_id, ValuationObservation.observed_at <= end,
    ).order_by(ValuationObservation.observed_at)).all()
    snapshots = db.scalars(select(ValuationSnapshot).where(
        ValuationSnapshot.user_id == user_id, ValuationSnapshot.created_at <= end,
    ).order_by(ValuationSnapshot.created_at)).all()
    transactions = db.scalars(select(Transaction).where(
        Transaction.user_id == user_id, Transaction.trade_date <= end,
    )).all()
    points: dict[str, list[dict]] = {}
    for item in snapshots:
        if item.source == "ledger_rebuild":
            continue
        points.setdefault(item.holding_id, []).append({
            "at": utc(item.snapshot_date), "quantity": item.quantity, "price": item.unit_price,
            "rate": item.value_cny / item.value if item.value else None,
            "value": item.value_cny, "legacy": True, "price_as_of": utc(item.snapshot_date),
        })
    for item in observations:
        points.setdefault(item.holding_id, []).append({
            "at": utc(item.observed_at), "quantity": item.quantity, "price": item.unit_price,
            "rate": item.exchange_rate_to_cny, "value": item.value_cny, "legacy": False,
            "price_as_of": utc(item.price_as_of or item.observed_at),
        })
    flows: dict[str, Decimal] = {}
    for event in events:
        for row in event["flow_rows"]:
            flows[row["holding_id"]] = flows.get(row["holding_id"], ZERO) + row["flow_cny"]
    period_transactions = [item for item in transactions if start < utc(item.trade_date) <= end]
    net_external = sum((external_flow(item) for item in period_transactions), ZERO)
    duration = max((end - start).total_seconds(), 1)
    weighted_external = sum((
        external_flow(item) * Decimal(str((end - utc(item.trade_date)).total_seconds() / duration))
        for item in period_transactions
    ), ZERO)
    rows = []
    for holding in holdings:
        history = sorted(points.get(holding.id, []), key=lambda point: (point["at"], not point["legacy"]))
        previous = next((point for point in reversed(history) if point["at"] <= start), None)
        current = history[-1] if history else None
        ledger = [item for item in transactions if item.holding_id == holding.id]
        prior = replay_ledger([item for item in ledger if utc(item.trade_date) <= start])
        closing = replay_ledger([item for item in ledger if utc(item.trade_date) <= end])
        used_partial_window = False
        if previous is None and prior.quantity == 0 and ledger:
            previous = {
                "at": start, "quantity": ZERO, "price": ZERO, "rate": None,
                "value": ZERO, "legacy": False, "price_as_of": start,
            }
        elif previous is None and current is not None:
            # On the first day after enabling timestamped observations there is
            # no prior boundary point. Use the first in-window observation and
            # disclose that the contribution covers only a partial window.
            previous = next((point for point in history if start < point["at"] < current["at"]), None)
            used_partial_window = previous is not None
        if holding.type == "cash" and ledger:
            previous_rate = (
                previous.get("rate") if previous and previous.get("rate")
                else holding.exchange_rate_to_cny or Decimal("1")
            )
            current_rate = (
                current.get("rate") if current and current.get("rate")
                else holding.exchange_rate_to_cny or previous_rate
            )
            previous = {
                "at": start, "quantity": prior.quantity, "price": Decimal("1"),
                "rate": previous_rate, "value": prior.quantity * previous_rate,
                "legacy": False, "price_as_of": start,
            }
            current = {
                "at": end, "quantity": closing.quantity, "price": Decimal("1"),
                "rate": current_rate, "value": closing.quantity * current_rate,
                "legacy": False, "price_as_of": end,
            }
        if not closing.quantity and ledger:
            current = {"at": end, "quantity": ZERO, "price": closing.price, "rate": closing.rate, "value": ZERO, "legacy": False, "price_as_of": end}
        if not prior.quantity and not closing.quantity and not flows.get(holding.id) and not history:
            continue
        available = previous is not None and current is not None and previous["at"] < current["at"]
        fresh = (
            available
            and not used_partial_window
            and abs(start - previous["at"]) <= timedelta(hours=6)
            and abs(end - current["at"]) <= timedelta(hours=6)
        )
        flow = flows.get(holding.id, ZERO)
        gross = current["value"] - previous["value"] if available else None
        pnl = gross - flow if available else None
        price_contribution = fx_contribution = None
        if available and previous["rate"] and current["rate"]:
            price_contribution = previous["quantity"] * (current["price"] - previous["price"]) * previous["rate"]
            fx_contribution = previous["quantity"] * current["price"] * (current["rate"] - previous["rate"])
        rows.append({
            "holding_id": holding.id, "name": holding.instrument_name or holding.name,
            "symbol": holding.symbol, "currency": holding.currency, "market": holding.market,
            "previous_value_cny": previous["value"] if previous else None,
            "current_value_cny": current["value"] if current else None,
            "baseline_observed_at": previous["at"] if previous else None,
            "end_observed_at": current["at"] if current else None,
            "baseline_price_as_of": previous.get("price_as_of") if previous else None,
            "end_price_as_of": current.get("price_as_of") if current else None,
            "gross_daily_change_cny": gross, "transaction_flow_cny": flow,
            "daily_change_cny": pnl if available else None,
            "reference_change_cny": pnl,
            "daily_change_pct": pnl / previous["value"] * 100 if available and previous["value"] else None,
            "price_contribution_cny": price_contribution if available else None,
            "fx_contribution_cny": fx_contribution if available else None,
            "trading_income_fees_contribution_cny": pnl - price_contribution - fx_contribution if available and price_contribution is not None else None,
            "data_available": bool(available),
            "data_quality": (
                "missing" if not available
                else "observed" if fresh and not previous["legacy"] and not current["legacy"]
                else "daily_snapshot_estimate" if previous["legacy"] or current["legacy"]
                else "partial_window_estimate"
            ),
        })
    comparable_rows = [row for row in rows if row["data_available"]]
    coverage_base = sum((row["current_value_cny"] or ZERO for row in rows), ZERO)
    covered_value = sum((row["current_value_cny"] or ZERO for row in comparable_rows), ZERO)
    coverage_pct = covered_value / coverage_base * 100 if coverage_base else ZERO
    usable = bool(rows) and coverage_pct >= Decimal("80")
    exact = usable and all(row["data_quality"] == "observed" for row in rows)
    current_total = sum((row["current_value_cny"] or ZERO for row in rows), ZERO)
    previous_total = sum((row["previous_value_cny"] or ZERO for row in rows), ZERO)
    pnl = sum((row["daily_change_cny"] or ZERO for row in comparable_rows), ZERO) if usable else None
    denominator = previous_total + weighted_external
    return {
        "window_start": start, "window_end": end,
        "baseline_rule": "美股收盘到收盘；睡前复盘以上一日北京时间22:00为基准",
        "data_available": usable,
        "calculation_quality": "exact" if exact else "estimate" if usable else "insufficient",
        "coverage_pct": coverage_pct,
        "current_value_cny": current_total if all(row["current_value_cny"] is not None for row in rows) and rows else None,
        "previous_value_cny": previous_total if all(row["previous_value_cny"] is not None for row in rows) and rows else None,
        "external_flow_cny": net_external, "investment_pnl_cny": pnl,
        "investment_return_pct": pnl / denominator * 100 if pnl is not None and denominator > 0 else None,
        "return_method": "Modified Dietz 区间估算，外部资金流按时间加权",
        "realized_gain_cny": sum((item.realized_gain_cny or ZERO for item in period_transactions), ZERO),
        "known_contribution_cny": sum((row["daily_change_cny"] or ZERO for row in rows), ZERO),
        "missing_contributor_count": sum(not row["data_available"] for row in rows),
        "estimated_contributor_count": sum(row["data_quality"] != "observed" for row in comparable_rows),
        "contributors": sorted(rows, key=lambda row: abs(row["daily_change_cny"] or ZERO), reverse=True),
        "transaction_events": events,
        "data_notes": ["缺少精确边界快照时使用最近可比观察估算，并展示实际行情日期与覆盖率。", "已实现盈亏按历史成本统计，已经体现在组合损益内，不能再次相加。"],
    }
