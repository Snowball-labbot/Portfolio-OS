from __future__ import annotations

import csv
import html
import io
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urljoin

import httpx
import yfinance as yf
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Holding, MarketScoreSnapshot
from .sources import DEFAULT_HEADERS


UTC = timezone.utc
logger = logging.getLogger(__name__)
_cache_lock = threading.Lock()
_social_cache: tuple[datetime, list[dict[str, Any]]] | None = None
_score_cache: tuple[datetime, list[dict[str, Any]]] | None = None
_macro_cache: tuple[datetime, dict[str, Any]] | None = None
SCORE_ASSETS = (
    ("SPY", "标普 500"),
    ("QQQ", "纳斯达克 100"),
    ("GLD", "黄金"),
    ("BTC-USD", "比特币"),
)


def _clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def social_top_ten(force: bool = False) -> list[dict[str, Any]]:
    global _social_cache
    with _cache_lock:
        if not force and _social_cache and datetime.now(UTC) - _social_cache[0] < timedelta(minutes=15):
            return _social_cache[1]
    try:
        with httpx.Client(headers=DEFAULT_HEADERS, timeout=20, follow_redirects=True) as client:
            response = client.get("https://apewisdom.io/api/v1.0/filter/all-stocks/page/1")
            response.raise_for_status()
            rows = response.json().get("results", [])[:10]
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("ApeWisdom unavailable, using cached or empty result: %s", exc)
        with _cache_lock:
            return _social_cache[1] if _social_cache else []
    normalized = [{
        "rank": int(item.get("rank") or 0),
        "ticker": str(item.get("ticker") or ""),
        "name": html.unescape(str(item.get("name") or item.get("ticker") or "")),
        "mentions": int(item.get("mentions") or 0),
        "upvotes": int(item.get("upvotes") or 0),
        "rank_24h_ago": int(item["rank_24h_ago"]) if item.get("rank_24h_ago") is not None else None,
        "mentions_24h_ago": int(item["mentions_24h_ago"]) if item.get("mentions_24h_ago") is not None else None,
    } for item in rows]
    with _cache_lock:
        _social_cache = (datetime.now(UTC), normalized)
    return normalized


def _fred_latest(series_id: str) -> float | None:
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv"
    with httpx.Client(headers=DEFAULT_HEADERS, timeout=20, follow_redirects=True) as client:
        response = client.get(
            url,
            params={"id": series_id, "cosd": (date.today() - timedelta(days=120)).isoformat()},
        )
        response.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(response.text)))
    for row in reversed(rows):
        value = row.get(series_id)
        if value and value != ".":
            try:
                return float(value)
            except ValueError:
                continue
    return None


def _safe_fred_latest(series_id: str) -> float | None:
    try:
        return _fred_latest(series_id)
    except (httpx.HTTPError, csv.Error, ValueError):
        return None


def _safe_info(ticker: yf.Ticker) -> dict[str, Any]:
    try:
        return ticker.info or {}
    except Exception:
        return {}


