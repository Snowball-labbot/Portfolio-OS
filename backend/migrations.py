from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


HOLDING_COLUMNS = {
    "instrument_name": "VARCHAR(255)",
    "quote_source": "VARCHAR(64)",
    "price_updated_at": "TIMESTAMP",
    "cost_basis_cny": "NUMERIC(24, 2) NOT NULL DEFAULT 0",
    "archived_at": "TIMESTAMP",
    "source_backup_id": "VARCHAR(64)",
    "import_batch_id": "VARCHAR(36)",
}

TRANSACTION_COLUMNS = {
    "client_request_id": "VARCHAR(36)",
    "operation_id": "VARCHAR(36)",
    "related_holding_id": "VARCHAR(36)",
    "realized_gain_native": "NUMERIC(24, 8) NOT NULL DEFAULT 0",
    "realized_gain_cny": "NUMERIC(24, 8) NOT NULL DEFAULT 0",
    "flow_class": "VARCHAR(32) NOT NULL DEFAULT 'internal_trade'",
}


def ensure_lightweight_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "holdings" not in table_names:
        return

    with engine.begin() as connection:
        existing = {column["name"] for column in inspector.get_columns("holdings")}
        for name, ddl_type in HOLDING_COLUMNS.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE holdings ADD COLUMN {name} {ddl_type}"))

        if "transactions" in table_names:
            transaction_columns = {column["name"] for column in inspector.get_columns("transactions")}
            for name, ddl_type in TRANSACTION_COLUMNS.items():
                if name not in transaction_columns:
                    connection.execute(text(f"ALTER TABLE transactions ADD COLUMN {name} {ddl_type}"))
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_transactions_operation ON transactions (operation_id)")
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_holdings_archived_at ON holdings (archived_at)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_holdings_import_batch_id ON holdings (import_batch_id)"))
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_user_request ON transactions (user_id, client_request_id)"))
            # Only classify legacy rows when introducing this column. Repeating
            # this migration would overwrite explicit user choices on every boot.
            if "flow_class" in transaction_columns:
                return
            connection.execute(text("UPDATE transactions SET flow_class = 'internal_transfer' WHERE type IN ('transfer_in', 'transfer_out')"))
            connection.execute(text("UPDATE transactions SET flow_class = 'valuation_correction' WHERE type = 'adjustment'"))
            connection.execute(text("UPDATE transactions SET flow_class = 'opening_balance' WHERE trade_date < '2026-07-07' AND operation_id IS NULL"))
            connection.execute(text("UPDATE transactions SET flow_class = 'external_contribution' WHERE type = 'cash_in' AND operation_id IS NULL AND trade_date >= '2026-07-07'"))
            connection.execute(text("UPDATE transactions SET flow_class = 'external_withdrawal' WHERE type = 'cash_out' AND operation_id IS NULL AND trade_date >= '2026-07-07'"))
            connection.execute(text("UPDATE transactions SET flow_class = 'external_contribution' WHERE type = 'buy' AND operation_id IS NULL AND trade_date >= '2026-07-07'"))
            connection.execute(text("""
                UPDATE transactions AS withdrawn
                SET flow_class = 'valuation_correction'
                WHERE withdrawn.type = 'cash_out'
                  AND withdrawn.operation_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM transactions AS deposited
                    WHERE deposited.holding_id = withdrawn.holding_id
                      AND deposited.type = 'cash_in'
                      AND deposited.operation_id IS NOT NULL
                      AND deposited.quantity = withdrawn.quantity
                      AND DATE(deposited.trade_date) = DATE(withdrawn.trade_date)
                      AND deposited.trade_date < withdrawn.trade_date
                  )
            """))
