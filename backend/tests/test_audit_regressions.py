from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import select

from backend.models import Transaction, ValuationObservation, ValuationSnapshot
from backend.research.briefing import build_transaction_events, report_window
from backend.research.calendar import us_market_session_close_at
from backend.research.report_render import contribution_table
from backend.research.review_metrics import review_metrics
from backend.research.sources import ExternalNews
from backend.research.translation import _apply_translation
from backend.routers.holdings import create_transaction
from backend.schemas import TransactionCreateIn
from backend.services import create_transaction_record, recalculate_holding
from backend.tests.test_cash_ledger import CashLedgerTests

UTC = timezone.utc


class AuditRegressions(TestCase):
    setUp = CashLedgerTests.setUp
    tearDown = CashLedgerTests.tearDown
    _holding = CashLedgerTests._holding

    def stock(self):
        return self._holding(asset_type="stock", name="Example", currency="USD", quantity="10", unit_price="100", exchange_rate="7")

    def test_same_request_cannot_sell_twice(self):
        stock = self.stock()
        payload = TransactionCreateIn(type="sell", quantity=D(2), unit_price=D(120), currency="USD", exchange_rate_to_cny=D(7), client_request_id="retry-same-request")
        first = create_transaction(stock.id, payload, self.user, self.db)
        second = create_transaction(stock.id, payload, self.user, self.db)
        self.assertEqual(first.id, second.id)
        self.db.refresh(stock)
        self.assertEqual(stock.quantity, D(8))

    def test_backdated_sale_cannot_spend_future_position(self):
        stock = self.stock()
        with self.assertRaises(HTTPException) as error:
            create_transaction(stock.id, TransactionCreateIn(type="sell", quantity=D(2), unit_price=D(120), currency="USD", exchange_rate_to_cny=D(7), trade_date=datetime(2026, 7, 23, tzinfo=UTC)), self.user, self.db)
        self.assertEqual(error.exception.status_code, 400)
        self.db.refresh(stock)
        self.assertEqual(stock.quantity, D(10))

    def test_historical_cost_replay_preserves_latest_quote(self):
        stock = self.stock()
        create_transaction_record(self.db, user_id=self.user.id, holding_id=stock.id, transaction_type="sell", quantity=D(5), unit_price=D(130), currency="USD", exchange_rate_to_cny=D(8), trade_date=datetime(2026, 7, 28, tzinfo=UTC))
        create_transaction_record(self.db, user_id=self.user.id, holding_id=stock.id, transaction_type="buy", quantity=D(10), unit_price=D(120), currency="USD", exchange_rate_to_cny=D(6), trade_date=datetime(2026, 7, 25, tzinfo=UTC))
        stock.current_price = D(155)
        stock.exchange_rate_to_cny = D("7.3")
        stock.price_updated_at = datetime(2026, 8, 1, tzinfo=UTC)
        recalculate_holding(self.db, stock, strict=True)
        sale = self.db.scalar(select(Transaction).where(Transaction.holding_id == stock.id, Transaction.type == "sell"))
        self.assertEqual(sale.realized_gain_cny, D(1650))
        self.assertEqual(stock.current_price, D(155))
        self.assertEqual(stock.exchange_rate_to_cny, D("7.3"))

    def test_historical_cross_currency_uses_submitted_fx(self):
        stock = self.stock()
        cash = self._holding(asset_type="cash", name="HKD cash", currency="HKD", quantity="10000", unit_price="1", exchange_rate="0.92")
        with patch("backend.routers.holdings.get_currency_cny_rate", side_effect=AssertionError("must not replace submitted FX")):
            create_transaction(stock.id, TransactionCreateIn(type="buy", quantity=D(1), unit_price=D(100), currency="USD", exchange_rate_to_cny=D("7.2"), cash_exchange_rate_to_cny=D("0.9"), settle_cash=True, cash_holding_id=cash.id, trade_date=datetime(2026, 7, 27, tzinfo=UTC)), self.user, self.db)
        self.db.refresh(cash)
        self.assertEqual(cash.quantity, D(9200))

    def test_external_deposit_is_not_investment_return(self):
        cash = self._holding(asset_type="cash", name="CNY cash", currency="CNY", quantity="1000", unit_price="1", exchange_rate="1")
        start = datetime(2026, 8, 1, 14, tzinfo=UTC)
        tx = create_transaction_record(self.db, user_id=self.user.id, holding_id=cash.id, transaction_type="cash_in", quantity=D(150000), unit_price=D(1), currency="CNY", flow_class="external_contribution", trade_date=start + timedelta(hours=1))
        context = review_metrics(self.db, self.user.id, [cash], start, start + timedelta(days=1), build_transaction_events([tx], {cash.id: cash}))
        self.assertEqual(context["external_flow_cny"], D(150000))
        self.assertEqual(context["investment_pnl_cny"], D(0))
        self.assertEqual(context["investment_return_pct"], D(0))

    def test_new_external_position_does_not_double_subtract_its_first_snapshot(self):
        holding = self._holding(
            asset_type="stock", name="New position", currency="USD",
            quantity="0", unit_price="1", exchange_rate="1",
        )
        start = datetime(2026, 8, 1, 14, tzinfo=UTC)
        trade_at = start + timedelta(hours=1)
        tx = create_transaction_record(
            self.db, user_id=self.user.id, holding_id=holding.id,
            transaction_type="buy", quantity=D(100), unit_price=D(1),
            currency="USD", exchange_rate_to_cny=D(1),
            flow_class="external_contribution", trade_date=trade_at,
        )
        self.db.add(ValuationSnapshot(
            user_id=self.user.id, holding_id=holding.id,
            snapshot_date=trade_at, created_at=trade_at,
            quantity=D(100), unit_price=D("1.10"), value=D(110),
            value_cny=D(110), source="test",
        ))
        self.db.flush()
        events = build_transaction_events([tx], {holding.id: holding})
        context = review_metrics(self.db, self.user.id, [holding], start, start + timedelta(days=1), events)

        self.assertEqual(context["external_flow_cny"], D(100))
        self.assertEqual(context["investment_pnl_cny"], D(10))

    def test_sale_and_cash_receipt_do_not_double_count_profit(self):
        stock = self.stock()
        cash = self._holding(asset_type="cash", name="CNY cash", currency="CNY", quantity="0", unit_price="1", exchange_rate="1")
        start = datetime(2026, 8, 1, 14, tzinfo=UTC)
        for at, qty, price in [(start, D(10), D(100)), (start + timedelta(days=1), D(8), D(120))]:
            self.db.add(ValuationObservation(user_id=self.user.id, holding_id=stock.id, observed_at=at, quantity=qty, unit_price=price, exchange_rate_to_cny=D(7), value_cny=qty*price*7, source="test"))
        sale = create_transaction_record(self.db, user_id=self.user.id, holding_id=stock.id, transaction_type="sell", quantity=D(2), unit_price=D(120), currency="USD", exchange_rate_to_cny=D(7), operation_id="paired", trade_date=start+timedelta(hours=1))
        receipt = create_transaction_record(self.db, user_id=self.user.id, holding_id=cash.id, transaction_type="cash_in", quantity=D(1680), unit_price=D(1), currency="CNY", operation_id="paired", trade_date=start+timedelta(hours=1))
        self.db.flush()
        events = build_transaction_events([sale, receipt], {stock.id: stock, cash.id: cash})
        context = review_metrics(self.db, self.user.id, [stock, cash], start, start+timedelta(days=1), events)
        self.assertEqual(context["investment_pnl_cny"], D(1400))
        self.assertEqual(context["external_flow_cny"], D(0))

    def test_internal_buy_from_foreign_cash_does_not_create_profit(self):
        stock = self.stock()
        cash = self._holding(
            asset_type="cash", name="USD cash", currency="USD",
            quantity="1000", unit_price="1", exchange_rate="7",
        )
        start = datetime(2026, 8, 1, 14, tzinfo=UTC)
        end = start + timedelta(days=1)
        self.db.add_all([
            ValuationObservation(
                user_id=self.user.id, holding_id=stock.id, observed_at=start,
                quantity=D(10), unit_price=D(100), exchange_rate_to_cny=D(7),
                value_cny=D(7000), source="test",
            ),
            ValuationObservation(
                user_id=self.user.id, holding_id=stock.id, observed_at=end,
                quantity=D(11), unit_price=D(100), exchange_rate_to_cny=D(7),
                value_cny=D(7700), source="test",
            ),
        ])
        buy = create_transaction_record(
            self.db, user_id=self.user.id, holding_id=stock.id,
            transaction_type="buy", quantity=D(1), unit_price=D(100),
            currency="USD", exchange_rate_to_cny=D(7), operation_id="buy-pair",
            trade_date=start + timedelta(hours=1),
        )
        debit = create_transaction_record(
            self.db, user_id=self.user.id, holding_id=cash.id,
            transaction_type="cash_out", quantity=D(100), unit_price=D(1),
            currency="USD", exchange_rate_to_cny=D(7), operation_id="buy-pair",
            trade_date=start + timedelta(hours=1),
        )
        self.db.flush()
        events = build_transaction_events([buy, debit], {stock.id: stock, cash.id: cash})
        context = review_metrics(self.db, self.user.id, [stock, cash], start, end, events)

        self.assertEqual(context["external_flow_cny"], D(0))
        self.assertEqual(context["investment_pnl_cny"], D(0))

    def test_calendar_early_close_and_separate_review_windows(self):
        self.assertEqual(us_market_session_close_at(date(2026, 11, 27)).hour, 18)
        at = datetime(2026, 9, 8, 14, tzinfo=UTC)
        bedtime = report_window("bedtime", at.date(), at.date(), at)
        close = report_window("market_close", date(2026, 9, 4), date(2026, 9, 4), at)
        self.assertEqual(bedtime[1], at)
        self.assertNotEqual(bedtime, close)

    def test_delayed_bedtime_review_uses_actual_generation_time(self):
        generated = datetime(2026, 9, 8, 14, 25, tzinfo=UTC)
        _, end = report_window("bedtime", date(2026, 9, 8), date(2026, 9, 8), generated)
        self.assertEqual(end, generated)

    def test_partial_observations_still_render_contribution_table(self):
        stock = self.stock()
        start = datetime(2026, 9, 7, 14, tzinfo=UTC)
        first = datetime(2026, 9, 8, 6, tzinfo=UTC)
        end = datetime(2026, 9, 8, 14, 30, tzinfo=UTC)
        self.db.add_all([
            ValuationObservation(user_id=self.user.id, holding_id=stock.id, observed_at=first, price_as_of=datetime(2026, 9, 4, 20, tzinfo=UTC), quantity=D(10), unit_price=D(100), exchange_rate_to_cny=D("6.8"), value_cny=D(6800), source="test"),
            ValuationObservation(user_id=self.user.id, holding_id=stock.id, observed_at=end, price_as_of=end, quantity=D(10), unit_price=D(101), exchange_rate_to_cny=D("6.7"), value_cny=D(6767), source="test"),
        ])
        self.db.flush()
        context = review_metrics(self.db, self.user.id, [stock], start, end, [])
        self.assertTrue(context["data_available"])
        self.assertEqual(context["calculation_quality"], "estimate")
        self.assertEqual(context["investment_pnl_cny"], D(-33))
        rendered = contribution_table(context)
        self.assertIn("今日各持仓贡献", rendered)
        self.assertIn("09-04 → 09-08", rendered)
        self.assertIn("最近可比行情", rendered)

    def test_headline_translation_cannot_invent_summary(self):
        news = ExternalNews(news_key="test", title="Company reports earnings", source="test", source_url="https://example.com", published_at=datetime.now(UTC))
        _apply_translation(news, "公司公布财报", "收入大增50%", model="test")
        self.assertIsNone(news.summary)
