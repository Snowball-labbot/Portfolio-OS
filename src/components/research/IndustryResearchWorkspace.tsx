import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  Building2,
  Database,
  ExternalLink,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type {
  CompanyCoverageItem,
  CompanyDossier,
  CompanyFundamentals,
  WatchlistItem,
} from '@/types';
import { cn } from '@/lib/utils';
import { ResearchLibrary } from './ResearchLibrary';
import { WatchlistResearchModal } from './WatchlistResearchModal';


function companyKey(item: Pick<CompanyCoverageItem, 'market' | 'symbol'>) {
  return `${item.market}:${item.symbol}`;
}

function money(value: number | null | undefined, currency = 'CNY') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    notation: Math.abs(Number(value)) >= 100_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(Number(value)) >= 1000 ? 0 : 2,
  }).format(Number(value));
}

function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(Number(value));
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(1)}%`;
}

interface DossierTarget {
  folderId: string;
  documentId: string;
}

export function IndustryResearchWorkspace() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [coverage, setCoverage] = useState<CompanyCoverageItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [fundamentals, setFundamentals] = useState<CompanyFundamentals | null>(null);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [loadingFundamentals, setLoadingFundamentals] = useState(false);
  const [creatingDossier, setCreatingDossier] = useState(false);
  const [error, setError] = useState('');
  const [editingWatchlist, setEditingWatchlist] = useState<WatchlistItem | null>(null);
  const [dossierTarget, setDossierTarget] = useState<DossierTarget | null>(null);

  const selected = useMemo(
    () => coverage.find((item) => companyKey(item) === selectedKey) || coverage[0] || null,
    [coverage, selectedKey],
  );

  const loadCoverage = async () => {
    setLoadingCoverage(true);
    setError('');
    try {
      const [nextCoverage, nextWatchlist] = await Promise.all([api.companyCoverage(), api.watchlist()]);
      setCoverage(nextCoverage);
      setWatchlist(nextWatchlist);
      setSelectedKey((current) => (
        nextCoverage.some((item) => companyKey(item) === current)
          ? current
          : nextCoverage[0] ? companyKey(nextCoverage[0]) : ''
      ));
    } catch (loadError) {
      setError(getErrorMessage(loadError, '公司覆盖加载失败'));
    } finally {
      setLoadingCoverage(false);
    }
  };

  useEffect(() => {
    if (!drawerOpen) return;
    loadCoverage();
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen || !selected) {
      setFundamentals(null);
      return;
    }
    let active = true;
    setLoadingFundamentals(true);
    setFundamentals(null);
    api.companyFundamentals(selected.symbol, selected.market)
      .then((next) => { if (active) setFundamentals(next); })
      .catch((loadError) => { if (active) setError(getErrorMessage(loadError, '基本面快照暂时不可用')); })
      .finally(() => { if (active) setLoadingFundamentals(false); });
    return () => { active = false; };
  }, [drawerOpen, selected]);

  const currentWatchlistItem = selected?.watchlist_id
    ? watchlist.find((item) => item.id === selected.watchlist_id) || null
    : null;

  const addToWatchlist = async () => {
    if (!selected) return;
    try {
      await api.createWatchlistItem({
        symbol: selected.symbol,
        name: selected.name,
        market: selected.market,
        currency: selected.currency,
        industry: selected.industry || fundamentals?.industry || null,
      });
      await loadCoverage();
    } catch (addError) {
      setError(getErrorMessage(addError, '加入观察名单失败'));
    }
  };

  const openDossier = async () => {
    if (!selected) return;
    setCreatingDossier(true);
    try {
      const result: CompanyDossier = await api.createCompanyDossier(selected.market, selected.symbol);
      setDossierTarget({ folderId: result.folder.id, documentId: result.document.id });
      setDrawerOpen(false);
    } catch (createError) {
      setError(getErrorMessage(createError, '创建公司研究档案失败'));
    } finally {
      setCreatingDossier(false);
    }
  };

  const rangePosition = fundamentals?.current_price != null
    && fundamentals.fifty_two_week_low != null
    && fundamentals.fifty_two_week_high != null
    && fundamentals.fifty_two_week_high > fundamentals.fifty_two_week_low
    ? Math.min(100, Math.max(0, (
      (fundamentals.current_price - fundamentals.fifty_two_week_low)
      / (fundamentals.fifty_two_week_high - fundamentals.fifty_two_week_low)
    ) * 100))
    : null;

  return (
    <>
      <ResearchLibrary
        key={dossierTarget?.documentId || 'industry-library'}
        scope="industry"
        initialFolderId={dossierTarget?.folderId}
        initialDocumentId={dossierTarget?.documentId}
        headerAction={(
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 hover:border-brand-400 hover:text-brand-700"
          >
            <Building2 size={15} /> 公司覆盖
          </button>
        )}
      />

      {drawerOpen && (
        <div className="fixed inset-0 z-[90] bg-ink-950/35 backdrop-blur-[1px]" onMouseDown={() => setDrawerOpen(false)}>
          <aside
            className="absolute inset-y-0 right-0 flex w-[760px] max-w-[calc(100vw-40px)] flex-col bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-ink-100 px-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-950 text-white"><Building2 size={18} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-ink-950">公司覆盖与基本面</h2>
                <p className="mt-0.5 text-xs text-ink-400">持仓公司与观察名单统一管理，数据按需更新</p>
              </div>
              <button type="button" onClick={loadCoverage} title="刷新公司覆盖" className="rounded-md p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-900"><RefreshCw size={16} className={loadingCoverage ? 'animate-spin' : ''} /></button>
              <button type="button" onClick={() => setDrawerOpen(false)} title="关闭" className="rounded-md p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-900"><X size={18} /></button>
            </header>

            {error && <div className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}<button type="button" onClick={() => setError('')} className="ml-auto"><X size={14} /></button></div>}

            <div className="grid min-h-0 flex-1 grid-cols-[214px_minmax(0,1fr)]">
              <nav className="custom-scrollbar min-h-0 overflow-y-auto border-r border-ink-100 bg-ink-50/45 p-2">
                {loadingCoverage && !coverage.length ? (
                  <div className="flex h-40 items-center justify-center"><Loader2 size={18} className="animate-spin text-brand-600" /></div>
                ) : coverage.length ? coverage.map((item) => (
                  <button
                    key={companyKey(item)}
                    type="button"
                    onClick={() => { setSelectedKey(companyKey(item)); setError(''); }}
                    className={cn(
                      'mb-1 w-full rounded-md px-3 py-3 text-left transition-colors',
                      selected && companyKey(selected) === companyKey(item) ? 'bg-white shadow-sm ring-1 ring-ink-100' : 'hover:bg-white',
                    )}
                  >
                    <div className="flex items-center gap-2"><span className="text-sm font-bold text-ink-900">{item.symbol}</span>{item.in_portfolio && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[9px] font-semibold text-brand-700">持仓</span>}</div>
                    <div className="mt-1 truncate text-xs text-ink-500">{item.name}</div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-ink-400"><span>{item.industry || '行业待补充'}</span><span>{percent(item.portfolio_weight_pct)}</span></div>
                  </button>
                )) : <div className="px-3 py-12 text-center text-xs leading-5 text-ink-400">股票持仓或观察名单会显示在这里。</div>}
              </nav>

              <main className="custom-scrollbar min-h-0 overflow-y-auto px-6 py-5">
                {selected ? (
                  <>
                    <div className="flex items-start gap-4 border-b border-ink-100 pb-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-ink-400"><span>{selected.market}</span><span>·</span><span>{selected.currency}</span><span>·</span><span>{selected.industry || fundamentals?.industry || '行业待补充'}</span></div>
                        <h3 className="mt-2 text-xl font-bold text-ink-950">{selected.name}</h3>
                        <div className="mt-1 text-sm text-ink-400">{selected.symbol}{fundamentals?.exchange ? ` · ${fundamentals.exchange}` : ''}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-ink-400">当前价</div>
                        <div className="mt-1 text-xl font-bold text-ink-950">{money(fundamentals?.current_price, fundamentals?.currency || selected.currency)}</div>
                      </div>
                    </div>

                    <section className="grid grid-cols-3 border-b border-ink-100 py-4">
                      <div><div className="text-[11px] text-ink-400">持仓价值</div><div className="mt-1 text-sm font-bold text-ink-900">{selected.in_portfolio ? money(selected.holding_value_cny) : '未持有'}</div></div>
                      <div><div className="text-[11px] text-ink-400">组合占比</div><div className="mt-1 text-sm font-bold text-ink-900">{percent(selected.portfolio_weight_pct)}</div></div>
                      <div><div className="text-[11px] text-ink-400">研究状态</div><div className="mt-1 text-sm font-bold text-ink-900">{selected.stance === 'holding' ? '持仓待建档' : selected.stance}</div></div>
                    </section>

                    {loadingFundamentals ? (
                      <div className="flex h-56 items-center justify-center"><Loader2 size={20} className="animate-spin text-brand-600" /></div>
                    ) : fundamentals ? (
                      <>
                        <section className="py-5">
                          <div className="mb-3 flex items-center gap-2"><Database size={15} className="text-ink-400" /><h4 className="text-sm font-bold text-ink-900">关键基本面</h4></div>
                          <div className="grid grid-cols-3 gap-x-5 gap-y-4">
                            {[
                              ['市值', money(fundamentals.market_cap, fundamentals.currency)],
                              ['市盈率 TTM', number(fundamentals.trailing_pe)],
                              ['预期市盈率', number(fundamentals.forward_pe)],
                              ['收入增长', percent(fundamentals.revenue_growth_pct)],
                              ['利润增长', percent(fundamentals.earnings_growth_pct)],
                              ['毛利率', percent(fundamentals.gross_margin_pct)],
                              ['营业利润率', percent(fundamentals.operating_margin_pct)],
                              ['净资产收益率', percent(fundamentals.return_on_equity_pct)],
                              ['自由现金流', money(fundamentals.free_cash_flow, fundamentals.currency)],
                            ].map(([label, value]) => (
                              <div key={label} className="border-t border-ink-100 pt-2"><div className="text-[10px] text-ink-400">{label}</div><div className="mt-1 text-sm font-semibold text-ink-900">{value}</div></div>
                            ))}
                          </div>
                        </section>

                        <section className="border-y border-ink-100 py-4">
                          <div className="flex items-center justify-between text-[11px] text-ink-400"><span>52 周低点 {money(fundamentals.fifty_two_week_low, fundamentals.currency)}</span><span>52 周高点 {money(fundamentals.fifty_two_week_high, fundamentals.currency)}</span></div>
                          <div className="relative mt-3 h-1.5 rounded-full bg-ink-100">
                            {rangePosition != null && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-600 shadow" style={{ left: `${rangePosition}%` }} />}
                          </div>
                        </section>
                      </>
                    ) : (
                      <div className="my-5 border-y border-ink-100 py-8 text-center text-sm text-ink-400">当前数据源没有返回可用基本面，可继续手工记录研究。</div>
                    )}

                    <section className="py-5">
                      <h4 className="text-sm font-bold text-ink-900">当前研究论点</h4>
                      <p className="mt-2 text-sm leading-6 text-ink-500">{selected.thesis || '尚未建立可证伪的核心投资逻辑。先记录为什么值得研究，再进入公司档案补全证据。'}</p>
                    </section>

                    <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-5">
                      {currentWatchlistItem ? (
                        <button type="button" onClick={() => setEditingWatchlist(currentWatchlistItem)} className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 px-3 text-xs font-semibold text-ink-700 hover:bg-ink-50"><BookOpenCheck size={15} /> 编辑研究卡</button>
                      ) : (
                        <button type="button" onClick={addToWatchlist} className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 px-3 text-xs font-semibold text-ink-700 hover:bg-ink-50"><Plus size={15} /> 加入观察名单</button>
                      )}
                      <button type="button" onClick={openDossier} disabled={creatingDossier} className="inline-flex h-9 items-center gap-2 rounded-md bg-ink-950 px-3 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-50">{creatingDossier ? <Loader2 size={15} className="animate-spin" /> : <FilePlus2 size={15} />} 创建或打开公司档案</button>
                      {currentWatchlistItem?.ir_url && <a href={currentWatchlistItem.ir_url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold text-brand-700 hover:bg-brand-50"><ExternalLink size={14} /> IR 网站</a>}
                    </div>

                    {fundamentals && <p className="mt-5 text-[10px] leading-4 text-ink-300">数据源：{fundamentals.source}，更新于 {new Date(fundamentals.as_of).toLocaleString('zh-CN')}。该快照可能延迟或缺失，研究结论应以公司公告和监管文件复核。</p>}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-ink-400">暂无公司覆盖。</div>
                )}
              </main>
            </div>
          </aside>
        </div>
      )}

      {editingWatchlist && (
        <WatchlistResearchModal
          item={editingWatchlist}
          onClose={() => setEditingWatchlist(null)}
          onSaved={async () => { setEditingWatchlist(null); await loadCoverage(); }}
        />
      )}
    </>
  );
}
