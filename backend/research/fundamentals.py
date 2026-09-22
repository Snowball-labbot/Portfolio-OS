from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from typing import Any


UTC = timezone.utc
CACHE_SECONDS = 3600


class FundamentalsError(RuntimeError):
    pass


def _normalize_symbol(symbol: str, market: str) -> str:
    value = symbol.strip().upper()
    if market.upper() == "KR" and value.isdigit() and len(value) == 6:
        return f"{value}.KS"
    return value


def _first(source: Any, *keys: str) -> Any:
    for key in keys:
        if isinstance(source, dict):
            value = source.get(key)
        else:
            value = getattr(source, key, None)
        if value is not None:
            return value
    return None


def _decimal(value: Any, *, percent_ratio: bool = False) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(number):
        return None
    if percent_ratio:
        number *= 100
    try:
        return Decimal(str(round(number, 6)))
    except InvalidOperation:
        return None


def _integer(value: Any) -> int | None:
    number = _decimal(value)
    return int(number) if number is not None else None


@lru_cache(maxsize=128)
def _fetch_cached(symbol: str, market: str, cache_bucket: int) -> dict[str, Any]:
    del cache_bucket
    try:
        import yfinance as yf  # type: ignore
    except Exception as exc:
        raise FundamentalsError("yfinance is not installed or failed to import") from exc

    ticker_symbol = _normalize_symbol(symbol, market)
    ticker = yf.Ticker(ticker_symbol)

    fast_info: Any = {}
    info: dict[str, Any] = {}
    try:
        fast_info = ticker.fast_info
    except Exception:
        fast_info = {}
    try:
        info = ticker.info or {}
    except Exception as exc:
        if not fast_info:
            raise FundamentalsError(f"Yahoo Finance fundamentals request failed: {exc}") from exc

    current_price = _first(
        fast_info,
        "last_price",
        "lastPrice",
        "regular_market_price",
        "regularMarketPrice",
        "previous_close",
        "previousClose",
    ) or _first(info, "currentPrice", "regularMarketPrice", "previousClose")

    name = str(
        _first(info, "longName", "shortName", "displayName")
        or ticker_symbol
    )
    currency = str(
        _first(fast_info, "currency")
        or _first(info, "currency")
        or ("KRW" if market.upper() == "KR" else "USD")
    ).upper()

    result = {
        "symbol": ticker_symbol,
        "name": name,
        "market": market.upper(),
        "currency": currency,
        "exchange": _first(info, "fullExchangeName", "exchange"),
        "instrument_type": _first(info, "quoteType"),
        "sector": _first(info, "sector"),
        "industry": _first(info, "industry"),
        "current_price": _decimal(current_price),
        "market_cap": _decimal(_first(fast_info, "market_cap", "marketCap") or _first(info, "marketCap")),
        "trailing_pe": _decimal(_first(info, "trailingPE")),
        "forward_pe": _decimal(_first(info, "forwardPE")),
        "price_to_sales": _decimal(_first(info, "priceToSalesTrailing12Months")),
        "price_to_book": _decimal(_first(info, "priceToBook")),
        "revenue_growth_pct": _decimal(_first(info, "revenueGrowth"), percent_ratio=True),
        "earnings_growth_pct": _decimal(_first(info, "earningsGrowth"), percent_ratio=True),
        "gross_margin_pct": _decimal(_first(info, "grossMargins"), percent_ratio=True),
        "operating_margin_pct": _decimal(_first(info, "operatingMargins"), percent_ratio=True),
        "profit_margin_pct": _decimal(_first(info, "profitMargins"), percent_ratio=True),
        "return_on_equity_pct": _decimal(_first(info, "returnOnEquity"), percent_ratio=True),
        "debt_to_equity": _decimal(_first(info, "debtToEquity")),
        "free_cash_flow": _decimal(_first(info, "freeCashflow")),
        "dividend_yield_pct": _decimal(_first(info, "dividendYield"), percent_ratio=True),
        "beta": _decimal(_first(info, "beta")),
        "fifty_two_week_low": _decimal(
            _first(fast_info, "year_low", "yearLow") or _first(info, "fiftyTwoWeekLow")
        ),
        "fifty_two_week_high": _decimal(
            _first(fast_info, "year_high", "yearHigh") or _first(info, "fiftyTwoWeekHigh")
        ),
        "target_mean_price": _decimal(_first(info, "targetMeanPrice")),
        "analyst_count": _integer(_first(info, "numberOfAnalystOpinions")),
        "as_of": datetime.now(UTC),
        "source": "Yahoo Finance (unofficial, on-demand)",
    }
    if result["current_price"] is None and result["market_cap"] is None and not info:
        raise FundamentalsError(f"No fundamentals found for {ticker_symbol}")
    return result


def get_company_fundamentals(symbol: str, market: str) -> dict[str, Any]:
    if not symbol.strip():
        raise FundamentalsError("Symbol is required")
    cache_bucket = int(time.time() // CACHE_SECONDS)
    return _fetch_cached(symbol.strip().upper(), market.strip().upper() or "US", cache_bucket).copy()
