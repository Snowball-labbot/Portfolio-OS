from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

import httpx

from backend.research.fundamentals import _decimal, _normalize_symbol
from backend.research import market_observation
from backend.research.market_observation import social_top_ten
from backend.research.translation import normalize_news_key
from backend.routers.research import _coverage_key, _decision_queue


UTC = timezone.utc


class FundamentalsNormalizationTests(TestCase):
    def test_korean_symbol_is_normalized_for_yahoo(self) -> None:
        self.assertEqual(_normalize_symbol("000660", "KR"), "000660.KS")
        self.assertEqual(_coverage_key("KR", "000660.KQ"), ("KR", "000660"))

    def test_percent_ratio_is_converted_to_percentage_points(self) -> None:
        self.assertEqual(str(_decimal(0.125, percent_ratio=True)), "12.5")
        self.assertIsNone(_decimal(float("nan")))


class DecisionQueueTests(TestCase):
    def test_high_priority_event_precedes_missing_thesis(self) -> None:
        now = datetime.now(UTC)
        event = SimpleNamespace(
            id="event-1",
            event_type="earnings",
            title="NVDA 财报",
            company_name="NVIDIA",
            country=None,
            source="NASDAQ",
            actual=None,
            consensus="0.80",
            scheduled_at=now + timedelta(hours=8),
            importance=3,
            ticker="NVDA",
            source_url="https://example.com/event",
        )
        watchlist = SimpleNamespace(
            id="watch-1",
            symbol="NVDA",
            thesis="",
            next_review_at=None,
            ir_url=None,
        )

        queue = _decision_queue([event], [watchlist], now)

        self.assertEqual(queue[0]["id"], "event:event-1")
        self.assertEqual(queue[0]["priority"], 3)
        self.assertEqual(queue[1]["id"], "thesis:watch-1")


class ResearchResilienceTests(TestCase):
    def test_social_ranking_uses_cache_when_provider_fails(self) -> None:
        cached = [{"rank": 1, "ticker": "NVDA"}]
        original_cache = market_observation._social_cache
        market_observation._social_cache = (datetime.now(UTC), cached)
        client = MagicMock()
        client.__enter__.return_value.get.side_effect = httpx.ConnectError("offline")
        try:
            with patch("backend.research.market_observation.httpx.Client", return_value=client):
                self.assertEqual(social_top_ten(force=True), cached)
        finally:
            market_observation._social_cache = original_cache

    def test_long_news_key_is_stable_and_database_safe(self) -> None:
        raw = "company:NVDA:" + "x" * 500
        normalized = normalize_news_key(raw)

        self.assertLessEqual(len(normalized), 255)
        self.assertEqual(normalized, normalize_news_key(raw))
        self.assertNotEqual(normalized, normalize_news_key(raw + "changed"))
