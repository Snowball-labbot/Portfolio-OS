from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..database import SessionLocal, get_db
from ..dependencies import get_current_user
from ..models import (
    Holding,
    ResearchAttachment,
    ResearchDocument,
    ResearchEvent,
    ResearchFolder,
    ResearchGenerationRun,
    ResearchNewsItem,
    QuantExperiment,
    SourceSyncState,
    User,
    WatchlistItem,
)
from ..schemas import (
    ResearchBriefImportIn,
    ResearchDocumentCreateIn,
    ResearchDocumentOut,
    ResearchDocumentUpdateIn,
    ResearchEventOut,
    ResearchFolderCreateIn,
    ResearchFolderOut,
    ResearchGenerationRequest,
    ResearchGenerationRunOut,
    ResearchGenerationStatusOut,
    ResearchImportConfirmIn,
    ResearchImportDraftOut,
    ResearchImportOrganizeIn,
    ResearchImportPreviewOut,
    ResearchNewsOut,
    CompanyCoverageOut,
    CompanyDossierOut,
    CompanyFundamentalsOut,
    DecisionQueueItemOut,
    QuantExperimentCreateIn,
    QuantExperimentOut,
    QuantExperimentUpdateIn,
    WatchlistCreateIn,
    WatchlistOut,
    WatchlistUpdateIn,
)
from ..research.service import (
    ensure_root_folders,
    get_root_folder,
    save_brief_document,
    sync_earnings_events,
    sync_macro_events,
    sync_research_news,
    sync_sec_events,
    user_research_packet,
)
from ..research.fundamentals import FundamentalsError, get_company_fundamentals
from ..research.briefing import (
    BRIEF_REPORT_KINDS,
    agnes_is_configured,
    execute_generation_run,
    generation_status,
    is_us_market_session,
    latest_completed_us_session,
    latest_successful_run,
    queue_generation,
    shanghai_today,
)
from ..research.document_import import (
    MAX_IMPORT_BYTES,
    DocumentImportError,
    extract_research_file,
    organize_research_import,
    safe_filename,
    suggest_import_metadata,
)


router = APIRouter(prefix="/api/research", tags=["research"])
UTC = timezone.utc
LOW_SIGNAL_NEWS_SOURCES = {"Motley Fool", "24/7 Wall St.", "Insider Monkey"}


def _user_folder(db: DbSession, user_id: str, folder_id: str) -> ResearchFolder:
    folder = db.get(ResearchFolder, folder_id)
    if not folder or folder.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research folder not found")
    return folder


def _user_document(db: DbSession, user_id: str, document_id: str) -> ResearchDocument:
    document = db.get(ResearchDocument, document_id)
    if not document or document.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research document not found")
    return document


def _user_attachment(db: DbSession, user_id: str, attachment_id: str) -> ResearchAttachment:
    attachment = db.get(ResearchAttachment, attachment_id)
    if not attachment or attachment.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research attachment not found")
    return attachment


def _validate_import_scope(scope: str) -> str:
    normalized = scope.strip().lower()
    if normalized not in {"macro", "industry", "quant"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="资料只能导入宏观、行业或量化研究目录")
    return normalized


def _user_watchlist_item(db: DbSession, user_id: str, item_id: str) -> WatchlistItem:
    item = db.get(WatchlistItem, item_id)
    if not item or item.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist item not found")
    return item


def _user_experiment(db: DbSession, user_id: str, experiment_id: str) -> QuantExperiment:
    experiment = db.get(QuantExperiment, experiment_id)
    if not experiment or experiment.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quant experiment not found")
    return experiment


def _coverage_key(market: str | None, symbol: str | None) -> tuple[str, str]:
    normalized_market = (market or "US").strip().upper()
    normalized_symbol = (symbol or "").strip().upper()
    if normalized_market == "KR":
        normalized_symbol = normalized_symbol.removesuffix(".KS").removesuffix(".KQ")
    return normalized_market, normalized_symbol


