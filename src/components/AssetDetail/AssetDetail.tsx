import { Suspense, lazy, useState } from 'react';
import { ArrowLeft, Edit2, Loader2, Save, X } from 'lucide-react';
import { AssetItem } from '@/types';
import { useAssetStore } from '@/store/useAssetStore';
import { AssetInfo } from './AssetInfo';
import { TransactionForm } from './TransactionForm';
import { CashTransferForm } from './CashTransferForm';
import { ExposureEditor } from './ExposureEditor';
import { AssetType } from '@/types';

const AssetSpecificChart = lazy(() => import('./AssetSpecificChart').then((module) => ({ default: module.AssetSpecificChart })));
const AssetSpecificHistory = lazy(() => import('./AssetSpecificHistory').then((module) => ({ default: module.AssetSpecificHistory })));

interface AssetDetailProps {
  asset: AssetItem | null;
  onBack?: () => void;
}

const ranges = [
  { value: 'week', label: '\u5468' },
  { value: 'month', label: '\u6708' },
  { value: 'year', label: '\u5e74' },
] as const;

export function AssetDetail({ asset, onBack }: AssetDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year'>('week');
  const [editForm, setEditForm] = useState({
    name: '',
    group: '',
    market: '',
    symbol: '',
    currency: 'CNY',
    exchangeRate: '1',
  });

  const { updateAsset } = useAssetStore();

  if (!asset) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <div className="text-center">
          <p className="text-lg font-medium">{'\u8bf7\u9009\u62e9\u4e00\u4e2a\u8d44\u4ea7'}</p>
          <p className="text-sm">{'\u70b9\u51fb\u5de6\u4fa7\u76ee\u5f55\u67e5\u770b\u8be6\u60c5'}</p>
        </div>
      </div>
    );
  }

  const startEdit = () => {
    setEditForm({
      name: asset.name || '',
      group: asset.group || '',
      market: asset.market || '',
      symbol: asset.symbol || '',
      currency: asset.currency || 'CNY',
      exchangeRate: String(asset.exchange_rate_to_cny || 1),
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    await updateAsset(asset.id, {
      name: editForm.name || undefined,
      group: editForm.group || undefined,
      market: editForm.market || undefined,
      symbol: editForm.symbol || undefined,
      currency: editForm.currency || undefined,
      exchange_rate_to_cny: parseFloat(editForm.exchangeRate) || 1,
    });
    setIsEditing(false);
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex shrink-0 items-center justify-between border-b border-ink-100 bg-white px-5 py-3 md:px-7">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-md p-2 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
            title={'\u8fd4\u56de\u603b\u89c8'}
          >
            <ArrowLeft size={20} />
          </button>
          <span className="text-sm font-semibold text-ink-600">{'\u8fd4\u56de\u8d44\u4ea7\u5217\u8868'}</span>
        </div>

        <button
          onClick={startEdit}
          className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700 transition-colors hover:border-brand-500 hover:text-brand-700"
        >
          <Edit2 size={16} />
          {'\u4fee\u6539\u8d44\u4ea7'}
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] space-y-4 p-4 md:p-5 lg:p-6">
          <section>
            <AssetInfo asset={asset} />
          </section>

          <ExposureEditor holdingId={asset.id} />

          <section className="rounded-lg border border-ink-100 bg-white p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-ink-900">价值走势</h3>
              <p className="text-xs text-ink-400">按周、月、年查看该资产估值变化</p>
            </div>
            <div className="flex rounded-md bg-ink-50 p-1">
              {ranges.map((range) => (
                <button
                  key={range.value}
                  onClick={() => setTimeRange(range.value)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                    timeRange === range.value
                      ? 'bg-white text-brand-700 shadow-sm'
                      : 'text-ink-400 hover:text-ink-700'
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-[300px]">
            <Suspense fallback={
              <div className="flex h-[300px] items-center justify-center">
                <Loader2 className="animate-spin text-brand-500" />
              </div>
            }>
              <AssetSpecificChart asset={asset} timeRange={timeRange} />
            </Suspense>
          </div>
        </section>

          <section>
            <TransactionForm key={`${asset.id}:${asset.currency}`} asset={asset} />
          </section>

          {asset.type === AssetType.CASH && (
            <section>
              <CashTransferForm asset={asset} />
            </section>
          )}

          <section className="rounded-lg border border-ink-100 bg-white p-5 md:p-6">
          <h3 className="mb-4 text-base font-bold text-ink-900">记录历史</h3>
          <Suspense fallback={
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-gray-400" />
            </div>
          }>
            <AssetSpecificHistory assetId={asset.id} />
          </Suspense>
        </section>
        </div>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <button
              onClick={() => setIsEditing(false)}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
            <h2 className="mb-4 text-xl font-bold">{'\u4fee\u6539\u8d44\u4ea7\u4fe1\u606f'}</h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{'\u8d44\u4ea7\u540d\u79f0'}</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{'\u5b50\u6587\u4ef6\u5939/\u5206\u7ec4'}</label>
                <input
                  type="text"
                  value={editForm.group}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, group: e.target.value }))}
                  className="w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={'\u8f93\u5165\u5206\u7ec4\u540d\u79f0'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{'\u5e02\u573a'}</label>
                  <input
                    value={editForm.market}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, market: e.target.value }))}
                    className="w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{'\u4ee3\u7801'}</label>
                  <input
                    value={editForm.symbol}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, symbol: e.target.value }))}
                    className="w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{'\u5e01\u79cd'}</label>
                  <input
                    value={editForm.currency}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                    className="w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{'\u5151\u4eba\u6c11\u5e01\u6c47\u7387'}</label>
                  <input
                    type="number"
                    value={editForm.exchangeRate}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, exchangeRate: e.target.value }))}
                    className="w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex-1 rounded-lg bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  {'\u53d6\u6d88'}
                </button>
                <button
                  onClick={handleSave}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Save size={16} /> {'\u4fdd\u5b58\u4fee\u6539'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
