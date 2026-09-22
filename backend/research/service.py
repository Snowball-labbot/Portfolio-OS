from __future__ import annotations

import os
from hashlib import sha256
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import (
    Holding,
    ResearchDocument,
    ResearchEvent,
    ResearchFolder,
    ResearchNewsItem,
    SourceSyncState,
    WatchlistItem,
)
from .sources import (
    ExternalEvent,
    fetch_alpha_vantage_earnings,
    fetch_bea_events,
    fetch_bls_events,
    fetch_fomc_events,
    fetch_sec_filings,
    fetch_sec_ticker_map,
    fetch_reuters_news,
    fetch_yahoo_company_news,
    fetch_yahoo_earnings,
    fetch_yahoo_macro_news,
)
from .translation import normalize_news_key, translate_news_items


UTC = timezone.utc
ROOT_FOLDERS = [
    ("每日简报", "briefs", "每日导入的市场与持仓研究简报"),
    ("宏观研究", "macro", "按时间沉淀宏观研究，通过标签筛选，不强制拆分类别"),
    ("行业研究", "industry", "按产业链建立行业和公司研究目录"),
    ("量化研究", "quant", "保存策略假设、实验记录和回测结论"),
    ("资料收件箱", "inbox", "尚未完成归档的报告、链接和临时笔记"),
    ("每日新闻", "news", "过去24小时与持仓和观察名单相关的新闻简报"),
]


def ensure_root_folders(db: Session, user_id: str) -> list[ResearchFolder]:
    existing = db.scalars(
        select(ResearchFolder).where(ResearchFolder.user_id == user_id, ResearchFolder.parent_id.is_(None))
    ).all()
    by_kind = {folder.kind: folder for folder in existing}
    changed = False
    for index, (name, kind, description) in enumerate(ROOT_FOLDERS):
        current = by_kind.get(kind)
        if current:
            if current.name != name or current.description != description or current.sort_order != index:
                current.name = name
                current.description = description
                current.sort_order = index
                changed = True
            continue
        folder = ResearchFolder(
            user_id=user_id,
            name=name,
            kind=kind,
            description=description,
            sort_order=index,
        )
        db.add(folder)
        existing.append(folder)
        changed = True
    if changed:
        db.commit()
    return sorted(existing, key=lambda item: (item.sort_order, item.created_at))


def get_root_folder(db: Session, user_id: str, kind: str) -> ResearchFolder:
    ensure_root_folders(db, user_id)
    folder = db.scalar(select(ResearchFolder).where(
        ResearchFolder.user_id == user_id,
        ResearchFolder.parent_id.is_(None),
        ResearchFolder.kind == kind,
    ))
    if not folder:
        raise RuntimeError(f"Missing research root folder: {kind}")
    return folder


def _sync_state(db: Session, source: str) -> SourceSyncState:
    state = db.scalar(select(SourceSyncState).where(SourceSyncState.source == source))
    if state:
        return state
    state = SourceSyncState(source=source)
    db.add(state)
    db.flush()
    return state


def mark_sync_started(db: Session, source: str) -> SourceSyncState:
    state = _sync_state(db, source)
    state.status = "running"
    state.last_started_at = datetime.now(UTC)
    state.last_error = None
    db.commit()
    return state


def mark_sync_result(db: Session, source: str, item_count: int, error: str | None = None) -> None:
    state = _sync_state(db, source)
    state.status = "error" if error else "healthy"
    state.item_count = item_count
    state.last_error = error
    if not error:
        state.last_success_at = datetime.now(UTC)
    db.commit()


def upsert_events(db: Session, events: list[ExternalEvent]) -> int:
    def clipped(value: str | None, limit: int) -> str | None:
        return value[:limit] if value else value

    count = 0
    for item in events:
        event_key = item.event_key
        if len(event_key) > 255:
            event_key = f"{event_key[:190]}:{sha256(event_key.encode('utf-8')).hexdigest()}"
        event = db.scalar(select(ResearchEvent).where(
            ResearchEvent.source == item.source,
            ResearchEvent.event_key == event_key,
        ))
        if event is None:
            event = ResearchEvent(source=clipped(item.source, 64), event_key=event_key, event_type=item.event_type, title=item.title[:500])
            db.add(event)
        event.event_type = item.event_type
        event.title = item.title[:500]
        event.description = item.description
        event.country = clipped(item.country, 8)
        event.ticker = clipped(item.ticker, 32)
        event.company_name = clipped(item.company_name, 255)
        event.indicator_code = clipped(item.indicator_code, 64)
        event.reference_period = clipped(item.reference_period, 64)
        event.scheduled_at = item.scheduled_at
        event.time_precision = clipped(item.time_precision, 16) or "exact"
        event.status = clipped(item.status, 32) or "scheduled"
        event.importance = item.importance
        event.source_url = clipped(item.source_url, 1000)
        event.actual = clipped(item.actual, 64)
        event.consensus = clipped(item.consensus, 64)
        event.previous = clipped(item.previous, 64)
        event.unit = clipped(item.unit, 32)
        event.published_at = item.published_at
        event.raw_data = item.raw_data
        count += 1
    db.commit()
    return count


