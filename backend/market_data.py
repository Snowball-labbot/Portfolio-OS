from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from functools import lru_cache
from threading import Lock
from time import monotonic, sleep
from typing import Any

import requests


class MarketDataError(RuntimeError):
    pass


EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281"
REQUEST_TIMEOUT_SECONDS = 8
REQUEST_RETRY_DELAYS_SECONDS = (0.0, 0.2, 0.5)
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0 Safari/537.36"
    )
}
DEFAULT_USD_CNY_RATE = Decimal("7.20")
DEFAULT_KRW_CNY_RATE = Decimal("0.0052")
DEFAULT_HKD_CNY_RATE = Decimal("0.92")
CN_TIMEZONE = timezone(timedelta(hours=8))
ETF_SPOT_CACHE_TTL_SECONDS = 30.0
CN_ETF_CODE_PREFIXES = ("15", "16", "18", "50", "51", "56", "58")

_etf_spot_cache: tuple[float, list[dict[str, Any]]] | None = None
_etf_spot_cache_lock = Lock()


def resolve_quote_exchange_rate(
    currency: str,
    candidate: Decimal | int | float | str | None,
    existing: Decimal | int | float | str | None,
) -> Decimal:
    """Keep a known rate when a live provider falls back to a static default.

    Static defaults are useful while importing a new holding, but they must not
    overwrite an already observed FX rate during a quote refresh. Otherwise a
    transient FX outage is reported as portfolio profit or loss.
    """
    code = (currency or "CNY").strip().upper()
    if code == "CNY":
        return Decimal("1")
    proposed = _to_decimal(candidate) if candidate is not None else Decimal("0")
    previous = _to_decimal(existing) if existing is not None else Decimal("0")
    defaults = {
        "USD": DEFAULT_USD_CNY_RATE,
        "KRW": DEFAULT_KRW_CNY_RATE,
        "HKD": DEFAULT_HKD_CNY_RATE,
    }
    if previous > 0 and proposed == defaults.get(code) and proposed != previous:
        return previous
    if proposed > 0:
        return proposed
    if previous > 0:
        return previous
    return defaults.get(code, Decimal("1"))


def _akshare():
    try:
        import akshare as ak  # type: ignore
    except Exception as exc:
        raise MarketDataError("AKShare is not installed or failed to import") from exc
    return ak


def _yfinance():
    try:
        import yfinance as yf  # type: ignore
    except Exception as exc:
        raise MarketDataError("yfinance is not installed or failed to import") from exc
    return yf


def _request_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    last_error: Exception | None = None
    for delay in REQUEST_RETRY_DELAYS_SECONDS:
        if delay:
            sleep(delay)
        try:
            response = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
    raise MarketDataError(f"Market request failed: {last_error}") from last_error


def _to_decimal(value: Any) -> Decimal:
    if value is None:
        raise MarketDataError("Missing price")
    text = str(value).replace(",", "").strip()
    if text.lower() in {"", "-", "nan", "none", "nat", "<na>"}:
        raise MarketDataError("Invalid price")
    try:
        result = Decimal(text)
    except Exception as exc:
        raise MarketDataError(f"Invalid price: {value}") from exc
    if not result.is_finite():
        raise MarketDataError("Invalid price")
    return result


def _parse_date(value: Any) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _parse_cn_datetime(value: Any) -> datetime:
    """Parse AKShare's China-local timestamps without shifting them twice."""
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=CN_TIMEZONE)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return _parse_date(value)


def _normalize_cn_code(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"", "nan", "none", "nat", "<na>"}:
        return ""
    if text.endswith(".0") and text[:-2].isdigit():
        text = text[:-2]
    return text.zfill(6) if text.isdigit() else text


def _looks_like_cn_etf_code(value: Any) -> bool:
    code = _normalize_cn_code(value)
    return len(code) == 6 and code.startswith(CN_ETF_CODE_PREFIXES)


def _row_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    for key, value in row.items():
        key_text = str(key)
        if any(candidate in key_text for candidate in keys):
            return value
    return None


def _clean_us_symbol(symbol: str) -> str:
    return symbol.split(".")[-1].upper()


