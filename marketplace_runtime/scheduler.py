from __future__ import annotations

import logging
import os
from threading import Event
from datetime import datetime, timedelta, timezone

from backend.database import SessionLocal
from backend.research.briefing import (
    SHANGHAI,
    market_close_at,
    run_daily_news_generation,
    run_market_close_generation,
    run_startup_generation,
)
from backend.research.service import sync_earnings_events, sync_macro_events, sync_research_news, sync_sec_events


logger = logging.getLogger("portfolio-os.scheduler")
UTC = timezone.utc


def _run_db_job(name: str, callback) -> None:
    with SessionLocal() as db:
        try:
            logger.info("Starting research sync: %s", name)
            callback(db)
            logger.info("Research sync finished: %s", name)
        except Exception:
            db.rollback()
            logger.exception("Research sync failed: %s", name)


def _run_generation(name: str, callback) -> bool:
    try:
        result = callback()
        if result is not None:
            logger.info("Research generation finished: %s %s", name, result.status)
            return True
    except Exception:
        logger.exception("Research generation failed: %s", name)
    return False


def run_scheduler(stop: Event) -> None:
    intervals = {
        "macro": int(os.getenv("RESEARCH_MACRO_INTERVAL_SECONDS", str(6 * 60 * 60))),
        "earnings": int(os.getenv("RESEARCH_EARNINGS_INTERVAL_SECONDS", str(12 * 60 * 60))),
        "sec": int(os.getenv("RESEARCH_SEC_INTERVAL_SECONDS", str(10 * 60))),
        "news": int(os.getenv("RESEARCH_NEWS_INTERVAL_SECONDS", str(60 * 60))),
    }
    jobs = {
        "macro": sync_macro_events,
        "earnings": sync_earnings_events,
        "sec": sync_sec_events,
        "news": sync_research_news,
    }
    next_runs = {name: datetime.min.replace(tzinfo=UTC) for name in jobs}
    next_startup_attempt = datetime.min.replace(tzinfo=UTC)
    last_bedtime_day = None

    while not stop.is_set():
        now = datetime.now(UTC)
        for name, callback in jobs.items():
            if now >= next_runs[name]:
                _run_db_job(name, callback)
                next_runs[name] = now + timedelta(seconds=intervals[name])

        if now >= next_startup_attempt:
            generated = _run_generation("startup", run_startup_generation)
            _run_generation("daily-news", run_daily_news_generation)
            _run_generation("latest-us-close", run_market_close_generation)
            next_startup_attempt = now + (timedelta(days=1) if generated else timedelta(minutes=10))

        shanghai_day = now.astimezone(SHANGHAI).date()
        if last_bedtime_day != shanghai_day and now >= market_close_at(shanghai_day):
            if _run_generation("bedtime", lambda: run_market_close_generation(now, require_schedule=True)):
                last_bedtime_day = shanghai_day

        stop.wait(30)