def upsert_news(db: Session, items) -> int:
    count = 0
    for item in items:
        news_key = normalize_news_key(item.news_key)
        record = db.scalar(select(ResearchNewsItem).where(
            ResearchNewsItem.source == item.source[:128],
            ResearchNewsItem.news_key == news_key,
        ))
        if record is None:
            record = ResearchNewsItem(
                source=item.source[:128],
                news_key=news_key,
                title=item.title[:1000],
                source_url=item.source_url[:1500],
                published_at=item.published_at,
            )
            db.add(record)
        record.title = item.title[:1000]
        record.summary = item.summary
        record.source_domain = item.source_domain[:255] if item.source_domain else None
        record.source_url = item.source_url[:1500]
        record.published_at = item.published_at
        record.ticker = item.ticker[:32] if item.ticker else None
        record.topic = item.topic[:32]
        record.language = item.language[:16]
        record.image_url = item.image_url[:1500] if item.image_url else None
        record.raw_data = {**(record.raw_data or {}), **item.raw_data}
        count += 1
    db.execute(delete(ResearchNewsItem).where(
        ResearchNewsItem.published_at < datetime.now(UTC) - timedelta(days=45)
    ))
    db.commit()
    return count


def sync_macro_events(db: Session, days_back: int = 3, days_forward: int = 120) -> dict[str, int]:
    now = datetime.now(UTC)
    start = now - timedelta(days=days_back)
    end = now + timedelta(days=days_forward)
    sources = {
        "BLS": lambda: fetch_bls_events(start, end),
        "BEA": lambda: fetch_bea_events(start, end),
        "Federal Reserve": lambda: fetch_fomc_events(start, end),
    }
    result: dict[str, int] = {}
    for source, loader in sources.items():
        mark_sync_started(db, source)
        try:
            events = loader()
            result[source] = upsert_events(db, events)
            mark_sync_result(db, source, result[source])
        except Exception as exc:
            db.rollback()
            result[source] = 0
            mark_sync_result(db, source, 0, str(exc)[:1000])
    return result


def sync_earnings_events(db: Session) -> int:
    source = "Earnings Calendar"
    api_key = os.getenv("ALPHA_VANTAGE_API_KEY", "").strip()
    symbols = set(db.scalars(select(WatchlistItem.symbol).where(WatchlistItem.market == "US")).all())
    symbols.update(
        symbol.upper()
        for symbol in db.scalars(select(Holding.symbol).where(Holding.market == "US", Holding.symbol.is_not(None))).all()
        if symbol
    )
    mark_sync_started(db, source)
    try:
        events = fetch_alpha_vantage_earnings(symbols, api_key) if api_key else []
        if not events:
            events = fetch_yahoo_earnings(symbols)
        count = upsert_events(db, events)
        mark_sync_result(db, source, count)
        return count
    except Exception as exc:
        db.rollback()
        mark_sync_result(db, source, 0, str(exc)[:1000])
        return 0


def sync_sec_events(db: Session, days_back: int = 7) -> int:
    source = "SEC EDGAR"
    mark_sync_started(db, source)
    items = db.scalars(select(WatchlistItem).where(WatchlistItem.market == "US")).all()
    watchlist_by_symbol = {item.symbol.strip().upper(): item for item in items}
    symbols = set(watchlist_by_symbol)
    symbols.update(
        symbol.strip().upper()
        for symbol in db.scalars(
            select(Holding.symbol).where(Holding.market == "US", Holding.symbol.is_not(None))
        ).all()
        if symbol
    )
    if not symbols:
        mark_sync_result(db, source, 0)
        return 0

    try:
        ticker_map = fetch_sec_ticker_map()
        events: list[ExternalEvent] = []
        for symbol in sorted(symbols):
            item = watchlist_by_symbol.get(symbol)
            mapped = ticker_map.get(symbol, {})
            cik = (item.cik if item else None) or str(mapped.get("cik_str") or "")
            if not cik:
                continue
            if item and not item.cik:
                item.cik = str(cik).zfill(10)
            events.extend(fetch_sec_filings(symbol, cik, date.today() - timedelta(days=days_back)))
        db.commit()
        count = upsert_events(db, events)
        mark_sync_result(db, source, count)
        return count
    except Exception as exc:
        db.rollback()
        mark_sync_result(db, source, 0, str(exc)[:1000])
        return 0


