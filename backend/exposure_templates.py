from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import ExposureProfile, Holding, HoldingExposure


PROFILE_DATE = date(2026, 7, 1)


PROFILES = {
    "NASDAQ_100": ("纳斯达克 100", {"股票": 100}, {"美国": 100}, {"科技": 61, "消费": 18, "通信": 8, "医疗": 6, "工业": 4, "综合": 3}),
    "SP500": ("标普 500", {"股票": 100}, {"美国": 100}, {"科技": 31, "金融": 14, "医疗": 11, "消费": 18, "通信": 9, "工业": 8, "综合": 9}),
    "CHINA_DIVIDEND": ("中国红利", {"股票": 100}, {"中国": 100}, {"金融": 34, "工业": 16, "能源": 13, "消费": 12, "公用事业": 10, "综合": 15}),
    "CHINA_BROAD": ("中国宽基", {"股票": 100}, {"中国": 100}, {"金融": 20, "工业": 18, "消费": 18, "科技": 16, "医疗": 9, "综合": 19}),
    "CHINA_SHORT_BOND": ("中国短债", {"固定收益": 100}, {"中国": 100}, {"综合": 100}),
    "CHINA_CREDIT_BOND": ("中国信用债", {"固定收益": 100}, {"中国": 100}, {"综合": 100}),
    "US_SHORT_BOND": ("美国短债", {"固定收益": 100}, {"美国": 100}, {"综合": 100}),
    "US_TREASURY": ("美国国债", {"固定收益": 100}, {"美国": 100}, {"综合": 100}),
    "GOLD": ("黄金", {"黄金/商品": 100}, {"全球": 100}, {"综合": 100}),
    "CASH": ("现金", {"现金": 100}, {"全球": 100}, {"综合": 100}),
    "US_STOCK": ("美股个股", {"股票": 100}, {"美国": 100}, {"未分类": 100}),
    "CN_STOCK": ("A 股个股", {"股票": 100}, {"中国": 100}, {"未分类": 100}),
    "JP_STOCK": ("日本股票", {"股票": 100}, {"日本": 100}, {"未分类": 100}),
    "KR_STOCK": ("韩国股票", {"股票": 100}, {"韩国": 100}, {"未分类": 100}),
    "OTHER": ("其他/未分类", {"其他": 100}, {"未分类": 100}, {"未分类": 100}),
}


def seed_profiles(db: Session) -> None:
    existing = {profile.code: profile for profile in db.scalars(select(ExposureProfile)).all()}
    for code, (name, asset_classes, regions, sectors) in PROFILES.items():
        profile = existing.get(code)
        if profile is None:
            db.add(ExposureProfile(
                code=code,
                name=name,
                asset_class_weights=asset_classes,
                region_weights=regions,
                sector_weights=sectors,
                source="内置代理模板（指数行业权重为近似值）",
                as_of_date=PROFILE_DATE,
            ))
    db.flush()


def infer_profile_code(holding: Holding) -> str:
    text = " ".join(filter(None, [holding.name, holding.instrument_name, holding.symbol, holding.group])).lower()
    symbol = (holding.symbol or "").upper()
    market = (holding.market or "").upper()
    if holding.type == "cash":
        return "CASH"
    if any(word in text for word in ("黄金", "gold")):
        return "GOLD"
    if any(word in text for word in ("纳斯达克", "纳指", "nasdaq")) or symbol in {"QQQ", "QQQM"}:
        return "NASDAQ_100"
    if any(word in text for word in ("标普500", "标普 500", "s&p 500", "sp500")) or symbol in {"SPY", "VOO", "IVV"}:
        return "SP500"
    if any(word in text for word in ("日经", "nikkei", "日本股票", "日本指数")):
        return "JP_STOCK"
    if any(word in text for word in ("红利", "低波")):
        return "CHINA_DIVIDEND"
    if any(word in text for word in ("美国国债0-3", "美国短债", "0-3月", "0-1年")) or symbol in {"SGOV", "BIL", "SHV", "IB01"}:
        return "US_SHORT_BOND"
    if any(word in text for word in ("美国国债", "treasury")):
        return "US_TREASURY"
    if "短债" in text:
        return "CHINA_SHORT_BOND"
    if "信用债" in text:
        return "CHINA_CREDIT_BOND"
    if market in {"CN", "SH", "SZ"} and any(word in text for word in ("债券", "纯债", "债基")):
        return "CHINA_CREDIT_BOND"
    if holding.type == "stock":
        if market == "US":
            return "US_STOCK"
        if market in {"CN", "SH", "SZ"}:
            return "CN_STOCK"
        if market in {"JP", "JPN"}:
            return "JP_STOCK"
        if market in {"KR", "KOR"}:
            return "KR_STOCK"
    if holding.type in {"fund", "stock"} and market == "CN":
        return "CHINA_BROAD"
    return "OTHER"


def infer_stock_sector(holding: Holding) -> str:
    symbol = (holding.symbol or "").split(".")[0].upper()
    name = (holding.name or "").lower()
    if symbol in {"NVDA", "MU", "AMD", "AVGO", "TSM", "ASML", "INTC", "QCOM", "000660", "DRAM"} or any(word in name for word in ("半导体", "micron", "nvidia", "海力士", "memory")):
        return "半导体"
    if symbol in {"MSFT", "AAPL", "GOOG", "GOOGL", "META", "ORCL", "CRM", "ADBE"}:
        return "科技"
    if symbol in {"JPM", "BAC", "GS", "MS", "C", "V", "MA"}:
        return "金融"
    if symbol in {"LLY", "JNJ", "PFE", "MRK", "UNH", "ABBV"}:
        return "医疗"
    if symbol in {"AMZN", "TSLA", "COST", "WMT", "NKE", "MCD"}:
        return "消费"
    if symbol in {"CAT", "GE", "HON", "BA", "DE"}:
        return "工业"
    return "未分类"


def ensure_holding_mapping(db: Session, holding: Holding) -> list[HoldingExposure]:
    mappings = db.scalars(select(HoldingExposure).where(HoldingExposure.holding_id == holding.id)).all()
    if mappings and any(mapping.mapping_source == "manual" for mapping in mappings):
        return mappings
    inferred_code = infer_profile_code(holding)
    if mappings and len(mappings) == 1 and mappings[0].profile_code == inferred_code:
        return mappings
    if mappings:
        db.execute(delete(HoldingExposure).where(HoldingExposure.holding_id == holding.id))
    mapping = HoldingExposure(
        user_id=holding.user_id,
        holding_id=holding.id,
        profile_code=inferred_code,
        weight_pct=Decimal("100"),
        mapping_source="auto",
        as_of_date=date.today(),
    )
    db.add(mapping)
    db.flush()
    return [mapping]


def replace_manual_mappings(db: Session, holding: Holding, rows: list[dict]) -> list[HoldingExposure]:
    total = sum((Decimal(str(row["weight_pct"])) for row in rows), Decimal("0"))
    if abs(total - Decimal("100")) > Decimal("0.01"):
        raise ValueError("暴露权重合计必须为 100%")
    valid_codes = set(PROFILES)
    if any(row["profile_code"] not in valid_codes for row in rows):
        raise ValueError("包含未知的暴露模板")
    db.execute(delete(HoldingExposure).where(HoldingExposure.holding_id == holding.id))
    mappings = [HoldingExposure(
        user_id=holding.user_id,
        holding_id=holding.id,
        profile_code=row["profile_code"],
        weight_pct=Decimal(str(row["weight_pct"])),
        mapping_source="manual",
        as_of_date=date.today(),
    ) for row in rows]
    db.add_all(mappings)
    db.flush()
    return mappings
