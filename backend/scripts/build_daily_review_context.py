from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import akshare as ak
import pandas as pd
import yfinance as yf
from sqlalchemy import select

from ..database import SessionLocal
from ..models import Holding, Transaction, User


ETF_PREFIXES = ("15", "16", "18", "50", "51", "56", "58")


@dataclass
class PricePoint:
    day: date
    price: Decimal
    volume: Decimal | None = None


def decimal_value(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def rounded(value: Decimal | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def pick_point(series: list[PricePoint], target: date) -> PricePoint | None:
    candidates = [item for item in series if item.day <= target]
    return candidates[-1] if candidates else None


def yahoo_history(symbol: str, start: date, end: date) -> list[PricePoint]:
    frame = yf.Ticker(symbol).history(
        start=start.isoformat(),
        end=(end + timedelta(days=1)).isoformat(),
        interval="1d",
        auto_adjust=False,
        actions=False,
    )
    points: list[PricePoint] = []
    for index, row in frame.iterrows():
        close = row.get("Close")
        if close is None or pd.isna(close):
            continue
        volume = row.get("Volume")
        points.append(
            PricePoint(
                day=pd.Timestamp(index).date(),
                price=decimal_value(close),
                volume=None if volume is None or pd.isna(volume) else decimal_value(volume),
            )
        )
    return points


def cn_etf_history(symbol: str, start: date, end: date) -> list[PricePoint]:
    frame = ak.fund_etf_hist_em(
        symbol=symbol,
        period="daily",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
    )
    points: list[PricePoint] = []
    for _, row in frame.iterrows():
        raw_day = row.get("日期")
        raw_price = row.get("收盘")
        if raw_day is None or raw_price is None or pd.isna(raw_price):
            continue
        raw_volume = row.get("成交量")
        points.append(
            PricePoint(
                day=pd.Timestamp(raw_day).date(),
                price=decimal_value(raw_price),
                volume=None if raw_volume is None or pd.isna(raw_volume) else decimal_value(raw_volume),
            )
        )
    return points


def cn_fund_history(symbol: str, start: date, end: date) -> list[PricePoint]:
    frame = ak.fund_open_fund_info_em(symbol=symbol, indicator="单位净值走势")
    points: list[PricePoint] = []
    for _, row in frame.iterrows():
        raw_day = row.get("净值日期")
        raw_price = row.get("单位净值")
        if raw_day is None or raw_price is None or pd.isna(raw_price):
            continue
        point_day = pd.Timestamp(raw_day).date()
        if start <= point_day <= end:
            points.append(PricePoint(day=point_day, price=decimal_value(raw_price)))
    return points


def history_for_holding(holding: Holding, start: date, end: date) -> tuple[list[PricePoint], str]:
    market = (holding.market or "").upper()
    symbol = (holding.symbol or "").upper()
    if not symbol:
        return [], "manual"
    if market == "US":
        return yahoo_history(symbol, start, end), "Yahoo Finance"
    if market == "KR":
        yahoo_symbol = symbol if symbol.endswith((".KS", ".KQ")) else f"{symbol.zfill(6)}.KS"
        return yahoo_history(yahoo_symbol, start, end), "Yahoo Finance"
    if market == "LSE":
        yahoo_symbol = symbol if symbol.endswith(".L") else f"{symbol}.L"
        return yahoo_history(yahoo_symbol, start, end), "Yahoo Finance"
    if market == "CN" and symbol.startswith(ETF_PREFIXES):
        return cn_etf_history(symbol, start, end), "AKShare ETF history"
    if market == "CN":
        return cn_fund_history(symbol, start, end), "AKShare fund NAV"
    return [], "manual"


def fx_history(currency: str, start: date, end: date) -> list[PricePoint]:
    currency = currency.upper()
    if currency == "CNY":
        return [PricePoint(day=start, price=Decimal("1")), PricePoint(day=end, price=Decimal("1"))]
    symbol = {"USD": "CNY=X", "KRW": "KRWCNY=X"}.get(currency)
    if not symbol:
        return []
    return yahoo_history(symbol, start, end)


def technical_metrics(points: list[PricePoint], target: date) -> dict[str, Any]:
    available = [item for item in points if item.day <= target]
    if len(available) < 21:
        return {"state": "证据不足"}
    close = pd.Series([float(item.price) for item in available], dtype="float64")
    volume_values = [float(item.volume) if item.volume is not None else float("nan") for item in available]
    volume = pd.Series(volume_values, dtype="float64")
    last = close.iloc[-1]
    return_5d = last / close.iloc[-6] - 1 if len(close) >= 6 else None
    return_20d = last / close.iloc[-21] - 1
    ma20 = close.tail(20).mean()
    ma60 = close.tail(60).mean() if len(close) >= 60 else None
    volume_ratio = None
    if volume.notna().sum() >= 25:
        prior = volume.iloc[-25:-5].mean()
        volume_ratio = volume.tail(5).mean() / prior if prior else None

    strong = last > ma20 and (ma60 is None or ma20 > ma60) and return_20d > 0
    overheated = return_20d > 0.15 and last > ma20 * 1.08
    weak = last < ma20 and return_20d < 0
    state = "过热" if overheated else "强势" if strong else "弱势" if weak else "中性"
    return {
        "state": state,
        "return_5d_pct": round(return_5d * 100, 2) if return_5d is not None else None,
        "return_20d_pct": round(return_20d * 100, 2),
        "ma20": round(float(ma20), 4),
        "ma60": round(float(ma60), 4) if ma60 is not None else None,
        "volume_ratio_5v20": round(float(volume_ratio), 2) if volume_ratio is not None and not pd.isna(volume_ratio) else None,
    }


def holding_row(
    holding: Holding,
    target: date,
    history_start: date,
    fx_cache: dict[str, list[PricePoint]],
) -> dict[str, Any]:
    previous_day = target - timedelta(days=1)
    quantity = holding.quantity or Decimal("0")
    warnings: list[str] = []
    try:
        history, source = history_for_holding(holding, history_start, target)
    except Exception as exc:
        history, source = [], "manual fallback"
        warnings.append(f"价格历史获取失败：{exc}")

    target_point = pick_point(history, target)
    previous_point = pick_point(history, previous_day)
    if target_point is None:
        target_point = PricePoint(target, holding.current_price or Decimal("0"))
        source = "current/manual fallback"
        warnings.append("目标日期无历史行情，沿用当前手工价格")
    if previous_point is None:
        previous_point = target_point
        warnings.append("缺少前值，日变动按 0 处理")

    currency = (holding.currency or "CNY").upper()
    fx_series = fx_cache.get(currency, [])
    target_fx = pick_point(fx_series, target)
    previous_fx = pick_point(fx_series, previous_day)
    if target_fx is None:
        target_fx = PricePoint(target, holding.exchange_rate_to_cny or Decimal("1"))
        warnings.append("目标日期无历史汇率，沿用持仓汇率")
    if previous_fx is None:
        previous_fx = target_fx

    previous_value = quantity * previous_point.price * previous_fx.price
    target_value = quantity * target_point.price * target_fx.price
    price_contribution = quantity * (target_point.price - previous_point.price) * previous_fx.price
    fx_contribution = quantity * target_point.price * (target_fx.price - previous_fx.price)
    change = target_value - previous_value
    return_pct = change / previous_value * Decimal("100") if previous_value else Decimal("0")

    return {
        "id": holding.id,
        "type": holding.type,
        "group": holding.group,
        "name": holding.instrument_name or holding.name,
        "symbol": holding.symbol,
        "market": holding.market,
        "currency": currency,
        "quantity": rounded(quantity, 8),
        "source": source,
        "price_date": target_point.day.isoformat(),
        "previous_price_date": previous_point.day.isoformat(),
        "price": rounded(target_point.price, 8),
        "previous_price": rounded(previous_point.price, 8),
        "fx": rounded(target_fx.price, 8),
        "previous_fx": rounded(previous_fx.price, 8),
        "value_cny": rounded(target_value),
        "previous_value_cny": rounded(previous_value),
        "change_cny": rounded(change),
        "return_pct": rounded(return_pct),
        "price_contribution_cny": rounded(price_contribution),
        "fx_contribution_cny": rounded(fx_contribution),
        "technical": technical_metrics(history, target) if history else {"state": "证据不足"},
        "warnings": warnings,
    }


def build_context(email: str, target: date) -> dict[str, Any]:
    history_start = target - timedelta(days=120)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            raise ValueError(f"User not found: {email}")
        holdings = db.scalars(select(Holding).where(Holding.user_id == user.id).order_by(Holding.name)).all()
        flows = db.scalars(
            select(Transaction).where(
                Transaction.user_id == user.id,
                Transaction.trade_date >= datetime.combine(target, datetime.min.time()),
                Transaction.trade_date < datetime.combine(target + timedelta(days=1), datetime.min.time()),
            )
        ).all()

    currencies = {(holding.currency or "CNY").upper() for holding in holdings}
    fx_cache: dict[str, list[PricePoint]] = {}
    for currency in currencies:
        try:
            fx_cache[currency] = fx_history(currency, history_start, target)
        except Exception:
            fx_cache[currency] = []

    rows = [holding_row(holding, target, history_start, fx_cache) for holding in holdings]
    rows.sort(key=lambda item: abs(item["change_cny"] or 0), reverse=True)
    total_value = sum(decimal_value(item["value_cny"] or 0) for item in rows)
    previous_value = sum(decimal_value(item["previous_value_cny"] or 0) for item in rows)
    price_contribution = sum(decimal_value(item["price_contribution_cny"] or 0) for item in rows)
    fx_contribution = sum(decimal_value(item["fx_contribution_cny"] or 0) for item in rows)
    change = total_value - previous_value
    return_pct = change / previous_value * Decimal("100") if previous_value else Decimal("0")

    flow_rows = [
        {
            "type": item.type,
            "quantity": rounded(item.quantity, 8),
            "unit_price": rounded(item.unit_price, 8),
            "fee": rounded(item.fee, 8),
            "currency": item.currency,
        }
        for item in flows
    ]
    warning_count = sum(len(item["warnings"]) for item in rows)
    return {
        "schema_version": "daily_equity_review_context_v1",
        "review_date": target.isoformat(),
        "generated_at": datetime.now().astimezone().isoformat(),
        "reporting_currency": "CNY",
        "portfolio": {
            "ending_value_cny": rounded(total_value),
            "previous_value_cny": rounded(previous_value),
            "investment_change_cny": rounded(change),
            "investment_return_pct": rounded(return_pct),
            "price_contribution_cny": rounded(price_contribution),
            "fx_contribution_cny": rounded(fx_contribution),
            "holding_count": len(rows),
            "warning_count": warning_count,
        },
        "flows": flow_rows,
        "holdings": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build historical data context for daily portfolio reviews.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--date", action="append", required=True, dest="dates")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    for raw_date in args.dates:
        target = date.fromisoformat(raw_date)
        payload = build_context(args.email, target)
        output_path = output_dir / f"{target.isoformat()}-context.json"
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(output_path)


if __name__ == "__main__":
    main()
