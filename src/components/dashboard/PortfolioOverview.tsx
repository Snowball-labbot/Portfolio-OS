import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { ArrowUpRight, BriefcaseBusiness, CalendarDays, WalletCards } from 'lucide-react';
import { useAssetStore } from '@/store/useAssetStore';
import { api } from '@/lib/api';
import { ASSET_CONFIG } from '@/constants/assets';
import { AssetItem, AssetType, PortfolioPerformance, PortfolioPerspective } from '@/types';
import { formatCny, formatCompactCny, formatPercent } from '@/lib/format';
import { PortfolioSankey } from './PortfolioSankey';

interface PortfolioOverviewProps {
  onOpenAssets: () => void;
}

const ranges = [
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'all', label: '全部' },
] as const;

interface PieTooltipParams {
  name: string;
  value: number | string;
  percent: number;
  data: {
    assets?: AssetItem[];
    contributors?: Array<{ name: string; value_cny: number }>;
  };
}

interface AxisTooltipParams {
  axisValue: string;
  value: number | string;
}

export function PortfolioOverview({ onOpenAssets }: PortfolioOverviewProps) {
  const { assets, summary } = useAssetStore();
  const [range, setRange] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [trendMode, setTrendMode] = useState<'value' | 'profit'>('value');
  const [performance, setPerformance] = useState<PortfolioPerformance | null>(null);
  const [perspective, setPerspective] = useState<PortfolioPerspective | null>(null);
  const [allocationMode, setAllocationMode] = useState<'asset_type' | 'core' | 'region'>('asset_type');
  const [trendLoading, setTrendLoading] = useState(false);

  const totalValue = Number(summary?.total_value_cny ?? assets.reduce(
    (sum, asset) => sum + Number(asset.current_value_cny || 0),
    0,
  ));
  const totalCost = Number(summary?.total_cost_cny ?? assets.reduce(
    (sum, asset) => sum + Number(asset.quantity || 0) * Number(asset.avg_cost || 0) * Number(asset.exchange_rate_to_cny || 1),
    0,
  ));
  const totalGain = Number(summary?.total_gain_cny ?? (totalValue - totalCost));
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const totalGainClass = totalGain > 0 ? 'text-red-600' : totalGain < 0 ? 'text-emerald-600' : 'text-ink-400';
  const pricedAssets = assets.filter((asset) => asset.price_updated_at).length;
  const investableValue = assets
    .filter((asset) => asset.type !== AssetType.PROPERTY)
    .reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
  const cashValue = assets
    .filter((asset) => asset.type === AssetType.CASH)
    .reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
  const lastUpdated = assets
    .map((asset) => asset.price_updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  useEffect(() => {
    let cancelled = false;
    setTrendLoading(true);
    api.portfolioPerformance(range)
      .then((result) => {
        if (!cancelled) setPerformance(result);
      })
      .catch(() => {
        if (!cancelled) setPerformance(null);
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    api.portfolioPerspective()
      .then((result) => {
        if (!cancelled) setPerspective(result);
      })
      .catch(() => {
        if (!cancelled) setPerspective(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assets]);

  const assetTypeAllocation = useMemo(() => {
    const totals = new Map<AssetType, { value: number; assets: typeof assets }>();
    assets.forEach((asset) => {
      const current = totals.get(asset.type) || { value: 0, assets: [] };
      current.value += Number(asset.current_value_cny || 0);
      current.assets.push(asset);
      totals.set(asset.type, current);
    });
    return Array.from(totals.entries())
      .map(([type, item]) => ({
        type,
        name: ASSET_CONFIG[type].label,
        value: item.value,
        assets: item.assets,
        itemStyle: { color: ASSET_CONFIG[type].color },
      }))
      .sort((a, b) => b.value - a.value);
  }, [assets]);

  const allocation = useMemo(() => {
    if (allocationMode === 'asset_type') return assetTypeAllocation;
    const palette = ['#3559d7', '#22a079', '#d89a27', '#7a59c8', '#d06652', '#4d7f91', '#8b95a5', '#b35c8d', '#5073c7', '#5f9561', '#9a7650'];
    const rows = perspective?.views[allocationMode] || [];
    return rows.map((row, index) => ({
      name: row.name,
      value: Number(row.value_cny),
      contributors: row.contributors,
      itemStyle: { color: palette[index % palette.length] },
    }));
  }, [allocationMode, assetTypeAllocation, perspective]);

  const donutOption = useMemo(() => ({
    animationDuration: 560,
    animationDurationUpdate: 280,
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: '#fff',
      borderColor: '#d5d9df',
      borderWidth: 1,
      padding: 12,
      extraCssText: 'box-shadow: 0 12px 32px rgba(11,15,21,.12); border-radius: 6px;',
      formatter: (params: PieTooltipParams) => {
        const items = params.data.assets
          ? [...params.data.assets].map((asset) => ({ name: asset.name, value_cny: Number(asset.current_value_cny) }))
          : [...(params.data.contributors || [])];
        const topItems = items
          .sort((a, b) => Number(b.value_cny) - Number(a.value_cny))
          .slice(0, 6);
        const rows = topItems.map((item) => (
          `<div class="chart-tooltip__row"><span>${item.name}</span><strong>${formatCny(Number(item.value_cny), 0)}</strong></div>`
        )).join('');
        return `<div class="chart-tooltip"><div class="chart-tooltip__title">${params.name} · ${params.percent}%</div><div class="chart-tooltip__row"><span>合计</span><strong>${formatCny(Number(params.value))}</strong></div>${rows}</div>`;
      },
    },
    legend: {
      orient: 'vertical',
      right: 8,
      top: 'middle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 15,
      icon: 'circle',
      textStyle: { color: '#667180', fontSize: 12 },
      formatter: (name: string) => {
        const item = allocation.find((entry) => entry.name === name);
        const ratio = totalValue > 0 ? (Number(item?.value || 0) / totalValue) * 100 : 0;
        return `${name}  ${ratio.toFixed(1)}%`;
      },
    },
    series: [{
      name: '资产分布',
      type: 'pie',
      radius: ['54%', '78%'],
      center: ['34%', '50%'],
      minAngle: 2,
      padAngle: 2,
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 3 },
      label: { show: false },
      emphasis: {
        scaleSize: 7,
        itemStyle: { shadowBlur: 18, shadowColor: 'rgba(11,15,21,.12)' },
      },
      data: allocation,
    }],
  }), [allocation, totalValue]);

  const trendOption = useMemo(() => {
    const points = performance?.points || [];
    const values = points.map((point) => Number(trendMode === 'value' ? point.value_cny : point.profit_cny));
    return {
      animationDuration: 560,
      animationDurationUpdate: 260,
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#0b0f15',
        borderWidth: 0,
        padding: [10, 12],
        textStyle: { color: '#fff', fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: '#8993a1', type: 'dashed' } },
        formatter: (params: AxisTooltipParams[]) => {
          const point = params[0];
          return `${dayjs(point.axisValue).format('YYYY-MM-DD')}<br/><strong style="font-size:15px">${formatCny(Number(point.value))}</strong>`;
        },
      },
      grid: { left: 8, right: 12, top: 20, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((point) => point.date),
        axisLine: { lineStyle: { color: '#d5d9df' } },
        axisTick: { show: false },
        axisLabel: { color: '#8993a1', margin: 12, formatter: (value: string) => dayjs(value).format('MM-DD') },
      },
      yAxis: {
        type: 'value',
        min: values.length ? Math.min(...values) * 0.96 : 0,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#8993a1', formatter: (value: number) => formatCompactCny(value) },
        splitLine: { lineStyle: { color: '#e7e9ed', type: 'dashed' } },
      },
      series: [{
        type: 'line',
        data: values,
        smooth: 0.28,
        showSymbol: false,
        symbolSize: 7,
        lineStyle: { color: '#3559d7', width: 2.5 },
        itemStyle: { color: '#3559d7', borderColor: '#fff', borderWidth: 2 },
        areaStyle: { color: '#3559d7', opacity: 0.07 },
        emphasis: { focus: 'series' },
      }],
    };
  }, [performance, trendMode]);

  const slices = Object.values(AssetType)
    .map((type) => {
      const value = assets
        .filter((asset) => asset.type === type)
        .reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);
      return { type, value };
    })
    .filter((item) => item.value > 0);

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 p-4 md:p-5 lg:p-6">
      <section className="grid overflow-hidden rounded-lg border border-ink-100 bg-white lg:grid-cols-[1.15fr_0.85fr]">
        <div className="border-b border-ink-100 p-5 lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold text-ink-600">Net Worth</span>
            <WalletCards size={20} className="text-ink-300" />
          </div>
          <div className="mt-4 font-display text-[clamp(2.1rem,4vw,3.55rem)] font-semibold leading-none text-ink-950">
            {formatCompactCny(totalValue)}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-400">
            <span>{assets.length} 个持仓</span>
            <span>{pricedAssets} 个已绑定行情</span>
            <span>{lastUpdated ? `更新于 ${dayjs(lastUpdated).format('MM-DD HH:mm')}` : '等待首次行情更新'}</span>
          </div>
          <div className={`mt-3 text-sm font-semibold ${totalGainClass}`}>
            总盈亏 {totalGain >= 0 ? '+' : ''}{formatCny(totalGain, 0)}
            <span className="mx-1 text-ink-300">·</span>
            {totalGain >= 0 ? '+' : ''}{formatPercent(totalGainPct, 1)}
          </div>
        </div>

        <div className="p-5 lg:p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink-600">资产概览</span>
            <BriefcaseBusiness size={19} className="text-ink-300" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-md bg-ink-50/70 p-3">
              <div className="text-[11px] text-ink-400">可投资资产</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-ink-950">{formatCny(investableValue)}</div>
            </div>
            <div className="rounded-md bg-ink-50/70 p-3">
              <div className="text-[11px] text-ink-400">现金</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-ink-950">{formatCny(cashValue)}</div>
            </div>
            <div className="col-span-2 rounded-md bg-ink-50/70 p-3">
              <div className="text-[11px] text-ink-400">记录成本</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-ink-950">{formatCny(totalCost)}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAssets}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            管理全部资产
            <ArrowUpRight size={15} />
          </button>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-lg border border-ink-100 bg-white sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['当前市值', performance?.current_value_cny ?? totalValue],
          ['累计净投入', performance?.net_invested_cny ?? 0],
          ['基准日起盈亏', performance?.profit_cny ?? 0],
          ['实际收益 / 最大回撤', `${formatPercent(Number(performance?.return_pct || 0), 2)} / ${formatPercent(Number(performance?.max_drawdown_pct || 0), 2)}`],
        ].map(([label, value], index) => (
          <div key={String(label)} className={`px-5 py-4 ${index > 0 ? 'border-t border-ink-100 sm:border-l sm:border-t-0' : ''}`}>
            <div className="text-[11px] text-ink-400">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-ink-950">
              {typeof value === 'number' ? formatCny(Number(value), 0) : value}
            </div>
          </div>
        ))}
      </section>

      {slices.length > 0 && (
        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {slices.map(({ type, value }) => (
            <button
              key={type}
              type="button"
              onClick={onOpenAssets}
              className="min-w-0 rounded-md border border-ink-100 bg-white px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-sm"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-ink-500">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ASSET_CONFIG[type].color }} />
                {ASSET_CONFIG[type].label}
              </div>
              <div className="mt-2 text-sm font-bold text-ink-900">{formatCny(value, 0)}</div>
              <div className="mt-1 text-[11px] text-ink-400">
                {totalValue > 0 ? formatPercent((value / totalValue) * 100) : '0.00%'}
              </div>
            </button>
          ))}
        </section>
      )}

      <section className="rounded-lg border border-ink-100 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 md:px-6">
          <div>
            <h2 className="text-base font-bold text-ink-900">净资产趋势</h2>
            <p className="mt-1 text-xs text-ink-400">从首次记录日起，显示成本与市场价格共同形成的资产总额。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md bg-ink-50 p-1">
              <button type="button" onClick={() => setTrendMode('value')} className={`h-8 rounded px-3 text-xs font-semibold ${trendMode === 'value' ? 'bg-white text-ink-950 shadow-sm' : 'text-ink-400'}`}>组合市值</button>
              <button type="button" onClick={() => setTrendMode('profit')} className={`h-8 rounded px-3 text-xs font-semibold ${trendMode === 'profit' ? 'bg-white text-ink-950 shadow-sm' : 'text-ink-400'}`}>投资收益</button>
            </div>
            <div className="flex rounded-md bg-ink-50 p-1">
              {ranges.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                className={`h-8 min-w-10 rounded px-3 text-xs font-semibold transition ${
                  range === item.value ? 'bg-white text-ink-950 shadow-sm' : 'text-ink-400 hover:text-ink-700'
                }`}
              >
                {item.label}
              </button>
              ))}
            </div>
          </div>
        </div>
        <div className="relative min-h-[290px] px-3 py-4 md:px-5">
          {trendLoading && (
            <div className="absolute right-5 top-4 z-10 inline-flex items-center gap-2 text-xs text-ink-400">
              <CalendarDays size={14} className="animate-pulse" />
              加载趋势
            </div>
          )}
          {(performance?.points.length || 0) > 0 ? (
            <ReactECharts option={trendOption} notMerge lazyUpdate style={{ width: '100%', height: 310 }} />
          ) : (
            <div className="flex h-[290px] items-center justify-center text-sm text-ink-400">
              首次刷新行情后，这里会开始记录净资产曲线
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5">
        <section className="rounded-lg border border-ink-100 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 md:px-6">
            <div>
              <h2 className="text-base font-bold text-ink-900">资产配置</h2>
              <p className="mt-1 text-xs text-ink-400">在产品类型、核心暴露和地区之间切换，悬停查看金额构成。</p>
            </div>
            <div className="flex rounded-md bg-ink-50 p-1" aria-label="资产配置视图">
              {[
                { value: 'asset_type', label: '资产类型' },
                { value: 'core', label: '核心暴露' },
                { value: 'region', label: '地区' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setAllocationMode(item.value as typeof allocationMode)}
                  className={`h-8 rounded px-3 text-xs font-semibold transition ${allocationMode === item.value ? 'bg-white text-ink-950 shadow-sm' : 'text-ink-400 hover:text-ink-700'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {allocation.length > 0 ? (
            <ReactECharts option={donutOption} notMerge lazyUpdate style={{ width: '100%', height: 340 }} />
          ) : (
            <div className="flex h-[340px] items-center justify-center text-sm text-ink-400">暂无资产数据</div>
          )}
          {allocationMode !== 'asset_type' && perspective && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-5 py-3 text-[11px] text-ink-400 md:px-6">
              <span>未分类 {Number(perspective.unclassified_pct || 0).toFixed(1)}%</span>
              <span>{perspective.source} · 数据日期 {perspective.as_of_date}</span>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-ink-100 bg-white">
          <div className="border-b border-ink-100 px-5 py-4 md:px-6">
            <h2 className="text-base font-bold text-ink-900">资产流向</h2>
            <p className="mt-1 text-xs text-ink-400">持仓经过账户分组与资产类型汇总到总资产</p>
          </div>
          <PortfolioSankey assets={assets} />
        </section>
      </div>
    </div>
  );
}