def sync_research_news(db: Session) -> int:
    symbols = set(db.scalars(select(WatchlistItem.symbol).where(WatchlistItem.market == "US")).all())
    symbols.update(
        symbol
        for symbol in db.scalars(
            select(Holding.symbol)
            .where(Holding.market == "US", Holding.symbol.is_not(None))
            .order_by(Holding.current_value_cny.desc())
            .limit(20)
        ).all()
        if symbol
    )
    normalized = {symbol.strip().upper() for symbol in symbols if symbol}
    count = 0
    sources = {
        "Yahoo Finance News": lambda: [*fetch_yahoo_macro_news(), *fetch_yahoo_company_news(normalized)],
        "Reuters News": lambda: fetch_reuters_news(normalized),
    }
    for source, loader in sources.items():
        mark_sync_started(db, source)
        try:
            source_items = loader()
            translate_news_items(db, source_items)
            saved = upsert_news(db, source_items)
            mark_sync_result(db, source, saved)
            count += saved
        except Exception as exc:
            db.rollback()
            mark_sync_result(db, source, 0, str(exc)[:1000])

    return count


def user_research_packet(db: Session, user_id: str, target_date: date) -> dict:
    start = datetime.combine(target_date, datetime.min.time(), UTC)
    end = start + timedelta(days=7)
    watchlist = db.scalars(select(WatchlistItem).where(WatchlistItem.user_id == user_id)).all()
    holdings = db.scalars(select(Holding).where(Holding.user_id == user_id)).all()
    symbols = {item.symbol.strip().upper() for item in watchlist if item.symbol}
    symbols.update(item.symbol.strip().upper() for item in holdings if item.symbol)
    events = db.scalars(
        select(ResearchEvent)
        .where(
            ResearchEvent.scheduled_at >= start,
            ResearchEvent.scheduled_at < end,
        )
        .order_by(ResearchEvent.scheduled_at, ResearchEvent.importance.desc())
    ).all()
    visible_events = [
        event
        for event in events
        if event.ticker is None or event.ticker.strip().upper() in symbols
    ]
    news = db.scalars(
        select(ResearchNewsItem)
        .where(ResearchNewsItem.published_at >= start - timedelta(days=2), ResearchNewsItem.published_at < end)
        .order_by(ResearchNewsItem.published_at.desc())
    ).all()
    visible_news = []
    seen_news_urls: set[str] = set()
    for item in news:
        if item.ticker and item.ticker.strip().upper() not in symbols:
            continue
        if item.source_url in seen_news_urls:
            continue
        seen_news_urls.add(item.source_url)
        visible_news.append(item)
        if len(visible_news) >= 20:
            break
    total_value = sum((item.current_value_cny for item in holdings), Decimal("0"))
    return {
        "schema_version": "research_packet_v1",
        "date": target_date.isoformat(),
        "generated_at": datetime.now(UTC).isoformat(),
        "portfolio": {
            "total_value_cny": float(total_value),
            "holdings": [
                {
                    "symbol": item.symbol,
                    "name": item.name,
                    "type": item.type,
                    "market": item.market,
                    "value_cny": float(item.current_value_cny),
                    "weight_pct": float(item.current_value_cny / total_value * 100) if total_value else 0,
                    "unrealized_gain_cny": float(item.unrealized_gain_cny),
                }
                for item in holdings
            ],
        },
        "watchlist": [
            {
                "symbol": item.symbol,
                "name": item.name,
                "industry": item.industry,
                "stance": item.stance,
                "thesis": item.thesis,
                "risks": item.risks,
                "invalidation": item.invalidation,
            }
            for item in watchlist
        ],
        "events_next_7_days": [
            {
                "type": event.event_type,
                "title": event.title,
                "ticker": event.ticker,
                "scheduled_at": event.scheduled_at.isoformat() if event.scheduled_at else None,
                "status": event.status,
                "importance": event.importance,
                "source": event.source,
                "source_url": event.source_url,
                "consensus": event.consensus,
                "previous": event.previous,
            }
            for event in visible_events
        ],
        "recent_news": [
            {
                "title": item.title,
                "summary": item.summary,
                "ticker": item.ticker,
                "topic": item.topic,
                "source": item.source,
                "published_at": item.published_at.isoformat(),
                "source_url": item.source_url,
            }
            for item in visible_news
        ],
        "writing_requirements": {
            "language": "zh-CN",
            "sections": ["今日结论", "未来七天关键事件", "持仓与观察名单影响", "需要继续研究的问题"],
            "rules": ["区分事实与推断", "引用 source_url", "不编造一致预期", "不输出确定性买卖指令"],
        },
    }


def save_brief_document(db: Session, user_id: str, payload: dict) -> ResearchDocument:
    folder = get_root_folder(db, user_id, "briefs")
    document = ResearchDocument(
        user_id=user_id,
        folder_id=folder.id,
        document_type="brief",
        title=payload["title"],
        summary=payload.get("summary"),
        content_markdown=payload["content_markdown"],
        tags=list(dict.fromkeys(["每日简报", *payload.get("tags", [])])),
        source_url=payload.get("source_url"),
        as_of_date=payload["as_of_date"],
        status="published",
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document
