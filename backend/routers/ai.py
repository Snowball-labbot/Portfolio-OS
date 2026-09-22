from datetime import datetime, timezone
from decimal import Decimal
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..ai_client import AIConfigError, AIRequestError, call_ai_chat, parse_json_content
from ..ai_settings import load_ai_config
from ..database import get_db
from ..dependencies import get_current_user
from ..models import Holding, Transaction, User
from ..schemas import (
    ExtractedHoldingIn,
    HoldingsImageExtractIn,
    HoldingsImageExtractOut,
    ImportExtractedHoldingsIn,
    ImportExtractedHoldingsOut,
    StrategyAdviceIn,
    StrategyAdviceOut,
)
from ..services import apply_market_price, recalculate_holding, total_cost_cny, write_snapshot

router = APIRouter(prefix="/api/ai", tags=["ai"])


ASSET_TYPES = ["cash", "stock", "bond", "fund", "property", "other"]


def _holding_payload(holding: Holding) -> dict[str, Any]:
    return {
        "id": holding.id,
        "type": holding.type,
        "name": holding.name,
        "group": holding.group,
        "market": holding.market,
        "symbol": holding.symbol,
        "currency": holding.currency,
        "quantity": str(holding.quantity),
        "avg_cost": str(holding.avg_cost),
        "current_price": str(holding.current_price),
        "current_value_cny": str(holding.current_value_cny),
        "total_cost_cny": str(total_cost_cny(holding)),
        "unrealized_gain_cny": str(holding.unrealized_gain_cny),
        "unrealized_gain_pct": str(holding.unrealized_gain_pct),
    }


def _asset_summary(holdings: list[Holding]) -> dict[str, Any]:
    total = sum((holding.current_value_cny for holding in holdings), Decimal("0"))
    by_type: dict[str, Decimal] = {item: Decimal("0") for item in ASSET_TYPES}
    for holding in holdings:
        by_type[holding.type] = by_type.get(holding.type, Decimal("0")) + holding.current_value_cny
    return {
        "total_value_cny": str(total),
        "slices": [
            {
                "type": item,
                "value_cny": str(value),
                "percent": str((value / total * Decimal("100")) if total > 0 else Decimal("0")),
            }
            for item, value in by_type.items()
        ],
    }


def _ai_error(exc: Exception) -> HTTPException:
    if isinstance(exc, AIConfigError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI_API_KEY is not configured. Please set it on the backend first.",
        )
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.post("/strategy-advice", response_model=StrategyAdviceOut)
def strategy_advice(
    payload: StrategyAdviceIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> StrategyAdviceOut:
    holdings = db.scalars(select(Holding).where(Holding.user_id == user.id, Holding.archived_at.is_(None))).all()
    settings = load_ai_config()
    system_prompt = (
        "你是一个资产配置分析助手，不是持牌投资顾问，也不能替用户做投资决策。"
        "你的任务是基于用户提供的持仓、资产类型占比、成本、浮盈亏、目标策略、用户补充目标和最近对话，做资产配置层面的结构化分析。"
        "重要限制："
        "1. 不得承诺收益，不得预测确定涨跌。"
        "2. 不得使用“必须买入”“必须卖出”“一定会”等确定性表述。"
        "3. 不得编造用户没有提供的数据；如果缺少风险偏好、投资期限、现金流需求，应明确说明。"
        "4. 不针对单一股票或基金给出强制买卖指令，只能给出配置层面的可选调整方向。"
        "5. 如果数据来自当前估值，应说明它可能随行情、汇率、净值更新而变化。"
        "6. 默认以 CNY 汇总，外币资产按用户当前汇率折算。"
        "分析规则："
        "1. 先总结当前资产配置：总资产、主要资产类别、集中度、现金/股票/债券/基金/其他占比。"
        "2. 对比目标策略：列出明显超配和低配项；偏离超过 3 个百分点视为值得关注，超过 10 个百分点视为显著偏离。"
        "3. 分析风险点：集中风险、币种风险、权益波动、债券久期或信用风险、现金比例不足或过高。"
        "4. 给出可选调整方向：用“可以考虑”“一种思路是”“如果你的目标是……”表达。"
        "5. 最后列出还需要用户补充的信息。"
        "输出使用中文，语气克制，结论可执行但不冒进。"
    )
    chat_history = [
        {
            "role": str(item.get("role") or "")[:20],
            "content": str(item.get("content") or "")[:2000],
        }
        for item in payload.chat_history[-10:]
        if str(item.get("role") or "") in {"user", "assistant"} and str(item.get("content") or "").strip()
    ]
    user_payload = {
        "asset_summary": _asset_summary(holdings),
        "holdings": [_holding_payload(holding) for holding in holdings],
        "selected_strategy": payload.selected_strategy,
        "allocation_rows": payload.allocation_rows,
        "custom_context": payload.custom_context,
        "chat_history": chat_history,
        "output_format": {
            "advice_markdown": "string",
            "risk_flags": ["string"],
            "rebalance_notes": ["string"],
        },
    }
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                "请基于下面 JSON 输出严格 JSON，不要 Markdown 代码块。"
                "JSON 必须包含 advice_markdown、risk_flags、rebalance_notes 三个字段。"
                "最近对话只用于理解用户连续追问，不要逐字复述历史对话：\n"
                f"{json.dumps(user_payload, ensure_ascii=False)}"
            ),
        },
    ]
    try:
        content = call_ai_chat(messages, settings.model)
        parsed = parse_json_content(content)
    except (AIConfigError, AIRequestError, ValueError) as exc:
        raise _ai_error(exc) from exc

    if isinstance(parsed, dict):
        return StrategyAdviceOut(
            advice_markdown=str(parsed.get("advice_markdown") or parsed.get("advice") or content),
            risk_flags=[str(item) for item in parsed.get("risk_flags", []) if item],
            rebalance_notes=[str(item) for item in parsed.get("rebalance_notes", []) if item],
        )
    return StrategyAdviceOut(advice_markdown=content)


