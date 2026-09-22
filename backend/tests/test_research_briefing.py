from datetime import date, datetime, timezone
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.models import Holding, ResearchDocument, ResearchFolder, ResearchGenerationRun, ResearchNewsItem, Transaction, User
from backend.research.briefing import (
    build_transaction_events,
    build_generation_context,
    execute_generation_run,
    is_us_market_session,
    latest_completed_us_session,
    market_close_at,
    queue_generation,
)


class ResearchBriefingTests(TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="briefing@example.com", password_hash="test", role="user")
        self.db.add(self.user)
        self.db.flush()
        self.db.add(Holding(
            user_id=self.user.id,
            type="stock",
            name="Example Holding",
            instrument_name="Example Holding",
            symbol="EXM",
            market="US",
            currency="USD",
            quantity=Decimal("10"),
            current_price=Decimal("100"),
            exchange_rate_to_cny=Decimal("7"),
            current_value_cny=Decimal("7000"),
            cost_basis_cny=Decimal("6500"),
        ))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_standard_market_holidays_and_dst_are_respected(self) -> None:
        self.assertFalse(is_us_market_session(date(2026, 7, 3)))
        self.assertFalse(is_us_market_session(date(2026, 11, 26)))
        self.assertTrue(is_us_market_session(date(2026, 7, 6)))
        winter_close = market_close_at(date(2026, 1, 5)).astimezone(ZoneInfo("Asia/Shanghai"))
        summer_close = market_close_at(date(2026, 7, 6)).astimezone(ZoneInfo("Asia/Shanghai"))
        self.assertEqual((winter_close.hour, winter_close.minute), (22, 0))
        self.assertEqual((summer_close.hour, summer_close.minute), (22, 0))

    def test_latest_completed_us_session_handles_beijing_evening_and_weekends(self) -> None:
        before_us_close = datetime(2026, 9, 4, 12, tzinfo=timezone.utc)
        after_us_close = datetime(2026, 9, 5, 0, tzinfo=timezone.utc)
        saturday_morning = datetime(2026, 9, 5, 12, tzinfo=timezone.utc)
        self.assertEqual(latest_completed_us_session(before_us_close), date(2026, 9, 3))
        self.assertEqual(latest_completed_us_session(after_us_close), date(2026, 9, 4))
        self.assertEqual(latest_completed_us_session(saturday_morning), date(2026, 9, 4))

    def test_generation_queue_is_idempotent_and_manual_retryable(self) -> None:
        first, created = queue_generation(self.db, self.user, "startup", date(2026, 9, 4), date(2026, 9, 4))
        second, created_again = queue_generation(self.db, self.user, "startup", date(2026, 9, 4), date(2026, 9, 4))
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first.id, second.id)

        first.status = "failed"
        self.db.commit()
        retried, should_execute = queue_generation(
            self.db,
            self.user,
            "startup",
            date(2026, 9, 4),
            date(2026, 9, 4),
            force=True,
        )
        self.assertTrue(should_execute)
        self.assertEqual(retried.attempt_count, 2)
        self.assertEqual(retried.status, "queued")

    def test_sell_and_cash_settlement_are_one_transaction_event(self) -> None:
        asset = Holding(
            user_id=self.user.id,
            type="stock",
            name="Roundhill Memory ETF",
            instrument_name="Roundhill Memory ETF",
            symbol="DRAM",
            market="US",
            currency="USD",
        )
        cash = Holding(
            user_id=self.user.id,
            type="cash",
            name="IBKR 美元现金",
            instrument_name="IBKR 美元现金",
            currency="USD",
        )
        self.db.add_all([asset, cash])
        self.db.flush()
        operation_id = "dram-sale-operation"
        sell = Transaction(
            user_id=self.user.id,
            holding_id=asset.id,
            type="sell",
            quantity=Decimal("20"),
            unit_price=Decimal("58.4"),
            currency="USD",
            exchange_rate_to_cny=Decimal("7.2"),
            operation_id=operation_id,
            realized_gain_cny=Decimal("-1148.04370063"),
        )
        cash_in = Transaction(
            user_id=self.user.id,
            holding_id=cash.id,
            type="cash_in",
            quantity=Decimal("1168"),
            unit_price=Decimal("1"),
            currency="USD",
            exchange_rate_to_cny=Decimal("7.2"),
            operation_id=operation_id,
            related_holding_id=asset.id,
            note="卖出 Roundhill Memory ETF 自动入账",
        )
        self.db.add_all([sell, cash_in])
        self.db.flush()

        events = build_transaction_events([sell, cash_in], {asset.id: asset, cash.id: cash})

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["action"], "卖出")
        self.assertIn("卖出 Roundhill Memory ETF", event["description"])
        self.assertIn("IBKR 美元现金", event["description"])
        self.assertEqual(event["settlements"][0]["direction"], "in")
        self.assertEqual(event["realized_gain_cny"], Decimal("-1148.04370063"))
        self.assertEqual(sum((row["flow_cny"] for row in event["flow_rows"]), Decimal("0")), Decimal("0"))

    def test_successful_agnes_generation_publishes_and_updates_one_document(self) -> None:
        run, _ = queue_generation(self.db, self.user, "startup", date(2026, 9, 4), date(2026, 9, 4))
        session_factory = lambda: Session(self.engine)
        report = "# 核心结论\n\n组合整体保持稳定。\n\n## 来源\n\n数据不足。"
        with (
            patch("backend.research.briefing.SessionLocal", session_factory),
            patch("backend.research.briefing.agnes_is_configured", return_value=True),
            patch("backend.research.briefing.refresh_report_sources"),
            patch("backend.research.briefing.call_ai_chat", return_value=report),
        ):
            result = execute_generation_run(run.id)

        self.assertEqual(result.status, "succeeded")
        documents = self.db.scalars(select(ResearchDocument).where(ResearchDocument.user_id == self.user.id)).all()
        self.assertEqual(len(documents), 1)
        self.assertIn("Agnes自动生成", documents[0].tags)

        close_run, _ = queue_generation(self.db, self.user, "market_close", date(2026, 9, 4), date(2026, 9, 4))
        with (
            patch("backend.research.briefing.SessionLocal", session_factory),
            patch("backend.research.briefing.agnes_is_configured", return_value=True),
            patch("backend.research.briefing.refresh_report_sources"),
            patch("backend.research.briefing.call_ai_chat", return_value=report + "\n\n收盘更新。"),
        ):
            execute_generation_run(close_run.id)

        self.db.expire_all()
        documents = self.db.scalars(select(ResearchDocument).where(ResearchDocument.user_id == self.user.id)).all()
        self.assertEqual(len(documents), 2)
        self.assertTrue(any("美股收盘复盘" in document.title for document in documents))

    def test_failed_generation_keeps_a_retryable_status(self) -> None:
        run, _ = queue_generation(self.db, self.user, "manual", date(2026, 9, 4), date(2026, 9, 4))
        session_factory = lambda: Session(self.engine)
        with (
            patch("backend.research.briefing.SessionLocal", session_factory),
            patch("backend.research.briefing.agnes_is_configured", return_value=True),
            patch("backend.research.briefing.refresh_report_sources"),
            patch("backend.research.briefing.call_ai_chat", side_effect=RuntimeError("temporary failure")),
        ):
            result = execute_generation_run(run.id)

        self.assertEqual(result.status, "failed")
        self.assertIn("temporary failure", result.error or "")
        self.assertIsNone(self.db.scalar(select(ResearchDocument).where(ResearchDocument.user_id == self.user.id)))
        self.db.expire_all()
        self.assertEqual(self.db.get(ResearchGenerationRun, run.id).status, "failed")

    def test_daily_news_uses_a_rolling_window_and_separate_folder(self) -> None:
        self.db.add_all([
            ResearchNewsItem(
                news_key="fresh",
                title="Fresh market headline",
                summary="Fresh",
                source="Test",
                source_url="https://example.com/fresh",
                published_at=datetime(2026, 9, 4, 11, tzinfo=timezone.utc),
                ticker="EXM",
                topic="company",
            ),
            ResearchNewsItem(
                news_key="stale",
                title="Stale market headline",
                summary="Stale",
                source="Test",
                source_url="https://example.com/stale",
                published_at=datetime(2026, 9, 3, 11, tzinfo=timezone.utc),
                ticker="EXM",
                topic="company",
            ),
        ])
        self.db.commit()

        with patch("backend.research.briefing.now_utc", return_value=datetime(2026, 9, 4, 12, tzinfo=timezone.utc)):
            context = build_generation_context(self.db, self.user, "daily_news", date(2026, 9, 4), date(2026, 9, 4))
        self.assertEqual([item["title"] for item in context["news"]], ["Fresh market headline"])
        self.assertEqual(context["report"]["news_window_start"].isoformat(), "2026-09-03T12:00:00+00:00")

        run, _ = queue_generation(self.db, self.user, "daily_news", date(2026, 9, 4), date(2026, 9, 4))
        session_factory = lambda: Session(self.engine)
        with (
            patch("backend.research.briefing.SessionLocal", session_factory),
            patch("backend.research.briefing.agnes_is_configured", return_value=True),
            patch("backend.research.briefing.refresh_report_sources"),
            patch("backend.research.briefing.call_ai_chat", return_value="# 每日新闻\n\n只有一条相关资讯。"),
        ):
            execute_generation_run(run.id)

        document = self.db.scalar(select(ResearchDocument).where(ResearchDocument.document_type == "daily_news"))
        self.assertIsNotNone(document)
        folder = self.db.get(ResearchFolder, document.folder_id)
        self.assertEqual(folder.kind, "news")
        self.assertIn("过去24小时", document.tags)
