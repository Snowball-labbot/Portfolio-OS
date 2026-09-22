from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from hashlib import sha256

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai_client import AIConfigError, AIRequestError, call_ai_chat, parse_json_content
from ..ai_settings import load_ai_config
from ..config import get_settings
from ..models import ResearchNewsItem
from .sources import ExternalNews


UTC = timezone.utc
logger = logging.getLogger(__name__)
CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")


def normalize_news_key(value: str) -> str:
    if len(value) <= 255:
        return value
    return f"{value[:190]}:{sha256(value.encode('utf-8')).hexdigest()}"


def _already_chinese(value: str | None) -> bool:
    return bool(value and CHINESE_RE.search(value))


def _apply_translation(
    item: ExternalNews,
    title_zh: str,
    summary_zh: str | None,
    *,
    model: str,
) -> None:
    original_title = item.raw_data.get("original_title") or item.title
    original_summary = item.raw_data.get("original_summary")
    if original_summary is None:
        original_summary = item.summary
    if not original_summary:
        summary_zh = None
    item.raw_data = {
        **item.raw_data,
        "original_title": original_title,
        "original_summary": original_summary,
        "title_zh": title_zh,
        "summary_zh": summary_zh,
        "translation_model": model,
        "translated_at": datetime.now(UTC).isoformat(),
    }
    item.title = title_zh[:1000]
    item.summary = summary_zh
    item.language = "zh-CN"


def _google_translate_text(client: httpx.Client, value: str | None) -> str | None:
    if not value:
        return None
    response = client.get(
        "https://translate.googleapis.com/translate_a/single",
        params={
            "client": "gtx",
            "sl": "auto",
            "tl": "zh-CN",
            "dt": "t",
            "q": value[:3000],
        },
    )
    response.raise_for_status()
    payload = response.json()
    translated = "".join(
        str(part[0])
        for part in payload[0]
        if isinstance(part, list) and part and part[0]
    ).strip()
    return translated or None


def _fallback_translate(batch: list[ExternalNews]) -> None:
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            for item in batch:
                title_zh = _google_translate_text(client, item.title)
                if not title_zh:
                    continue
                summary_zh = _google_translate_text(client, item.summary)
                _apply_translation(
                    item,
                    title_zh,
                    summary_zh,
                    model="google-translate-fallback",
                )
    except (httpx.HTTPError, ValueError, TypeError, IndexError) as exc:
        logger.warning("Fallback news translation failed; keeping source language: %s", exc)


def translate_news_items(db: Session, items: list[ExternalNews]) -> None:
    if not items:
        return

    keys = {normalize_news_key(item.news_key) for item in items}
    existing_rows = db.scalars(
        select(ResearchNewsItem).where(
            ResearchNewsItem.news_key.in_(keys),
        )
    ).all()
    existing_by_key = {row.news_key: row for row in existing_rows}
    pending: list[ExternalNews] = []

    for item in items:
        if _already_chinese(item.title):
            _apply_translation(item, item.title, item.summary, model="source")
            continue
        existing = existing_by_key.get(normalize_news_key(item.news_key))
        existing_raw = existing.raw_data if existing else {}
        original_title = existing_raw.get("original_title") if existing_raw else None
        if (
            existing
            and existing.language.lower().startswith("zh")
            and (not original_title or original_title == item.title)
        ):
            item.title = existing.title
            item.summary = existing.summary
            item.language = existing.language
            item.raw_data = {**item.raw_data, **existing_raw}
            continue
        pending.append(item)

    settings = load_ai_config()
    if not pending:
        return

    for offset in range(0, len(pending), 15):
        batch = pending[offset : offset + 15]
        if not settings.api_key:
            _fallback_translate(batch)
            continue
        payload = [
            {
                "id": index,
                "title": item.title[:600],
                "summary": item.summary[:1200] if item.summary else None,
                "ticker": item.ticker,
            }
            for index, item in enumerate(batch)
        ]
        try:
            content = call_ai_chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "你是金融新闻翻译编辑。把英文标题和摘要准确翻译成简体中文，"
                            "保留公司名、股票代码、数字、日期和专业术语，不添加原文没有的判断，"
                            "不输出投资建议。返回严格 JSON："
                            '{"items":[{"id":0,"title_zh":"...","summary_zh":"...或null"}]}。'
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps(payload, ensure_ascii=False),
                    },
                ],
                model=settings.model,
                temperature=0.0,
            )
            parsed = parse_json_content(content)
            rows = parsed.get("items", []) if isinstance(parsed, dict) else parsed
            translated = {
                int(row["id"]): row
                for row in rows
                if isinstance(row, dict) and str(row.get("id", "")).isdigit() and row.get("title_zh")
            }
            for index, item in enumerate(batch):
                row = translated.get(index)
                if not row:
                    continue
                _apply_translation(
                    item,
                    str(row["title_zh"]).strip(),
                    str(row["summary_zh"]).strip() if row.get("summary_zh") else None,
                    model=settings.model,
                )
        except (AIConfigError, AIRequestError, ValueError, TypeError, KeyError) as exc:
            logger.warning("AI news translation failed; trying fallback translator: %s", exc)
            _fallback_translate(batch)


def translate_existing_news(db: Session, limit: int = 500) -> int:
    rows = db.scalars(
        select(ResearchNewsItem)
        .where(~ResearchNewsItem.language.ilike("zh%"))
        .order_by(ResearchNewsItem.published_at.desc())
        .limit(limit)
    ).all()
    if not rows:
        return 0

    items = [
        ExternalNews(
            news_key=row.news_key,
            title=row.title,
            source=row.source,
            source_url=row.source_url,
            published_at=row.published_at,
            summary=row.summary,
            source_domain=row.source_domain,
            ticker=row.ticker,
            topic=row.topic,
            language=row.language,
            image_url=row.image_url,
            raw_data=row.raw_data or {},
        )
        for row in rows
    ]
    translate_news_items(db, items)
    translated = 0
    for row, item in zip(rows, items, strict=True):
        if not item.language.lower().startswith("zh"):
            continue
        row.title = item.title[:1000]
        row.summary = item.summary
        row.language = item.language[:16]
        row.raw_data = {**(row.raw_data or {}), **item.raw_data}
        translated += 1
    db.commit()
    return translated
