from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from .models import Transaction


ZERO = Decimal("0")


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def ordered_transactions(items):
    return sorted(items, key=lambda item: (utc(item.trade_date), utc(item.created_at), item.id))


@dataclass
class LedgerBalance:
    quantity: Decimal = ZERO
    cost: Decimal = ZERO
    cost_cny: Decimal = ZERO
    price: Decimal = ZERO
    rate: Decimal = Decimal("1")
    marked_at: datetime | None = None


def replay_ledger(items: list[Transaction], *, strict: bool = False, update_realized: bool = False) -> LedgerBalance:
    balance = LedgerBalance()
    for item in ordered_transactions(items):
        q, p, fee = item.quantity or ZERO, item.unit_price or ZERO, item.fee or ZERO
        rate = item.exchange_rate_to_cny or Decimal("1")
        gain, gain_cny = ZERO, ZERO
        if item.type in {"buy", "cash_in", "transfer_in"} or (item.type == "adjustment" and q > 0):
            balance.quantity += q
            balance.cost += q * p + fee
            balance.cost_cny += (q * p + fee) * rate
        elif item.type in {"sell", "cash_out", "transfer_out"}:
            removed = q if item.type == "sell" else q + fee
            if strict and removed > balance.quantity:
                raise ValueError(f"{utc(item.trade_date).astimezone().isoformat()} 的交易超过当时可用份额或现金，请核对历史流水")
            removed = min(removed, balance.quantity)
            basis = balance.cost * removed / balance.quantity if balance.quantity else ZERO
            basis_cny = balance.cost_cny * removed / balance.quantity if balance.quantity else ZERO
            balance.quantity -= removed
            balance.cost -= basis
            balance.cost_cny -= basis_cny
            if item.type == "sell":
                gain = q * p - fee - basis
                gain_cny = (q * p - fee) * rate - basis_cny
        elif item.type == "income":
            gain = q - fee
            gain_cny = gain * rate
        if update_realized and item.type in {"sell", "income"}:
            item.realized_gain_native = gain
            item.realized_gain_cny = gain_cny
        if item.type != "income":
            balance.price, balance.rate, balance.marked_at = p, rate, utc(item.trade_date)
    return balance
