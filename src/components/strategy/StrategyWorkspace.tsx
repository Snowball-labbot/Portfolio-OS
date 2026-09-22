import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Plus,
  Save,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { AIStrategyAssistant } from '@/components/AIStrategyAssistant';
import { ALLOCATION_STRATEGIES, AllocationStrategy } from '@/constants/allocationStrategies';
import { ASSET_CONFIG } from '@/constants/assets';
import { useAssetStore } from '@/store/useAssetStore';
import { AssetType } from '@/types';
import { formatCny, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

const ASSET_TYPES = Object.values(AssetType);
const STORAGE_KEY = 'custom-allocation-strategies';
const PAGE_SIZE = 6;

interface BarTooltipParams {
  axisValue?: string;
  marker?: string;
  seriesName?: string;
  value: number | string;
}

function emptyWeights() {
  return ASSET_TYPES.reduce((result, type) => {
    result[type] = '';
    return result;
  }, {} as Record<AssetType, string>);
}

function loadCustomStrategies(): AllocationStrategy[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      .map((item) => ({ ...item, custom: true }));
  } catch {
    return [];
  }
}

export function StrategyWorkspace() {
  const { assets } = useAssetStore();
  const [customStrategies, setCustomStrategies] = useState<AllocationStrategy[]>(loadCustomStrategies);
  const strategies = useMemo(() => [...ALLOCATION_STRATEGIES, ...customStrategies], [customStrategies]);
  const [selectedId, setSelectedId] = useState(strategies[0]?.id || '');
  const [page, setPage] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customRisk, setCustomRisk] = useState('自定义');
  const [customDescription, setCustomDescription] = useState('');
  const [customWeights, setCustomWeights] = useState<Record<AssetType, string>>(emptyWeights);
  const [customError, setCustomError] = useState('');

  const selectedStrategy = strategies.find((strategy) => strategy.id === selectedId) || strategies[0];
  const pageCount = Math.max(1, Math.ceil(strategies.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleStrategies = strategies.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const totalValue = assets.reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
  const customTotal = ASSET_TYPES.reduce((sum, type) => sum + Number(customWeights[type] || 0), 0);

  const rows = useMemo(() => ASSET_TYPES.map((type) => {
    const currentValue = assets
      .filter((asset) => asset.type === type)
      .reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
    const currentPercent = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
    const targetPercent = selectedStrategy?.weights[type] || 0;
    const gap = currentPercent - targetPercent;
    return {
      type,
      label: ASSET_CONFIG[type].label,
      color: ASSET_CONFIG[type].color,
      currentValue,
      currentPercent,
      targetPercent,
      gap,
      status: gap > 3 ? 'over' : gap < -3 ? 'under' : 'near',
    };
  }), [assets, selectedStrategy, totalValue]);

  const chartOption = useMemo(() => ({
    animationDuration: 520,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#0b0f15',
      borderWidth: 0,
      textStyle: { color: '#fff' },
      formatter: (params: BarTooltipParams[]) => {
        const lines = params.map((item) => `${item.marker}${item.seriesName}：${formatPercent(Number(item.value), 1)}`);
        return `<strong>${params[0]?.axisValue || ''}</strong><br/>${lines.join('<br/>')}`;
      },
    },
    legend: {
      top: 0,
      right: 8,
      itemWidth: 9,
      itemHeight: 9,
      icon: 'circle',
      textStyle: { color: '#667180' },
    },
    grid: { left: 20, right: 20, top: 48, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { color: '#8993a1', formatter: '{value}%' },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#e7e9ed', type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: rows.map((row) => row.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#4c5664', fontWeight: 600 },
    },
    series: [
      {
        name: '我的占比',
        type: 'bar',
        barWidth: 10,
        data: rows.map((row) => Number(row.currentPercent.toFixed(2))),
        itemStyle: { color: '#3559d7', borderRadius: [0, 2, 2, 0] },
      },
      {
        name: '目标占比',
        type: 'bar',
        barWidth: 10,
        data: rows.map((row) => Number(row.targetPercent.toFixed(2))),
        itemStyle: { color: '#b5bcc6', borderRadius: [0, 2, 2, 0] },
      },
    ],
  }), [rows]);

  const saveCustomStrategies = (next: AllocationStrategy[]) => {
    setCustomStrategies(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const resetCustomForm = () => {
    setCustomName('');
    setCustomRisk('自定义');
    setCustomDescription('');
    setCustomWeights(emptyWeights());
    setCustomError('');
  };

  const saveCustom = () => {
    if (!customName.trim()) {
      setCustomError('请输入策略名称。');
      return;
    }
    if (Math.abs(customTotal - 100) > 0.01) {
      setCustomError('目标占比合计必须等于 100%。');
      return;
    }
    const strategy: AllocationStrategy = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      riskLevel: customRisk.trim() || '自定义',
      description: customDescription.trim() || '自定义目标资产配置。',
      weights: ASSET_TYPES.reduce((result, type) => {
        const value = Number(customWeights[type] || 0);
        if (value > 0) result[type] = value;
        return result;
      }, {} as Partial<Record<AssetType, number>>),
      custom: true,
    };
    const next = [...customStrategies, strategy];
    saveCustomStrategies(next);
    setSelectedId(strategy.id);
    setPage(Math.floor((strategies.length) / PAGE_SIZE));
    setCustomOpen(false);
    resetCustomForm();
  };

  const deleteCustom = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    const next = customStrategies.filter((strategy) => strategy.id !== id);
    saveCustomStrategies(next);
    if (selectedId === id) setSelectedId(ALLOCATION_STRATEGIES[0]?.id || '');
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 p-4 md:p-5 lg:p-6">
      <section className="flex flex-col gap-5 rounded-lg border border-ink-100 bg-white p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-brand-50 text-brand-700">
            <Target size={21} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-ink-400">Strategy Lab</div>
            <h2 className="mt-1 text-xl font-bold text-ink-950">目标配置与当前持仓对比</h2>
            <p className="mt-1 text-sm text-ink-400">
              当前 {assets.length} 个持仓，总资产 {formatCny(totalValue)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-ink-200 px-4 text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-ink-50"
          >
            <Plus size={16} />
            自定义策略
          </button>
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink-950 px-4 text-sm font-semibold text-white hover:bg-ink-800"
          >
            <Bot size={17} />
            AI 策略助手
          </button>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink-800">选择目标模型</h3>
            <p className="mt-0.5 text-xs text-ink-400">每页最多展示 6 个策略</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-400">{safePage + 1} / {pageCount}</span>
            <button
              type="button"
              aria-label="上一页"
              disabled={safePage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              className="rounded-md border border-ink-100 bg-white p-2 text-ink-500 hover:border-ink-200 disabled:opacity-35"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="下一页"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              className="rounded-md border border-ink-100 bg-white p-2 text-ink-500 hover:border-ink-200 disabled:opacity-35"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="grid auto-rows-[150px] gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visibleStrategies.map((strategy) => {
            const active = strategy.id === selectedStrategy?.id;
            const weights = Object.entries(strategy.weights)
              .filter(([, value]) => Number(value) > 0)
              .map(([type, value]) => `${ASSET_CONFIG[type as AssetType].label} ${value}%`)
              .join(' · ');
            return (
              <button
                key={strategy.id}
                type="button"
                onClick={() => setSelectedId(strategy.id)}
                className={cn(
                  'group relative flex h-full flex-col rounded-lg border bg-white p-5 text-left transition',
                  active
                    ? 'border-brand-500 ring-1 ring-brand-500'
                    : 'border-ink-100 hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-sm',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-base font-bold text-ink-950">{strategy.name}</div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded bg-ink-50 px-2 py-1 text-[11px] font-semibold text-ink-500">
                      {strategy.riskLevel}
                    </span>
                    {strategy.custom && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="删除自定义策略"
                        onClick={(event) => deleteCustom(event, strategy.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') deleteCustom(event as unknown as React.MouseEvent, strategy.id);
                        }}
                        className="rounded p-1.5 text-ink-300 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink-500">{strategy.description}</p>
                <p className="mt-auto truncate text-[11px] text-ink-400">{weights}</p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-lg border border-ink-100 bg-white">
          <div className="border-b border-ink-100 px-5 py-4 md:px-6">
            <h3 className="text-base font-bold text-ink-900">{selectedStrategy?.name}</h3>
            <p className="mt-1 text-xs text-ink-400">当前占比与目标占比</p>
          </div>
          {assets.length > 0 ? (
            <ReactECharts option={chartOption} notMerge lazyUpdate style={{ width: '100%', height: 360 }} />
          ) : (
            <div className="flex h-[360px] items-center justify-center text-sm text-ink-400">
              添加资产后即可比较配置差距
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
          <div className="border-b border-ink-100 px-5 py-4 md:px-6">
            <h3 className="text-base font-bold text-ink-900">配置差距</h3>
            <p className="mt-1 text-xs text-ink-400">偏差超过 3 个百分点时标记超配或低配</p>
          </div>
          <div className="custom-scrollbar overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-ink-50/70 text-left text-[11px] uppercase text-ink-400">
                <tr>
                  <th className="px-5 py-3 font-semibold">类型</th>
                  <th className="px-4 py-3 text-right font-semibold">当前金额</th>
                  <th className="px-4 py-3 text-right font-semibold">当前</th>
                  <th className="px-4 py-3 text-right font-semibold">目标</th>
                  <th className="px-4 py-3 text-right font-semibold">差距</th>
                  <th className="px-5 py-3 text-right font-semibold">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((row) => (
                  <tr key={row.type}>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-2 font-semibold text-ink-800">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
                        {row.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-ink-500">{formatCny(row.currentValue, 0)}</td>
                    <td className="px-4 py-4 text-right font-semibold text-ink-800">
                      {formatPercent(row.currentPercent, 1)}
                    </td>
                    <td className="px-4 py-4 text-right text-ink-500">{formatPercent(row.targetPercent, 1)}</td>
                    <td className={cn(
                      'px-4 py-4 text-right font-bold',
                      row.gap > 3 ? 'text-red-600' : row.gap < -3 ? 'text-amber-600' : 'text-emerald-600',
                    )}>
                      {row.gap > 0 ? '+' : ''}{formatPercent(row.gap, 1)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className={cn(
                        'inline-flex rounded px-2 py-1 text-[11px] font-semibold',
                        row.status === 'over' && 'bg-red-50 text-red-600',
                        row.status === 'under' && 'bg-amber-50 text-amber-700',
                        row.status === 'near' && 'bg-emerald-50 text-emerald-700',
                      )}>
                        {row.status === 'over' ? '超配' : row.status === 'under' ? '低配' : '接近'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <AIStrategyAssistant
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        selectedStrategy={selectedStrategy || {}}
        allocationRows={rows}
      />

      {customOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
          <div className="custom-scrollbar max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-ink-100 bg-white px-5 py-4 md:px-6">
              <div>
                <h3 className="text-lg font-bold text-ink-950">自定义目标策略</h3>
                <p className="mt-1 text-sm text-ink-400">设置名称与各类资产目标占比，合计必须为 100%。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomOpen(false);
                  resetCustomForm();
                }}
                className="rounded-md p-2 text-ink-400 hover:bg-ink-50"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-5 md:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-ink-700">策略名称</span>
                  <input
                    value={customName}
                    onChange={(event) => setCustomName(event.target.value)}
                    className="h-10 w-full rounded-md border border-ink-200 px-3 text-sm"
                    placeholder="例如：我的长期目标"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-ink-700">风险标签</span>
                  <input
                    value={customRisk}
                    onChange={(event) => setCustomRisk(event.target.value)}
                    className="h-10 w-full rounded-md border border-ink-200 px-3 text-sm"
                    placeholder="例如：中等"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-ink-700">说明</span>
                  <input
                    value={customDescription}
                    onChange={(event) => setCustomDescription(event.target.value)}
                    className="h-10 w-full rounded-md border border-ink-200 px-3 text-sm"
                    placeholder="这套目标策略的用途"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {ASSET_TYPES.map((type) => (
                  <label key={type} className="rounded-md border border-ink-100 bg-ink-50/70 p-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ASSET_CONFIG[type].color }} />
                      {ASSET_CONFIG[type].label}
                    </span>
                    <div className="relative mt-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={customWeights[type]}
                        onChange={(event) => setCustomWeights((current) => ({
                          ...current,
                          [type]: event.target.value,
                        }))}
                        className="h-10 w-full rounded-md border border-ink-200 bg-white px-3 pr-8 text-sm"
                        placeholder="0"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">%</span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-5">
                <div>
                  <div className={cn(
                    'text-sm font-bold',
                    Math.abs(customTotal - 100) <= 0.01 ? 'text-emerald-600' : 'text-amber-600',
                  )}>
                    当前合计：{formatPercent(customTotal, 1)}
                  </div>
                  {customError && <div className="mt-1 text-sm text-red-600">{customError}</div>}
                </div>
                <button
                  type="button"
                  onClick={saveCustom}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-ink-950 px-4 text-sm font-semibold text-white hover:bg-ink-800"
                >
                  <Save size={16} />
                  保存策略
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