def _company_coverage(db: DbSession, user_id: str) -> list[dict]:
    holdings = db.scalars(
        select(Holding).where(Holding.user_id == user_id).order_by(Holding.name)
    ).all()
    total_value = sum((item.current_value_cny or Decimal("0")) for item in holdings)
    stock_holdings = [item for item in holdings if item.type == "stock" and item.symbol]
    watchlist = db.scalars(
        select(WatchlistItem).where(WatchlistItem.user_id == user_id).order_by(WatchlistItem.symbol)
    ).all()

    rows: dict[tuple[str, str], dict] = {}
    for holding in stock_holdings:
        key = _coverage_key(holding.market, holding.symbol)
        value = holding.current_value_cny or Decimal("0")
        row = rows.setdefault(key, {
            "symbol": key[1],
            "name": holding.instrument_name or holding.name,
            "market": key[0],
            "currency": holding.currency,
            "industry": None,
            "stance": "holding",
            "thesis": None,
            "next_review_at": None,
            "in_portfolio": True,
            "holding_value_cny": Decimal("0"),
            "portfolio_weight_pct": Decimal("0"),
            "watchlist_id": None,
        })
        row["holding_value_cny"] += value

    for item in watchlist:
        key = _coverage_key(item.market, item.symbol)
        row = rows.setdefault(key, {
            "symbol": key[1],
            "name": item.name,
            "market": key[0],
            "currency": item.currency,
            "industry": item.industry,
            "stance": item.stance,
            "thesis": item.thesis,
            "next_review_at": item.next_review_at,
            "in_portfolio": False,
            "holding_value_cny": Decimal("0"),
            "portfolio_weight_pct": Decimal("0"),
            "watchlist_id": item.id,
        })
        row.update({
            "name": item.name or row["name"],
            "currency": item.currency or row["currency"],
            "industry": item.industry,
            "stance": item.stance,
            "thesis": item.thesis,
            "next_review_at": item.next_review_at,
            "watchlist_id": item.id,
        })

    for row in rows.values():
        if total_value > 0:
            row["portfolio_weight_pct"] = (
                row["holding_value_cny"] / total_value * Decimal("100")
            ).quantize(Decimal("0.01"))
    return sorted(
        rows.values(),
        key=lambda row: (-row["holding_value_cny"], row["market"], row["symbol"]),
    )


def _decision_queue(
    events: list[ResearchEvent],
    watchlist: list[WatchlistItem],
    now: datetime,
) -> list[dict]:
    queue: list[dict] = []
    for event in events:
        due_at = event.scheduled_at
        if event.importance < 2 or not due_at:
            continue
        hours_until = (due_at - now).total_seconds() / 3600
        if hours_until > 72 or hours_until < -12:
            continue
        priority = 3 if event.importance >= 3 or hours_until <= 24 else 2
        queue.append({
            "id": f"event:{event.id}",
            "kind": event.event_type,
            "priority": priority,
            "title": event.title,
            "description": (
                f"{event.company_name or event.country or event.source} · "
                f"实际 {event.actual or '待发布'} / 预期 {event.consensus or '未提供'}"
            ),
            "due_at": due_at,
            "symbol": event.ticker,
            "target_view": "research",
            "source_url": event.source_url,
        })

    for item in watchlist:
        if item.next_review_at and item.next_review_at <= now + timedelta(days=7):
            overdue = item.next_review_at < now
            queue.append({
                "id": f"review:{item.id}",
                "kind": "review",
                "priority": 3 if overdue else 2,
                "title": f"复核 {item.symbol} 投资论点",
                "description": "已超过复核日" if overdue else "未来七天到达复核日",
                "due_at": item.next_review_at,
                "symbol": item.symbol,
                "target_view": "industry",
                "source_url": item.ir_url,
            })
        if not item.thesis or not item.thesis.strip():
            queue.append({
                "id": f"thesis:{item.id}",
                "kind": "thesis",
                "priority": 1,
                "title": f"补全 {item.symbol} 核心投资逻辑",
                "description": "观察名单尚未记录可证伪的投资论点",
                "due_at": None,
                "symbol": item.symbol,
                "target_view": "industry",
                "source_url": item.ir_url,
            })

    def sort_key(item: dict) -> tuple:
        due = item["due_at"] or datetime.max.replace(tzinfo=UTC)
        return (-item["priority"], due, item["title"])

    return sorted(queue, key=sort_key)[:10]


