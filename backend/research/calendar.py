from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal


UTC = timezone.utc
NEW_YORK = ZoneInfo("America/New_York")
SHANGHAI = ZoneInfo("Asia/Shanghai")


@lru_cache(maxsize=12)
def us_schedule(year: int):
    return mcal.get_calendar("NYSE").schedule(start_date=f"{year}-01-01", end_date=f"{year}-12-31")


def is_us_market_session(day: date) -> bool:
    return day.isoformat() in us_schedule(day.year).index


def us_market_session_close_at(day: date) -> datetime:
    if not is_us_market_session(day):
        raise ValueError(f"{day} 不是美股交易日")
    return us_schedule(day.year).loc[day.isoformat(), "market_close"].to_pydatetime()


def latest_completed_us_session(now: datetime | None = None) -> date:
    current = (now or datetime.now(UTC)).astimezone(UTC)
    for offset in range(20):
        day = current.astimezone(NEW_YORK).date() - timedelta(days=offset)
        if is_us_market_session(day) and us_market_session_close_at(day) <= current:
            return day
    raise ValueError("暂无法确定最近一个已收盘的美股交易日")


def market_context(now: datetime) -> dict:
    local = now.astimezone(NEW_YORK)
    day = local.date()
    state = "休市"
    if is_us_market_session(day):
        session = us_schedule(day.year).loc[day.isoformat()]
        state = "盘前" if now < session.market_open else "盘中" if now < session.market_close else "已收盘"
    return {
        "new_york_time": local.isoformat(),
        "beijing_time": now.astimezone(SHANGHAI).isoformat(),
        "us_market_status": state,
        "latest_completed_us_session": latest_completed_us_session(now).isoformat(),
        "calendar_source": "NYSE / pandas-market-calendars",
    }
