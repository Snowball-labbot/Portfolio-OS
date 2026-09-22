import type {
  AssetItem,
  CashTransferInput,
  CashTransferItem,
  CompanyCoverageItem,
  CompanyDossier,
  CompanyFundamentals,
  ExtractedHolding,
  FxRate,
  HoldingCreateInput,
  HoldingUpdateInput,
  HoldingsImageExtractResponse,
  ImportExtractedHoldingsResult,
  MarketInstrument,
  MarketQuote,
  PortfolioBackupFile,
  PortfolioImportResult,
  PortfolioImportPreview,
  PortfolioPerformance,
  PortfolioPerspective,
  ExposureProfile,
  HoldingExposureResult,
  QuantExperiment,
  QuantExperimentInput,
  Summary,
  StrategyAdviceRequest,
  StrategyAdviceResponse,
  TransactionCreateInput,
  TransactionItem,
  TrendPoint,
  User,
  MarketScore,
  MacroTape,
  ResearchBriefInput,
  ResearchDashboard,
  ResearchDocument,
  ResearchDocumentInput,
  ResearchEvent,
  ResearchNewsItem,
  ResearchFolder,
  ResearchFolderInput,
  ResearchGenerationRequest,
  ResearchGenerationRun,
  ResearchGenerationStatus,
  ResearchImportConfirmInput,
  ResearchImportDraft,
  ResearchImportOrganizeInput,
  ResearchImportPreview,
  SocialMention,
  WatchlistItem,
  AISettingsInput,
  AISettingsView,
} from '@/types';

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