def _company_dossier_template(name: str, symbol: str, market: str) -> str:
    return f"""# {name}（{symbol}）投资研究

> 市场：{market}
> 当前观点：研究中
> 本文用于记录可复核的研究过程，不构成投资建议。

## 决策摘要

- 为什么现在研究：
- 当前结论：
- 最大的不确定性：

## 核心投资逻辑

1. 待补充
2. 待补充
3. 待补充

## 反方证据与证伪条件

- 哪些事实会推翻当前判断：
- 市场可能比我更正确的地方：

## 商业模式与关键经营指标

| 指标 | 当前值 | 趋势 | 数据来源 | 下一次更新 |
| --- | ---: | --- | --- | --- |
| 收入增长 |  |  |  |  |
| 毛利率 |  |  |  |  |
| 自由现金流 |  |  |  |  |

## 财务质量与资本配置


## 估值情景

| 情景 | 核心假设 | 合理价值 | 触发条件 |
| --- | --- | ---: | --- |
| 乐观 |  |  |  |
| 基准 |  |  |  |
| 悲观 |  |  |  |

## 催化剂与时间表


## 主要风险


## 证据日志

- YYYY-MM-DD：事实 / 来源 / 对论点的影响

## 下一次复核清单

- [ ] 更新关键经营指标
- [ ] 检查反方证据
- [ ] 复核估值假设
"""


def _run_refresh_jobs() -> None:
    with SessionLocal() as db:
        sync_macro_events(db)
        sync_earnings_events(db)
        sync_sec_events(db)
        sync_research_news(db)


def _user_symbols(db: DbSession, user_id: str) -> set[str]:
    symbols = {
        symbol.strip().upper()
        for symbol in db.scalars(select(WatchlistItem.symbol).where(WatchlistItem.user_id == user_id)).all()
        if symbol
    }
    symbols.update(
        symbol.strip().upper()
        for symbol in db.scalars(
            select(Holding.symbol).where(Holding.user_id == user_id, Holding.symbol.is_not(None))
        ).all()
        if symbol
    )
    return symbols


def _visible_events(db: DbSession, user_id: str, start: datetime, end: datetime) -> list[ResearchEvent]:
    symbols = _user_symbols(db, user_id)
    events = db.scalars(
        select(ResearchEvent)
        .where(ResearchEvent.scheduled_at >= start, ResearchEvent.scheduled_at < end)
        .order_by(ResearchEvent.scheduled_at, ResearchEvent.importance.desc())
    ).all()
    return [
        event
        for event in events
        if event.ticker is None or event.ticker.strip().upper() in symbols
    ]