def _get_attr_or_item(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    try:
        return getattr(value, key, None)
    except Exception:
        # yfinance's lazy FastInfo properties can fail independently when a
        # provider response is incomplete. Let the remaining fields/fallbacks
        # decide whether the quote is usable.
        return None


def _first_value(source: Any, *keys: str) -> Any:
    for key in keys:
        value = _get_attr_or_item(source, key)
        if value is not None and str(value).strip() not in {"", "-", "nan", "None"}:
            return value
    return None


def _parse_market_time(value: Any) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except Exception:
        return _parse_date(value)


def _normalize_yahoo_symbol(symbol: str, market: str) -> str:
    text = symbol.strip().upper()
    if market == "KR":
        if text.endswith((".KS", ".KQ")):
            return text
        if text.isdigit() and len(text) == 6:
            return f"{text}.KS"
    if market in {"LSE", "UK", "LON"} and not text.endswith(".L"):
        return f"{text}.L"
    return text


def _yahoo_quote_candidates(query: str, market: str) -> list[str]:
    text = query.strip().upper()
    if not text:
        return []
    if market == "KR":
        if text.endswith((".KS", ".KQ")):
            return [text]
        if text.isdigit() and len(text) == 6:
            return [f"{text}.KS", f"{text}.KQ"]
    return [_normalize_yahoo_symbol(text, market)]


def _quote_from_yahoo_ticker(symbol: str, market: str) -> dict[str, Any]:
    yf = _yfinance()
    ticker_symbol = _normalize_yahoo_symbol(symbol, market)
    ticker = yf.Ticker(ticker_symbol)

    fast_info: Any = {}
    try:
        fast_info = ticker.fast_info
    except Exception:
        fast_info = {}

    info: dict[str, Any] = {}
    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    price = _first_value(
        fast_info,
        "last_price",
        "lastPrice",
        "regular_market_price",
        "regularMarketPrice",
        "previous_close",
        "previousClose",
    )
    if price is None:
        price = _first_value(info, "regularMarketPrice", "currentPrice", "previousClose", "open")

    currency = str(_first_value(fast_info, "currency") or info.get("currency") or ("KRW" if market == "KR" else "USD"))
    name = str(info.get("shortName") or info.get("longName") or info.get("displayName") or ticker_symbol)
    updated_at = _parse_market_time(
        info.get("regularMarketTime") or _first_value(fast_info, "last_trade_time", "lastTradeTime")
    )
    price_decimal = _to_decimal(price)
    exchange_rate = Decimal("1")
    if currency.upper() == "USD":
        exchange_rate = get_usd_cny_rate()
    elif currency.upper() == "KRW":
        exchange_rate = get_krw_cny_rate()
    elif currency.upper() != "CNY":
        exchange_rate, _ = get_currency_cny_rate(currency)

    return {
        "symbol": ticker_symbol,
        "name": name,
        "market": market,
        "kind": "stock",
        "currency": currency.upper(),
        "price": price_decimal,
        "exchange_rate_to_cny": exchange_rate,
        "price_updated_at": updated_at,
        "quote_source": "yahoo:yfinance",
    }


def _yahoo_search(query: str, market: str) -> list[dict[str, Any]]:
    yf = _yfinance()
    results: list[dict[str, Any]] = []

    try:
        search = yf.Search(query, max_results=12)
        rows = getattr(search, "quotes", []) or []
    except Exception:
        rows = []

    for row in rows:
        symbol = str(_first_value(row, "symbol") or "").upper()
        if not symbol:
            continue
        if market == "KR" and not symbol.endswith((".KS", ".KQ")):
            continue
        if market == "US" and "." in symbol:
            continue
        quote_type = str(_first_value(row, "quoteType") or "").upper()
        if quote_type and quote_type not in {"EQUITY", "ETF"}:
            continue
        name = str(_first_value(row, "shortname", "shortName", "longname", "longName", "name") or symbol)
        currency = str(_first_value(row, "currency") or ("KRW" if market == "KR" else "USD")).upper()
        item: dict[str, Any] = {
            "symbol": symbol,
            "name": name,
            "market": market,
            "kind": "stock",
            "currency": currency,
            "quote_source": "yahoo:search",
        }
        price = _first_value(row, "regularMarketPrice", "price")
        if price is not None:
            item["price"] = _to_decimal(price)
            item["price_updated_at"] = datetime.now(timezone.utc)
        results.append(item)
        if len(results) >= 8:
            return results

    if market == "KR" and results:
        return results

    seen = {item["symbol"] for item in results}
    for symbol in _yahoo_quote_candidates(query, market):
        if symbol in seen:
            continue
        try:
            quote = _quote_from_yahoo_ticker(symbol, market)
        except Exception:
            continue
        results.append({
            "symbol": quote["symbol"],
            "name": quote["name"],
            "market": market,
            "kind": "stock",
            "currency": quote["currency"],
            "price": quote["price"],
            "price_updated_at": quote["price_updated_at"],
            "quote_source": "yahoo:yfinance",
        })
        if len(results) >= 8:
            break

    return results


def _eastmoney_search_us(query: str) -> list[dict[str, Any]]:
    data = _request_json(
        "http://searchapi.eastmoney.com/api/suggest/get",
        {"input": query, "type": "14", "token": "D43BF722C8E33BDC906FB84D85E326E8"},
    )
    table = data.get("QuotationCodeTable") or {}
    rows = table.get("Data") or []
    results: list[dict[str, Any]] = []
    for row in rows[:8]:
        symbol = str(row.get("Code") or row.get("UnifiedCode") or "").upper()
        quote_id = str(row.get("QuoteID") or "")
        if not symbol or not quote_id:
            continue
        results.append({
            "symbol": symbol,
            "name": str(row.get("Name") or symbol),
            "market": "US",
            "kind": "stock",
            "currency": "USD",
            "quote_id": quote_id,
            "quote_source": "eastmoney:suggest",
        })
    return results


def _eastmoney_us_quote(symbol: str) -> dict[str, Any]:
    candidates = _eastmoney_search_us(symbol)
    target = _clean_us_symbol(symbol)
    match = next((item for item in candidates if item["symbol"].upper() == target), None)
    if not match and candidates:
        match = candidates[0]
    if not match:
        raise MarketDataError(f"No US stock quote found for {symbol}")

    quote_id = str(match.get("quote_id") or f"105.{match['symbol']}")
    data = _request_json(
        "http://push2.eastmoney.com/api/qt/ulist.np/get",
        {
            "secids": quote_id,
            "ut": EASTMONEY_UT,
            "fltt": "2",
            "fields": "f12,f13,f14,f2,f3,f4,f17,f18",
        },
    )
    rows = ((data.get("data") or {}).get("diff") or [])
    if not rows:
        raise MarketDataError(f"No US stock quote found for {symbol}")
    row = rows[0]
    return {
        "symbol": match["symbol"],
        "name": match["name"],
        "market": "US",
        "kind": "stock",
        "currency": "USD",
        "price": _to_decimal(row.get("f2")),
        "exchange_rate_to_cny": get_usd_cny_rate(),
        "price_updated_at": datetime.now(timezone.utc),
        "quote_source": "eastmoney:us_quote",
    }


def _eastmoney_fund_search(query: str) -> list[dict[str, Any]]:
    data = _request_json(
        "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx",
        {"m": "1", "key": query},
    )
    rows = data.get("Datas") or []
    results: list[dict[str, Any]] = []
    for row in rows[:8]:
        base = row.get("FundBaseInfo") or {}
        symbol = str(row.get("CODE") or base.get("FCODE") or "")
        if not symbol:
            continue
        item: dict[str, Any] = {
            "symbol": symbol,
            "name": str(row.get("NAME") or base.get("SHORTNAME") or f"Fund {symbol}"),
            "market": "CN",
            "kind": "fund",
            "currency": "CNY",
            "quote_source": "eastmoney:fund_suggest",
        }
        if base.get("DWJZ") not in {None, "", "-"}:
            item["price"] = _to_decimal(base.get("DWJZ"))
        if base.get("FSRQ"):
            item["price_updated_at"] = _parse_date(base.get("FSRQ"))
        results.append(item)
    return results


def get_usd_cny_rate() -> Decimal:
    # Prefer the tradable offshore spot rate. It is available on networks where
    # Yahoo quote hosts are commonly throttled, and avoids blocking every US
    # quote refresh on a provider timeout.
    try:
        data = _request_json(
            "http://push2.eastmoney.com/api/qt/ulist.np/get",
            {
                "secids": "133.USDCNH",
                "fltt": "2",
                "fields": "f12,f14,f2,f18",
            },
        )
        rows = ((data.get("data") or {}).get("diff") or [])
        if rows:
            return _to_decimal(rows[0].get("f2"))
    except Exception:
        pass

    try:
        yf = _yfinance()
        ticker = yf.Ticker("USDCNY=X")
        fast_info: Any = {}
        try:
            fast_info = ticker.fast_info
        except Exception:
            fast_info = {}
        info: dict[str, Any] = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}
        price = _first_value(
            fast_info,
            "last_price",
            "lastPrice",
            "regular_market_price",
            "regularMarketPrice",
            "previous_close",
            "previousClose",
        )
        if price is None:
            price = _first_value(info, "regularMarketPrice", "currentPrice", "previousClose")
        return _to_decimal(price)
    except Exception:
        pass

    try:
        data = _request_json(
            "http://push2.eastmoney.com/api/qt/clist/get",
            {
                "np": "1",
                "fltt": "2",
                "invt": "2",
                "fs": "m:119,m:120,m:133",
                "fields": "f12,f13,f14,f2",
                "fid": "f3",
                "pn": "1",
                "pz": "300",
                "po": "1",
                "dect": "1",
                "wbp2u": "|0|0|0|web",
            },
        )
        rows = ((data.get("data") or {}).get("diff") or [])
        for row in rows:
            code = str(row.get("f12") or "").upper()
            name = str(row.get("f14") or "")
            if "USDCNY" in code or "美元人民币" in name:
                return _to_decimal(row.get("f2"))
    except Exception:
        pass

    try:
        return _akshare_usd_cny_rate()
    except Exception:
        return DEFAULT_USD_CNY_RATE


