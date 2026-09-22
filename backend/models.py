from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return str(uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="user", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    holdings: Mapped[list["Holding"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    user: Mapped[User] = relationship()


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    max_uses: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Holding(Base):
    __tablename__ = "holdings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    group: Mapped[str | None] = mapped_column(String(255), nullable=True)
    market: Mapped[str | None] = mapped_column(String(32), nullable=True)
    symbol: Mapped[str | None] = mapped_column(String(64), nullable=True)
    instrument_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quote_source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="CNY", nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    avg_cost: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    current_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    current_value: Mapped[Decimal] = mapped_column(Numeric(24, 2), default=Decimal("0"), nullable=False)
    current_value_cny: Mapped[Decimal] = mapped_column(Numeric(24, 2), default=Decimal("0"), nullable=False)
    exchange_rate_to_cny: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("1"), nullable=False)
    cost_basis_cny: Mapped[Decimal] = mapped_column(Numeric(24, 2), default=Decimal("0"), nullable=False)
    price_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    source_backup_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    import_batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    user: Mapped[User] = relationship(back_populates="holdings")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="holding", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_holdings_user_type", "user_id", "type"),)

    @property
    def unrealized_gain_native(self) -> Decimal:
        return (self.current_value or Decimal("0")) - ((self.quantity or Decimal("0")) * (self.avg_cost or Decimal("0")))

    @property
    def unrealized_gain_cny(self) -> Decimal:
        return (self.current_value_cny or Decimal("0")) - (self.cost_basis_cny or Decimal("0"))

    @property
    def unrealized_gain_pct(self) -> Decimal:
        cost = self.cost_basis_cny or Decimal("0")
        if cost <= 0:
            return Decimal("0")
        return self.unrealized_gain_cny / cost * Decimal("100")

    @property
    def realized_gain_native(self) -> Decimal:
        return sum((item.realized_gain_native or Decimal("0") for item in self.transactions), Decimal("0"))

    @property
    def realized_gain_cny(self) -> Decimal:
        return sum((item.realized_gain_cny or Decimal("0") for item in self.transactions), Decimal("0"))


class Transaction(Base):
    __tablename__ = "transactions"

    client_request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    holding_id: Mapped[str] = mapped_column(ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    trade_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    fee: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="CNY", nullable=False)
    exchange_rate_to_cny: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("1"), nullable=False)
    operation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    related_holding_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    flow_class: Mapped[str] = mapped_column(String(32), default="internal_trade", nullable=False)
    realized_gain_native: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    realized_gain_cny: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    holding: Mapped[Holding] = relationship(back_populates="transactions")

    __table_args__ = (
        Index("ix_transactions_holding_date", "holding_id", "trade_date"),
        Index("ix_transactions_operation", "operation_id"),
        Index("uq_transactions_user_request", "user_id", "client_request_id", unique=True),
    )


class CashTransfer(Base):
    __tablename__ = "cash_transfers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_holding_id: Mapped[str] = mapped_column(ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False)
    destination_holding_id: Mapped[str] = mapped_column(ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False)
    source_amount: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    destination_amount: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    source_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    destination_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    source_exchange_rate_to_cny: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    destination_exchange_rate_to_cny: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    fee: Mapped[Decimal] = mapped_column(Numeric(24, 8), default=Decimal("0"), nullable=False)
    trade_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    __table_args__ = (
        Index("ix_cash_transfers_user_date", "user_id", "trade_date"),
        Index("ix_cash_transfers_source_destination", "source_holding_id", "destination_holding_id"),
    )


class ValuationSnapshot(Base):
    __tablename__ = "valuation_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    holding_id: Mapped[str] = mapped_column(ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(24, 2), nullable=False)
    value_cny: Mapped[Decimal] = mapped_column(Numeric(24, 2), nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    __table_args__ = (
        UniqueConstraint("holding_id", "snapshot_date", name="uq_holding_snapshot_date"),
        Index("ix_snapshots_user_date", "user_id", "snapshot_date"),
    )


class ValuationObservation(Base):
    __tablename__ = "valuation_observations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    holding_id: Mapped[str] = mapped_column(ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    price_as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    exchange_rate_to_cny: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    value_cny: Mapped[Decimal] = mapped_column(Numeric(24, 2), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (Index("ix_observations_user_time", "user_id", "observed_at"),)


class ExposureProfile(Base):
    __tablename__ = "exposure_profiles"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    asset_class_weights: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    region_weights: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    sector_weights: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    source: Mapped[str] = mapped_column(String(255), default="内置代理模板", nullable=False)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)


class HoldingExposure(Base):
    __tablename__ = "holding_exposures"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    holding_id: Mapped[str] = mapped_column(ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_code: Mapped[str] = mapped_column(ForeignKey("exposure_profiles.code"), nullable=False)
    weight_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("100"), nullable=False)
    mapping_source: Mapped[str] = mapped_column(String(32), default="auto", nullable=False)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (
        UniqueConstraint("holding_id", "profile_code", name="uq_holding_exposure_profile"),
        Index("ix_holding_exposures_user_holding", "user_id", "holding_id"),
    )


class PortfolioImportBatch(Base):
    __tablename__ = "portfolio_import_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    backup_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    imported_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    market: Mapped[str] = mapped_column(String(16), default="US", nullable=False)
    cik: Mapped[str | None] = mapped_column(String(16), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ir_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    stance: Mapped[str] = mapped_column(String(32), default="research", nullable=False)
    thesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    fair_value_low: Mapped[Decimal | None] = mapped_column(Numeric(24, 4), nullable=True)
    fair_value_high: Mapped[Decimal | None] = mapped_column(Numeric(24, 4), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    catalysts: Mapped[str | None] = mapped_column(Text, nullable=True)
    risks: Mapped[str | None] = mapped_column(Text, nullable=True)
    invalidation: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "market", "symbol", name="uq_watchlist_user_market_symbol"),
        Index("ix_watchlist_user_industry", "user_id", "industry"),
    )


class ResearchFolder(Base):
    __tablename__ = "research_folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("research_folders.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), default="custom", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (Index("ix_research_folders_user_parent", "user_id", "parent_id", "sort_order"),)


