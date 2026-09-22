from datetime import datetime, timezone
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.models import CashTransfer, Holding, Transaction, User
from backend.routers.holdings import create_transaction
from backend.routers.transfers import create_cash_transfer
from backend.schemas import CashTransferCreateIn, TransactionCreateIn
from backend.services import create_holding_record, create_transaction_record, recalculate_holding


UTC = timezone.utc


class CashLedgerTests(TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="ledger@example.com", password_hash="test", role="user")
        self.db.add(self.user)
        self.db.flush()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _holding(
        self,
        *,
        asset_type: str,
        name: str,
        currency: str,
        quantity: str,
        unit_price: str,
        exchange_rate: str,
    ) -> Holding:
        holding = create_holding_record(
            self.db,
            user_id=self.user.id,
            asset_type=asset_type,
            name=name,
            group="IBKR",
            market="US" if asset_type != "cash" else None,
            symbol="MU" if asset_type != "cash" else None,
            currency=currency,
            exchange_rate_to_cny=exchange_rate,
        )
        create_transaction_record(
            self.db,
            user_id=self.user.id,
            holding_id=holding.id,
            transaction_type="cash_in" if asset_type == "cash" else "buy",
            trade_date=datetime(2026, 7, 24, tzinfo=UTC),
            quantity=quantity,
            unit_price=unit_price,
            currency=currency,
            exchange_rate_to_cny=exchange_rate,
        )
        recalculate_holding(self.db, holding)
        self.db.commit()
        return holding

    def test_sell_can_settle_into_cash_and_record_realized_gain(self) -> None:
        stock = self._holding(
            asset_type="stock",
            name="Micron",
            currency="USD",
            quantity="10",
            unit_price="100",
            exchange_rate="7",
        )
        cash = self._holding(
            asset_type="cash",
            name="IBKR USD cash",
            currency="USD",
            quantity="1000",
            unit_price="1",
            exchange_rate="7",
        )

        result = create_transaction(
            stock.id,
            TransactionCreateIn(
                type="sell",
                quantity=Decimal("2"),
                unit_price=Decimal("150"),
                fee=Decimal("1"),
                currency="USD",
                exchange_rate_to_cny=Decimal("7"),
                settle_cash=True,
                cash_holding_id=cash.id,
                trade_date=datetime(2026, 7, 25, tzinfo=UTC),
            ),
            self.user,
            self.db,
        )

        self.db.refresh(stock)
        self.db.refresh(cash)
        self.assertEqual(stock.quantity, Decimal("8.00000000"))
        self.assertEqual(stock.avg_cost, Decimal("100.00000000"))
        self.assertEqual(cash.quantity, Decimal("1299.00000000"))
        self.assertEqual(result.realized_gain_native, Decimal("99.00000000"))
        self.assertEqual(result.realized_gain_cny, Decimal("693.00000000"))
        self.assertEqual(result.related_holding_id, cash.id)

        linked_cash_entry = self.db.scalar(
            select(Transaction).where(
                Transaction.holding_id == cash.id,
                Transaction.operation_id == result.operation_id,
            )
        )
        self.assertIsNotNone(linked_cash_entry)
        self.assertEqual(linked_cash_entry.type, "cash_in")
        self.assertEqual(linked_cash_entry.quantity, Decimal("299.00000000"))
        self.assertEqual(linked_cash_entry.related_holding_id, stock.id)

    def test_buy_cash_settlement_debits_cost_and_fee(self) -> None:
        stock = self._holding(
            asset_type="stock",
            name="Micron",
            currency="USD",
            quantity="1",
            unit_price="100",
            exchange_rate="7",
        )
        cash = self._holding(
            asset_type="cash",
            name="IBKR USD cash",
            currency="USD",
            quantity="1000",
            unit_price="1",
            exchange_rate="7",
        )

        create_transaction(
            stock.id,
            TransactionCreateIn(
                type="buy",
                quantity=Decimal("2"),
                unit_price=Decimal("120"),
                fee=Decimal("1"),
                currency="USD",
                exchange_rate_to_cny=Decimal("7"),
                settle_cash=True,
                cash_holding_id=cash.id,
            ),
            self.user,
            self.db,
        )

        self.db.refresh(stock)
        self.db.refresh(cash)
        self.assertEqual(stock.quantity, Decimal("3.00000000"))
        self.assertEqual(stock.avg_cost.quantize(Decimal("0.00000001")), Decimal("113.66666667"))
        self.assertEqual(cash.quantity, Decimal("759.00000000"))

    @patch(
        "backend.routers.holdings.get_currency_cny_rate",
        return_value=(Decimal("0.9"), "market:HKD/CNY"),
    )
    def test_buy_can_settle_from_cross_currency_cash(self, _mock_rate) -> None:
        stock = self._holding(
            asset_type="stock",
            name="DRAM",
            currency="USD",
            quantity="1",
            unit_price="50",
            exchange_rate="7.2",
        )
        cash = self._holding(
            asset_type="cash",
            name="IBKR HKD cash",
            currency="HKD",
            quantity="1000",
            unit_price="1",
            exchange_rate="0.9",
        )

        result = create_transaction(
            stock.id,
            TransactionCreateIn(
                type="buy",
                quantity=Decimal("2"),
                unit_price=Decimal("50"),
                fee=Decimal("1"),
                currency="USD",
                exchange_rate_to_cny=Decimal("7.2"),
                settle_cash=True,
                cash_holding_id=cash.id,
            ),
            self.user,
            self.db,
        )

        self.db.refresh(cash)
        self.assertEqual(cash.quantity, Decimal("192.00000000"))
        linked_cash_entry = self.db.scalar(
            select(Transaction).where(
                Transaction.holding_id == cash.id,
                Transaction.operation_id == result.operation_id,
            )
        )
        self.assertIsNotNone(linked_cash_entry)
        self.assertEqual(linked_cash_entry.quantity, Decimal("808.00000000"))
        self.assertEqual(linked_cash_entry.currency, "HKD")
        self.assertEqual(linked_cash_entry.exchange_rate_to_cny, Decimal("0.90000000"))

    def test_cross_currency_transfer_moves_cash_without_guessing_fx_amount(self) -> None:
        source = self._holding(
            asset_type="cash",
            name="Yu'e Bao CNY",
            currency="CNY",
            quantity="1000",
            unit_price="1",
            exchange_rate="1",
        )
        destination = self._holding(
            asset_type="cash",
            name="IBKR HKD cash",
            currency="HKD",
            quantity="100",
            unit_price="1",
            exchange_rate="0.92",
        )

        transfer = create_cash_transfer(
            CashTransferCreateIn(
                source_holding_id=source.id,
                destination_holding_id=destination.id,
                source_amount=Decimal("500"),
                destination_amount=Decimal("540"),
                source_exchange_rate_to_cny=Decimal("1"),
                destination_exchange_rate_to_cny=Decimal("0.92"),
                fee=Decimal("2"),
                note="CNY to HKD",
            ),
            self.user,
            self.db,
        )

        self.db.refresh(source)
        self.db.refresh(destination)
        self.assertEqual(source.quantity, Decimal("498.00000000"))
        self.assertEqual(destination.quantity, Decimal("640.00000000"))
        self.assertEqual(self.db.get(CashTransfer, transfer.id).destination_amount, Decimal("540.00000000"))

        entries = self.db.scalars(
            select(Transaction).where(Transaction.operation_id == transfer.id).order_by(Transaction.type)
        ).all()
        self.assertEqual([entry.type for entry in entries], ["transfer_in", "transfer_out"])
        self.assertEqual({entry.related_holding_id for entry in entries}, {source.id, destination.id})