def get_krw_cny_rate() -> Decimal:
    direct_rate: Decimal | None = None
    try:
        yf = _yfinance()
        ticker = yf.Ticker("KRWCNY=X")
        fast_info: Any = {}
        try:
            fast_info = ticker.fast_info
        except Exception:
            fast_info = {}
        info: dict[str, Any] = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}
        price = _first_value(
            fast_info,
            "last_price",
            "lastPrice",
            "regular_market_price",
            "regularMarketPrice",
            "previous_close",
            "previousClose",
        )
        if price is None:
            price = _first_value(info, "regularMarketPrice", "currentPrice", "previousClose")
        direct_rate = _to_decimal(price)
    except Exception:
        pass

    # Yahoo's direct KRW/CNY quote has occasionally returned an isolated value
    # more than 10% away from the broader FX market. Cross-check it through USD
    # before allowing that spike to change the portfolio's CNY valuation.
    try:
        yf = _yfinance()
        ticker = yf.Ticker("USDKRW=X")
        fast_info: Any = {}
        try:
            fast_info = ticker.fast_info
        except Exception:
            fast_info = {}
        info: dict[str, Any] = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}
        usd_krw = _first_value(
            fast_info,
            "last_price",
            "lastPrice",
            "regular_market_price",
            "regularMarketPrice",
            "previous_close",
            "previousClose",
        )
        if usd_krw is None:
            usd_krw = _first_value(info, "regularMarketPrice", "currentPrice", "previousClose")
        cross_rate = get_usd_cny_rate() / _to_decimal(usd_krw)
        if cross_rate > 0:
            if direct_rate is None or abs(direct_rate - cross_rate) / cross_rate > Decimal("0.05"):
                return cross_rate
    except Exception:
        pass

    return direct_rate if direct_rate and direct_rate > 0 else DEFAULT_KRW_CNY_RATE


