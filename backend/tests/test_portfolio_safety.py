from decimal import Decimal
from unittest import TestCase

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.models import Holding, PortfolioImportBatch, Transaction, User
from backend.routers.holdings import create_transaction, delete_holding, restore_holding
from backend.routers.portfolio_backup import import_portfolio, preview_import, undo_import_batch
from backend.schemas import PortfolioBackupHolding, PortfolioBackupImportIn, TransactionCreateIn
from backend.services import create_holding_record, create_transaction_record, recalculate_holding


class PortfolioSafetyTests(TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="safety@example.com", password_hash="test", role="user")
        self.db.add(self.user)
        self.db.flush()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_archive_and_restore_preserve_ledger(self) -> None:
        holding = create_holding_record(self.db, user_id=self.user.id, asset_type="stock", name="AAPL", market="US", symbol="AAPL", currency="USD")
        create_transaction_record(
            self.db,
            user_id=self.user.id,
            holding_id=holding.id,
            transaction_type="buy",
            quantity="2",
            unit_price="100",
            currency="USD",
            exchange_rate_to_cny="7",
            flow_class="opening_balance",
        )
        recalculate_holding(self.db, holding)
        self.db.commit()

        delete_holding(holding.id, self.user, self.db)
        self.assertIsNotNone(self.db.get(Holding, holding.id).archived_at)
        self.assertEqual(len(self.db.scalars(select(Transaction).where(Transaction.holding_id == holding.id)).all()), 1)
        restored = restore_holding(holding.id, self.user, self.db)
        self.assertIsNone(restored.archived_at)
        self.assertEqual(restored.quantity, Decimal("2.00000000"))

    def test_import_preview_skips_duplicates_and_batch_can_be_undone(self) -> None:
        existing = create_holding_record(self.db, user_id=self.user.id, asset_type="fund", name="Existing", market="CN", symbol="000001", currency="CNY")
        self.db.commit()
        payload = PortfolioBackupImportIn(
            schema_version="portfolio_backup_v3",
            backup_key="test-backup",
            holdings=[
                PortfolioBackupHolding(type="fund", name="Existing", market="CN", symbol="000001", currency="CNY"),
                PortfolioBackupHolding(
                    type="fund",
                    name="New fund",
                    market="CN",
                    symbol="000002",
                    currency="CNY",
                    quantity=Decimal("10"),
                    avg_cost=Decimal("2"),
                    current_price=Decimal("2.1"),
                    exchange_rate_to_cny=Decimal("1"),
                ),
            ],
        )

        preview = preview_import(payload, self.user, self.db)
        self.assertEqual(preview.duplicate_count, 1)
        self.assertEqual(preview.new_count, 1)
        result = import_portfolio(payload, self.user, self.db)
        self.assertEqual(result.imported, 1)
        self.assertEqual(result.skipped, 1)
        imported = self.db.scalar(select(Holding).where(Holding.symbol == "000002"))
        self.assertIsNotNone(imported)
        entry = self.db.scalar(select(Transaction).where(Transaction.holding_id == imported.id))
        self.assertEqual(entry.flow_class, "opening_balance")

        undone = undo_import_batch(result.batch_id, self.user, self.db)
        self.assertEqual(undone["removed"], 1)
        self.assertIsNone(self.db.scalar(select(Holding).where(Holding.symbol == "000002")))
        self.assertEqual(self.db.get(PortfolioImportBatch, result.batch_id).status, "reverted")
        self.assertIsNotNone(self.db.get(Holding, existing.id))

    def test_income_credits_cash_without_changing_position_cost(self) -> None:
        holding = create_holding_record(self.db, user_id=self.user.id, asset_type="bond", name="SGOV", market="US", symbol="SGOV", currency="USD")
        cash = create_holding_record(self.db, user_id=self.user.id, asset_type="cash", name="IBKR USD", group="IBKR", currency="USD", exchange_rate_to_cny="7")
        create_transaction_record(
            self.db,
            user_id=self.user.id,
            holding_id=holding.id,
            transaction_type="buy",
            quantity="10",
            unit_price="100",
            currency="USD",
            exchange_rate_to_cny="7",
            flow_class="opening_balance",
        )
        recalculate_holding(self.db, holding)
        self.db.commit()

        transaction = create_transaction(
            holding.id,
            TransactionCreateIn(
                type="income",
                quantity=Decimal("12.5"),
                unit_price=Decimal("1"),
                currency="USD",
                exchange_rate_to_cny=Decimal("7"),
                settle_cash=True,
                cash_holding_id=cash.id,
                flow_class="internal_trade",
            ),
            self.user,
            self.db,
        )

        self.db.refresh(holding)
        self.db.refresh(cash)
        self.assertEqual(holding.quantity, Decimal("10.00000000"))
        self.assertEqual(holding.cost_basis_cny, Decimal("7000.00"))
        self.assertEqual(cash.quantity, Decimal("12.50000000"))
        self.assertEqual(transaction.realized_gain_native, Decimal("12.50000000"))
