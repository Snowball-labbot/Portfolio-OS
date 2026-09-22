from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone

from ..database import Base, SessionLocal, engine
from ..migrations import ensure_lightweight_migrations
from .service import sync_earnings_events, sync_macro_events, sync_research_news, sync_sec_events
from .briefing import (
    SHANGHAI,
    latest_completed_us_session,
    market_close_at,
    run_daily_news_generation,
    run_market_close_generation,
    run_startup_generation,
)


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("research-worker")
UTC = timezone.utc


def run_job(name: str, callback) -> None:
    with SessionLocal() as db:
        try:
            result = callback(db)
            logger.info("Research job %s finished: %s", name, result)
        except Exception:
            db.rollback()
            logger.exception("Research job %s failed", name)


def run_generation_job(name: str, callback) -> None:
    try:
        result = callback()
        if result is not None:
            logger.info("Research generation %s finished: %s %s", name, result.status, result.id)
    except Exception:
        logger.exception("Research generation %s failed", name)


def main() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_lightweight_migrations(engine)
    macro_interval = int(os.getenv("RESEARCH_MACRO_INTERVAL_SECONDS", str(6 * 60 * 60)))
    earnings_interval = int(os.getenv("RESEARCH_EARNINGS_INTERVAL_SECONDS", str(12 * 60 * 60)))
    sec_interval = int(os.getenv("RESEARCH_SEC_INTERVAL_SECONDS", str(10 * 60)))
    news_interval = int(os.getenv("RESEARCH_NEWS_INTERVAL_SECONDS", str(60 * 60)))
    next_runs = {
        "macro": datetime.min.replace(tzinfo=UTC),
        "earnings": datetime.min.replace(tzinfo=UTC),
        "sec": datetime.min.replace(tzinfo=UTC),
        "news": datetime.min.replace(tzinfo=UTC),
    }
    startup_generation_pending = True
    last_bedtime_attempt = None
    logger.info("Research worker started")
    while True:
        now = datetime.now(UTC)
        if now >= next_runs["macro"]:
            run_job("macro", sync_macro_events)
            next_runs["macro"] = now + timedelta(seconds=macro_interval)
        if now >= next_runs["earnings"]:
            run_job("earnings", sync_earnings_events)
            next_runs["earnings"] = now + timedelta(seconds=earnings_interval)
        if now >= next_runs["sec"]:
            run_job("sec", sync_sec_events)
            next_runs["sec"] = now + timedelta(seconds=sec_interval)
        if now >= next_runs["news"]:
            run_job("news", sync_research_news)
            next_runs["news"] = now + timedelta(seconds=news_interval)
        if startup_generation_pending:
            startup_generation_pending = False
            run_generation_job("startup", run_startup_generation)
            # A worker restart is also a valid catch-up point for the latest
            # completed US session; the idempotency key prevents duplicates.
            run_generation_job("startup-market-close", run_market_close_generation)
            run_generation_job("startup-news", run_daily_news_generation)
        now = datetime.now(UTC)
        shanghai_day = now.astimezone(SHANGHAI).date()
        if (
            (last_bedtime_attempt is None or now - last_bedtime_attempt >= timedelta(minutes=10))
            and now >= market_close_at(shanghai_day)
        ):
            last_bedtime_attempt = now
            run_generation_job("bedtime", lambda: run_market_close_generation(now, require_schedule=True))
        time.sleep(30)


if __name__ == "__main__":
    main()