def get_currency_cny_rate(currency: str, trade_date: date | None = None) -> tuple[Decimal, str]:
    if trade_date is not None:
        return _historical_fx_rate(currency, trade_date)
    code = currency.strip().upper()
    if code == "CNY":
        return Decimal("1"), "fixed:CNY"
    if code == "USD":
        return get_usd_cny_rate(), "market:USD/CNY"
    if code == "KRW":
        return get_krw_cny_rate(), "yahoo:KRWCNY=X"

    try:
        yf = _yfinance()
        ticker = yf.Ticker(f"{code}CNY=X")
        fast_info: Any = {}
        try:
            fast_info = ticker.fast_info
        except Exception:
            fast_info = {}
        info: dict[str, Any] = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}
        price = _first_value(
            fast_info,
            "last_price",
            "lastPrice",
            "regular_market_price",
            "regularMarketPrice",
            "previous_close",
            "previousClose",
        )
        if price is None:
            price = _first_value(info, "regularMarketPrice", "currentPrice", "previousClose")
        return _to_decimal(price), f"yahoo:{code}CNY=X"
    except Exception as exc:
        if code == "HKD":
            return DEFAULT_HKD_CNY_RATE, "fallback:HKD/CNY"
        raise MarketDataError(f"Unable to fetch {code}/CNY rate") from exc


