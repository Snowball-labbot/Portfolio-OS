from datetime import datetime, timezone
from decimal import Decimal
from unittest import TestCase

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.exposure_templates import ensure_holding_mapping, infer_profile_code, replace_manual_mappings, seed_profiles
from backend.models import Holding, User, ValuationSnapshot
from backend.services import create_holding_record, create_transaction_record, portfolio_performance, recalculate_holding


UTC = timezone.utc


class PortfolioInsightsTests(TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="insights@example.com", password_hash="test", role="user")
        self.db.add(self.user)
        self.db.flush()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_exposure_classifier_uses_simple_index_buckets(self) -> None:
        nasdaq = Holding(user_id=self.user.id, type="fund", name="景顺长城纳斯达克科技ETF联接", market="CN", currency="CNY")
        short_bond = Holding(user_id=self.user.id, type="bond", name="广发安泽短债债券A", market="CN", currency="CNY")
        us_stock = Holding(user_id=self.user.id, type="stock", name="NVIDIA", symbol="NVDA", market="US", currency="USD")
        japan_fund = Holding(user_id=self.user.id, type="fund", name="日经ETF华夏", market="CN", currency="CNY")
        credit_bond = Holding(user_id=self.user.id, type="fund", name="景顺长城景颐招利6个月持有期债券A", market="CN", currency="CNY")
        self.assertEqual(infer_profile_code(nasdaq), "NASDAQ_100")
        self.assertEqual(infer_profile_code(short_bond), "CHINA_SHORT_BOND")
        self.assertEqual(infer_profile_code(us_stock), "US_STOCK")
        self.assertEqual(infer_profile_code(japan_fund), "JP_STOCK")
        self.assertEqual(infer_profile_code(credit_bond), "CHINA_CREDIT_BOND")

    def test_auto_mapping_refreshes_but_manual_split_is_preserved(self) -> None:
        seed_profiles(self.db)
        holding = Holding(
            user_id=self.user.id,
            type="fund",
            name="普通基金",
            market="CN",
            currency="CNY",
        )
        self.db.add(holding)
        self.db.flush()
        self.assertEqual(ensure_holding_mapping(self.db, holding)[0].profile_code, "CHINA_BROAD")

        holding.name = "日经 ETF 联接"
        self.assertEqual(ensure_holding_mapping(self.db, holding)[0].profile_code, "JP_STOCK")
        replace_manual_mappings(self.db, holding, [
            {"profile_code": "JP_STOCK", "weight_pct": "70"},
            {"profile_code": "CASH", "weight_pct": "30"},
        ])
        holding.name = "标普 500 ETF 联接"
        mappings = ensure_holding_mapping(self.db, holding)
        self.assertEqual({item.profile_code for item in mappings}, {"JP_STOCK", "CASH"})
        self.assertTrue(all(item.mapping_source == "manual" for item in mappings))

    def test_cost_basis_keeps_transaction_time_fx(self) -> None:
        holding = create_holding_record(
            self.db,
            user_id=self.user.id,
            asset_type="stock",
            name="Test stock",
            market="US",
            symbol="TEST",
            currency="USD",
            exchange_rate_to_cny="7.5",
        )
        create_transaction_record(
            self.db,
            user_id=self.user.id,
            holding_id=holding.id,
            transaction_type="buy",
            quantity="10",
            unit_price="100",
            exchange_rate_to_cny="7",
            currency="USD",
        )
        recalculate_holding(self.db, holding)
        holding.exchange_rate_to_cny = Decimal("7.5")
        holding.current_value_cny = Decimal("7500")
        self.assertEqual(holding.cost_basis_cny, Decimal("7000"))
        self.assertEqual(holding.unrealized_gain_cny, Decimal("500"))
        self.assertEqual(holding.unrealized_gain_pct.quantize(Decimal("0.01")), Decimal("7.14"))

    def test_external_contribution_does_not_create_return(self) -> None:
        holding = create_holding_record(self.db, user_id=self.user.id, asset_type="cash", name="Cash", currency="CNY")
        create_transaction_record(
            self.db,
            user_id=self.user.id,
            holding_id=holding.id,
            transaction_type="cash_in",
            trade_date=datetime(2026, 7, 6, 9, tzinfo=UTC),
            quantity="100",
            unit_price="1",
            currency="CNY",
            exchange_rate_to_cny="1",
            flow_class="opening_balance",
        )
        self.db.add_all([
            ValuationSnapshot(
                user_id=self.user.id,
                holding_id=holding.id,
                snapshot_date=datetime(2026, 7, 6, tzinfo=UTC),
                quantity=Decimal("100"), unit_price=Decimal("1"), value=Decimal("100"), value_cny=Decimal("100"), source="test",
            ),
            ValuationSnapshot(
                user_id=self.user.id,
                holding_id=holding.id,
                snapshot_date=datetime(2026, 7, 7, tzinfo=UTC),
                quantity=Decimal("150"), unit_price=Decimal("1"), value=Decimal("150"), value_cny=Decimal("150"), source="test",
            ),
        ])
        create_transaction_record(
            self.db,
            user_id=self.user.id,
            holding_id=holding.id,
            transaction_type="cash_in",
            trade_date=datetime(2026, 7, 7, 12, tzinfo=UTC),
            quantity="50",
            unit_price="1",
            currency="CNY",
            exchange_rate_to_cny="1",
            flow_class="external_contribution",
        )
        recalculate_holding(self.db, holding)
        self.db.commit()
        result = portfolio_performance(self.db, self.user.id, "all")
        self.assertEqual(result["profit_cny"], Decimal("0"))
        self.assertEqual(result["return_pct"], Decimal("0"))
