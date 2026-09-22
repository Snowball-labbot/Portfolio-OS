import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { AssetItem } from '@/types';
import { ASSET_CONFIG } from '@/constants/assets';
import { formatCny, formatPercent } from '@/lib/format';

interface PortfolioSankeyProps {
  assets: AssetItem[];
}

interface SankeyTooltipParams {
  value: number | string;
  name: string;
  dataType: 'edge' | 'node';
  data: {
    source?: string;
    target?: string;
  };
}

interface SankeyLabelParams {
  name: string;
}

export function PortfolioSankey({ assets }: PortfolioSankeyProps) {
  const option = useMemo(() => {
    const nodes = new Map<string, { name: string; label: string; itemStyle: { color: string } }>();
    const links: Array<{ source: string; target: string; value: number }> = [];
    const totalValue = assets.reduce((sum, asset) => sum + Number(asset.current_value_cny || 0), 0);

    assets.forEach((asset) => {
      const value = Math.max(0, Number(asset.current_value_cny || 0));
      if (value <= 0) return;

      const assetNode = `asset:${asset.id}`;
      const typeNode = `type:${asset.type}`;
      const typeConfig = ASSET_CONFIG[asset.type];
      nodes.set(assetNode, {
        name: assetNode,
        label: asset.name,
        itemStyle: { color: `${typeConfig.color}b8` },
      });
      nodes.set(typeNode, {
        name: typeNode,
        label: typeConfig.label,
        itemStyle: { color: typeConfig.color },
      });

      if (asset.group) {
        const groupNode = `group:${asset.type}:${asset.group}`;
        nodes.set(groupNode, {
          name: groupNode,
          label: asset.group,
          itemStyle: { color: `${typeConfig.color}d9` },
        });
        links.push({ source: assetNode, target: groupNode, value });
        links.push({ source: groupNode, target: typeNode, value });
      } else {
        links.push({ source: assetNode, target: typeNode, value });
      }
    });

    nodes.set('portfolio:total', {
      name: 'portfolio:total',
      label: '总资产',
      itemStyle: { color: '#0b0f15' },
    });

    const typeTotals = new Map<string, number>();
    assets.forEach((asset) => {
      const key = `type:${asset.type}`;
      typeTotals.set(key, (typeTotals.get(key) || 0) + Math.max(0, Number(asset.current_value_cny || 0)));
    });
    typeTotals.forEach((value, key) => {
      if (value > 0) links.push({ source: key, target: 'portfolio:total', value });
    });

    const nodeData = Array.from(nodes.values());
    const labels = Object.fromEntries(nodeData.map((node) => [node.name, node.label]));

    return {
      animationDuration: 650,
      animationDurationUpdate: 320,
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: '#ffffff',
        borderColor: '#d5d9df',
        borderWidth: 1,
        padding: 12,
        textStyle: { color: '#242b35', fontSize: 12 },
        extraCssText: 'box-shadow: 0 12px 32px rgba(11,15,21,.12); border-radius: 6px;',
        formatter: (params: SankeyTooltipParams) => {
          const value = Number(params.value || 0);
          const label = params.dataType === 'edge'
            ? `${labels[params.data.source]} → ${labels[params.data.target]}`
            : labels[params.name];
          const ratio = totalValue > 0 ? (value / totalValue) * 100 : 0;
          return `<div class="chart-tooltip"><div class="chart-tooltip__title">${label}</div><div class="chart-tooltip__row"><span>金额</span><strong>${formatCny(value)}</strong></div><div class="chart-tooltip__row"><span>占总资产</span><strong>${formatPercent(ratio)}</strong></div></div>`;
        },
      },
      series: [
        {
          type: 'sankey',
          data: nodeData,
          links,
          left: 12,
          right: 28,
          top: 18,
          bottom: 16,
          nodeWidth: 8,
          nodeGap: 12,
          nodeAlign: 'justify',
          draggable: false,
          layoutIterations: 48,
          emphasis: {
            focus: 'adjacency',
            lineStyle: { opacity: 0.72 },
          },
          lineStyle: {
            color: 'source',
            opacity: 0.22,
            curveness: 0.52,
          },
          label: {
            color: '#4c5664',
            fontSize: 11,
            formatter: (params: SankeyLabelParams) => labels[params.name] || params.name,
          },
          levels: [
            { depth: 0, itemStyle: { borderWidth: 0 } },
            { depth: 1, itemStyle: { borderWidth: 0 } },
            { depth: 2, itemStyle: { borderWidth: 0 } },
            { depth: 3, itemStyle: { borderWidth: 0 } },
          ],
        },
      ],
    };
  }, [assets]);

  if (assets.length === 0) {
    return (
      <div className="flex h-[340px] items-center justify-center text-sm text-ink-400">
        添加资产后即可查看资金流向
      </div>
    );
  }

  return <ReactECharts option={option} notMerge lazyUpdate style={{ width: '100%', height: 340 }} />;
}