def _akshare_usd_cny_rate() -> Decimal:
    ak = _akshare()
    code_key = "\u4ee3\u7801"
    name_key = "\u540d\u79f0"
    latest_key = "\u6700\u65b0\u4ef7"
    df = ak.forex_spot_em()
    for row in df.to_dict("records"):
        code = str(row.get(code_key, "")).upper()
        name = str(row.get(name_key, ""))
        if "USDCNY" in code or "\u7f8e\u5143\u4eba\u6c11\u5e01" in name:
            return _to_decimal(row.get(latest_key))
    raise MarketDataError("Unable to fetch USD/CNY rate")


def _akshare_etf_spot_records() -> list[dict[str, Any]]:
    """Return a short-lived snapshot of all CN exchange-traded funds."""
    global _etf_spot_cache

    now = monotonic()
    with _etf_spot_cache_lock:
        if _etf_spot_cache and now - _etf_spot_cache[0] < ETF_SPOT_CACHE_TTL_SECONDS:
            return _etf_spot_cache[1]

        try:
            frame = _akshare().fund_etf_spot_em()
            records = [] if getattr(frame, "empty", False) else frame.to_dict("records")
        except Exception as exc:
            raise MarketDataError("AKShare ETF spot request failed") from exc

        _etf_spot_cache = (now, records)
        return records


def _akshare_etf_quote(symbol: str) -> dict[str, Any] | None:
    target = _normalize_cn_code(symbol)
    if not target:
        return None

    for row in _akshare_etf_spot_records():
        code = _normalize_cn_code(_row_value(row, "代码", "基金代码"))
        if code != target:
            continue

        price = _to_decimal(_row_value(row, "最新价", "收盘"))
        name = str(_row_value(row, "名称", "基金简称") or f"ETF {target}")
        updated_at = _row_value(row, "更新时间", "数据日期")
        return {
            "symbol": target,
            "name": name,
            "market": "CN",
            "kind": "etf",
            "currency": "CNY",
            "price": price,
            "exchange_rate_to_cny": Decimal("1"),
            "price_updated_at": _parse_cn_datetime(updated_at),
            "quote_source": "akshare:fund_etf_spot_em",
        }

    return None


def _akshare_etf_historical_quote(symbol: str, trade_date: date) -> dict[str, Any] | None:
    target = _normalize_cn_code(symbol)
    if not target:
        return None

    try:
        frame = _akshare().fund_etf_hist_em(
            symbol=target,
            period="daily",
            start_date=(trade_date - timedelta(days=31)).strftime("%Y%m%d"),
            end_date=trade_date.strftime("%Y%m%d"),
            adjust="",
        )
    except Exception as exc:
        raise MarketDataError("AKShare ETF historical request failed") from exc

    if getattr(frame, "empty", False):
        return None

    eligible: list[tuple[date, Decimal]] = []
    for row in frame.to_dict("records"):
        raw_date = _row_value(row, "日期", "交易日期")
        try:
            observation_date = date.fromisoformat(str(raw_date)[:10])
        except (TypeError, ValueError):
            continue
        if observation_date > trade_date:
            continue
        try:
            price = _to_decimal(_row_value(row, "收盘", "最新价"))
        except MarketDataError:
            continue
        eligible.append((observation_date, price))

    if not eligible:
        return None

    observation_date, price = max(eligible, key=lambda item: item[0])
    return {
        "symbol": target,
        "name": f"ETF {target}",
        "market": "CN",
        "kind": "etf",
        "currency": "CNY",
        "price": price,
        "exchange_rate_to_cny": Decimal("1"),
        "price_updated_at": datetime.combine(observation_date, datetime.min.time(), tzinfo=CN_TIMEZONE).astimezone(timezone.utc),
        "quote_source": "akshare:fund_etf_hist_em",
    }