@router.post("/extract-holdings-image", response_model=HoldingsImageExtractOut)
def extract_holdings_image(
    payload: HoldingsImageExtractIn,
    user: User = Depends(get_current_user),
) -> HoldingsImageExtractOut:
    del user
    settings = load_ai_config()
    system_prompt = (
        "请从这张基金或证券持仓截图中提取资产持仓信息。"
        "只提取图片中明确出现的数据，不要猜测。"
        "重点字段：基金代码或股票代码、名称、持有份额或股数、持仓成本价、当前价或净值、持仓金额、币种。"
        "如果字段不确定，填 null，并在 confidence 中降低置信度。"
        "返回严格 JSON 数组，不要输出解释文字。"
        "字段为 type, market, symbol, name, quantity, unit_price, current_price, currency, exchange_rate_to_cny, group, note, confidence。"
        "国内 6 位代码默认 market 为 CN 且 type 为 fund，美股字母代码默认 market 为 US 且 type 为 stock。"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请识别这张截图中的持仓，返回 JSON 数组。"},
                {"type": "image_url", "image_url": {"url": payload.image_data_url}},
            ],
        },
    ]
    try:
        content = call_ai_chat(messages, settings.vision_model, temperature=0)
        parsed = parse_json_content(content)
    except (AIConfigError, AIRequestError, ValueError) as exc:
        raise _ai_error(exc) from exc

    rows = parsed if isinstance(parsed, list) else parsed.get("holdings", []) if isinstance(parsed, dict) else []
    holdings: list[ExtractedHoldingIn] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").strip() or None
        market = str(row.get("market") or "").strip().upper() or None
        asset_type = str(row.get("type") or "").strip().lower()
        if symbol and not market:
            market = "CN" if symbol.isdigit() else "US"
        if asset_type not in ASSET_TYPES:
            asset_type = "stock" if market == "US" else "fund"
        currency = str(row.get("currency") or ("USD" if market == "US" else "CNY")).upper()
        holdings.append(
            ExtractedHoldingIn(
                type=asset_type,
                market=market,
                symbol=symbol,
                name=str(row.get("name") or symbol or "AI extracted holding"),
                quantity=row.get("quantity") or Decimal("0"),
                unit_price=row.get("unit_price") or row.get("avg_cost") or Decimal("0"),
                current_price=row.get("current_price") or row.get("latest_price"),
                currency=currency,
                exchange_rate_to_cny=row.get("exchange_rate_to_cny") or (Decimal("1") if currency == "CNY" else Decimal("7.2")),
                group=row.get("group"),
                note=row.get("note") or "AI image import",
                confidence=row.get("confidence"),
            )
        )
    return HoldingsImageExtractOut(holdings=holdings)


@router.post("/import-extracted-holdings", response_model=ImportExtractedHoldingsOut)
def import_extracted_holdings(
    payload: ImportExtractedHoldingsIn,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> ImportExtractedHoldingsOut:
    imported: list[Holding] = []
    for item in payload.holdings:
        holding = Holding(
            user_id=user.id,
            type=item.type,
            name=item.name,
            group=item.group or None,
            market=item.market or None,
            symbol=item.symbol or None,
            instrument_name=item.name,
            currency=item.currency.upper(),
            exchange_rate_to_cny=item.exchange_rate_to_cny,
        )
        db.add(holding)
        db.flush()
        if item.quantity > 0 or item.unit_price > 0:
            db.add(
                Transaction(
                    user_id=user.id,
                    holding_id=holding.id,
                    type="buy",
                    trade_date=datetime.now(timezone.utc),
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    fee=Decimal("0"),
                    currency=item.currency.upper(),
                    exchange_rate_to_cny=item.exchange_rate_to_cny,
                    note=item.note or "AI image import",
                )
            )
            db.flush()
            recalculate_holding(db, holding)
            if item.current_price is not None:
                apply_market_price(
                    db,
                    holding,
                    item.current_price,
                    item.exchange_rate_to_cny,
                    source="ai_image_import",
                    when=None,
                    instrument_name=item.name,
                )
            else:
                write_snapshot(db, holding)
        imported.append(holding)
    db.commit()
    for holding in imported:
        db.refresh(holding)
    return ImportExtractedHoldingsOut(imported=len(imported), holdings=imported)