def _calculate_score(symbol: str, label: str) -> dict[str, Any]:
    ticker = yf.Ticker(symbol)
    history = ticker.history(period="1y", interval="1d", auto_adjust=True)
    if history.empty or len(history) < 120:
        raise RuntimeError(f"Insufficient market history for {symbol}")
    close = history["Close"].dropna()
    latest = float(close.iloc[-1])
    ma50 = float(close.tail(50).mean())
    ma200 = float(close.tail(min(200, len(close))).mean())
    six_month_start = float(close.iloc[max(0, len(close) - 126)])
    return_6m = (latest / six_month_start - 1) * 100 if six_month_start else 0
    trend_score = (
        (30 if latest >= ma200 else 0)
        + (25 if latest >= ma50 else 0)
        + (20 if ma50 >= ma200 else 0)
        + _clamp(12.5 + return_6m * 1.25, 0, 25)
    )

    info = _safe_info(ticker)
    pe = info.get("trailingPE") or info.get("forwardPE")
    pe_ranges = {"SPY": (16, 30), "QQQ": (20, 40)}
    pe_low, pe_high = pe_ranges.get(symbol, (0, 0))
    valuation_score = (
        50
        if not pe or symbol not in pe_ranges
        else _clamp((pe_high - float(pe)) / (pe_high - pe_low) * 100)
    )

    real_yield = _safe_fred_latest("DFII10")
    yield_curve = _safe_fred_latest("T10Y2Y")
    real_yield_score = 50 if real_yield is None else _clamp(100 - (real_yield - 0.25) / 2.75 * 100)
    curve_score = 50 if yield_curve is None else _clamp(50 + yield_curve * 30)
    macro_score = real_yield_score * 0.65 + curve_score * 0.35

    try:
        vix_history = yf.Ticker("^VIX").history(period="5d", interval="1d", auto_adjust=False)
        vix = float(vix_history["Close"].dropna().iloc[-1]) if not vix_history.empty else 20
    except Exception:
        vix = 20
    volatility_score = _clamp(100 - max(0, vix - 12) / 33 * 95)

    weights = {
        "SPY": (0.35, 0.25, 0.25, 0.15),
        "QQQ": (0.30, 0.25, 0.30, 0.15),
        "GLD": (0.00, 0.40, 0.40, 0.20),
        "BTC-USD": (0.00, 0.45, 0.30, 0.25),
    }[symbol]
    score = (
        valuation_score * weights[0]
        + trend_score * weights[1]
        + macro_score * weights[2]
        + volatility_score * weights[3]
    )
    return {
        "symbol": symbol,
        "label": label,
        "score": round(score, 2),
        "valuation_score": round(valuation_score, 2),
        "trend_score": round(trend_score, 2),
        "macro_score": round(macro_score, 2),
        "volatility_score": round(volatility_score, 2),
        "as_of_date": date.today(),
        "data": {
            "price": round(latest, 2),
            "ma50": round(ma50, 2),
            "ma200": round(ma200, 2),
            "return_6m_pct": round(return_6m, 2),
            "pe": round(float(pe), 2) if pe else None,
            "valuation_available": symbol in pe_ranges and bool(pe),
            "real_yield_10y": real_yield,
            "yield_curve_10y_2y": yield_curve,
            "vix": round(vix, 2),
            "methodology": {
                "valuation": int(weights[0] * 100),
                "trend": int(weights[1] * 100),
                "macro": int(weights[2] * 100),
                "volatility": int(weights[3] * 100),
            },
        },
    }


def market_scores(db: Session, force: bool = False) -> list[dict[str, Any]]:
    global _score_cache
    with _cache_lock:
        if not force and _score_cache and datetime.now(UTC) - _score_cache[0] < timedelta(minutes=30):
            return _score_cache[1]
    results: list[dict[str, Any]] = []
    for symbol, label in SCORE_ASSETS:
        try:
            result = _calculate_score(symbol, label)
        except Exception:
            latest = db.scalar(
                select(MarketScoreSnapshot)
                .where(MarketScoreSnapshot.symbol == symbol)
                .order_by(MarketScoreSnapshot.as_of_date.desc())
            )
            if latest:
                result = {
                    "symbol": latest.symbol,
                    "label": latest.label,
                    "score": float(latest.score),
                    "valuation_score": float(latest.valuation_score),
                    "trend_score": float(latest.trend_score),
                    "macro_score": float(latest.macro_score),
                    "volatility_score": float(latest.volatility_score),
                    "as_of_date": latest.as_of_date,
                    "data": {**latest.data, "stale": True},
                }
            else:
                continue
        snapshot = db.scalar(select(MarketScoreSnapshot).where(
            MarketScoreSnapshot.symbol == symbol,
            MarketScoreSnapshot.as_of_date == result["as_of_date"],
        ))
        if snapshot is None:
            snapshot = MarketScoreSnapshot(symbol=symbol, label=label, as_of_date=result["as_of_date"])
            db.add(snapshot)
        snapshot.score = Decimal(str(result["score"]))
        snapshot.valuation_score = Decimal(str(result["valuation_score"]))
        snapshot.trend_score = Decimal(str(result["trend_score"]))
        snapshot.macro_score = Decimal(str(result["macro_score"]))
        snapshot.volatility_score = Decimal(str(result["volatility_score"]))
        snapshot.data = result["data"]
        results.append(result)
    db.commit()
    with _cache_lock:
        _score_cache = (datetime.now(UTC), results)
    return results