def get_fund_quote(symbol: str) -> dict[str, Any]:
    normalized_symbol = _normalize_cn_code(symbol)
    errors: list[str] = []

    try:
        etf_quote = _akshare_etf_quote(normalized_symbol)
        if etf_quote:
            return etf_quote
    except MarketDataError as exc:
        errors.append(str(exc))

    # Never replace a traded ETF price with an open-ended fund NAV.
    if _looks_like_cn_etf_code(normalized_symbol):
        detail = f": {'; '.join(errors)}" if errors else ""
        raise MarketDataError(f"Unable to fetch CN ETF quote for {normalized_symbol}{detail}")

    try:
        for item in _eastmoney_fund_search(normalized_symbol):
            if _normalize_cn_code(item["symbol"]) == normalized_symbol and item.get("price") is not None:
                return {
                    **item,
                    "symbol": normalized_symbol,
                    "exchange_rate_to_cny": Decimal("1"),
                    "quote_source": "eastmoney:fund_suggest",
                }
    except MarketDataError as exc:
        errors.append(str(exc))

    try:
        ak = _akshare()
        df = ak.fund_open_fund_info_em(symbol=normalized_symbol, indicator="\u5355\u4f4d\u51c0\u503c\u8d70\u52bf")
        if df.empty:
            raise MarketDataError(f"No open fund NAV found for {normalized_symbol}")
        latest = df.iloc[-1].to_dict()
        price = _to_decimal(latest.get("\u5355\u4f4d\u51c0\u503c"))
        name = f"Fund {normalized_symbol}"
        for row in _fund_name_records():
            if _normalize_cn_code(row.get("\u57fa\u91d1\u4ee3\u7801")) == normalized_symbol:
                name = str(row.get("\u57fa\u91d1\u7b80\u79f0") or row.get("\u57fa\u91d1\u540d\u79f0") or name)
                break
        return {
            "symbol": normalized_symbol,
            "name": name,
            "market": "CN",
            "kind": "fund",
            "currency": "CNY",
            "price": price,
            "exchange_rate_to_cny": Decimal("1"),
            "price_updated_at": _parse_date(latest.get("\u51c0\u503c\u65e5\u671f")),
            "quote_source": "akshare:fund_open_fund_info_em",
        }
    except Exception as exc:
        if isinstance(exc, MarketDataError):
            errors.append(str(exc))
        else:
            errors.append(f"AKShare open fund request failed: {exc}")

    detail = f": {'; '.join(errors)}" if errors else ""
    raise MarketDataError(f"No fund/ETF quote found for {normalized_symbol}{detail}")


@lru_cache(maxsize=1)
def _fund_name_records() -> list[dict[str, Any]]:
    try:
        df = _akshare().fund_name_em()
    except Exception:
        return []
    return df.to_dict("records")


def get_us_stock_quote(symbol: str) -> dict[str, Any]:
    eastmoney_error_detail = ""
    try:
        # This endpoint is materially faster on networks where Yahoo's quote
        # hosts are throttled or their TLS connection is reset.
        return _eastmoney_us_quote(symbol)
    except Exception as eastmoney_error:
        eastmoney_error_detail = str(eastmoney_error)

    yahoo_error_detail = ""
    try:
        return _quote_from_yahoo_ticker(symbol, "US")
    except Exception as yahoo_error:
        yahoo_error_detail = str(yahoo_error)

    target = _clean_us_symbol(symbol)
    code_key = "\u4ee3\u7801"
    name_key = "\u540d\u79f0"
    latest_key = "\u6700\u65b0\u4ef7"
    try:
        df = _akshare().stock_us_spot_em()
        for row in df.to_dict("records"):
            code = str(row.get(code_key, ""))
            short_code = _clean_us_symbol(code)
            name = str(row.get(name_key, ""))
            if short_code == target or code.upper() == symbol.upper() or name.upper() == target:
                return {
                    "symbol": short_code,
                    "name": name,
                    "market": "US",
                    "kind": "stock",
                    "currency": "USD",
                    "price": _to_decimal(row.get(latest_key)),
                    "exchange_rate_to_cny": get_usd_cny_rate(),
                    "price_updated_at": datetime.now(timezone.utc),
                    "quote_source": "akshare:stock_us_spot_em",
                }
    except Exception as akshare_error:
        detail = "; ".join(
            item for item in [eastmoney_error_detail, yahoo_error_detail, str(akshare_error)] if item
        )
        raise MarketDataError(f"US stock quote temporarily unavailable for {symbol}: {detail}") from akshare_error
    raise MarketDataError(f"No US stock quote found for {symbol}")


