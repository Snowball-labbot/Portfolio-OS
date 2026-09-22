import { create } from 'zustand';
import { api, getErrorMessage } from '@/lib/api';
import {
  AssetItem,
  AssetType,
  CashTransferInput,
  HoldingCreateInput,
  HoldingUpdateInput,
  PortfolioImportResult,
  Summary,
  TransactionCreateInput,
  TransactionItem,
  TrendPoint,
} from '@/types';

interface AssetState {
  assets: AssetItem[];
  archivedAssets: AssetItem[];
  transactionsByAsset: Record<string, TransactionItem[]>;
  summary: Summary | null;
  loading: boolean;
  error: string | null;
  loadAssets: () => Promise<void>;
  loadArchivedAssets: () => Promise<void>;
  loadSummary: () => Promise<void>;
  addAsset: (asset: HoldingCreateInput) => Promise<void>;
  updateAsset: (id: string, changes: HoldingUpdateInput) => Promise<void>;
  removeAsset: (id: string) => Promise<void>;
  restoreAsset: (id: string) => Promise<void>;
  removeGroup: (type: AssetType, groupName: string) => Promise<void>;
  loadTransactions: (holdingId: string) => Promise<void>;
  addTransaction: (holdingId: string, transaction: TransactionCreateInput) => Promise<void>;
  transferCash: (transfer: CashTransferInput) => Promise<void>;
  refreshAssetPrice: (holdingId: string) => Promise<void>;
  getTrend: (range: 'week' | 'month' | 'year') => Promise<TrendPoint[]>;
  getHoldingTrend: (holdingId: string, range: 'week' | 'month' | 'year') => Promise<TrendPoint[]>;
  exportCurrentAssets: () => Promise<void>;
  importAssetBackup: (file: File) => Promise<PortfolioImportResult>;
  removeHistory: (historyId: string) => void;
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: [],
  archivedAssets: [],
  transactionsByAsset: {},
  summary: null,
  loading: false,
  error: null,
  loadAssets: async () => {
    set({ loading: true, error: null });
    try {
      const [assets, summary] = await Promise.all([api.holdings(), api.summary()]);
      set({ assets, summary, loading: false });
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, '加载资产失败') });
      throw error;
    }
  },
  loadSummary: async () => {
    const summary = await api.summary();
    set({ summary });
  },
  loadArchivedAssets: async () => {
    const all = await api.holdings(true);
    set({ archivedAssets: all.filter((asset) => asset.archived_at) });
  },
  addAsset: async (asset) => {
    await api.createHolding(asset);
    await get().loadAssets();
  },
  updateAsset: async (id, changes) => {
    await api.updateHolding(id, changes);
    await get().loadAssets();
  },
  removeAsset: async (id) => {
    await api.deleteHolding(id);
    set((state) => {
      const nextTransactions = { ...state.transactionsByAsset };
      delete nextTransactions[id];
      return {
        assets: state.assets.filter((asset) => asset.id !== id),
        transactionsByAsset: nextTransactions,
      };
    });
    await get().loadSummary();
    await get().loadArchivedAssets();
  },
  restoreAsset: async (id) => {
    await api.restoreHolding(id);
    await Promise.all([get().loadAssets(), get().loadArchivedAssets()]);
  },
  removeGroup: async (type, groupName) => {
    const targets = get().assets.filter((asset) => asset.type === type && asset.group === groupName);
    await Promise.all(targets.map((asset) => api.deleteHolding(asset.id)));
    await get().loadAssets();
  },
  loadTransactions: async (holdingId) => {
    const transactions = await api.transactions(holdingId);
    set((state) => ({
      transactionsByAsset: {
        ...state.transactionsByAsset,
        [holdingId]: transactions,
      },
    }));
  },
  addTransaction: async (holdingId, transaction) => {
    await api.createTransaction(holdingId, transaction);
    const results = await Promise.allSettled([
      get().loadAssets(), get().loadTransactions(holdingId),
      ...(transaction.cash_holding_id ? [get().loadTransactions(transaction.cash_holding_id)] : []),
    ]);
    if (results.some((result) => result.status === 'rejected')) set({ error: '交易已保存，但页面刷新失败，请刷新查看，不要重复录入。' });
  },
  transferCash: async (transfer) => {
    await api.createCashTransfer(transfer);
    await Promise.all([
      get().loadAssets(),
      get().loadTransactions(transfer.source_holding_id),
      get().loadTransactions(transfer.destination_holding_id),
    ]);
  },
  refreshAssetPrice: async (holdingId) => {
    const refreshed = await api.refreshHoldingPrice(holdingId);
    set((state) => ({
      assets: state.assets.map((asset) => (asset.id === holdingId ? refreshed : asset)),
    }));
    await get().loadSummary();
  },
  getTrend: (range) => api.trend(range),
  getHoldingTrend: (holdingId, range) => api.holdingTrend(holdingId, range),
  exportCurrentAssets: async () => {
    const payload = await api.exportPortfolio();
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `portfolio_backup_${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
  importAssetBackup: async (file) => {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.holdings)) {
      throw new Error('Invalid portfolio backup file');
    }
    const preview = await api.previewPortfolioImport(payload);
    const confirmed = window.confirm(
      `文件共 ${preview.total} 条资产，其中 ${preview.duplicate_count} 条疑似重复，将默认跳过；预计新增 ${preview.new_count} 条。是否继续？`,
    );
    if (!confirmed) throw new Error('已取消导入');
    const result = await api.importPortfolio({ ...payload, skip_duplicates: true });
    await get().loadAssets();
    return result;
  },
  removeHistory: () => {
    // Transaction deletion is intentionally not exposed in v1 because it rewrites cost basis.
  },
}));