def score_history(db: Session, symbol: str, days: int = 365) -> list[MarketScoreSnapshot]:
    cutoff = date.today() - timedelta(days=days)
    return db.scalars(
        select(MarketScoreSnapshot)
        .where(MarketScoreSnapshot.symbol == symbol.upper(), MarketScoreSnapshot.as_of_date >= cutoff)
        .order_by(MarketScoreSnapshot.as_of_date)
    ).all()


def _indicator(
    key: str,
    label: str,
    *,
    value: float | None = None,
    unit: str = "%",
    change: float | None = None,
    change_unit: str = "bp",
    as_of: str | None = None,
    source: str,
    source_url: str,
    history: list[dict[str, Any]] | None = None,
    note: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "value": round(value, 4) if value is not None else None,
        "unit": unit,
        "change": round(change, 3) if change is not None else None,
        "change_unit": change_unit,
        "as_of": as_of,
        "source": source,
        "source_url": source_url,
        "status": status or ("fresh" if value is not None else "unavailable"),
        "history": history or [],
        "note": note,
    }


def _fred_series(series_id: str, days: int = 60) -> list[dict[str, Any]]:
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv"
    with httpx.Client(headers=DEFAULT_HEADERS, timeout=20, follow_redirects=True) as client:
        response = client.get(url, params={"id": series_id})
        response.raise_for_status()
    points: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(response.text)):
        raw = row.get(series_id)
        if not raw or raw == ".":
            continue
        try:
            points.append({"date": row.get("observation_date") or row.get("DATE"), "value": float(raw)})
        except (TypeError, ValueError):
            continue
    return points[-days:]


def _fred_indicator(key: str, label: str, series_id: str, *, note: str | None = None) -> dict[str, Any]:
    source_url = f"https://fred.stlouisfed.org/series/{series_id}"
    try:
        points = _fred_series(series_id)
        latest = points[-1]
        previous = points[-2] if len(points) > 1 else latest
        status = "fresh"
        try:
            if date.today() - date.fromisoformat(latest["date"]) > timedelta(days=7):
                status = "delayed"
        except (TypeError, ValueError):
            pass
        return _indicator(
            key,
            label,
            value=latest["value"],
            change=(latest["value"] - previous["value"]) * 100,
            as_of=latest["date"],
            source="FRED",
            source_url=source_url,
            history=points[-30:],
            note=note,
            status=status,
        )
    except Exception as exc:
        logger.warning("FRED series %s unavailable: %s", series_id, exc)
        return _indicator(key, label, source="FRED", source_url=source_url, note=note)


def _yf_indicator(
    key: str,
    label: str,
    symbol: str,
    *,
    unit: str,
    source_label: str = "Yahoo Finance",
    note: str | None = None,
) -> dict[str, Any]:
    source_url = f"https://finance.yahoo.com/quote/{symbol}"
    try:
        frame = yf.Ticker(symbol).history(period="3mo", interval="1d", auto_adjust=False)
        close = frame["Close"].dropna()
        if close.empty:
            raise RuntimeError("empty history")
        latest = float(close.iloc[-1])
        previous = float(close.iloc[-2]) if len(close) > 1 else latest
        points = [
            {"date": index.date().isoformat(), "value": round(float(value), 4)}
            for index, value in close.tail(30).items()
        ]
        return _indicator(
            key,
            label,
            value=latest,
            unit=unit,
            change=((latest / previous) - 1) * 100 if previous else None,
            change_unit="%",
            as_of=points[-1]["date"],
            source=source_label,
            source_url=source_url,
            history=points,
            note=note,
        )
    except Exception as exc:
        logger.warning("Yahoo series %s unavailable: %s", symbol, exc)
        return _indicator(
            key,
            label,
            unit=unit,
            change_unit="%",
            source=source_label,
            source_url=source_url,
            note=note,
        )


