import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  MoreVertical,
  ArchiveRestore,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useAssetStore } from '@/store/useAssetStore';
import { ASSET_CONFIG } from '@/constants/assets';
import { AssetItem, AssetType } from '@/types';
import { formatCny, formatPercent, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AssetsWorkspaceProps {
  onSelectAsset: (asset: AssetItem) => void;
  onAddAsset: () => void;
}

type TypeFilter = 'all' | AssetType;

const assetTypes = Object.values(AssetType);
const ungroupedLabel = '未分组';

function signedCny(value: number) {
  return `${value >= 0 ? '+' : ''}${formatCny(value, 0)}`;
}

function gainClass(value: number) {
  if (value > 0) return 'text-red-600';
  if (value < 0) return 'text-emerald-600';
  return 'text-ink-400';
}

export function AssetsWorkspace({ onSelectAsset, onAddAsset }: AssetsWorkspaceProps) {
  const { assets, archivedAssets, loadArchivedAssets, removeAsset, restoreAsset, refreshAssetPrice } = useAssetStore();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const totalValue = assets.reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== 'all' && asset.type !== typeFilter) return false;
      if (!normalized) return true;
      return [asset.name, asset.symbol, asset.market, asset.group, ASSET_CONFIG[asset.type].label]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [assets, query, typeFilter]);

  const sections = useMemo(() => assetTypes
    .map((type) => {
      const typeAssets = filteredAssets.filter((asset) => asset.type === type);
      const groups = new Map<string, AssetItem[]>();
      typeAssets.forEach((asset) => {
        const group = asset.group?.trim() || ungroupedLabel;
        groups.set(group, [...(groups.get(group) || []), asset]);
      });
      return {
        type,
        assets: typeAssets,
        groups: Array.from(groups.entries()).sort(([a], [b]) => {
          if (a === ungroupedLabel) return 1;
          if (b === ungroupedLabel) return -1;
          return a.localeCompare(b, 'zh-CN');
        }),
        value: typeAssets.reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0),
        gain: typeAssets.reduce(
          (sum, asset) => sum + Number(asset.unrealized_gain_cny || 0) + Number(asset.realized_gain_cny || 0),
          0,
        ),
      };
    })
    .filter((section) => section.assets.length > 0), [filteredAssets]);

  const toggleSection = (key: string) => {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleRefresh = async (event: React.MouseEvent, asset: AssetItem) => {
    event.stopPropagation();
    setRefreshingId(asset.id);
    try {
      await refreshAssetPrice(asset.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : '行情刷新失败，请稍后重试。');
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (event: React.MouseEvent, asset: AssetItem) => {
    event.stopPropagation();
    if (!confirm(`确定归档“${asset.name}”吗？流水和历史快照会保留，可随时恢复。`)) return;
    try {
      await removeAsset(asset.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : '归档资产失败。');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 p-4 md:p-5 lg:p-6">
      <section className="rounded-lg border border-ink-100 bg-white">
        <div className="flex flex-col gap-4 border-b border-ink-100 p-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div>
            <div className="text-sm font-semibold text-ink-600">全部资产</div>
            <div className="mt-1 text-2xl font-semibold text-ink-950">{formatCny(totalValue)}</div>
            <div className="mt-1 text-xs text-ink-400">{assets.length} 个持仓，按类型和账户分组展示</div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" size={17} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、代码或分组"
                className="h-10 w-full rounded-md border border-ink-200 bg-white pl-9 pr-3 text-sm text-ink-800 placeholder:text-ink-300 focus:border-brand-500"
              />
            </label>
            <button
              type="button"
              onClick={onAddAsset}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink-950 px-4 text-sm font-semibold text-white transition hover:bg-ink-800"
            >
              <Plus size={17} />
              新增资产
            </button>
          </div>
        </div>

        <div className="custom-scrollbar flex gap-1 overflow-x-auto p-2.5 md:px-4">
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={cn(
              'h-9 shrink-0 rounded-md px-4 text-xs font-semibold transition-colors',
              typeFilter === 'all' ? 'bg-ink-950 text-white' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800',
            )}
          >
            全部 {assets.length}
          </button>
          <button
            type="button"
            onClick={async () => {
              const next = !showArchived;
              setShowArchived(next);
              if (next) await loadArchivedAssets();
            }}
            className="h-9 shrink-0 rounded-md px-4 text-xs font-semibold text-ink-500 hover:bg-ink-50"
          >
            已归档 {archivedAssets.length}
          </button>
          {assetTypes.map((type) => {
            const count = assets.filter((asset) => asset.type === type).length;
            const value = assets
              .filter((asset) => asset.type === type)
              .reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
            return (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 rounded-md px-4 text-xs font-semibold transition-colors',
                  typeFilter === type ? 'bg-ink-950 text-white' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800',
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ASSET_CONFIG[type].color }} />
                {ASSET_CONFIG[type].label}
                <span className={typeFilter === type ? 'text-white/50' : 'text-ink-300'}>{count}</span>
                {value > 0 && (
                  <span className={typeFilter === type ? 'text-white/70' : 'text-ink-400'}>
                    {totalValue > 0 ? formatPercent((value / totalValue) * 100, 0) : '0%'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {showArchived && (
        <section className="rounded-lg border border-ink-100 bg-white px-5 py-4">
          <h2 className="text-sm font-bold text-ink-900">已归档资产</h2>
          <div className="mt-3 divide-y divide-ink-100">
            {archivedAssets.length === 0 ? <p className="py-3 text-xs text-ink-400">暂无归档资产</p> : archivedAssets.map((asset) => (
              <div key={asset.id} className="flex items-center justify-between py-2.5 text-sm">
                <span><strong>{asset.name}</strong><small className="ml-2 text-ink-400">{asset.symbol || asset.currency}</small></span>
                <button type="button" onClick={() => restoreAsset(asset.id)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600">
                  <ArchiveRestore size={14} /> 恢复
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {sections.length === 0 ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 bg-white px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-400">
            <Search size={20} />
          </div>
          <h2 className="mt-4 text-base font-bold text-ink-800">没有匹配的资产</h2>
          <p className="mt-1 text-sm text-ink-400">调整搜索或分类条件，或者录入第一笔持仓。</p>
        </section>
      ) : (
        sections.map((section) => {
          const sectionKey = `type:${section.type}`;
          const sectionCollapsed = collapsed[sectionKey];
          return (
            <section key={section.type} className="overflow-hidden rounded-lg border border-ink-100 bg-white">
              <button
                type="button"
                onClick={() => toggleSection(sectionKey)}
                className="flex w-full items-center gap-3 border-b border-ink-100 px-5 py-3.5 text-left hover:bg-ink-50/70 md:px-6"
              >
                {sectionCollapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ASSET_CONFIG[section.type].color }} />
                <span className="text-sm font-bold text-ink-900">{ASSET_CONFIG[section.type].label}</span>
                <span className="text-xs text-ink-400">{section.assets.length} 项</span>
                <span className="ml-auto flex min-w-[190px] items-baseline justify-end gap-4 text-right">
                  <span className="text-sm font-bold text-ink-900">{formatCny(section.value, 0)}</span>
                  <span className={`text-xs font-semibold ${gainClass(section.gain)}`}>
                    {signedCny(section.gain)}
                  </span>
                </span>
                <span className="w-14 text-right text-xs text-ink-400">
                  {totalValue > 0 ? formatPercent((section.value / totalValue) * 100, 1) : '0%'}
                </span>
              </button>

              {!sectionCollapsed && (
                <div>
                  {section.groups.map(([groupName, groupAssets]) => {
                    const groupKey = `${sectionKey}:group:${groupName}`;
                    const groupCollapsed = collapsed[groupKey];
                    const groupTotal = groupAssets.reduce(
                      (sum, asset) => sum + Number(asset.current_value_cny || 0),
                      0,
                    );
                    const groupGain = groupAssets.reduce(
                      (sum, asset) => sum
                        + Number(asset.unrealized_gain_cny || 0)
                        + Number(asset.realized_gain_cny || 0),
                      0,
                    );
                    return (
                      <div key={groupName} className="border-b border-ink-100 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => toggleSection(groupKey)}
                          className="flex w-full items-center gap-2 bg-ink-50/60 px-5 py-2.5 text-left text-xs md:px-8"
                        >
                          {groupCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          <span className="font-semibold text-ink-600">{groupName}</span>
                          <span className="text-ink-400">{groupAssets.length}</span>
                          <span className="ml-auto flex min-w-[170px] items-baseline justify-end gap-3 text-right">
                            <span className="font-semibold text-ink-600">{formatCny(groupTotal, 0)}</span>
                            <span className={`font-semibold ${gainClass(groupGain)}`}>
                              {signedCny(groupGain)}
                            </span>
                          </span>
                        </button>

                        {!groupCollapsed && (
                          <div className="custom-scrollbar overflow-x-auto">
                            <table className="w-full min-w-[720px] table-fixed text-sm">
                              <thead className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                                <tr>
                                  <th className="w-[48%] px-8 py-3 font-semibold">Asset</th>
                                  <th className="w-[22%] px-4 py-3 text-right font-semibold">Cost / Gain</th>
                                  <th className="w-[22%] px-4 py-3 text-right font-semibold">Value</th>
                                  <th className="w-[8%] px-4 py-3 font-semibold" />
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-ink-100">
                                {groupAssets
                                  .sort((a, b) => Number(b.current_value_cny) - Number(a.current_value_cny))
                                  .map((asset) => {
                                    const costCny = Number(asset.quantity || 0)
                                      * Number(asset.avg_cost || 0)
                                      * Number(asset.exchange_rate_to_cny || 1);
                                    const gainCny = Number(asset.unrealized_gain_cny || 0)
                                      + Number(asset.realized_gain_cny || 0);
                                    const gainPct = Number(asset.unrealized_gain_pct || 0);
                                    const hasRealizedGain = Math.abs(Number(asset.realized_gain_cny || 0)) > 0.005;
                                    const valuePct = totalValue > 0
                                      ? (Number(asset.current_value_cny) / totalValue) * 100
                                      : 0;
                                    const identity = [
                                      asset.symbol || '手动记录',
                                      asset.type === AssetType.CASH
                                        ? `${asset.currency} ${formatQuantity(asset.quantity)}`
                                        : `${formatQuantity(asset.quantity)} 份`,
                                    ].filter(Boolean).join(' · ');

                                    return (
                                      <tr
                                        key={asset.id}
                                        tabIndex={0}
                                        onClick={() => onSelectAsset(asset)}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter' || event.key === ' ') onSelectAsset(asset);
                                        }}
                                        className="group cursor-pointer bg-white transition-colors hover:bg-brand-50/45 focus:bg-brand-50/45"
                                      >
                                        <td className="px-8 py-3.5">
                                          <div className="truncate font-semibold text-ink-950">{asset.name}</div>
                                          <div className="mt-1 truncate text-xs text-ink-400">{identity}</div>
                                        </td>
                                        <td className="px-4 py-3.5 text-right">
                                          <div className="text-sm text-ink-500">
                                            <span className="text-ink-400">In</span>{' '}
                                            <span className="font-semibold text-ink-800">{formatCny(costCny, 0)}</span>
                                          </div>
                                          <div className={`mt-1 text-xs font-semibold ${gainClass(gainCny)}`}>
                                            {signedCny(gainCny)} · {hasRealizedGain ? '含已实现' : formatPercent(gainPct, 1)}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3.5 text-right">
                                          <div className="font-bold text-ink-950">{formatCny(asset.current_value_cny, 0)}</div>
                                          <div className="mt-1 text-xs text-ink-400">{formatPercent(valuePct, 1)}</div>
                                        </td>
                                        <td className="px-4 py-3.5">
                                          <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                                            <button
                                              type="button"
                                              title="刷新行情"
                                              disabled={!asset.symbol || !asset.market || refreshingId === asset.id}
                                              onClick={(event) => handleRefresh(event, asset)}
                                              className="rounded p-1.5 text-ink-400 hover:bg-white hover:text-brand-600 disabled:opacity-30"
                                            >
                                              <RefreshCw
                                                size={15}
                                                className={refreshingId === asset.id ? 'animate-spin' : ''}
                                              />
                                            </button>
                                            <button
                                              type="button"
                                              title="归档资产"
                                              onClick={(event) => handleDelete(event, asset)}
                                              className="rounded p-1.5 text-ink-400 hover:bg-white hover:text-red-600"
                                            >
                                              <Trash2 size={15} />
                                            </button>
                                            <MoreVertical size={15} className="mt-1.5 text-ink-300" />
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
