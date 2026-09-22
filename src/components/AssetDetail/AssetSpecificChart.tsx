import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { useAssetStore } from '@/store/useAssetStore';
import { AssetItem, TrendPoint } from '@/types';

interface AssetSpecificChartProps {
  asset: AssetItem;
  timeRange: 'week' | 'month' | 'year';
}

interface AxisTooltipParams {
  axisValue: string;
  value: number | string;
}

export function AssetSpecificChart({ asset, timeRange }: AssetSpecificChartProps) {
  const { getHoldingTrend } = useAssetStore();
  const [points, setPoints] = useState<TrendPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    getHoldingTrend(asset.id, timeRange)
      .then((data) => {
        if (!cancelled) setPoints(data);
      })
      .catch((error) => console.error('Load holding trend failed:', error));
    return () => {
      cancelled = true;
    };
  }, [asset.id, getHoldingTrend, timeRange]);

  const chartOption = useMemo(() => {
    const dates = points.map((point) => point.date);
    const costBasisCny = Number(asset.quantity || 0) * Number(asset.avg_cost || 0) * Number(asset.exchange_rate_to_cny || 1);
    const values = points.map((point) => Number(point.value_cny || 0));

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: AxisTooltipParams[]) => {
          const total = Number(params[0].value);
          const gain = total > 0 ? total - costBasisCny : 0;
          const color = gain >= 0 ? '#ef4444' : '#16a34a';
          return [
            `<div>${params[0].axisValue}</div>`,
            `<div style="font-weight:bold">\u603b\u989d ¥${total.toLocaleString()}</div>`,
            `<div style="color:${color}">\u6d6e\u76c8/\u6d6e\u4e8f ¥${gain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>`,
          ].join('');
        },
      },
      grid: {
        left: '2%',
        right: '4%',
        bottom: '10%',
        top: '10%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLabel: {
          formatter: (value: string) => dayjs(value).format('MM-DD'),
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => `¥${Number(value).toLocaleString()}`,
        },
        splitLine: {
          lineStyle: { type: 'dashed' },
        },
      },
      series: [{
        name: '\u8d44\u4ea7\u603b\u989d',
        type: 'line',
        smooth: true,
        data: values,
        areaStyle: { opacity: 0.1 },
        itemStyle: { color: '#3b82f6' },
        lineStyle: { color: '#3b82f6' },
        showSymbol: false,
      }],
    };
  }, [asset.avg_cost, asset.exchange_rate_to_cny, asset.quantity, points]);

  return (
    <div className="h-[300px] w-full rounded-lg bg-white p-2">
      <ReactECharts option={chartOption} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
