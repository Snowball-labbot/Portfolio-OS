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


def _event(**overrides) -> SimpleNamespace:
    fields = {
        "id": "event-1",
        "event_type": "macro",
        "title": "美国消费者价格指数（CPI）",
        "company_name": None,
        "country": "US",
        "source": "BLS",
        "actual": None,
        "consensus": None,
        "scheduled_at": None,
        "importance": 2,
        "ticker": None,
        "source_url": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


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

    def test_naive_sqlite_timestamps_do_not_mix_with_aware_now(self) -> None:
        now = datetime.now(UTC)
        naive_due = (now + timedelta(hours=8)).replace(tzinfo=None)
        naive_review = (now - timedelta(days=1)).replace(tzinfo=None)
        watchlist = SimpleNamespace(
            id="watch-1",
            symbol="NVDA",
            thesis="护城河",
            next_review_at=naive_review,
            ir_url=None,
        )

        queue = _decision_queue([_event(importance=3, scheduled_at=naive_due)], [watchlist], now)

        # Same priority: earlier due date first.
        self.assertEqual([item["id"] for item in queue], ["review:watch-1", "event:event-1"])
        self.assertEqual(queue[0]["priority"], 3)
        self.assertEqual(queue[1]["due_at"], naive_due)

    def test_mixed_naive_and_aware_due_dates_still_sort(self) -> None:
        now = datetime.now(UTC)
        naive = _event(id="naive", scheduled_at=(now + timedelta(hours=2)).replace(tzinfo=None))
        aware = _event(id="aware", scheduled_at=now + timedelta(hours=4))

        queue = _decision_queue([naive, aware], [], now)

        self.assertEqual([item["id"] for item in queue], ["event:naive", "event:aware"])


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
