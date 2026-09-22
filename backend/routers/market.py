from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status

from ..dependencies import get_current_user
from ..market_data import MarketDataError, get_currency_cny_rate, get_historical_quote, get_quote, search_instrument
from ..models import User
from ..schemas import FxRateOut, MarketQuoteOut, MarketSearchResult

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/fx", response_model=FxRateOut)
def currency_rate(currency: str, date: str | None = None, user: User = Depends(get_current_user)) -> dict:
    try:
        target_date = datetime.fromisoformat(date).date() if date else None
        rate, source = get_currency_cny_rate(currency, target_date)
    except (ValueError, MarketDataError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {
        "currency": currency.upper(),
        "exchange_rate_to_cny": rate,
        "quote_source": source,
        "updated_at": datetime.now(timezone.utc),
    }


@router.get("/search", response_model=list[MarketSearchResult])
def search_market(q: str, market: str = "CN", user: User = Depends(get_current_user)) -> list[dict]:
    try:
        return search_instrument(q, market)
    except MarketDataError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/quote", response_model=MarketQuoteOut)
def quote_market(market: str, symbol: str, kind: str = "fund", user: User = Depends(get_current_user)) -> dict:
    try:
        quote = get_quote(market, symbol, kind)
    except MarketDataError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    # Keep the wire shape stable even when upstream returns Decimal-like objects.
    quote["exchange_rate_to_cny"] = Decimal(quote["exchange_rate_to_cny"])
    quote["price"] = Decimal(quote["price"])
    return quote


@router.get("/historical", response_model=MarketQuoteOut)
def historical_quote(market: str, symbol: str, kind: str, date: str, user: User = Depends(get_current_user)) -> dict:
    del user
    try:
        trade_date = datetime.fromisoformat(date).date()
        quote = get_historical_quote(market, symbol, kind, trade_date)
    except (ValueError, MarketDataError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    quote["exchange_rate_to_cny"] = Decimal(quote["exchange_rate_to_cny"])
    quote["price"] = Decimal(quote["price"])
    return quote