interface ErrorPayload {
  detail?: unknown;
  message?: unknown;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = (await response.json()) as ErrorPayload;
      const payloadMessage = payload.detail ?? payload.message;
      message = typeof payloadMessage === 'string' ? payloadMessage : message;
    } catch {
      // Keep status text when the response body is not JSON.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

async function multipartRequest<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  form.append('file', file, file.name);
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = (await response.json()) as ErrorPayload;
      const payloadMessage = payload.detail ?? payload.message;
      message = typeof payloadMessage === 'string' ? payloadMessage : message;
    } catch {
      // Keep status text when the response body is not JSON.
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  authConfig: () => request<{ allow_open_registration: boolean }>('/api/auth/config'),
  me: () => request<User>('/api/auth/me'),
  login: (email: string, password: string) => request<User>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  }),
  register: (email: string, password: string, inviteCode?: string) => request<User>('/api/auth/register', {
    method: 'POST',
    body: { email, password, invite_code: inviteCode || null },
  }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  aiSettings: () => request<AISettingsView>('/api/settings/ai'),
  saveAiSettings: (payload: AISettingsInput) => request<AISettingsView>('/api/settings/ai', {
    method: 'PUT', body: payload,
  }),
  testAiSettings: (payload: AISettingsInput) => request<{ ok: boolean; message: string }>('/api/settings/ai/test', {
    method: 'POST', body: payload,
  }),
  clearAiSettings: () => request<{ ok: boolean }>('/api/settings/ai', { method: 'DELETE' }),
  holdings: (includeArchived = false) => request<AssetItem[]>(`/api/holdings?include_archived=${includeArchived}`),
  createHolding: (payload: HoldingCreateInput) => request<AssetItem>('/api/holdings', {
    method: 'POST',
    body: payload,
  }),
  updateHolding: (id: string, payload: HoldingUpdateInput) => request<AssetItem>(`/api/holdings/${id}`, {
    method: 'PATCH',
    body: payload,
  }),
  deleteHolding: (id: string) => request<{ ok: boolean }>(`/api/holdings/${id}`, { method: 'DELETE' }),
  restoreHolding: (id: string) => request<AssetItem>(`/api/holdings/${id}/restore`, { method: 'POST' }),
  transactions: (holdingId: string) => request<TransactionItem[]>(`/api/holdings/${holdingId}/transactions`),
  createTransaction: (holdingId: string, payload: TransactionCreateInput) => request<TransactionItem>(`/api/holdings/${holdingId}/transactions`, {
    method: 'POST',
    body: payload,
  }),
  cashTransfers: (holdingId?: string) => request<CashTransferItem[]>(
    `/api/transfers${holdingId ? `?holding_id=${encodeURIComponent(holdingId)}` : ''}`,
  ),
  createCashTransfer: (payload: CashTransferInput) => request<CashTransferItem>('/api/transfers', {
    method: 'POST',
    body: payload,
  }),
  fxRate: (currency: string, date?: string) => request<FxRate>(`/api/market/fx?currency=${encodeURIComponent(currency)}${date ? `&date=${encodeURIComponent(date)}` : ''}`),
  refreshHoldingPrice: (holdingId: string) => request<AssetItem>(`/api/holdings/${holdingId}/refresh-price`, {
    method: 'POST',
  }),
  searchMarket: (query: string, market: 'CN' | 'US' | 'KR') => request<MarketInstrument[]>(`/api/market/search?q=${encodeURIComponent(query)}&market=${market}`),
  quoteMarket: (market: string, symbol: string, kind: string) => request<MarketQuote>(`/api/market/quote?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}&kind=${encodeURIComponent(kind)}`),
  historicalQuote: (market: string, symbol: string, kind: string, date: string) => request<MarketQuote>(`/api/market/historical?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}&kind=${encodeURIComponent(kind)}&date=${encodeURIComponent(date)}`),
  summary: () => request<Summary>('/api/analytics/summary'),
  trend: (range: 'week' | 'month' | 'year') => request<TrendPoint[]>(`/api/analytics/trend?range=${range}`),
  holdingTrend: (holdingId: string, range: 'week' | 'month' | 'year') => request<TrendPoint[]>(`/api/holdings/${holdingId}/trend?range=${range}`),
  exportPortfolio: () => request<PortfolioBackupFile>('/api/portfolio/export'),
  importPortfolio: (payload: PortfolioBackupFile) => request<PortfolioImportResult>('/api/portfolio/import', {
    method: 'POST',
    body: payload,
  }),
  previewPortfolioImport: (payload: PortfolioBackupFile) => request<PortfolioImportPreview>('/api/portfolio/import-preview', { method: 'POST', body: payload }),
  undoPortfolioImport: (batchId: string) => request<{ ok: boolean; removed: number }>(`/api/portfolio/import-batches/${batchId}`, { method: 'DELETE' }),
  latestPortfolioImportBatch: () => request<{ id: string; imported_count: number; skipped_count: number; created_at: string } | null>('/api/portfolio/import-batches/latest'),
  portfolioPerspective: () => request<PortfolioPerspective>('/api/portfolio-insights/perspective'),
  exposureProfiles: () => request<ExposureProfile[]>('/api/portfolio-insights/profiles'),
  holdingExposures: (holdingId: string) => request<HoldingExposureResult>(`/api/portfolio-insights/holdings/${holdingId}/exposures`),
  updateHoldingExposures: (holdingId: string, items: Array<{ profile_code: string; weight_pct: number }>) => request<{ ok: boolean }>(`/api/portfolio-insights/holdings/${holdingId}/exposures`, {
    method: 'PUT',
    body: { items },
  }),
  portfolioPerformance: (range: 'week' | 'month' | 'year' | 'all') => request<PortfolioPerformance>(`/api/portfolio-insights/performance?range=${range}`),
  strategyAdvice: (payload: StrategyAdviceRequest) => request<StrategyAdviceResponse>('/api/ai/strategy-advice', {
    method: 'POST',
    body: payload,
  }),
  extractHoldingsImage: (imageDataUrl: string) => request<HoldingsImageExtractResponse>('/api/ai/extract-holdings-image', {
    method: 'POST',
    body: { image_data_url: imageDataUrl },
  }),
  importExtractedHoldings: (holdings: ExtractedHolding[]) => request<ImportExtractedHoldingsResult>('/api/ai/import-extracted-holdings', {
    method: 'POST',
    body: { holdings },
  }),
  researchDashboard: () => request<ResearchDashboard>('/api/research/dashboard'),
  researchGenerationStatus: () => request<ResearchGenerationStatus>('/api/research/generation-status'),
  generateResearchBrief: (payload: ResearchGenerationRequest = { kind: 'manual' }) => request<ResearchGenerationRun>('/api/research/generate-brief', {
    method: 'POST', body: payload,
  }),
  researchEvents: (days = 30, eventType?: string) => request<ResearchEvent[]>(
    `/api/research/events?days=${days}${eventType ? `&event_type=${encodeURIComponent(eventType)}` : ''}`,
  ),
  researchNews: (days = 7, topic?: string) => request<ResearchNewsItem[]>(
    `/api/research/news?days=${days}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`,
  ),
  refreshResearch: () => request<{ ok: boolean; message: string }>('/api/research/refresh', { method: 'POST' }),
  researchFolders: () => request<ResearchFolder[]>('/api/research/folders'),
  createResearchFolder: (payload: ResearchFolderInput) => request<ResearchFolder>('/api/research/folders', {
    method: 'POST', body: payload,
  }),
  deleteResearchFolder: (id: string) => request<{ ok: boolean }>(`/api/research/folders/${id}`, { method: 'DELETE' }),
  researchDocuments: (folderId?: string, query?: string) => request<ResearchDocument[]>(
    `/api/research/documents?${new URLSearchParams({
      ...(folderId ? { folder_id: folderId } : {}),
      ...(query ? { q: query } : {}),
    }).toString()}`,
  ),
  createResearchDocument: (payload: ResearchDocumentInput) => request<ResearchDocument>('/api/research/documents', {
    method: 'POST', body: payload,
  }),
  updateResearchDocument: (id: string, payload: Partial<ResearchDocumentInput>) => request<ResearchDocument>(`/api/research/documents/${id}`, {
    method: 'PATCH', body: payload,
  }),
  deleteResearchDocument: (id: string) => request<{ ok: boolean }>(`/api/research/documents/${id}`, { method: 'DELETE' }),
  previewResearchImport: (file: File, scope: 'macro' | 'industry' | 'quant') => multipartRequest<ResearchImportPreview>('/api/research/imports/preview', file, { scope }),
  organizeResearchImport: (id: string, payload: ResearchImportOrganizeInput) => request<ResearchImportDraft>(`/api/research/imports/${id}/organize`, {
    method: 'POST', body: payload,
  }),
  confirmResearchImport: (id: string, payload: ResearchImportConfirmInput) => request<ResearchDocument>(`/api/research/imports/${id}/confirm`, {
    method: 'POST', body: payload,
  }),
  watchlist: () => request<WatchlistItem[]>('/api/research/watchlist'),
  createWatchlistItem: (payload: Partial<WatchlistItem> & Pick<WatchlistItem, 'symbol' | 'name'>) => request<WatchlistItem>('/api/research/watchlist', {
    method: 'POST', body: payload,
  }),
  updateWatchlistItem: (id: string, payload: Partial<WatchlistItem>) => request<WatchlistItem>(`/api/research/watchlist/${id}`, {
    method: 'PATCH', body: payload,
  }),
  deleteWatchlistItem: (id: string) => request<{ ok: boolean }>(`/api/research/watchlist/${id}`, { method: 'DELETE' }),
  companyCoverage: () => request<CompanyCoverageItem[]>('/api/research/coverage'),
  companyFundamentals: (symbol: string, market = 'US') => request<CompanyFundamentals>(
    `/api/research/company/${encodeURIComponent(symbol)}/fundamentals?market=${encodeURIComponent(market)}`,
  ),
  createCompanyDossier: (market: string, symbol: string) => request<CompanyDossier>(
    `/api/research/company/${encodeURIComponent(market)}/${encodeURIComponent(symbol)}/dossier`,
    { method: 'POST' },
  ),
  quantExperiments: () => request<QuantExperiment[]>('/api/research/quant/experiments'),
  createQuantExperiment: (payload: QuantExperimentInput) => request<QuantExperiment>('/api/research/quant/experiments', {
    method: 'POST', body: payload,
  }),
  updateQuantExperiment: (id: string, payload: Partial<QuantExperimentInput>) => request<QuantExperiment>(`/api/research/quant/experiments/${id}`, {
    method: 'PATCH', body: payload,
  }),
  deleteQuantExperiment: (id: string) => request<{ ok: boolean }>(`/api/research/quant/experiments/${id}`, { method: 'DELETE' }),
  researchPacket: (date: string) => request<Record<string, unknown>>(`/api/research/codex-packet/${date}`),
  previewResearchBrief: (payload: ResearchBriefInput) => request<ResearchBriefInput & { word_count: number; warnings: string[] }>('/api/research/briefs/import-preview', {
    method: 'POST', body: payload,
  }),
  confirmResearchBrief: (payload: ResearchBriefInput) => request<ResearchDocument>('/api/research/briefs/import-confirm', {
    method: 'POST', body: payload,
  }),
  socialTopTen: (refresh = false) => request<SocialMention[]>(`/api/market-observation/social-top10?refresh=${refresh}`),
  marketScores: (refresh = false) => request<MarketScore[]>(`/api/market-observation/scores?refresh=${refresh}`),
  macroTape: (refresh = false) => request<MacroTape>(`/api/market-observation/macro-tape?refresh=${refresh}`),
  marketScoreHistory: (symbol: string, days = 365) => request<Array<Record<string, number | string>>>(
    `/api/market-observation/scores/${encodeURIComponent(symbol)}/history?days=${days}`,
  ),
};