def get_kr_stock_quote(symbol: str) -> dict[str, Any]:
    errors: list[str] = []
    for candidate in _yahoo_quote_candidates(symbol, "KR"):
        try:
            return _quote_from_yahoo_ticker(candidate, "KR")
        except Exception as exc:
            errors.append(str(exc))
    detail = "; ".join(errors) if errors else symbol
    raise MarketDataError(f"No KR stock quote found for {symbol}: {detail}")


def get_quote(market: str, symbol: str, kind: str | None = None) -> dict[str, Any]:
    market = market.upper()
    selected_kind = (kind or "").lower()
    if market == "US":
        return get_us_stock_quote(symbol)
    if market == "KR":
        return get_kr_stock_quote(symbol)
    if market in {"LSE", "UK", "LON"}:
        return _quote_from_yahoo_ticker(symbol, market)
    if market == "CN" and selected_kind in {"", "fund", "etf", "stock", "bond"}:
        return get_fund_quote(symbol)
    raise MarketDataError(f"Unsupported market/kind: {market}/{kind}")


def _historical_fx_rate(currency: str, trade_date: date) -> tuple[Decimal, str]:
    code = currency.upper()
    if code == "CNY":
        return Decimal("1"), "fixed:CNY"
    try:
        yf = _yfinance()
        history = yf.Ticker(f"{code}CNY=X").history(
            start=trade_date.isoformat(),
            end=(trade_date + timedelta(days=1)).isoformat(),
            auto_adjust=False,
        )
        if history.empty:
            raise MarketDataError("No historical FX observation")
        return _to_decimal(history["Close"].dropna().iloc[0]), f"yahoo:historical:{code}CNY=X"
    except Exception as exc:
        raise MarketDataError(f"Unable to fetch historical {code}/CNY rate for {trade_date}") from exc