def _pbc_reverse_repo_indicator() -> dict[str, Any]:
    index_url = "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html"
    try:
        with httpx.Client(headers=DEFAULT_HEADERS, timeout=20, follow_redirects=True) as client:
            response = client.get(index_url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            href = next(
                (
                    anchor.get("href")
                    for anchor in soup.find_all("a", href=True)
                    if "公开市场业务交易公告 [" in anchor.get_text(" ", strip=True)
                    and PurePosixPath(anchor.get("href", "")).name == "index.html"
                    and anchor.get("href", "") != PurePosixPath(index_url).as_posix()
                ),
                None,
            )
            if not href:
                raise RuntimeError("latest PBOC announcement link not found")
            detail_url = urljoin(index_url, href)
            detail = client.get(detail_url)
            detail.raise_for_status()
        text = BeautifulSoup(detail.text, "html.parser").get_text(" ", strip=True)
        compact_text = re.sub(r"\s+", "", text)
        rate_matches = re.findall(r"7天([0-9.]+)%", compact_text)
        date_match = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", text)
        if not rate_matches:
            raise RuntimeError("7-day reverse repo rate not found")
        as_of = None
        if date_match:
            as_of = f"{int(date_match.group(1)):04d}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}"
        value = float(rate_matches[-1])
        return _indicator(
            "pbc_7d",
            "7天逆回购",
            value=value,
            change=None,
            as_of=as_of,
            source="中国人民银行",
            source_url=detail_url,
            history=[{"date": as_of, "value": value}] if as_of else [],
            note="央行短期政策利率",
        )
    except Exception as exc:
        logger.warning("PBOC reverse repo unavailable: %s", exc)
        return _indicator(
            "pbc_7d",
            "7天逆回购",
            source="中国人民银行",
            source_url=index_url,
            note="央行短期政策利率",
        )


def _china_rates() -> list[dict[str, Any]]:
    source_url = "https://www.chinamoney.com.cn/chinese/bkfrr/"
    curve_url = "https://www.chinabond.com.cn/"
    today = date.today()
    start = today - timedelta(days=45)
    try:
        import akshare as ak

        repo = ak.repo_rate_hist(start_date=start.strftime("%Y%m%d"), end_date=today.strftime("%Y%m%d"))
        repo = repo.dropna(subset=["FDR007"])
        latest = repo.iloc[-1]
        previous = repo.iloc[-2] if len(repo) > 1 else latest
        repo_points = [
            {"date": str(row["date"]), "value": round(float(row["FDR007"]), 4)}
            for _, row in repo.tail(30).iterrows()
        ]
        dr007 = _indicator(
            "dr007",
            "DR007",
            value=float(latest["FDR007"]),
            change=(float(latest["FDR007"]) - float(previous["FDR007"])) * 100,
            as_of=str(latest["date"]),
            source="中国货币网 FDR007",
            source_url=source_url,
            history=repo_points,
            note="存款类机构7天回购定盘利率",
        )
    except Exception as exc:
        logger.warning("DR007 unavailable: %s", exc)
        dr007 = _indicator(
            "dr007",
            "DR007",
            source="中国货币网 FDR007",
            source_url=source_url,
            note="存款类机构7天回购定盘利率",
        )

    curve_items: list[dict[str, Any]] = []
    try:
        import akshare as ak

        frame = ak.bond_china_yield(start_date=start.strftime("%Y%m%d"), end_date=today.strftime("%Y%m%d"))
        frame = frame[frame["曲线名称"] == "中债国债收益率曲线"].sort_values("日期")
        if frame.empty:
            raise RuntimeError("empty China government curve")
        configs = (
            ("cgb_2y", "CGB 2Y", None, "2年值按中债1年与3年线性插值"),
            ("cgb_10y", "CGB 10Y", "10年", None),
            ("cgb_30y", "CGB 30Y", "30年", None),
        )
        for key, label, column, note in configs:
            points: list[dict[str, Any]] = []
            for _, row in frame.tail(30).iterrows():
                value = (float(row["1年"]) + float(row["3年"])) / 2 if column is None else float(row[column])
                points.append({"date": str(row["日期"]), "value": round(value, 4)})
            latest = points[-1]
            previous = points[-2] if len(points) > 1 else latest
            curve_items.append(_indicator(
                key,
                label,
                value=latest["value"],
                change=(latest["value"] - previous["value"]) * 100,
                as_of=latest["date"],
                source="中债收益率曲线",
                source_url=curve_url,
                history=points,
                note=note,
            ))
    except Exception as exc:
        logger.warning("China government curve unavailable: %s", exc)
        for key, label, _, note in (
            ("cgb_2y", "CGB 2Y", None, "2年值按中债1年与3年线性插值"),
            ("cgb_10y", "CGB 10Y", None, None),
            ("cgb_30y", "CGB 30Y", None, None),
        ):
            curve_items.append(_indicator(key, label, source="中债收益率曲线", source_url=curve_url, note=note))
    return [dr007, *curve_items]


def _jgb_10y_indicator() -> dict[str, Any]:
    url = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv"
    try:
        with httpx.Client(headers=DEFAULT_HEADERS, timeout=25, follow_redirects=True) as client:
            response = client.get(url)
            response.raise_for_status()
        lines = response.text.splitlines()
        rows = csv.DictReader(lines[1:])
        points: list[dict[str, Any]] = []
        for row in rows:
            raw = row.get("10Y")
            if not raw or raw == "-":
                continue
            raw_date = str(row["Date"])
            normalized_date = datetime.strptime(raw_date, "%Y/%m/%d").date().isoformat()
            points.append({"date": normalized_date, "value": float(raw)})
        latest = points[-1]
        previous = points[-2] if len(points) > 1 else latest
        status = "fresh"
        try:
            if date.today() - date.fromisoformat(latest["date"]) > timedelta(days=7):
                status = "delayed"
        except ValueError:
            pass
        return _indicator(
            "jgb_10y",
            "JGB 10Y",
            value=latest["value"],
            change=(latest["value"] - previous["value"]) * 100,
            as_of=latest["date"],
            source="日本财务省",
            source_url=url,
            history=points[-30:],
            status=status,
        )
    except Exception as exc:
        logger.warning("JGB 10Y unavailable: %s", exc)
        return _indicator("jgb_10y", "JGB 10Y", source="日本财务省", source_url=url)


def _macro_market_data() -> dict[str, Any]:
    global _macro_cache
    with _cache_lock:
        if _macro_cache and datetime.now(UTC) - _macro_cache[0] < timedelta(minutes=30):
            return _macro_cache[1]

    tasks = {
        "fed_funds": lambda: _fred_indicator("fed_funds", "Fed Funds", "DFF", note="有效联邦基金利率"),
        "sofr": lambda: _fred_indicator("sofr", "SOFR", "SOFR", note="美元隔夜担保融资利率"),
        "ust_2y": lambda: _fred_indicator("ust_2y", "UST 2Y", "DGS2"),
        "ust_10y": lambda: _fred_indicator("ust_10y", "UST 10Y", "DGS10"),
        "ust_30y": lambda: _fred_indicator("ust_30y", "UST 30Y", "DGS30"),
        "boj_policy": lambda: _fred_indicator(
            "boj_policy", "BOJ 隔夜利率", "IRSTCI01JPM156N", note="月度短期利率代理，政策变动后可能延迟"
        ),
        "jgb_10y": _jgb_10y_indicator,
        "usd_jpy": lambda: _yf_indicator("usd_jpy", "USDJPY", "JPY=X", unit="JPY"),
        "pbc_7d": _pbc_reverse_repo_indicator,
        "china_rates": _china_rates,
        "usd_cnh": lambda: _yf_indicator("usd_cnh", "USDCNH", "CNH=X", unit="CNH"),
        "brent": lambda: _yf_indicator("brent", "Brent", "BZ=F", unit="USD/bbl", note="近月期货"),
        "copper": lambda: _yf_indicator("copper", "Copper", "HG=F", unit="USD/lb", note="COMEX近月期货"),
        "iron_ore": lambda: _yf_indicator("iron_ore", "Iron Ore", "TIO=F", unit="USD/t", note="新加坡铁矿石期货代理"),
    }
    with ThreadPoolExecutor(max_workers=10, thread_name_prefix="macro-tape") as executor:
        futures = {key: executor.submit(task) for key, task in tasks.items()}
        values = {key: future.result() for key, future in futures.items()}

    us_items = [values[key] for key in ("fed_funds", "sofr", "ust_2y", "ust_10y", "ust_30y")]
    japan_items = [values[key] for key in ("boj_policy", "jgb_10y", "usd_jpy")]
    china_items = [values["pbc_7d"], *values["china_rates"], values["usd_cnh"]]
    commodities = [values[key] for key in ("brent", "copper", "iron_ore")]
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "groups": [
            {"key": "us", "label": "美国利率", "description": "政策利率、融资成本与期限折现率", "items": us_items},
            {"key": "japan", "label": "日本利率与日元", "description": "BOJ、JGB与日元套利交易", "items": japan_items},
            {"key": "china", "label": "中国利率与人民币", "description": "政策锚、银行间资金与国债曲线", "items": china_items},
        ],
        "commodities": commodities,
    }
    with _cache_lock:
        _macro_cache = (datetime.now(UTC), payload)
    return payload


