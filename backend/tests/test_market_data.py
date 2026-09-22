from datetime import date
from decimal import Decimal
from unittest import TestCase
from unittest.mock import MagicMock, patch

import pandas as pd

from backend import market_data


class ChineseFundMarketDataTests(TestCase):
    def setUp(self) -> None:
        self.previous_spot_cache = market_data._etf_spot_cache
        market_data._etf_spot_cache = None

    def tearDown(self) -> None:
        market_data._etf_spot_cache = self.previous_spot_cache

    def test_cn_etf_uses_akshare_spot_price_before_fund_nav(self) -> None:
        ak = MagicMock()
        ak.fund_etf_spot_em.return_value = pd.DataFrame([
            {
                "\u4ee3\u7801": "515450",
                "\u540d\u79f0": "\u7ea2\u5229\u4f4e\u6ce2\u0035\u0030ETF\u5357\u65b9",
                "\u6700\u65b0\u4ef7": 1.426,
                "\u66f4\u65b0\u65f6\u95f4": "2026-09-04 16:11:51+08:00",
            },
        ])

        with patch.object(market_data, "_akshare", return_value=ak), patch.object(
            market_data, "_eastmoney_fund_search", return_value=[]
        ):
            quote = market_data.get_quote("CN", "515450", "fund")

        self.assertEqual(quote["price"], Decimal("1.426"))
        self.assertEqual(quote["kind"], "etf")
        self.assertEqual(quote["quote_source"], "akshare:fund_etf_spot_em")
        self.assertEqual(quote["price_updated_at"].hour, 8)
        ak.fund_open_fund_info_em.assert_not_called()

    def test_open_fund_still_falls_back_to_nav_endpoint(self) -> None:
        ak = MagicMock()
        ak.fund_etf_spot_em.return_value = pd.DataFrame()
        ak.fund_open_fund_info_em.return_value = pd.DataFrame([
            {
                "\u51c0\u503c\u65e5\u671f": "2026-09-03",
                "\u5355\u4f4d\u51c0\u503c": "1.0244",
            },
        ])

        with patch.object(market_data, "_akshare", return_value=ak), patch.object(
            market_data, "_eastmoney_fund_search", return_value=[]
        ), patch.object(
            market_data,
            "_fund_name_records",
            return_value=[{"\u57fa\u91d1\u4ee3\u7801": "002864", "\u57fa\u91d1\u7b80\u79f0": "\u5e7f\u53d1\u5b89\u6cfd\u77ed\u503aA"}],
        ):
            quote = market_data.get_quote("CN", "002864", "fund")

        self.assertEqual(quote["price"], Decimal("1.0244"))
        self.assertEqual(quote["kind"], "fund")
        self.assertEqual(quote["quote_source"], "akshare:fund_open_fund_info_em")

    def test_cn_etf_historical_quote_accepts_stock_typed_holding(self) -> None:
        ak = MagicMock()
        ak.fund_etf_hist_em.return_value = pd.DataFrame([
            {"\u65e5\u671f": "2026-09-03", "\u6536\u76d8": 1.418},
            {"\u65e5\u671f": "2026-09-04", "\u6536\u76d8": 1.426},
        ])

        with patch.object(market_data, "_akshare", return_value=ak):
            quote = market_data.get_historical_quote(
                "CN",
                "515450",
                "stock",
                date(2026, 9, 4),
            )

        self.assertEqual(quote["price"], Decimal("1.426"))
        self.assertEqual(quote["kind"], "etf")
        self.assertEqual(quote["quote_source"], "akshare:fund_etf_hist_em")
        ak.fund_open_fund_info_em.assert_not_called()

    def test_static_fx_fallback_does_not_replace_observed_rate(self) -> None:
        rate = market_data.resolve_quote_exchange_rate("USD", Decimal("7.20"), Decimal("6.7804"))
        self.assertEqual(rate, Decimal("6.7804"))

    def test_live_fx_rate_replaces_previous_rate(self) -> None:
        rate = market_data.resolve_quote_exchange_rate("USD", Decimal("6.6982"), Decimal("6.7804"))
        self.assertEqual(rate, Decimal("6.6982"))

    def test_usd_cny_prefers_market_spot_over_central_parity(self) -> None:
        response = {"data": {"diff": [{"f2": "6.6992"}]}}
        with patch.object(market_data, "_request_json", return_value=response), patch.object(
            market_data, "_yfinance"
        ) as yahoo:
            rate = market_data.get_usd_cny_rate()

        self.assertEqual(rate, Decimal("6.6992"))
        yahoo.assert_not_called()

    def test_us_quote_uses_reachable_primary_provider(self) -> None:
        expected = {"symbol": "QQQ", "price": Decimal("715.78")}
        with patch.object(
            market_data, "_eastmoney_us_quote", return_value=expected
        ) as eastmoney, patch.object(market_data, "_quote_from_yahoo_ticker") as yahoo:
            quote = market_data.get_us_stock_quote("QQQ")

        self.assertEqual(quote, expected)
        eastmoney.assert_called_once_with("QQQ")
        yahoo.assert_not_called()

    def test_lazy_yahoo_field_failure_does_not_abort_other_fields(self) -> None:
        class PartialFastInfo:
            @property
            def last_price(self):
                raise KeyError("currentTradingPeriod")

            previous_close = Decimal("704.07")

        self.assertEqual(
            market_data._first_value(PartialFastInfo(), "last_price", "previous_close"),
            Decimal("704.07"),
        )

    def test_krw_rate_rejects_large_direct_quote_outlier(self) -> None:
        direct = MagicMock(fast_info={"last_price": Decimal("0.00437")}, info={})
        cross = MagicMock(fast_info={"last_price": Decimal("1336")}, info={})
        yf = MagicMock()
        yf.Ticker.side_effect = lambda symbol: direct if symbol == "KRWCNY=X" else cross

        with patch.object(market_data, "_yfinance", return_value=yf), patch.object(
            market_data, "get_usd_cny_rate", return_value=Decimal("6.70")
        ):
            rate = market_data.get_krw_cny_rate()

        self.assertEqual(rate, Decimal("6.70") / Decimal("1336"))