def get_historical_quote(market: str, symbol: str, kind: str, trade_date: date) -> dict[str, Any]:
    market = market.upper()
    selected_kind = kind.lower()
    if market == "CN" and selected_kind in {"", "fund", "etf", "stock", "bond"}:
        normalized_symbol = _normalize_cn_code(symbol)
        errors: list[str] = []

        try:
            etf_quote = _akshare_etf_historical_quote(normalized_symbol, trade_date)
            if etf_quote:
                return etf_quote
        except MarketDataError as exc:
            errors.append(str(exc))

        if _looks_like_cn_etf_code(normalized_symbol):
            detail = f": {'; '.join(errors)}" if errors else ""
            raise MarketDataError(f"Unable to fetch historical CN ETF quote for {normalized_symbol}{detail}")

        try:
            frame = _akshare().fund_open_fund_info_em(
                symbol=normalized_symbol,
                indicator="\u5355\u4f4d\u51c0\u503c\u8d70\u52bf",
            )
            date_column = next(column for column in frame.columns if "\u65e5\u671f" in str(column))
            value_column = next(column for column in frame.columns if "\u5355\u4f4d\u51c0\u503c" in str(column))
            frame[date_column] = frame[date_column].astype(str)
            rows = frame[frame[date_column] <= trade_date.isoformat()]
            if rows.empty:
                raise MarketDataError("No fund NAV on or before the selected date")
            row = rows.iloc[-1]
            observation_date = date.fromisoformat(str(row[date_column])[:10])
            return {
                "symbol": normalized_symbol,
                "name": normalized_symbol,
                "market": "CN",
                "kind": "fund",
                "currency": "CNY",
                "price": _to_decimal(row[value_column]),
                "exchange_rate_to_cny": Decimal("1"),
                "price_updated_at": datetime.combine(observation_date, datetime.min.time(), tzinfo=CN_TIMEZONE).astimezone(timezone.utc),
                "quote_source": "akshare:historical_fund_nav",
            }
        except Exception as exc:
            if isinstance(exc, MarketDataError):
                errors.append(str(exc))
            else:
                errors.append(f"AKShare open fund history request failed: {exc}")

        detail = f": {'; '.join(errors)}" if errors else ""
        raise MarketDataError(f"Unable to fetch historical CN fund/ETF quote for {normalized_symbol}{detail}")

    if market not in {"US", "KR"}:
        raise MarketDataError(f"Historical quote is not supported for {market}/{kind}")
    try:
        yf = _yfinance()
        yahoo_symbol = _normalize_yahoo_symbol(symbol, market)
        history = yf.Ticker(yahoo_symbol).history(
            start=trade_date.isoformat(),
            end=(trade_date + timedelta(days=1)).isoformat(),
            auto_adjust=False,
        )
        if history.empty:
            raise MarketDataError("No market close on the selected date")
        price = _to_decimal(history["Close"].dropna().iloc[0])
        currency = "KRW" if market == "KR" else "USD"
        fx_rate, fx_source = _historical_fx_rate(currency, trade_date)
        return {
            "symbol": symbol.upper(),
            "name": symbol.upper(),
            "market": market,
            "kind": selected_kind or "stock",
            "currency": currency,
            "price": price,
            "exchange_rate_to_cny": fx_rate,
            "price_updated_at": datetime.combine(trade_date, datetime.min.time(), tzinfo=timezone.utc),
            "quote_source": f"yahoo:historical_close+{fx_source}",
        }
    except Exception as exc:
        if isinstance(exc, MarketDataError):
            raise
        raise MarketDataError(f"Unable to fetch historical quote for {symbol} on {trade_date}") from exc


def search_instrument(query: str, market: str = "CN") -> list[dict[str, Any]]:
    q = query.strip()
    if len(q) < 2:
        return []

    market = market.upper()
    if market == "US":
        yahoo_results = _yahoo_search(q, "US")
        if yahoo_results:
            return yahoo_results
        try:
            return _eastmoney_search_us(q)
        except MarketDataError:
            if q.replace(".", "").isalnum():
                symbol = _clean_us_symbol(q)
                return [{
                    "symbol": symbol,
                    "name": symbol,
                    "market": "US",
                    "kind": "stock",
                    "currency": "USD",
                    "quote_source": "manual:fallback",
                }]
            raise

    if market == "KR":
        results = _yahoo_search(q, "KR")
        if results:
            return results
        if q.replace(".", "").isdigit() and len(q.split(".")[0]) == 6:
            return [{
                "symbol": _normalize_yahoo_symbol(q, "KR"),
                "name": q.upper(),
                "market": "KR",
                "kind": "stock",
                "currency": "KRW",
                "quote_source": "manual:fallback",
            }]
        return []

    results = _eastmoney_fund_search(q)
    if results:
        return results

    records = _fund_name_records()
    fallback: list[dict[str, Any]] = []
    for row in records:
        code = str(row.get("\u57fa\u91d1\u4ee3\u7801", ""))
        name = str(row.get("\u57fa\u91d1\u7b80\u79f0") or row.get("\u57fa\u91d1\u540d\u79f0") or "")
        if q in code or q.lower() in name.lower():
            fallback.append({
                "symbol": code,
                "name": name or f"Fund {code}",
                "market": "CN",
                "kind": "fund",
                "currency": "CNY",
                "quote_source": "akshare:fund_name_em",
            })
        if len(fallback) >= 8:
            break

    if not fallback and q.isdigit() and len(q) == 6:
        fallback.append({
            "symbol": q,
            "name": f"Fund {q}",
            "market": "CN",
            "kind": "fund",
            "currency": "CNY",
            "quote_source": "manual",
        })
    return fallback
