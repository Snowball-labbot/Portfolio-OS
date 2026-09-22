import asyncio
import logging
import os
from decimal import Decimal

from sqlalchemy import select

from .database import SessionLocal
from .market_data import MarketDataError, get_quote, resolve_quote_exchange_rate
from .models import Holding
from .services import apply_market_price


logger = logging.getLogger(__name__)

DEFAULT_REFRESH_INTERVAL_SECONDS = 5 * 60
STARTUP_DELAY_SECONDS = 2


def refresh_all_prices_once() -> dict[str, int]:
    refreshed = 0
    failed = 0
    skipped = 0

    with SessionLocal() as db:
      holdings = db.scalars(
          select(Holding).where(
              Holding.market.is_not(None),
              Holding.symbol.is_not(None),
              Holding.archived_at.is_(None),
          )
      ).all()

      for holding in holdings:
          if not holding.market or not holding.symbol:
              skipped += 1
              continue

          kind = "stock" if holding.market.upper() == "US" else "fund"
          try:
              quote = get_quote(holding.market, holding.symbol, kind)
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
              refreshed += 1
          except MarketDataError as exc:
              db.rollback()
              failed += 1
              logger.warning("Market refresh failed for %s %s: %s", holding.market, holding.symbol, exc)
          except Exception:
              db.rollback()
              failed += 1
              logger.exception("Unexpected market refresh failure for holding %s", holding.id)

    return {"refreshed": refreshed, "failed": failed, "skipped": skipped}


async def market_refresh_loop() -> None:
    interval = int(os.getenv("MARKET_REFRESH_INTERVAL_SECONDS", str(DEFAULT_REFRESH_INTERVAL_SECONDS)))
    await asyncio.sleep(STARTUP_DELAY_SECONDS)

    while True:
        try:
            result = await asyncio.to_thread(refresh_all_prices_once)
            logger.info("Market auto refresh finished: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Market auto refresh loop failed")
        await asyncio.sleep(interval)