def _visible_news(
    db: DbSession,
    user_id: str,
    start: datetime,
    end: datetime,
    limit: int = 30,
) -> list[ResearchNewsItem]:
    symbols = _user_symbols(db, user_id)
    items = db.scalars(
        select(ResearchNewsItem)
        .where(ResearchNewsItem.published_at >= start, ResearchNewsItem.published_at < end)
        .order_by(ResearchNewsItem.published_at.desc())
        .limit(limit * 8)
    ).all()
    candidates: list[ResearchNewsItem] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    for item in items:
        if item.ticker and item.ticker.strip().upper() not in symbols:
            continue
        if item.source_url in seen_urls:
            continue
        title_key = "".join(character for character in item.title.casefold() if character.isalnum())
        if title_key in seen_titles:
            continue
        seen_urls.add(item.source_url)
        seen_titles.add(title_key)
        candidates.append(item)

    def priority(item: ResearchNewsItem) -> tuple:
        source = item.source.strip()
        return (
            0 if source == "Reuters" else 1,
            0 if item.ticker else 1,
            1 if source in LOW_SIGNAL_NEWS_SOURCES else 0,
            -item.published_at.timestamp(),
        )

    reuters = sorted((item for item in candidates if item.source.strip() == "Reuters"), key=priority)
    others = sorted((item for item in candidates if item.source.strip() != "Reuters"), key=priority)
    selected = reuters[: min(len(reuters), max(1, (limit * 2) // 3))]
    low_signal_count = 0
    for item in others:
        if item.source.strip() in LOW_SIGNAL_NEWS_SOURCES:
            if low_signal_count >= 2:
                continue
            low_signal_count += 1
        selected.append(item)
        if len(selected) >= limit:
            break
    if len(selected) < limit:
        for item in reuters:
            if item not in selected:
                selected.append(item)
            if len(selected) >= limit:
                break
    return sorted(selected[:limit], key=priority)


@router.get("/dashboard")
def research_dashboard(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    folders = ensure_root_folders(db, user.id)
    now = datetime.now(UTC)
    events = _visible_events(db, user.id, now - timedelta(hours=12), now + timedelta(days=14))
    news = _visible_news(db, user.id, now - timedelta(days=3), now + timedelta(hours=1), limit=12)
    documents = db.scalars(
        select(ResearchDocument)
        .where(ResearchDocument.user_id == user.id)
        .order_by(ResearchDocument.updated_at.desc())
        .limit(6)
    ).all()
    watchlist = db.scalars(
        select(WatchlistItem).where(WatchlistItem.user_id == user.id).order_by(WatchlistItem.symbol)
    ).all()
    coverage = _company_coverage(db, user.id)
    decision_queue = _decision_queue(events, watchlist, now)
    active_sources = ["BLS", "BEA", "Federal Reserve", "Earnings Calendar", "SEC EDGAR", "Reuters News", "Yahoo Finance News"]
    source_states = db.scalars(
        select(SourceSyncState)
        .where(SourceSyncState.source.in_(active_sources))
        .order_by(SourceSyncState.source)
    ).all()
    return {
        "today": date.today().isoformat(),
        "events": [ResearchEventOut.model_validate(item).model_dump(mode="json") for item in events],
        "news": [ResearchNewsOut.model_validate(item).model_dump(mode="json") for item in news],
        "recent_documents": [ResearchDocumentOut.model_validate(item).model_dump(mode="json") for item in documents],
        "watchlist": [WatchlistOut.model_validate(item).model_dump(mode="json") for item in watchlist],
        "coverage": [CompanyCoverageOut.model_validate(item).model_dump(mode="json") for item in coverage],
        "decision_queue": [DecisionQueueItemOut.model_validate(item).model_dump(mode="json") for item in decision_queue],
        "folders": [ResearchFolderOut.model_validate(item).model_dump(mode="json") for item in folders],
        "sources": [{
            "source": item.source,
            "status": item.status,
            "last_success_at": item.last_success_at.isoformat() if item.last_success_at else None,
            "last_error": item.last_error,
            "item_count": item.item_count,
        } for item in source_states],
    }


@router.get("/events", response_model=list[ResearchEventOut])
def list_events(
    days: int = Query(default=30, ge=1, le=180),
    event_type: str | None = None,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[ResearchEvent]:
    now = datetime.now(UTC)
    events = _visible_events(db, user.id, now - timedelta(days=3), now + timedelta(days=days))
    return [item for item in events if not event_type or item.event_type == event_type]


@router.get("/news", response_model=list[ResearchNewsOut])
def list_news(
    days: int = Query(default=7, ge=1, le=30),
    topic: str | None = None,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[ResearchNewsItem]:
    now = datetime.now(UTC)
    items = _visible_news(db, user.id, now - timedelta(days=days), now + timedelta(hours=1), limit=100)
    return [item for item in items if not topic or item.topic == topic]


@router.post("/refresh")
def refresh_research_sources(
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
) -> dict:
    del user
    background_tasks.add_task(_run_refresh_jobs)
    return {"ok": True, "message": "Research source refresh started"}


@router.get("/generation-status", response_model=ResearchGenerationStatusOut)
def get_generation_status(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    return generation_status(db, user)


@router.post("/generate-brief", response_model=ResearchGenerationRunOut, status_code=status.HTTP_202_ACCEPTED)
def generate_research_brief(
    payload: ResearchGenerationRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> ResearchGenerationRun:
    if not agnes_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agnes API is not configured. Open the platform from the DSH research profile or configure Agnes for the backend.",
        )
    if payload.kind == "market_close" and payload.period_start is None and payload.period_end is None:
        period_end = latest_completed_us_session()
        period_start = period_end
    else:
        period_end = payload.period_end or shanghai_today()
        period_start = payload.period_start or period_end
    if payload.kind == "catchup" and payload.period_start is None:
        latest = latest_successful_run(db, user.id, BRIEF_REPORT_KINDS)
        if latest and latest.period_end < period_end:
            period_start = latest.period_end + timedelta(days=1)
    if period_start > period_end:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="period_start cannot be after period_end")
    if period_end > shanghai_today():
        raise HTTPException(status_code=422, detail="不能生成未来日期的复盘")
    if payload.kind == "market_close" and period_end > latest_completed_us_session():
        raise HTTPException(status_code=422, detail="该美股交易日尚未收盘")
    if payload.kind == "market_close" and not is_us_market_session(period_end):
        raise HTTPException(status_code=422, detail="该日期为美股休市日，请选择交易日")
    run, should_execute = queue_generation(
        db,
        user,
        payload.kind,
        period_start,
        period_end,
        force=payload.force or payload.kind == "manual",
    )
    if should_execute:
        background_tasks.add_task(execute_generation_run, run.id)
    return run


@router.post("/imports/preview", response_model=ResearchImportPreviewOut)
async def preview_research_import(
    file: UploadFile = File(...),
    scope: str = Form("industry"),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    normalized_scope = _validate_import_scope(scope)
    filename = safe_filename(file.filename)
    try:
        data = await file.read(MAX_IMPORT_BYTES + 1)
        extracted = extract_research_file(filename, file.content_type, data)
    except DocumentImportError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    finally:
        await file.close()

    attachment = ResearchAttachment(
        user_id=user.id,
        scope=normalized_scope,
        original_filename=extracted["original_filename"],
        content_type=extracted["content_type"],
        size_bytes=extracted["size_bytes"],
        sha256=extracted["sha256"],
        extracted_text=extracted["extracted_text"],
        extraction_method=extracted["extraction_method"],
        status="staged",
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    duplicate = db.scalar(
        select(ResearchAttachment)
        .where(
            ResearchAttachment.user_id == user.id,
            ResearchAttachment.sha256 == attachment.sha256,
            ResearchAttachment.status == "imported",
            ResearchAttachment.id != attachment.id,
        )
        .order_by(ResearchAttachment.created_at.desc())
    )
    metadata = suggest_import_metadata(
        attachment.original_filename,
        attachment.extracted_text,
        normalized_scope,
    )
    warnings = list(extracted["warnings"])
    if duplicate:
        warnings.append(f"检测到相同文件已导入：{duplicate.original_filename}，确认时将阻止重复创建。")
    return {
        "attachment_id": attachment.id,
        "original_filename": attachment.original_filename,
        "content_type": attachment.content_type,
        "size_bytes": attachment.size_bytes,
        "sha256": attachment.sha256,
        "extraction_method": attachment.extraction_method,
        "extracted_text": attachment.extracted_text,
        "extracted_chars": len(attachment.extracted_text),
        "suggested_title": metadata["title"],
        "suggested_summary": metadata["summary"],
        "suggested_tags": metadata["tags"],
        "suggested_document_type": metadata["document_type"],
        "warnings": warnings,
        "duplicate_document_id": duplicate.document_id if duplicate else None,
        "duplicate_filename": duplicate.original_filename if duplicate else None,
    }


@router.post("/imports/{attachment_id}/organize", response_model=ResearchImportDraftOut)
def organize_research_import_route(
    attachment_id: str,
    payload: ResearchImportOrganizeIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    attachment = _user_attachment(db, user.id, attachment_id)
    _user_folder(db, user.id, payload.folder_id)
    document_type = payload.document_type or attachment.scope
    if document_type not in {"macro", "industry", "quant", "note"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="导入资料的研究类型不受支持")
    organized = organize_research_import(
        filename=attachment.original_filename,
        extraction_method=attachment.extraction_method,
        text=attachment.extracted_text,
        scope=attachment.scope,
    )
    organized["document_type"] = document_type
    organized["attachment_id"] = attachment.id
    return organized


@router.post("/imports/{attachment_id}/confirm", response_model=ResearchDocumentOut)
def confirm_research_import(
    attachment_id: str,
    payload: ResearchImportConfirmIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> ResearchDocument:
    attachment = _user_attachment(db, user.id, attachment_id)
    _user_folder(db, user.id, payload.folder_id)
    if payload.document_type not in {"macro", "industry", "quant", "note", "company"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="导入资料的研究类型不受支持")

    duplicate = db.scalar(
        select(ResearchAttachment)
        .where(
            ResearchAttachment.user_id == user.id,
            ResearchAttachment.sha256 == attachment.sha256,
            ResearchAttachment.document_id.is_not(None),
            ResearchAttachment.id != attachment.id,
        )
        .order_by(ResearchAttachment.created_at.desc())
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"相同文件已导入为“{duplicate.original_filename}”，请先修改文件或使用已有研究文档。",
        )

    content = payload.content_markdown.strip()
    source_marker = f"> 来源文件：{attachment.original_filename}"
    if "来源文件：" not in content:
        content = f"{source_marker}\n\n{content}"
    tags: list[str] = []
    for tag in [*payload.tags, attachment.scope, "资料导入"]:
        normalized_tag = tag.strip()
        if normalized_tag and normalized_tag not in tags:
            tags.append(normalized_tag[:40])
    document = ResearchDocument(
        user_id=user.id,
        folder_id=payload.folder_id,
        document_type=payload.document_type,
        title=payload.title.strip(),
        summary=payload.summary.strip() if payload.summary and payload.summary.strip() else None,
        content_markdown=content,
        tags=tags,
        source_url=None,
        as_of_date=payload.as_of_date or date.today(),
        status="draft",
    )
    db.add(document)
    db.flush()
    attachment.document_id = document.id
    attachment.status = "imported"
    db.commit()
    db.refresh(document)
    return document


@router.get("/folders", response_model=list[ResearchFolderOut])
def list_folders(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> list[ResearchFolder]:
    ensure_root_folders(db, user.id)
    return db.scalars(
        select(ResearchFolder)
        .where(ResearchFolder.user_id == user.id)
        .order_by(ResearchFolder.sort_order, ResearchFolder.created_at)
    ).all()


@router.post("/folders", response_model=ResearchFolderOut)
def create_folder(payload: ResearchFolderCreateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> ResearchFolder:
    if payload.parent_id:
        _user_folder(db, user.id, payload.parent_id)
    folder = ResearchFolder(user_id=user.id, **payload.model_dump())
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    folder = _user_folder(db, user.id, folder_id)
    if folder.parent_id is None and folder.kind in {"briefs", "macro", "industry", "quant", "inbox", "news"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Built-in research folders cannot be deleted")
    db.delete(folder)
    db.commit()
    return {"ok": True}


@router.get("/documents", response_model=list[ResearchDocumentOut])
def list_documents(
    folder_id: str | None = None,
    document_type: str | None = None,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[ResearchDocument]:
    query = select(ResearchDocument).where(ResearchDocument.user_id == user.id)
    if folder_id:
        _user_folder(db, user.id, folder_id)
        query = query.where(ResearchDocument.folder_id == folder_id)
    if document_type:
        query = query.where(ResearchDocument.document_type == document_type)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(or_(ResearchDocument.title.ilike(pattern), ResearchDocument.summary.ilike(pattern)))
    return db.scalars(query.order_by(ResearchDocument.updated_at.desc())).all()


@router.post("/documents", response_model=ResearchDocumentOut)
def create_document(payload: ResearchDocumentCreateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> ResearchDocument:
    if payload.folder_id:
        _user_folder(db, user.id, payload.folder_id)
    document = ResearchDocument(user_id=user.id, **payload.model_dump())
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.patch("/documents/{document_id}", response_model=ResearchDocumentOut)
def update_document(document_id: str, payload: ResearchDocumentUpdateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> ResearchDocument:
    document = _user_document(db, user.id, document_id)
    changes = payload.model_dump(exclude_unset=True)
    if "folder_id" in changes and changes["folder_id"]:
        _user_folder(db, user.id, changes["folder_id"])
    for field, value in changes.items():
        setattr(document, field, value)
    db.commit()
    db.refresh(document)
    return document


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    document = _user_document(db, user.id, document_id)
    db.delete(document)
    db.commit()
    return {"ok": True}


@router.get("/watchlist", response_model=list[WatchlistOut])
def list_watchlist(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> list[WatchlistItem]:
    return db.scalars(
        select(WatchlistItem).where(WatchlistItem.user_id == user.id).order_by(WatchlistItem.symbol)
    ).all()


@router.post("/watchlist", response_model=WatchlistOut)
def create_watchlist_item(payload: WatchlistCreateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> WatchlistItem:
    values = payload.model_dump()
    values["symbol"] = payload.symbol.strip().upper()
    values["market"] = payload.market.strip().upper()
    values["currency"] = payload.currency.strip().upper()
    item = WatchlistItem(user_id=user.id, **values)
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Symbol already exists in watchlist") from exc
    db.refresh(item)
    return item


@router.patch("/watchlist/{item_id}", response_model=WatchlistOut)
def update_watchlist_item(item_id: str, payload: WatchlistUpdateIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> WatchlistItem:
    item = _user_watchlist_item(db, user.id, item_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value.upper() if field == "currency" and value else value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/watchlist/{item_id}")
def delete_watchlist_item(item_id: str, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    item = _user_watchlist_item(db, user.id, item_id)
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.get("/coverage", response_model=list[CompanyCoverageOut])
def list_company_coverage(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[dict]:
    return _company_coverage(db, user.id)


@router.get("/company/{symbol}/fundamentals", response_model=CompanyFundamentalsOut)
def company_fundamentals(
    symbol: str,
    market: str = Query(default="US", min_length=2, max_length=16),
    user: User = Depends(get_current_user),
) -> dict:
    del user
    try:
        return get_company_fundamentals(symbol, market)
    except FundamentalsError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/company/{market}/{symbol}/dossier", response_model=CompanyDossierOut)
def create_company_dossier(
    market: str,
    symbol: str,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    normalized_market, normalized_symbol = _coverage_key(market, symbol)
    coverage = next(
        (
            item for item in _company_coverage(db, user.id)
            if item["market"] == normalized_market and item["symbol"] == normalized_symbol
        ),
        None,
    )
    if not coverage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company is not in holdings or watchlist")

    root = get_root_folder(db, user.id, "industry")
    industry_name = coverage["industry"] or "待归类公司"
    industry_folder = db.scalar(
        select(ResearchFolder).where(
            ResearchFolder.user_id == user.id,
            ResearchFolder.parent_id == root.id,
            ResearchFolder.kind == "industry",
            ResearchFolder.name == industry_name,
        )
    )
    if not industry_folder:
        industry_folder = ResearchFolder(
            user_id=user.id,
            parent_id=root.id,
            name=industry_name,
            kind="industry",
            description=f"{industry_name}产业链、竞争格局与重点公司研究",
        )
        db.add(industry_folder)
        db.flush()

    folder_key = f"company:{normalized_market}:{normalized_symbol}"
    company_folder = db.scalar(
        select(ResearchFolder).where(
            ResearchFolder.user_id == user.id,
            ResearchFolder.parent_id == industry_folder.id,
            ResearchFolder.kind == "company",
            ResearchFolder.description == folder_key,
        )
    )
    if not company_folder:
        company_folder = ResearchFolder(
            user_id=user.id,
            parent_id=industry_folder.id,
            name=f"{coverage['name']} ({normalized_symbol})",
            kind="company",
            description=folder_key,
        )
        db.add(company_folder)
        db.flush()

    document = db.scalar(
        select(ResearchDocument)
        .where(
            ResearchDocument.user_id == user.id,
            ResearchDocument.folder_id == company_folder.id,
            ResearchDocument.document_type == "company",
        )
        .order_by(ResearchDocument.created_at)
    )
    if not document:
        document = ResearchDocument(
            user_id=user.id,
            folder_id=company_folder.id,
            document_type="company",
            title=f"{coverage['name']}（{normalized_symbol}）投资研究",
            summary="围绕投资逻辑、反方证据、关键经营指标、估值与失效条件持续更新。",
            content_markdown=_company_dossier_template(
                coverage["name"], normalized_symbol, normalized_market
            ),
            tags=[industry_name, normalized_symbol, "公司研究"],
            as_of_date=date.today(),
            status="draft",
        )
        db.add(document)

    db.commit()
    db.refresh(company_folder)
    db.refresh(document)
    return {"folder": company_folder, "document": document}


@router.get("/quant/experiments", response_model=list[QuantExperimentOut])
def list_quant_experiments(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[QuantExperiment]:
    return db.scalars(
        select(QuantExperiment)
        .where(QuantExperiment.user_id == user.id)
        .order_by(QuantExperiment.updated_at.desc())
    ).all()


@router.post("/quant/experiments", response_model=QuantExperimentOut)
def create_quant_experiment(
    payload: QuantExperimentCreateIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> QuantExperiment:
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start date cannot be after end date")
    experiment = QuantExperiment(user_id=user.id, **payload.model_dump())
    db.add(experiment)
    db.commit()
    db.refresh(experiment)
    return experiment


@router.patch("/quant/experiments/{experiment_id}", response_model=QuantExperimentOut)
def update_quant_experiment(
    experiment_id: str,
    payload: QuantExperimentUpdateIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> QuantExperiment:
    experiment = _user_experiment(db, user.id, experiment_id)
    changes = payload.model_dump(exclude_unset=True)
    start_date = changes.get("start_date", experiment.start_date)
    end_date = changes.get("end_date", experiment.end_date)
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start date cannot be after end date")
    for field, value in changes.items():
        setattr(experiment, field, value)
    db.commit()
    db.refresh(experiment)
    return experiment


@router.delete("/quant/experiments/{experiment_id}")
def delete_quant_experiment(
    experiment_id: str,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    experiment = _user_experiment(db, user.id, experiment_id)
    db.delete(experiment)
    db.commit()
    return {"ok": True}


@router.get("/codex-packet/{target_date}")
def codex_packet(target_date: date, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    return user_research_packet(db, user.id, target_date)


@router.post("/briefs/import-preview")
def preview_brief(payload: ResearchBriefImportIn, user: User = Depends(get_current_user)) -> dict:
    del user
    normalized = payload.model_dump(mode="json")
    normalized["word_count"] = len(payload.content_markdown)
    normalized["warnings"] = [] if len(payload.content_markdown) >= 120 else ["简报正文较短，请确认内容完整。"]
    return normalized


@router.post("/briefs/import-confirm", response_model=ResearchDocumentOut)
def confirm_brief(payload: ResearchBriefImportIn, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> ResearchDocument:
    return save_brief_document(db, user.id, payload.model_dump())
