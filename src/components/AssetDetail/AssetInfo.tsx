import { useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { RefreshCw } from 'lucide-react';
import { AssetItem } from '@/types';
import { ASSET_CONFIG } from '@/constants/assets';
import { useAssetStore } from '@/store/useAssetStore';
import { formatCny, formatPercent, formatQuantity } from '@/lib/format';

interface AssetInfoProps {
  asset: AssetItem;
}

function currencySymbol(currency: string) {
  if (currency === 'USD') return '$';
  if (currency === 'CNY') return '¥';
  if (currency === 'KRW') return '₩';
  return `${currency} `;
}

export function AssetInfo({ asset }: AssetInfoProps) {
  const config = ASSET_CONFIG[asset.type];
  const { refreshAssetPrice } = useAssetStore();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const gainCny = Number(asset.unrealized_gain_cny || 0);
  const gainNative = Number(asset.unrealized_gain_native || 0);
  const gainPct = Number(asset.unrealized_gain_pct || 0);
  const nativeCost = Number(asset.quantity || 0) * Number(asset.avg_cost || 0);
  const nativeGainPct = nativeCost > 0 ? (gainNative / nativeCost) * 100 : 0;
  const realizedGainCny = Number(asset.realized_gain_cny || 0);
  const realizedGainNative = Number(asset.realized_gain_native || 0);
  const gainClass = gainCny > 0 ? 'text-red-600' : gainCny < 0 ? 'text-emerald-600' : 'text-ink-500';
  const nativeSymbol = currencySymbol(asset.currency);

  const runRefresh = useCallback(async (silent = false) => {
    if (!asset.symbol || !asset.market) return;
    if (refreshInFlight.current) {
      if (!silent) setRefreshing(true);
      try {
        await refreshInFlight.current;
      } catch (error) {
        if (!silent) {
          setRefreshError(error instanceof Error ? error.message : '刷新行情失败，可以稍后重试。');
        }
      } finally {
        if (!silent) setRefreshing(false);
      }
      return;
    }

    if (!silent) {
      setRefreshing(true);
      setRefreshError('');
    }
    const task = refreshAssetPrice(asset.id);
    refreshInFlight.current = task;
    try {
      await task;
    } catch (error) {
      if (!silent) {
        setRefreshError(error instanceof Error ? error.message : '刷新行情失败，可以稍后重试。');
      }
    } finally {
      refreshInFlight.current = null;
      if (!silent) setRefreshing(false);
    }
  }, [asset.id, asset.market, asset.symbol, refreshAssetPrice]);

  const handleRefresh = () => runRefresh(false);

  useEffect(() => {
    const market = asset.market?.toUpperCase();
    const supportsFrequentRefresh = ['US', 'KR', 'LSE', 'UK', 'LON'].includes(market || '');
    if (!asset.symbol || !market || !supportsFrequentRefresh) return undefined;

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void runRefresh(true);
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [asset.market, asset.symbol, runRefresh]);

  const facts = asset.type === 'cash'
    ? [
      { label: '现金余额', value: `${nativeSymbol}${formatQuantity(asset.quantity)}`, helper: asset.currency },
      { label: '兑人民币汇率', value: formatQuantity(asset.exchange_rate_to_cny), helper: `${asset.currency}/CNY` },
      { label: '折合人民币', value: formatCny(asset.current_value_cny), helper: '计入总资产' },
    ]
    : [
      { label: '持有份额', value: formatQuantity(asset.quantity), helper: asset.currency },
      { label: '平均成本', value: `${nativeSymbol}${formatQuantity(asset.avg_cost)}`, helper: '买入单位成本' },
      {
        label: '最新价格',
        value: `${nativeSymbol}${formatQuantity(asset.current_price)}`,
        helper: asset.quote_source || '手动估值',
      },
      { label: '汇率', value: formatQuantity(asset.exchange_rate_to_cny), helper: `${asset.currency}/CNY` },
      {
        label: asset.currency === 'CNY' ? '浮盈/浮亏' : '人民币总盈亏',
        value: `${gainCny >= 0 ? '+' : ''}${formatCny(gainCny, 0)}`,
        helper: asset.currency === 'CNY'
          ? `${formatPercent(gainPct)}`
          : `含汇率 · ${formatPercent(gainPct)}`,
        className: gainClass,
      },
      ...(asset.currency === 'CNY' ? [] : [{
        label: '原币价格盈亏',
        value: `${gainNative >= 0 ? '+' : ''}${nativeSymbol}${formatQuantity(gainNative)}`,
        helper: `不含汇率 · ${formatPercent(nativeGainPct)}`,
        className: gainNative > 0 ? 'text-red-600' : gainNative < 0 ? 'text-emerald-600' : 'text-ink-500',
      }]),
      {
      label: '已实现/现金收益',
      value: `${realizedGainCny >= 0 ? '+' : ''}${formatCny(realizedGainCny, 0)}`,
      helper: `${nativeSymbol}${formatQuantity(realizedGainNative)}`,
      className: realizedGainCny > 0
        ? 'text-red-600'
        : realizedGainCny < 0
          ? 'text-emerald-600'
          : 'text-ink-500',
      },
    ];

  return (
    <div className="overflow-hidden rounded-lg border border-ink-100 bg-white">
      <div className="flex flex-col gap-6 p-5 md:flex-row md:items-start md:justify-between md:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded px-2 py-1 text-[11px] font-semibold"
              style={{ backgroundColor: `${config.color}14`, color: config.color }}
            >
              {config.label}
            </span>
            {asset.symbol && (
              <span className="rounded bg-ink-50 px-2 py-1 text-[11px] font-semibold text-ink-500">
                {asset.market || '-'} · {asset.symbol}
              </span>
            )}
            {asset.group && <span className="text-xs text-ink-400">{asset.group}</span>}
          </div>
          <h2 className="mt-3 truncate text-2xl font-bold text-ink-950 md:text-3xl">{asset.name}</h2>
          <p className="mt-2 text-xs text-ink-400">
            价格更新于 {asset.price_updated_at ? dayjs(asset.price_updated_at).format('YYYY-MM-DD HH:mm') : '暂无记录'}
          </p>
        </div>

        <div className="shrink-0 md:text-right">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Current Value</div>
          <div className="mt-2 text-3xl font-semibold text-ink-950">{formatCny(asset.current_value_cny)}</div>
          <div className="mt-1 text-xs text-ink-400">
            {asset.currency} {formatQuantity(asset.current_value)}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || !asset.symbol || !asset.market}
            className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-600 hover:border-brand-500 hover:text-brand-700 disabled:opacity-40"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            刷新行情
          </button>
        </div>
      </div>

      <div className={`grid border-t border-ink-100 sm:grid-cols-2 ${asset.type === 'cash' ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        {facts.map((item) => (
          <div
            key={item.label}
            className="min-w-0 border-b border-ink-100 p-5 sm:border-r lg:border-b-0 last:border-r-0"
          >
            <div className="text-xs text-ink-400">{item.label}</div>
            <div className={`mt-2 truncate text-lg font-bold ${item.className || 'text-ink-900'}`}>{item.value}</div>
            <div className="mt-1 truncate text-[11px] text-ink-400">{item.helper}</div>
          </div>
        ))}
      </div>

      {asset.type !== 'cash' && asset.currency !== 'CNY' && (
        <p className="border-t border-ink-100 bg-ink-50/60 px-5 py-3 text-xs text-ink-400">
          原币价格盈亏只反映证券价格；人民币总盈亏使用每笔交易历史汇率计算成本，并按当前汇率估值。
        </p>
      )}

      {refreshError && <p className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-600">{refreshError}</p>}
    </div>
  );
}