class ResearchDocument(Base):
    __tablename__ = "research_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id: Mapped[str | None] = mapped_column(ForeignKey("research_folders.id", ondelete="SET NULL"), nullable=True)
    document_type: Mapped[str] = mapped_column(String(32), default="note", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_markdown: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    as_of_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (
        Index("ix_research_documents_user_folder", "user_id", "folder_id", "updated_at"),
        Index("ix_research_documents_user_type", "user_id", "document_type", "as_of_date"),
    )


class ResearchAttachment(Base):
    __tablename__ = "research_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("research_documents.id", ondelete="SET NULL"), nullable=True, index=True)
    scope: Mapped[str] = mapped_column(String(32), default="industry", nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    extracted_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    extraction_method: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="staged", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    __table_args__ = (
        Index("ix_research_attachments_user_hash", "user_id", "sha256"),
        Index("ix_research_attachments_user_status", "user_id", "status", "created_at"),
    )


class ResearchGenerationRun(Base):
    __tablename__ = "research_generation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("research_documents.id", ondelete="SET NULL"), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    report_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    provider: Mapped[str] = mapped_column(String(32), default="agnes", nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (
        Index("ix_research_generation_user_status", "user_id", "status", "updated_at"),
        Index("ix_research_generation_user_period", "user_id", "period_end", "report_kind"),
    )


class ResearchEvent(Base):
    __tablename__ = "research_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    event_key: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(String(8), nullable=True)
    ticker: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    indicator_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference_period: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    time_precision: Mapped[str] = mapped_column(String(16), default="exact", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="scheduled", nullable=False)
    importance: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    actual: Mapped[str | None] = mapped_column(String(64), nullable=True)
    consensus: Mapped[str | None] = mapped_column(String(64), nullable=True)
    previous: Mapped[str | None] = mapped_column(String(64), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "event_key", name="uq_research_event_source_key"),
        Index("ix_research_events_type_schedule", "event_type", "scheduled_at"),
    )


class ResearchNewsItem(Base):
    __tablename__ = "research_news_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    news_key: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(1000), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(128), nullable=False)
    source_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_url: Mapped[str] = mapped_column(String(1500), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ticker: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    topic: Mapped[str] = mapped_column(String(32), default="market", nullable=False)
    language: Mapped[str] = mapped_column(String(16), default="en", nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(1500), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "news_key", name="uq_research_news_source_key"),
        Index("ix_research_news_topic_published", "topic", "published_at"),
    )


class QuantExperiment(Base):
    __tablename__ = "quant_experiments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="idea", nullable=False)
    hypothesis: Mapped[str] = mapped_column(Text, default="", nullable=False)
    universe: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    benchmark: Mapped[str | None] = mapped_column(String(64), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rebalance: Mapped[str | None] = mapped_column(String(64), nullable=True)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)

    __table_args__ = (
        Index("ix_quant_experiments_user_status", "user_id", "status", "updated_at"),
    )


class SourceSyncState(Base):
    __tablename__ = "source_sync_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="idle", nullable=False)
    last_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False)


class MarketScoreSnapshot(Base):
    __tablename__ = "market_score_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    valuation_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    trend_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    macro_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    volatility_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    __table_args__ = (
        UniqueConstraint("symbol", "as_of_date", name="uq_market_score_symbol_date"),
        Index("ix_market_score_symbol_date", "symbol", "as_of_date"),
    )
