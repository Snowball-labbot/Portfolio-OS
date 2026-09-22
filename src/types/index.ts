export enum AssetType {
  CASH = 'cash',
  STOCK = 'stock',
  BOND = 'bond',
  FUND = 'fund',
  PROPERTY = 'property',
  OTHER = 'other'
}

export interface AssetItem {
  id: string;
  type: AssetType;
  name: string;
  group?: string | null;
  market?: string | null;
  symbol?: string | null;
  instrument_name?: string | null;
  quote_source?: string | null;
  currency: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  current_value: number;
  current_value_cny: number;
  exchange_rate_to_cny: number;
  cost_basis_cny: number;
  price_updated_at?: string | null;
  archived_at?: string | null;
  unrealized_gain_native: number;
  unrealized_gain_cny: number;
  unrealized_gain_pct: number;
  realized_gain_native: number;
  realized_gain_cny: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionItem {
  id: string;
  holding_id: string;
  type: 'buy' | 'sell' | 'adjustment' | 'cash_in' | 'cash_out' | 'transfer_in' | 'transfer_out' | 'income';
  trade_date: string;
  quantity: number;
  unit_price: number;
  fee: number;
  currency: string;
  exchange_rate_to_cny: number;
  operation_id?: string | null;
  related_holding_id?: string | null;
  flow_class: FlowClass;
  realized_gain_native: number;
  realized_gain_cny: number;
  note?: string | null;
  created_at: string;
}

export interface AssetTypeConfig {
  label: string;
  color: string;
}

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

export interface HoldingCreateInput {
  type: AssetType;
  name: string;
  group?: string | null;
  market?: string | null;
  symbol?: string | null;
  currency: string;
  quantity: number;
  unit_price: number;
  current_price?: number | null;
  fee: number;
  exchange_rate_to_cny: number;
  trade_date?: string;
  note?: string | null;
  flow_class?: FlowClass;
}

export interface HoldingUpdateInput {
  name?: string;
  group?: string | null;
  market?: string | null;
  symbol?: string | null;
  currency?: string;
  exchange_rate_to_cny?: number;
}

export interface TransactionCreateInput {
  client_request_id?: string;
  cash_exchange_rate_to_cny?: number;
  type: TransactionItem['type'];
  quantity: number;
  unit_price: number;
  fee: number;
  currency: string;
  exchange_rate_to_cny: number;
  settle_cash?: boolean;
  cash_holding_id?: string | null;
  trade_date?: string;
  note?: string | null;
  flow_class?: FlowClass;
}

export type FlowClass = 'opening_balance' | 'external_contribution' | 'external_withdrawal' | 'internal_trade' | 'internal_transfer' | 'valuation_correction';

export interface CashTransferInput {
  source_holding_id: string;
  destination_holding_id: string;
  source_amount: number;
  destination_amount: number;
  source_exchange_rate_to_cny: number;
  destination_exchange_rate_to_cny: number;
  fee: number;
  trade_date?: string;
  note?: string | null;
}

export interface CashTransferItem extends CashTransferInput {
  id: string;
  source_currency: string;
  destination_currency: string;
  trade_date: string;
  created_at: string;
}

export interface FxRate {
  currency: string;
  exchange_rate_to_cny: number;
  quote_source: string;
  updated_at: string;
}

export interface Summary {
  total_value_cny: number;
  total_cost_cny: number;
  unrealized_gain_cny: number;
  realized_gain_cny: number;
  total_gain_cny: number;
  slices: Array<{ type: AssetType; value_cny: number; count: number }>;
}

export interface TrendPoint {
  date: string;
  value_cny: number;
}

export interface PerformancePoint extends TrendPoint {
  net_flow_cny: number;
  invested_capital_cny: number;
  profit_cny: number;
  cumulative_return_pct: number;
}

export interface PortfolioPerformance {
  baseline_date: string;
  current_value_cny: number;
  net_invested_cny: number;
  profit_cny: number;
  return_pct: number;
  max_drawdown_pct: number;
  points: PerformancePoint[];
}

export interface PerspectiveContributor {
  holding_id: string;
  name: string;
  value_cny: number;
  weight_pct: number;
  mapping_source: 'auto' | 'manual' | string;
}

export interface PerspectiveRow {
  name: string;
  value_cny: number;
  percent: number;
  contributors: PerspectiveContributor[];
}

export interface PortfolioPerspective {
  total_value_cny: number;
  unclassified_pct: number;
  source: string;
  as_of_date: string;
  views: Record<'core' | 'asset_class' | 'region' | 'sector', PerspectiveRow[]>;
}

export interface ExposureProfile {
  code: string;
  name: string;
  asset_class_weights: Record<string, number>;
  region_weights: Record<string, number>;
  sector_weights: Record<string, number>;
  source: string;
  as_of_date: string;
}

export interface HoldingExposureItem {
  profile_code: string;
  profile_name: string;
  weight_pct: number;
  mapping_source: 'auto' | 'manual' | string;
  as_of_date: string;
}

export interface HoldingExposureResult {
  holding_id: string;
  items: HoldingExposureItem[];
}

export interface PortfolioBackupTransaction {
  type: TransactionItem['type'];
  trade_date?: string | null;
  quantity: number;
  unit_price: number;
  fee: number;
  currency: string;
  exchange_rate_to_cny: number;
  operation_id?: string | null;
  related_holding_id?: string | null;
  realized_gain_native?: number;
  realized_gain_cny?: number;
  note?: string | null;
  flow_class?: FlowClass;
}

export interface PortfolioBackupHolding {
  backup_id?: string | null;
  type: AssetType | string;
  name: string;
  group?: string | null;
  market?: string | null;
  symbol?: string | null;
  instrument_name?: string | null;
  quote_source?: string | null;
  currency: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  exchange_rate_to_cny: number;
  price_updated_at?: string | null;
  archived_at?: string | null;
  source_backup_id?: string | null;
  exposures?: Array<{ profile_code: string; weight_pct: number }>;
  transactions: PortfolioBackupTransaction[];
}

export interface PortfolioBackupFile {
  schema_version: 'portfolio_backup_v1' | 'portfolio_backup_v2' | string;
  exported_at?: string;
  base_currency?: string;
  backup_key?: string;
  skip_duplicates?: boolean;
  holdings: PortfolioBackupHolding[];
}

export interface PortfolioImportResult {
  imported: number;
  skipped: number;
  batch_id?: string | null;
}

export interface PortfolioImportPreview {
  total: number;
  new_count: number;
  duplicate_count: number;
  duplicates: Array<{ backup_id?: string | null; name: string; symbol?: string | null; group?: string | null }>;
}

export interface MarketInstrument {
  symbol: string;
  name: string;
  market: 'CN' | 'US' | string;
  kind: 'fund' | 'stock' | string;
  currency: string;
  price?: number | null;
  price_updated_at?: string | null;
  quote_source?: string | null;
}

export interface MarketQuote extends MarketInstrument {
  price: number;
  exchange_rate_to_cny: number;
  price_updated_at: string;
  quote_source: string;
}

export interface StrategyAdviceRequest {
  selected_strategy: Record<string, unknown>;
  allocation_rows: Array<Record<string, unknown>>;
  custom_context?: string | null;
  chat_history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface StrategyAdviceResponse {
  advice_markdown: string;
  risk_flags: string[];
  rebalance_notes: string[];
}

export interface ExtractedHolding {
  type: AssetType | string;
  market?: string | null;
  symbol?: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  current_price?: number | null;
  currency: string;
  exchange_rate_to_cny: number;
  group?: string | null;
  note?: string | null;
  confidence?: number | null;
}

export interface HoldingsImageExtractResponse {
  holdings: ExtractedHolding[];
}

export interface ImportExtractedHoldingsResult {
  imported: number;
  holdings: AssetItem[];
}

export interface ResearchEvent {
  id: string;
  event_key: string;
  event_type: 'macro' | 'earnings' | 'filing' | string;
  title: string;
  description?: string | null;
  country?: string | null;
  ticker?: string | null;
  company_name?: string | null;
  indicator_code?: string | null;
  reference_period?: string | null;
  scheduled_at?: string | null;
  time_precision: 'exact' | 'window' | 'date' | string;
  status: string;
  importance: number;
  source: string;
  source_url?: string | null;
  actual?: string | null;
  consensus?: string | null;
  previous?: string | null;
  unit?: string | null;
  published_at?: string | null;
  updated_at: string;
}

export interface ResearchNewsItem {
  id: string;
  news_key: string;
  title: string;
  summary?: string | null;
  source: string;
  source_domain?: string | null;
  source_url: string;
  published_at: string;
  ticker?: string | null;
  topic: 'macro' | 'company' | 'market' | string;
  language: string;
  image_url?: string | null;
}

export interface ResearchFolder {
  id: string;
  parent_id?: string | null;
  name: string;
  kind: 'briefs' | 'macro' | 'industry' | 'company' | 'quant' | 'inbox' | 'news' | 'custom' | string;
  description?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchDocument {
  id: string;
  folder_id?: string | null;
  document_type: string;
  title: string;
  summary?: string | null;
  content_markdown: string;
  tags: string[];
  source_url?: string | null;
  as_of_date?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ResearchImportPreview {
  attachment_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  extraction_method: string;
  extracted_text: string;
  extracted_chars: number;
  suggested_title: string;
  suggested_summary?: string | null;
  suggested_tags: string[];
  suggested_document_type: string;
  warnings: string[];
  duplicate_document_id?: string | null;
  duplicate_filename?: string | null;
}

export interface ResearchImportOrganizeInput {
  folder_id: string;
  document_type?: string | null;
}

export interface ResearchImportDraft {
  attachment_id: string;
  title: string;
  summary?: string | null;
  tags: string[];
  document_type: string;
  content_markdown: string;
  ai_used: boolean;
  warnings: string[];
}

export interface ResearchImportConfirmInput {
  folder_id: string;
  document_type: string;
  title: string;
  summary?: string | null;
  content_markdown: string;
  tags: string[];
  as_of_date?: string | null;
}

export interface WatchlistItem {
  id: string;
  symbol: string;
  name: string;
  market: string;
  cik?: string | null;
  industry?: string | null;
  ir_url?: string | null;
  stance: string;
  thesis?: string | null;
  fair_value_low?: number | null;
  fair_value_high?: number | null;
  currency: string;
  catalysts?: string | null;
  risks?: string | null;
  invalidation?: string | null;
  next_review_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionQueueItem {
  id: string;
  kind: string;
  priority: 1 | 2 | 3;
  title: string;
  description?: string | null;
  due_at?: string | null;
  symbol?: string | null;
  target_view: 'research' | 'industry' | 'macro' | 'quant' | string;
  source_url?: string | null;
}

export interface CompanyCoverageItem {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  industry?: string | null;
  stance: string;
  thesis?: string | null;
  next_review_at?: string | null;
  in_portfolio: boolean;
  holding_value_cny: number;
  portfolio_weight_pct: number;
  watchlist_id?: string | null;
}

export interface CompanyFundamentals {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  exchange?: string | null;
  instrument_type?: string | null;
  sector?: string | null;
  industry?: string | null;
  current_price?: number | null;
  market_cap?: number | null;
  trailing_pe?: number | null;
  forward_pe?: number | null;
  price_to_sales?: number | null;
  price_to_book?: number | null;
  revenue_growth_pct?: number | null;
  earnings_growth_pct?: number | null;
  gross_margin_pct?: number | null;
  operating_margin_pct?: number | null;
  profit_margin_pct?: number | null;
  return_on_equity_pct?: number | null;
  debt_to_equity?: number | null;
  free_cash_flow?: number | null;
  dividend_yield_pct?: number | null;
  beta?: number | null;
  fifty_two_week_low?: number | null;
  fifty_two_week_high?: number | null;
  target_mean_price?: number | null;
  analyst_count?: number | null;
  as_of: string;
  source: string;
}

export interface CompanyDossier {
  folder: ResearchFolder;
  document: ResearchDocument;
}

export interface QuantExperiment {
  id: string;
  name: string;
  status: 'idea' | 'testing' | 'validated' | 'retired' | string;
  hypothesis: string;
  universe: string[];
  benchmark?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  rebalance?: string | null;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown>;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type QuantExperimentInput = Omit<QuantExperiment, 'id' | 'created_at' | 'updated_at'>;

export interface ResearchSourceState {
  source: string;
  status: string;
  last_success_at?: string | null;
  last_error?: string | null;
  item_count: number;
}

export interface ResearchDashboard {
  today: string;
  events: ResearchEvent[];
  news: ResearchNewsItem[];
  recent_documents: ResearchDocument[];
  watchlist: WatchlistItem[];
  coverage: CompanyCoverageItem[];
  decision_queue: DecisionQueueItem[];
  folders: ResearchFolder[];
  sources: ResearchSourceState[];
}

export interface ResearchGenerationRun {
  id: string;
  document_id?: string | null;
  report_kind: 'startup' | 'market_close' | 'catchup' | 'manual' | 'daily_news' | string;
  period_start: string;
  period_end: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | string;
  provider: string;
  model: string;
  attempt_count: number;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchGenerationStatus {
  active_runs?: ResearchGenerationRun[];
  latest_bedtime?: ResearchGenerationRun | null;
  automatic_enabled: boolean;
  is_target_user: boolean;
  ai_configured: boolean;
  provider: string;
  model: string;
  last_sync_at?: string | null;
  next_market_close_at: string;
  startup_generated_today: boolean;
  latest_run?: ResearchGenerationRun | null;
  latest_success?: ResearchGenerationRun | null;
  latest_daily_news?: ResearchGenerationRun | null;
  latest_daily_review?: ResearchGenerationRun | null;
}

export interface ResearchGenerationRequest {
  kind?: 'startup' | 'market_close' | 'catchup' | 'manual' | 'daily_news' | 'bedtime';
  period_start?: string;
  period_end?: string;
  force?: boolean;
}

export interface ResearchFolderInput {
  name: string;
  parent_id?: string | null;
  kind?: string;
  description?: string | null;
  sort_order?: number;
}

export interface ResearchDocumentInput {
  folder_id?: string | null;
  document_type?: string;
  title: string;
  summary?: string | null;
  content_markdown?: string;
  tags?: string[];
  source_url?: string | null;
  as_of_date?: string | null;
  status?: string;
}

export interface ResearchBriefInput {
  title: string;
  as_of_date: string;
  summary?: string | null;
  content_markdown: string;
  tags?: string[];
  source_url?: string | null;
}

export interface MarketScore {
  symbol: string;
  label: string;
  score: number;
  valuation_score: number;
  trend_score: number;
  macro_score: number;
  volatility_score: number;
  as_of_date: string;
  data: {
    price?: number | null;
    ma50?: number | null;
    ma200?: number | null;
    return_6m_pct?: number | null;
    pe?: number | null;
    real_yield_10y?: number | null;
    yield_curve_10y_2y?: number | null;
    vix?: number | null;
    stale?: boolean;
    methodology?: Record<string, number>;
  };
}

export interface SocialMention {
  rank: number;
  ticker: string;
  name: string;
  mentions: number;
  upvotes: number;
  rank_24h_ago?: number | null;
  mentions_24h_ago?: number | null;
}

export interface MarketPoint {
  date: string;
  value: number;
}

export interface MacroIndicator {
  key: string;
  label: string;
  value?: number | null;
  unit: string;
  change?: number | null;
  change_unit: 'bp' | '%' | string;
  as_of?: string | null;
  source: string;
  source_url: string;
  status: 'fresh' | 'delayed' | 'unavailable' | string;
  history: MarketPoint[];
  note?: string | null;
}

export interface MacroGroup {
  key: 'us' | 'japan' | 'china' | string;
  label: string;
  description: string;
  items: MacroIndicator[];
}

export interface PortfolioMacroLink {
  key: string;
  label: string;
  reason: string;
  value_cny: number;
  weight_pct: number;
  holdings: Array<{
    name: string;
    symbol?: string | null;
    value_cny: number;
  }>;
}

export interface MacroTape {
  generated_at: string;
  groups: MacroGroup[];
  commodities: MacroIndicator[];
  portfolio_links: PortfolioMacroLink[];
}

export interface AISettingsView {
  provider: string;
  base_url: string;
  model: string;
  vision_model: string;
  configured: boolean;
  masked_api_key: string | null;
  updated_at: string | null;
}

export interface AISettingsInput {
  provider: string;
  base_url: string;
  api_key?: string | null;
  model: string;
  vision_model?: string | null;
}
