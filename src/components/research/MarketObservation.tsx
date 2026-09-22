import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ExternalLink,
  Factory,
  Info,
  Landmark,
  Link2,
  Loader2,
  MessageSquareText,
  RefreshCw,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { MacroIndicator, MacroTape, MarketScore, SocialMention, WatchlistItem } from '@/types';
import { useAssetStore } from '@/store/useAssetStore';
import { cn } from '@/lib/utils';


const componentLabels = [
  ['valuation_score', '估值'],
  ['trend_score', '趋势'],
  ['macro_score', '宏观'],
  ['volatility_score', '波动'],
] as const;

function scoreLabel(score: number) {
  if (score >= 70) return '偏积极';
  if (score >= 55) return '中性偏强';
  if (score >= 45) return '中性';
  if (score >= 30) return '中性偏弱';
  return '偏谨慎';
}

function rankDelta(item: SocialMention) {
  if (!item.rank_24h_ago) return null;
  return item.rank_24h_ago - item.rank;
}

function formatIndicatorValue(item: MacroIndicator) {
  if (item.value == null) return '—';
  const digits = item.unit === '%' ? 2 : item.unit === 'JPY' || item.unit === 'CNH' ? 3 : 2;
  const suffix = item.unit === '%' ? '%' : '';
  return `${Number(item.value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

function formatChange(item: MacroIndicator) {
  if (item.change == null) return '暂无可比值';
  const prefix = Number(item.change) > 0 ? '+' : '';
  return `${prefix}${Number(item.change).toFixed(item.change_unit === 'bp' ? 1 : 2)}${item.change_unit}`;
}

function formatCny(value: number) {
  return `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

export function MarketObservation() {
  const { assets } = useAssetStore();
  const [macro, setMacro] = useState<MacroTape | null>(null);
  const [scores, setScores] = useState<MarketScore[]>([]);
  const [social, setSocial] = useState<SocialMention[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async (refresh = false) => {
    setError('');
    try {
      const [macroResult, scoresResult, socialResult, watchlistResult] = await Promise.allSettled([
        api.macroTape(refresh),
        api.marketScores(refresh),
        api.socialTopTen(refresh),
        api.watchlist(),
      ]);
      const failures: string[] = [];
      if (macroResult.status === 'fulfilled') setMacro(macroResult.value);
      else failures.push(getErrorMessage(macroResult.reason, '宏观指标暂不可用'));
      if (scoresResult.status === 'fulfilled') setScores(scoresResult.value);
      else failures.push(getErrorMessage(scoresResult.reason, '市场评分暂不可用'));
      if (socialResult.status === 'fulfilled') setSocial(socialResult.value.slice(0, 10));
      else failures.push(getErrorMessage(socialResult.reason, 'ApeWisdom 排名暂不可用'));
      if (watchlistResult.status === 'fulfilled') setWatchlist(watchlistResult.value);
      else failures.push(getErrorMessage(watchlistResult.reason, '观察名单暂不可用'));
      setError(failures.join('；'));
    } catch (loadError) {
      setError(getErrorMessage(loadError, '市场观察数据加载失败'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const ownedSymbols = useMemo(() => new Set(assets.filter((asset) => Number(asset.quantity) > 0).map((asset) => asset.symbol?.toUpperCase()).filter(Boolean)), [assets]);
  const watchedSymbols = useMemo(() => new Set(watchlist.map((item) => item.symbol.toUpperCase())), [watchlist]);

  return (
    <div className="mx-auto w-full max-w-[1540px] space-y-4 p-4 md:p-5 lg:p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-ink-100 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink-950 text-white"><BarChart3 size={19} /></div>
          <div>
            <div className="text-xs font-semibold uppercase text-ink-400">Market Observation</div>
            <h2 className="mt-0.5 text-xl font-bold text-ink-950">全球利率、汇率与需求信号</h2>
            <p className="mt-1 text-sm text-ink-400">沿政策利率到市场定价观察，并关联当前持仓；数据日期以各来源为准。</p>
          </div>
        </div>
        <button type="button" disabled={refreshing || loading} onClick={() => { setRefreshing(true); load(true); }} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-ink-200 px-4 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50">
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> 刷新数据
        </button>
      </section>

      {error && <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <div role="status" className="flex items-center gap-2 text-sm text-ink-500"><Loader2 size={16} className="animate-spin" />正在获取宏观指标、市场评分与讨论热度</div>}

      {macro && (
        <>
          <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 md:px-6">
              <div className="flex items-center gap-2"><Landmark size={17} className="text-ink-500" /><h3 className="font-bold text-ink-900">全球利率传导</h3></div>
              <div className="text-xs text-ink-400">抓取于 {new Date(macro.generated_at).toLocaleString('zh-CN')}</div>
            </div>
            <div className="divide-y divide-ink-100">
              {macro.groups.map((group) => (
                <div key={group.key} className="grid xl:grid-cols-[190px_minmax(0,1fr)]">
                  <div className="border-b border-ink-100 bg-ink-50/60 px-5 py-4 xl:border-b-0 xl:border-r xl:px-6">
                    <div className="text-sm font-bold text-ink-900">{group.label}</div>
                    <div className="mt-1 text-xs leading-5 text-ink-400">{group.description}</div>
                  </div>
                  <div className="overflow-x-auto">
                    <div className="flex min-w-max items-stretch px-2">
                      {group.items.map((item, index) => (
                        <div key={item.key} className="flex items-center">
                          <IndicatorCell item={item} />
                          {index < group.items.length - 1 && <ArrowRight size={14} className="shrink-0 text-ink-200" />}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-ink-100 px-5 py-3 text-xs text-ink-400 md:px-6">利率变动以基点显示；汇率上升代表每 1 美元可兑换更多对应货币。橙色日期表示源数据延迟超过 7 天。</div>
          </section>

          <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
            <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4 md:px-6"><Factory size={17} className="text-ink-500" /><h3 className="font-bold text-ink-900">大宗与实际需求</h3></div>
            <div className="grid divide-y divide-ink-100 md:grid-cols-3 md:divide-x md:divide-y-0">
              {macro.commodities.map((item) => <CommodityRow key={item.key} item={item} />)}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
            <div className="border-b border-ink-100 px-5 py-4 md:px-6">
              <div className="flex items-center gap-2"><Link2 size={17} className="text-ink-500" /><h3 className="font-bold text-ink-900">与当前组合的关联</h3></div>
              <p className="mt-1 text-xs text-ink-400">只按本地持仓的市场、币种和品种建立观察关系，不接入 IBKR，也不把宏观变化直接解释为买卖信号。</p>
            </div>
            <div className="divide-y divide-ink-100">
              {macro.portfolio_links.map((link) => (
                <div key={link.key} className="grid gap-3 px-5 py-4 lg:grid-cols-[230px_170px_minmax(0,1fr)] lg:items-center md:px-6">
                  <div><div className="text-sm font-bold text-ink-900">{link.label}</div><div className="mt-1 text-xs text-ink-400">{link.reason}</div></div>
                  <div><div className="text-sm font-bold tabular-nums text-ink-900">{formatCny(link.value_cny)}</div><div className="mt-1 text-xs tabular-nums text-ink-400">组合相关度 {Number(link.weight_pct).toFixed(1)}%</div></div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
                    {link.holdings.map((holding) => <span key={`${link.key}-${holding.name}`}>{holding.symbol || holding.name} <span className="tabular-nums text-ink-400">{formatCny(holding.value_cny)}</span></span>)}
                  </div>
                </div>
              ))}
              {!macro.portfolio_links.length && <div className="px-6 py-10 text-center text-sm text-ink-400">暂无可关联的当前持仓。</div>}
            </div>
          </section>
        </>
      )}

      <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
        <div className="border-b border-ink-100 px-5 py-4 md:px-6">
          <h3 className="font-bold text-ink-900">市场环境评分</h3>
          <p className="mt-1 text-xs text-ink-400">保留原有四维评分作为辅助观察，不替代上方的宏观原始数据。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead><tr className="border-b border-ink-100 bg-ink-50 text-[11px] uppercase text-ink-400"><th className="px-6 py-3 font-semibold">资产</th><th className="px-4 py-3 text-right font-semibold">综合</th>{componentLabels.map(([, label]) => <th key={label} className="px-4 py-3 text-right font-semibold">{label}</th>)}<th className="px-6 py-3 text-right font-semibold">状态</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {scores.map((score) => (
                <tr key={score.symbol} className="hover:bg-ink-50/60">
                  <td className="px-6 py-4"><div className="flex items-center gap-3"><span className="flex h-8 min-w-14 items-center justify-center rounded bg-ink-950 px-2 text-xs font-bold text-white">{score.symbol}</span><div><div className="text-sm font-semibold text-ink-900">{score.label}</div><div className="mt-0.5 text-[11px] text-ink-400">截至 {score.as_of_date}{score.data.stale ? ' · 缓存' : ''}</div></div></div></td>
                  <td className="px-4 py-4 text-right text-xl font-bold tabular-nums text-ink-950">{Number(score.score).toFixed(0)}</td>
                  {componentLabels.map(([field]) => <td key={field} className="px-4 py-4 text-right text-sm tabular-nums text-ink-600">{Number(score[field]).toFixed(0)}</td>)}
                  <td className="px-6 py-4 text-right text-xs font-semibold text-brand-700">{scoreLabel(Number(score.score))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !scores.length && <div className="px-6 py-12 text-center text-sm text-ink-400">市场评分首次计算需要访问 Yahoo Finance 与 FRED，请稍后刷新。</div>}
      </section>

      <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
        <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div><div className="flex items-center gap-2"><MessageSquareText size={17} className="text-ink-500" /><h3 className="font-bold text-ink-900">社交讨论 Top 10</h3></div><p className="mt-1 text-xs text-ink-400">完整显示 ApeWisdom 当前前十名，不折叠、不补齐小时历史。</p></div>
          <a href="https://apewisdom.io/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900">数据来源 ApeWisdom <ExternalLink size={13} /></a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-left">
            <thead><tr className="border-b border-ink-100 bg-ink-50 text-[11px] uppercase text-ink-400"><th className="w-20 px-6 py-3 font-semibold">排名</th><th className="px-4 py-3 font-semibold">股票</th><th className="px-4 py-3 text-right font-semibold">提及次数</th><th className="px-4 py-3 text-right font-semibold">赞同数</th><th className="px-6 py-3 text-right font-semibold">24h 变化</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {social.map((item) => {
                const delta = rankDelta(item);
                const owned = ownedSymbols.has(item.ticker.toUpperCase());
                const watched = watchedSymbols.has(item.ticker.toUpperCase());
                return (
                  <tr key={item.ticker} className="hover:bg-ink-50/60">
                    <td className="px-6 py-4 text-sm font-bold tabular-nums text-ink-700">{String(item.rank).padStart(2, '0')}</td>
                    <td className="px-4 py-4"><div className="flex items-center gap-3"><span className="flex h-8 min-w-12 items-center justify-center rounded bg-ink-50 px-2 text-xs font-bold text-ink-800">{item.ticker}</span><div><div className="text-sm font-semibold text-ink-900">{item.name}</div><div className="mt-0.5 flex gap-2 text-[11px]">{owned && <span className="text-brand-700">当前持仓</span>}{watched && <span className="text-amber-700">观察名单</span>}{!owned && !watched && <span className="text-ink-400">未关注</span>}</div></div></div></td>
                    <td className="px-4 py-4 text-right text-sm font-semibold tabular-nums text-ink-800">{item.mentions.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right text-sm tabular-nums text-ink-500">{item.upvotes.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right">{delta === null || delta === 0 ? <span className="text-xs text-ink-400">—</span> : <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', delta > 0 ? 'text-red-600' : 'text-emerald-600')}>{delta > 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{Math.abs(delta)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && !social.length && <div className="px-6 py-10 text-center text-sm text-ink-400">ApeWisdom 当前排名暂不可用，请稍后刷新。</div>}
      </section>

      <section className="flex items-start gap-3 rounded-lg border border-ink-100 bg-white px-5 py-4 text-xs leading-6 text-ink-500">
        <Info size={16} className="mt-1 shrink-0 text-ink-400" />
        <p>宏观数据按各市场自己的发布频率更新，并非同一时点快照。BOJ 使用月度短期利率代理，CGB 2Y 使用中债 1 年与 3 年插值，铁矿石使用新加坡期货代理；页面明确展示日期与来源，不把代理数据描述为实时政策值。</p>
      </section>
    </div>
  );
}

function IndicatorCell({ item }: { item: MacroIndicator }) {
  const positive = Number(item.change) > 0;
  const negative = Number(item.change) < 0;
  return (
    <div className="w-[164px] shrink-0 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-600">{item.label}</span>
        <span className={cn('h-1.5 w-1.5 rounded-full', item.status === 'unavailable' ? 'bg-red-400' : item.status === 'delayed' ? 'bg-amber-400' : 'bg-emerald-500')} />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5"><span className="text-xl font-bold tabular-nums text-ink-950">{formatIndicatorValue(item)}</span>{item.unit !== '%' && <span className="text-[10px] text-ink-400">{item.unit}</span>}</div>
      <div className={cn('mt-1 text-[11px] font-medium tabular-nums', positive ? 'text-red-600' : negative ? 'text-emerald-600' : 'text-ink-400')}>{formatChange(item)}</div>
      <a href={item.source_url} target="_blank" rel="noreferrer" title={item.note || item.source} className={cn('mt-2 inline-flex max-w-full items-center gap-1 truncate text-[10px] hover:text-ink-800', item.status === 'delayed' ? 'text-amber-600' : 'text-ink-400')}>{item.source} · {item.as_of || '待更新'} <ExternalLink size={10} className="shrink-0" /></a>
    </div>
  );
}

function CommodityRow({ item }: { item: MacroIndicator }) {
  const positive = Number(item.change) > 0;
  const negative = Number(item.change) < 0;
  return (
    <div className="flex min-h-[108px] items-center justify-between gap-4 px-5 py-4 md:px-6">
      <div><div className="text-sm font-bold text-ink-900">{item.label}</div><div className="mt-1 text-xs text-ink-400">{item.note}</div><a href={item.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] text-ink-400 hover:text-ink-700">{item.source} · {item.as_of || '待更新'} <ExternalLink size={10} /></a></div>
      <div className="text-right"><div className="text-xl font-bold tabular-nums text-ink-950">{formatIndicatorValue(item)}</div><div className={cn('mt-1 text-xs font-semibold tabular-nums', positive ? 'text-red-600' : negative ? 'text-emerald-600' : 'text-ink-400')}>{formatChange(item)}</div></div>
    </div>
  );
}