def _portfolio_macro_links(db: Session, user_id: str) -> list[dict[str, Any]]:
    holdings = db.scalars(
        select(Holding).where(Holding.user_id == user_id, Holding.archived_at.is_(None))
    ).all()
    total = sum((float(item.current_value_cny or 0) for item in holdings), 0.0)
    buckets: dict[str, dict[str, Any]] = {
        "us_rates": {"label": "美债利率 / 美股折现率", "reason": "影响美股尤其成长股的估值折现与美元融资环境", "holdings": [], "value": 0.0},
        "china_liquidity": {"label": "中国流动性 / 国债曲线", "reason": "影响人民币债券、红利与中国权益的资金环境", "holdings": [], "value": 0.0},
        "japan_carry": {"label": "日元 / 日本利率", "reason": "影响日本资产估值及日元套利交易波动", "holdings": [], "value": 0.0},
        "commodity_cycle": {"label": "铜与全球制造周期", "reason": "对半导体、AI基础设施和制造链需求预期更敏感", "holdings": [], "value": 0.0},
    }
    semiconductor_terms = ("NVDA", "MU", "DRAM", "TSM", "ASML", "半导体", "美光", "英伟达", "海力士")
    for holding in holdings:
        value = float(holding.current_value_cny or 0)
        if value <= 0:
            continue
        haystack = " ".join(filter(None, [holding.name, holding.symbol, holding.instrument_name])).upper()
        market = (holding.market or "").upper()
        currency = (holding.currency or "").upper()
        targets: list[str] = []
        if market in {"US", "USA"} or currency == "USD":
            targets.append("us_rates")
        if market in {"CN", "CHINA", "A"} or (currency == "CNY" and holding.type != "cash"):
            targets.append("china_liquidity")
        if market in {"JP", "JAPAN"} or currency == "JPY":
            targets.append("japan_carry")
        if any(term in haystack for term in semiconductor_terms):
            targets.append("commodity_cycle")
        for target in set(targets):
            buckets[target]["value"] += value
            buckets[target]["holdings"].append({"name": holding.name, "symbol": holding.symbol, "value_cny": round(value, 2)})

    return [
        {
            "key": key,
            "label": bucket["label"],
            "reason": bucket["reason"],
            "value_cny": round(bucket["value"], 2),
            "weight_pct": round(bucket["value"] / total * 100, 2) if total else 0,
            "holdings": sorted(bucket["holdings"], key=lambda item: item["value_cny"], reverse=True)[:5],
        }
        for key, bucket in buckets.items()
        if bucket["holdings"]
    ]


def macro_tape(db: Session, user_id: str, force: bool = False) -> dict[str, Any]:
    global _macro_cache
    if force:
        with _cache_lock:
            _macro_cache = None
    return {**_macro_market_data(), "portfolio_links": _portfolio_macro_links(db, user_id)}
