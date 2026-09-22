from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(ApiModel):
    id: str
    email: EmailStr
    role: str


class RegisterIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=8)
    invite_code: str | None = Field(default=None, min_length=4)


class LoginIn(ApiModel):
    email: EmailStr
    password: str


class InviteCreateIn(ApiModel):
    max_uses: int = Field(default=1, ge=1, le=100)
    expires_at: datetime | None = None


class InviteOut(ApiModel):
    code: str
    max_uses: int
    used_count: int
    expires_at: datetime | None


class HoldingCreateIn(ApiModel):
    type: str
    name: str = Field(min_length=1)
    group: str | None = None
    market: str | None = None
    symbol: str | None = None
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    quantity: Decimal = Field(default=Decimal("1"), ge=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    current_price: Decimal | None = Field(default=None, ge=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    exchange_rate_to_cny: Decimal = Field(default=Decimal("1"), gt=0)
    trade_date: datetime | None = None
    note: str | None = None
    flow_class: str = "opening_balance"


class HoldingUpdateIn(ApiModel):
    name: str | None = None
    group: str | None = None
    market: str | None = None
    symbol: str | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    exchange_rate_to_cny: Decimal | None = Field(default=None, gt=0)


class HoldingOut(ApiModel):
    id: str
    type: str
    name: str
    group: str | None
    market: str | None
    symbol: str | None
    instrument_name: str | None
    quote_source: str | None
    currency: str
    quantity: Decimal
    avg_cost: Decimal
    current_price: Decimal
    current_value: Decimal
    current_value_cny: Decimal
    exchange_rate_to_cny: Decimal
    cost_basis_cny: Decimal
    price_updated_at: datetime | None
    archived_at: datetime | None
    unrealized_gain_native: Decimal
    unrealized_gain_cny: Decimal
    unrealized_gain_pct: Decimal
    realized_gain_native: Decimal
    realized_gain_cny: Decimal
    created_at: datetime
    updated_at: datetime


class MarketSearchResult(ApiModel):
    symbol: str
    name: str
    market: str
    kind: str
    currency: str
    price: Decimal | None = None
    price_updated_at: datetime | None = None
    quote_source: str | None = None


class MarketQuoteOut(ApiModel):
    symbol: str
    name: str
    market: str
    kind: str
    currency: str
    price: Decimal
    exchange_rate_to_cny: Decimal
    price_updated_at: datetime
    quote_source: str


class TransactionCreateIn(ApiModel):
    client_request_id: str | None = Field(default=None, min_length=1, max_length=36)
    type: str
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    exchange_rate_to_cny: Decimal = Field(default=Decimal("1"), gt=0)
    settle_cash: bool = False
    cash_holding_id: str | None = None
    cash_exchange_rate_to_cny: Decimal | None = Field(default=None, gt=0)
    trade_date: datetime | None = None
    note: str | None = None
    flow_class: str = "internal_trade"


class TransactionOut(ApiModel):
    id: str
    holding_id: str
    type: str
    trade_date: datetime
    quantity: Decimal
    unit_price: Decimal
    fee: Decimal
    currency: str
    exchange_rate_to_cny: Decimal
    operation_id: str | None
    related_holding_id: str | None
    flow_class: str
    realized_gain_native: Decimal
    realized_gain_cny: Decimal
    note: str | None
    created_at: datetime


class CashTransferCreateIn(ApiModel):
    source_holding_id: str
    destination_holding_id: str
    source_amount: Decimal = Field(gt=0)
    destination_amount: Decimal = Field(gt=0)
    source_exchange_rate_to_cny: Decimal = Field(gt=0)
    destination_exchange_rate_to_cny: Decimal = Field(gt=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    trade_date: datetime | None = None
    note: str | None = None


class CashTransferOut(ApiModel):
    id: str
    source_holding_id: str
    destination_holding_id: str
    source_amount: Decimal
    destination_amount: Decimal
    source_currency: str
    destination_currency: str
    source_exchange_rate_to_cny: Decimal
    destination_exchange_rate_to_cny: Decimal
    fee: Decimal
    trade_date: datetime
    note: str | None
    created_at: datetime


class FxRateOut(ApiModel):
    currency: str
    exchange_rate_to_cny: Decimal
    quote_source: str
    updated_at: datetime


class SummarySlice(ApiModel):
    type: str
    value_cny: Decimal
    count: int


class SummaryOut(ApiModel):
    total_value_cny: Decimal
    total_cost_cny: Decimal
    unrealized_gain_cny: Decimal
    realized_gain_cny: Decimal
    total_gain_cny: Decimal
    slices: list[SummarySlice]


class TrendPoint(ApiModel):
    date: str
    value_cny: Decimal


class ExposureWeightIn(ApiModel):
    profile_code: str
    weight_pct: Decimal = Field(gt=0, le=100)


class ExposureMappingIn(ApiModel):
    items: list[ExposureWeightIn] = Field(min_length=1)


class ExposureProfileOut(ApiModel):
    code: str
    name: str
    asset_class_weights: dict[str, Any]
    region_weights: dict[str, Any]
    sector_weights: dict[str, Any]
    source: str
    as_of_date: date


class PortfolioPerspectiveOut(ApiModel):
    total_value_cny: Decimal
    unclassified_pct: Decimal
    source: str
    as_of_date: date
    views: dict[str, list[dict[str, Any]]]


class PortfolioBackupTransaction(ApiModel):
    type: str
    trade_date: datetime | None = None
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    exchange_rate_to_cny: Decimal = Field(default=Decimal("1"), gt=0)
    operation_id: str | None = None
    related_holding_id: str | None = None
    realized_gain_native: Decimal = Decimal("0")
    realized_gain_cny: Decimal = Decimal("0")
    note: str | None = None
    flow_class: str = "internal_trade"


class PortfolioBackupHolding(ApiModel):
    backup_id: str | None = None
    type: str
    name: str = Field(min_length=1)
    group: str | None = None
    market: str | None = None
    symbol: str | None = None
    instrument_name: str | None = None
    quote_source: str | None = None
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    avg_cost: Decimal = Field(default=Decimal("0"), ge=0)
    current_price: Decimal = Field(default=Decimal("0"), ge=0)
    exchange_rate_to_cny: Decimal = Field(default=Decimal("1"), gt=0)
    price_updated_at: datetime | None = None
    archived_at: datetime | None = None
    source_backup_id: str | None = None
    exposures: list[ExposureWeightIn] = Field(default_factory=list)
    transactions: list[PortfolioBackupTransaction] = Field(default_factory=list)


class PortfolioBackupOut(ApiModel):
    schema_version: str = "portfolio_backup_v3"
    backup_key: str
    exported_at: datetime
    base_currency: str = "CNY"
    holdings: list[PortfolioBackupHolding]


class PortfolioBackupImportIn(ApiModel):
    schema_version: str | None = None
    holdings: list[PortfolioBackupHolding]
    backup_key: str | None = None
    skip_duplicates: bool = True


class PortfolioBackupImportOut(ApiModel):
    imported: int
    skipped: int = 0
    batch_id: str | None = None


class PortfolioBackupPreviewOut(ApiModel):
    total: int
    new_count: int
    duplicate_count: int
    duplicates: list[dict[str, Any]] = Field(default_factory=list)


class StrategyAdviceIn(ApiModel):
    selected_strategy: dict[str, Any] = Field(default_factory=dict)
    allocation_rows: list[dict[str, Any]] = Field(default_factory=list)
    custom_context: str | None = None
    chat_history: list[dict[str, str]] = Field(default_factory=list)


class StrategyAdviceOut(ApiModel):
    advice_markdown: str
    risk_flags: list[str] = Field(default_factory=list)
    rebalance_notes: list[str] = Field(default_factory=list)


class HoldingsImageExtractIn(ApiModel):
    image_data_url: str


class ExtractedHoldingIn(ApiModel):
    type: str = "fund"
    market: str | None = None
    symbol: str | None = None
    name: str
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    current_price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    exchange_rate_to_cny: Decimal = Field(default=Decimal("1"), gt=0)
    group: str | None = None
    note: str | None = None
    confidence: Decimal | None = Field(default=None, ge=0, le=1)


class HoldingsImageExtractOut(ApiModel):
    holdings: list[ExtractedHoldingIn]


class ImportExtractedHoldingsIn(ApiModel):
    holdings: list[ExtractedHoldingIn]


class ImportExtractedHoldingsOut(ApiModel):
    imported: int
    holdings: list[HoldingOut]


class WatchlistCreateIn(ApiModel):
    symbol: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    market: str = Field(default="US", min_length=2, max_length=16)
    cik: str | None = None
    industry: str | None = None
    ir_url: str | None = None
    stance: str = "research"
    thesis: str | None = None
    fair_value_low: Decimal | None = Field(default=None, ge=0)
    fair_value_high: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    catalysts: str | None = None
    risks: str | None = None
    invalidation: str | None = None
    next_review_at: datetime | None = None


class WatchlistUpdateIn(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    cik: str | None = None
    industry: str | None = None
    ir_url: str | None = None
    stance: str | None = None
    thesis: str | None = None
    fair_value_low: Decimal | None = Field(default=None, ge=0)
    fair_value_high: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    catalysts: str | None = None
    risks: str | None = None
    invalidation: str | None = None
    next_review_at: datetime | None = None


class WatchlistOut(ApiModel):
    id: str
    symbol: str
    name: str
    market: str
    cik: str | None
    industry: str | None
    ir_url: str | None
    stance: str
    thesis: str | None
    fair_value_low: Decimal | None
    fair_value_high: Decimal | None
    currency: str
    catalysts: str | None
    risks: str | None
    invalidation: str | None
    next_review_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ResearchFolderCreateIn(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str | None = None
    kind: str = "custom"
    description: str | None = None
    sort_order: int = 0


class ResearchFolderOut(ApiModel):
    id: str
    parent_id: str | None
    name: str
    kind: str
    description: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ResearchDocumentCreateIn(ApiModel):
    folder_id: str | None = None
    document_type: str = "note"
    title: str = Field(min_length=1, max_length=255)
    summary: str | None = None
    content_markdown: str = ""
    tags: list[str] = Field(default_factory=list)
    source_url: str | None = None
    as_of_date: date | None = None
    status: str = "draft"


class ResearchDocumentUpdateIn(ApiModel):
    folder_id: str | None = None
    document_type: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    summary: str | None = None
    content_markdown: str | None = None
    tags: list[str] | None = None
    source_url: str | None = None
    as_of_date: date | None = None
    status: str | None = None


class ResearchDocumentOut(ApiModel):
    id: str
    folder_id: str | None
    document_type: str
    title: str
    summary: str | None
    content_markdown: str
    tags: list[str]
    source_url: str | None
    as_of_date: date | None
    status: str
    created_at: datetime
    updated_at: datetime


class ResearchImportPreviewOut(ApiModel):
    attachment_id: str
    original_filename: str
    content_type: str
    size_bytes: int
    sha256: str
    extraction_method: str
    extracted_text: str
    extracted_chars: int
    suggested_title: str
    suggested_summary: str | None
    suggested_tags: list[str] = Field(default_factory=list)
    suggested_document_type: str
    warnings: list[str] = Field(default_factory=list)
    duplicate_document_id: str | None = None
    duplicate_filename: str | None = None


class ResearchImportOrganizeIn(ApiModel):
    folder_id: str = Field(min_length=1)
    document_type: str | None = Field(default=None, max_length=32)


class ResearchImportDraftOut(ApiModel):
    attachment_id: str
    title: str
    summary: str | None
    tags: list[str] = Field(default_factory=list)
    document_type: str
    content_markdown: str
    ai_used: bool
    warnings: list[str] = Field(default_factory=list)


class ResearchImportConfirmIn(ApiModel):
    folder_id: str = Field(min_length=1)
    document_type: str = Field(default="note", min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=255)
    summary: str | None = None
    content_markdown: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    as_of_date: date | None = None


class ResearchBriefImportIn(ApiModel):
    title: str = Field(min_length=1, max_length=255)
    as_of_date: date
    summary: str | None = None
    content_markdown: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    source_url: str | None = None


class ResearchGenerationRequest(ApiModel):
    kind: str = Field(default="manual", pattern="^(startup|market_close|bedtime|catchup|manual|daily_news)$")
    period_start: date | None = None
    period_end: date | None = None
    force: bool = False


class ResearchGenerationRunOut(ApiModel):
    id: str
    document_id: str | None
    report_kind: str
    period_start: date
    period_end: date
    status: str
    provider: str
    model: str
    attempt_count: int
    started_at: datetime | None
    completed_at: datetime | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class ResearchGenerationStatusOut(ApiModel):
    active_runs: list[ResearchGenerationRunOut] = Field(default_factory=list)
    latest_bedtime: ResearchGenerationRunOut | None = None
    automatic_enabled: bool
    is_target_user: bool
    ai_configured: bool
    provider: str
    model: str
    last_sync_at: datetime | None
    next_market_close_at: datetime
    startup_generated_today: bool
    latest_run: ResearchGenerationRunOut | None
    latest_success: ResearchGenerationRunOut | None
    latest_daily_news: ResearchGenerationRunOut | None
    latest_daily_review: ResearchGenerationRunOut | None


class ResearchEventOut(ApiModel):
    id: str
    event_key: str
    event_type: str
    title: str
    description: str | None
    country: str | None
    ticker: str | None
    company_name: str | None
    indicator_code: str | None
    reference_period: str | None
    scheduled_at: datetime | None
    time_precision: str
    status: str
    importance: int
    source: str
    source_url: str | None
    actual: str | None
    consensus: str | None
    previous: str | None
    unit: str | None
    published_at: datetime | None
    updated_at: datetime


class ResearchNewsOut(ApiModel):
    id: str
    news_key: str
    title: str
    summary: str | None
    source: str
    source_domain: str | None
    source_url: str
    published_at: datetime
    ticker: str | None
    topic: str
    language: str
    image_url: str | None


class DecisionQueueItemOut(ApiModel):
    id: str
    kind: str
    priority: int = Field(ge=1, le=3)
    title: str
    description: str | None = None
    due_at: datetime | None = None
    symbol: str | None = None
    target_view: str
    source_url: str | None = None


class CompanyCoverageOut(ApiModel):
    symbol: str
    name: str
    market: str
    currency: str
    industry: str | None = None
    stance: str
    thesis: str | None = None
    next_review_at: datetime | None = None
    in_portfolio: bool
    holding_value_cny: Decimal = Decimal("0")
    portfolio_weight_pct: Decimal = Decimal("0")
    watchlist_id: str | None = None


class CompanyFundamentalsOut(ApiModel):
    symbol: str
    name: str
    market: str
    currency: str
    exchange: str | None = None
    instrument_type: str | None = None
    sector: str | None = None
    industry: str | None = None
    current_price: Decimal | None = None
    market_cap: Decimal | None = None
    trailing_pe: Decimal | None = None
    forward_pe: Decimal | None = None
    price_to_sales: Decimal | None = None
    price_to_book: Decimal | None = None
    revenue_growth_pct: Decimal | None = None
    earnings_growth_pct: Decimal | None = None
    gross_margin_pct: Decimal | None = None
    operating_margin_pct: Decimal | None = None
    profit_margin_pct: Decimal | None = None
    return_on_equity_pct: Decimal | None = None
    debt_to_equity: Decimal | None = None
    free_cash_flow: Decimal | None = None
    dividend_yield_pct: Decimal | None = None
    beta: Decimal | None = None
    fifty_two_week_low: Decimal | None = None
    fifty_two_week_high: Decimal | None = None
    target_mean_price: Decimal | None = None
    analyst_count: int | None = None
    as_of: datetime
    source: str


class CompanyDossierOut(ApiModel):
    folder: ResearchFolderOut
    document: ResearchDocumentOut


class QuantExperimentCreateIn(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="idea", max_length=32)
    hypothesis: str = ""
    universe: list[str] = Field(default_factory=list)
    benchmark: str | None = Field(default=None, max_length=64)
    start_date: date | None = None
    end_date: date | None = None
    rebalance: str | None = Field(default=None, max_length=64)
    parameters: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""


class QuantExperimentUpdateIn(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, max_length=32)
    hypothesis: str | None = None
    universe: list[str] | None = None
    benchmark: str | None = Field(default=None, max_length=64)
    start_date: date | None = None
    end_date: date | None = None
    rebalance: str | None = Field(default=None, max_length=64)
    parameters: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    notes: str | None = None


class QuantExperimentOut(ApiModel):
    id: str
    name: str
    status: str
    hypothesis: str
    universe: list[str]
    benchmark: str | None
    start_date: date | None
    end_date: date | None
    rebalance: str | None
    parameters: dict[str, Any]
    metrics: dict[str, Any]
    notes: str
    created_at: datetime
    updated_at: datetime


class MarketScoreOut(ApiModel):
    symbol: str
    label: str
    score: Decimal
    valuation_score: Decimal
    trend_score: Decimal
    macro_score: Decimal
    volatility_score: Decimal
    as_of_date: date
    data: dict[str, Any]


class SocialMentionOut(ApiModel):
    rank: int
    ticker: str
    name: str
    mentions: int
    upvotes: int
    rank_24h_ago: int | None = None
    mentions_24h_ago: int | None = None


class MarketPointOut(ApiModel):
    date: str
    value: float


class MacroIndicatorOut(ApiModel):
    key: str
    label: str
    value: float | None = None
    unit: str
    change: float | None = None
    change_unit: str
    as_of: str | None = None
    source: str
    source_url: str
    status: str
    history: list[MarketPointOut] = Field(default_factory=list)
    note: str | None = None


class MacroGroupOut(ApiModel):
    key: str
    label: str
    description: str
    items: list[MacroIndicatorOut]


class PortfolioMacroHoldingOut(ApiModel):
    name: str
    symbol: str | None = None
    value_cny: float


class PortfolioMacroLinkOut(ApiModel):
    key: str
    label: str
    reason: str
    value_cny: float
    weight_pct: float
    holdings: list[PortfolioMacroHoldingOut]


class MacroTapeOut(ApiModel):
    generated_at: datetime
    groups: list[MacroGroupOut]
    commodities: list[MacroIndicatorOut]
    portfolio_links: list[PortfolioMacroLinkOut]
