import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  ExternalLink,
  FileInput,
  FileText,
  Loader2,
  ListTodo,
  Newspaper,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type {
  DecisionQueueItem,
  ResearchBriefInput,
  ResearchDashboard,
  ResearchEvent,
  ResearchGenerationStatus,
  WatchlistItem,
} from '@/types';
import { cn } from '@/lib/utils';
import { WatchlistResearchModal } from './WatchlistResearchModal';


const eventTypeCopy: Record<string, string> = {
  macro: '宏观',
  earnings: '财报',
  filing: '公告',
};

function formatEventTime(value?: string | null) {
  if (!value) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function eventDistance(value?: string | null) {
  if (!value) return '';
  const hours = (new Date(value).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return '已到计划时间';
  if (hours < 24) return `${Math.max(1, Math.ceil(hours))} 小时后`;
  const localDay = (timestamp: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
  const days = Math.round((Date.parse(localDay(new Date(value).getTime())) - Date.parse(localDay(Date.now()))) / 86_400_000);
  return days === 1 ? '明天' : `${days} 天后`;
}

function formatNewsTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatStatusTime(value?: string | null) {
  if (!value) return '尚无记录';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function eventStatus(event: ResearchEvent) {
  if (event.status === 'published') return { label: '已发布', className: 'bg-emerald-50 text-emerald-700' };
  if (event.status === 'cancelled') return { label: '已取消', className: 'bg-red-50 text-red-700' };
  return { label: event.time_precision === 'exact' ? '已确认' : '预计', className: 'bg-ink-50 text-ink-500' };
}

function parseBriefFile(file: File, text: string): ResearchBriefInput {
  const today = new Date().toISOString().slice(0, 10);
  if (file.name.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    return {
      title: parsed.title || `每日投研简报 ${parsed.as_of_date || parsed.date || today}`,
      as_of_date: parsed.as_of_date || parsed.date || today,
      summary: parsed.summary || null,
      content_markdown: parsed.content_markdown || parsed.content || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : ['每日简报'],
      source_url: parsed.source_url || null,
    };
  }
  const firstHeading = text.match(/^#\s+(.+)$/m)?.[1];
  const firstParagraph = text.split(/\n\s*\n/).find((block) => block.trim() && !block.trim().startsWith('#'));
  return {
    title: firstHeading || `每日投研简报 ${today}`,
    as_of_date: today,
    summary: firstParagraph?.replace(/\s+/g, ' ').slice(0, 180) || null,
    content_markdown: text,
    tags: ['每日简报'],
  };
}

interface ResearchDeskProps {
  onNavigate?: (view: 'research' | 'macro' | 'industry' | 'quant') => void;
}

const priorityCopy: Record<number, { label: string; className: string }> = {
  3: { label: '优先', className: 'bg-red-50 text-red-700' },
  2: { label: '本周', className: 'bg-amber-50 text-amber-700' },
  1: { label: '待补全', className: 'bg-ink-50 text-ink-500' },
};

function queueDue(item: DecisionQueueItem) {
  if (!item.due_at) return '未设截止日';
  return formatEventTime(item.due_at);
}

export function ResearchDesk({ onNavigate }: ResearchDeskProps) {
  const [dashboard, setDashboard] = useState<ResearchDashboard | null>(null);
  const [generationStatus, setGenerationStatus] = useState<ResearchGenerationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingKind, setGeneratingKind] = useState<'brief' | 'news' | null>(null);
  const [error, setError] = useState('');
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [editingWatchlistItem, setEditingWatchlistItem] = useState<WatchlistItem | null>(null);
  const [briefPreview, setBriefPreview] = useState<(ResearchBriefInput & { word_count: number; warnings: string[] }) | null>(null);
  const [importing, setImporting] = useState(false);
  const briefInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setError('');
    try {
      const [dashboardResult, generationResult] = await Promise.allSettled([
        api.researchDashboard(),
        api.researchGenerationStatus(),
      ]);
      if (dashboardResult.status === 'rejected') throw dashboardResult.reason;
      setDashboard(dashboardResult.value);
      if (generationResult.status === 'fulfilled') setGenerationStatus(generationResult.value);
    } catch (loadError) {
      setError(getErrorMessage(loadError, '研究台加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const latestRunId = generationStatus?.latest_run?.id;
  const latestRunStatus = generationStatus?.latest_run?.status;
  const latestRunKind = generationStatus?.latest_run?.report_kind;
  const activeRunCount = generationStatus?.active_runs?.length || 0;

  useEffect(() => {
    if (!activeRunCount && latestRunStatus !== 'queued' && latestRunStatus !== 'running') {
      setGeneratingKind(null);
      return undefined;
    }
    setGeneratingKind(latestRunKind === 'daily_news' ? 'news' : 'brief');
    const timer = window.setInterval(async () => {
      try {
        const nextStatus = await api.researchGenerationStatus();
        setGenerationStatus(nextStatus);
        if (!nextStatus.active_runs?.length || nextStatus.latest_run?.status === 'succeeded') await load();
      } catch {
        // Keep the existing page usable while the background task is polled.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [latestRunId, latestRunKind, latestRunStatus, activeRunCount]);

  const upcoming = useMemo(() => (dashboard?.events || []).filter((event) => (
    !event.scheduled_at || new Date(event.scheduled_at).getTime() >= Date.now() - 12 * 3_600_000
  )).slice(0, 8), [dashboard]);
  const nextEvent = upcoming[0];
  const latestNews = (dashboard?.news || []).slice(0, 8);
  const missingThesis = dashboard?.watchlist.filter((item) => !item.thesis?.trim()).length || 0;
  const unhealthySources = dashboard?.sources.filter((source) => source.status === 'error').length || 0;

  const refreshSources = async () => {
    setRefreshing(true);
    try {
      await api.refreshResearch();
      window.setTimeout(load, 1500);
    } catch (refreshError) {
      setError(getErrorMessage(refreshError, '启动数据同步失败'));
    } finally {
      setRefreshing(false);
    }
  };

  const generateBrief = async () => {
    setGeneratingKind('brief');
    setError('');
    try {
      const run = await api.generateResearchBrief({ kind: 'manual' });
      setGenerationStatus((current) => current ? { ...current, latest_run: run } : current);
    } catch (generationError) {
      setGeneratingKind(null);
      setError(getErrorMessage(generationError, 'Agnes 简报生成失败'));
    }
  };

  const generateDailyNews = async () => {
    setGeneratingKind('news');
    setError('');
    try {
      const run = await api.generateResearchBrief({ kind: 'daily_news', force: true });
      setGenerationStatus((current) => current ? { ...current, latest_run: run } : current);
    } catch (generationError) {
      setGeneratingKind(null);
      setError(getErrorMessage(generationError, 'Agnes 每日新闻生成失败'));
    }
  };

  const downloadPacket = async () => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const packet = await api.researchPacket(today);
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `codex_research_packet_${today}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(getErrorMessage(downloadError, '生成 Codex 数据包失败'));
    }
  };

  const handleBriefFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const payload = parseBriefFile(file, await file.text());
      setBriefPreview(await api.previewResearchBrief(payload));
    } catch (importError) {
      setError(getErrorMessage(importError, '简报文件解析失败'));
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const confirmBrief = async () => {
    if (!briefPreview) return;
    setImporting(true);
    try {
      await api.confirmResearchBrief(briefPreview);
      setBriefPreview(null);
      await load();
    } catch (importError) {
      setError(getErrorMessage(importError, '简报导入失败'));
    } finally {
      setImporting(false);
    }
  };

  const addWatchlist = async () => {
    if (!symbol.trim()) return;
    try {
      await api.createWatchlistItem({
        symbol: symbol.trim().toUpperCase(),
        name: name.trim() || symbol.trim().toUpperCase(),
        market: 'US',
        currency: 'USD',
        industry: industry.trim() || null,
      });
      setSymbol(''); setName(''); setIndustry(''); setWatchlistOpen(false);
      await load();
    } catch (watchlistError) {
      setError(getErrorMessage(watchlistError, '添加观察公司失败'));
    }
  };

  if (loading) {
    return <div className="flex min-h-[520px] items-center justify-center"><Loader2 className="animate-spin text-brand-600" /></div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 md:p-5 lg:p-6">
      {error && (
        <div className="flex items-center gap-3 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={17} /> {error}
          <button type="button" className="ml-auto" onClick={() => setError('')}><X size={16} /></button>
        </div>
      )}

      <section className="grid overflow-hidden rounded-lg border border-ink-100 bg-white lg:grid-cols-[1.35fr_0.65fr]">
        <div className="border-b border-ink-100 p-6 lg:border-b-0 lg:border-r lg:p-8">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-ink-400">
            <CalendarDays size={15} /> Daily Research Desk
          </div>
          <h2 className="mt-4 text-2xl font-bold text-ink-950">今天真正需要关注的内容</h2>
          {nextEvent ? (
            <div className="mt-6 flex items-start gap-4">
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink-950 text-white">
                <span className="text-sm font-bold">{nextEvent.importance}</span>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold text-ink-950">{nextEvent.title}</span>
                  <span className="rounded bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700">{eventDistance(nextEvent.scheduled_at)}</span>
                </div>
                <p className="mt-1 text-sm text-ink-400">北京时间 {formatEventTime(nextEvent.scheduled_at)} · {nextEvent.source}</p>
              </div>
            </div>
          ) : (
            <p className="mt-5 text-sm text-ink-400">未来两周暂未同步到高优先级事件。</p>
          )}
        </div>
        <div className="grid grid-cols-3 divide-x divide-ink-100 lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
          {[
            ['未来事件', `${upcoming.length}`, '未来 14 天'],
            ['最新资讯', `${latestNews.length}`, '近三天'],
            ['数据源异常', `${unhealthySources}`, unhealthySources ? '需要检查' : '运行正常'],
          ].map(([label, value, helper]) => (
            <div key={label} className="p-4 lg:px-6 lg:py-4">
              <div className="text-[11px] text-ink-400">{label}</div>
              <div className="mt-1 text-xl font-bold text-ink-950">{value}</div>
              <div className="mt-0.5 text-[11px] text-ink-400">{helper}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={refreshSources} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-md bg-ink-950 px-4 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50">
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> 同步最新日历
        </button>
        <button type="button" onClick={downloadPacket} className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-700 hover:bg-ink-50">
          <Download size={15} /> 导出 Codex 数据包
        </button>
        <button type="button" onClick={() => briefInputRef.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-700 hover:bg-ink-50">
          {importing ? <Loader2 size={15} className="animate-spin" /> : <FileInput size={15} />} 导入每日简报
        </button>
        <input ref={briefInputRef} type="file" accept=".json,.md,text/markdown,application/json" className="hidden" onChange={handleBriefFile} />
        <button type="button" onClick={() => setWatchlistOpen(true)} className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-700 hover:bg-ink-50">
          <Plus size={15} /> 添加观察公司
        </button>
      </div>

      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-ink-100 bg-white px-5 py-3.5 text-xs">
        <div className="flex items-center gap-2 font-semibold text-ink-800">
          <Sparkles size={15} className="text-brand-600" /> Agnes 自动简报
        </div>
        <div className="text-ink-400">最后同步 <span className="font-medium text-ink-700">{formatStatusTime(generationStatus?.last_sync_at)}</span></div>
        <div className="text-ink-400">最后持仓复盘 <span className="font-medium text-ink-700">{formatStatusTime(generationStatus?.latest_daily_review?.completed_at || generationStatus?.latest_success?.completed_at)}</span></div>
        <div className="text-ink-400">每日新闻 <span className="font-medium text-ink-700">{formatStatusTime(generationStatus?.latest_daily_news?.completed_at)}</span></div>
        <div className="text-ink-400">下次睡前复盘 <span className="font-medium text-ink-700">{formatStatusTime(generationStatus?.next_market_close_at)}</span></div>
        {!generationStatus?.ai_configured && (
          <div className="text-amber-700">Agnes 未配置，数据同步不受影响</div>
        )}
        {generationStatus?.latest_run?.status === 'failed' && (
          <div className="max-w-md truncate text-red-600" title={generationStatus.latest_run.error || undefined}>上次生成失败：{generationStatus.latest_run.error || '未知错误'}</div>
        )}
        <button
          type="button"
          onClick={generateBrief}
          disabled={generatingKind !== null || !generationStatus?.ai_configured}
          className="ml-auto inline-flex h-8 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 font-semibold text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {generatingKind === 'brief' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generatingKind === 'brief' ? '正在生成' : '生成今日复盘'}
        </button>
        <button
          type="button"
          onClick={generateDailyNews}
          disabled={generatingKind !== null || !generationStatus?.ai_configured}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 font-semibold text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {generatingKind === 'news' ? <Loader2 size={14} className="animate-spin" /> : <Newspaper size={14} />}
          {generatingKind === 'news' ? '正在生成' : '刷新每日新闻'}
        </button>
      </section>

      <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 font-bold text-ink-900"><ListTodo size={17} /> 今日研究队列</h3>
            <p className="mt-0.5 text-xs text-ink-400">由临近事件、复核日期和缺失投资论点自动排序</p>
          </div>
          <span className="text-xs text-ink-400">{dashboard?.decision_queue.length || 0} 项</span>
        </div>
        {dashboard?.decision_queue.length ? (
          <div className="divide-y divide-ink-100">
            {dashboard.decision_queue.slice(0, 7).map((item) => {
              const priority = priorityCopy[item.priority] || priorityCopy[1];
              const target = item.target_view === 'macro' || item.target_view === 'quant'
                ? item.target_view
                : item.target_view === 'industry' ? 'industry' : 'research';
              return (
                <div key={item.id} className="grid min-h-16 gap-3 px-5 py-3.5 sm:grid-cols-[72px_minmax(0,1fr)_150px_36px] sm:items-center">
                  <span className={cn('w-fit rounded px-2 py-1 text-[11px] font-semibold', priority.className)}>{priority.label}</span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink-900">{item.title}</div>
                    <div className="mt-1 truncate text-xs text-ink-400">{item.description || '等待补充研究结论'}{item.symbol ? ` · ${item.symbol}` : ''}</div>
                  </div>
                  <div className="text-xs text-ink-400">{queueDue(item)}</div>
                  <button
                    type="button"
                    title="进入对应研究页"
                    onClick={() => onNavigate?.(target)}
                    disabled={!onNavigate}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-400 hover:bg-ink-50 hover:text-ink-900 disabled:opacity-30"
                  >
                    <ArrowRight size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-ink-400">目前没有临近事件或待补全研究项。</div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 font-bold text-ink-900"><Newspaper size={17} /> 最新资讯</h3>
            <p className="mt-0.5 text-xs text-ink-400">自动抓取宏观与持仓相关标题，点击原文后再决定是否沉淀为研究</p>
          </div>
          <span className="text-xs text-ink-400">每小时滚动更新</span>
        </div>
        {latestNews.length ? (
          <div className="grid divide-y divide-ink-100 lg:grid-cols-2 lg:divide-y-0">
            {latestNews.map((item, index) => (
              <a
                key={item.id}
                href={item.source_url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'group flex min-w-0 gap-3 border-ink-100 px-5 py-4 hover:bg-ink-50',
                  index % 2 === 0 && 'lg:border-r',
                  index >= 2 && 'lg:border-t',
                )}
              >
                <span className="mt-0.5 flex h-8 min-w-10 shrink-0 items-center justify-center rounded bg-ink-50 px-2 text-[11px] font-bold text-ink-600 group-hover:bg-white">
                  {item.ticker || (item.topic === 'macro' ? '宏观' : '市场')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-semibold leading-5 text-ink-900">{item.title}</span>
                  {item.summary && <span className="mt-1 line-clamp-1 block text-xs text-ink-400">{item.summary}</span>}
                  <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                    {item.source} · {formatNewsTime(item.published_at)} <ExternalLink size={11} />
                  </span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-ink-400">后台完成首次同步后，最新资讯会显示在这里。</div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-lg border border-ink-100 bg-white">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <div><h3 className="font-bold text-ink-900">未来事件</h3><p className="mt-0.5 text-xs text-ink-400">宏观事件保持单一时间流，按来源和关联公司筛选</p></div>
            <span className="text-xs text-ink-400">北京时间</span>
          </div>
          <div className="divide-y divide-ink-100">
            {upcoming.length ? upcoming.map((event) => {
              const statusCopy = eventStatus(event);
              return (
                <div key={event.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[118px_minmax(0,1fr)_auto] sm:items-center">
                  <div><div className="text-xs font-semibold text-ink-700">{formatEventTime(event.scheduled_at)}</div><div className="mt-1 text-[11px] text-ink-400">{eventDistance(event.scheduled_at)}</div></div>
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', event.importance === 3 ? 'bg-red-500' : 'bg-amber-400')} /><span className="truncate text-sm font-semibold text-ink-900">{event.title}</span></div><div className="mt-1 text-xs text-ink-400">{eventTypeCopy[event.event_type] || event.event_type} · {event.ticker || event.source}</div></div>
                  <div className="flex items-center gap-2"><span className={cn('rounded px-2 py-1 text-[11px] font-semibold', statusCopy.className)}>{statusCopy.label}</span>{event.source_url && <a href={event.source_url} target="_blank" rel="noreferrer" className="rounded p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-800"><ExternalLink size={14} /></a>}</div>
                </div>
              );
            }) : <div className="px-5 py-12 text-center text-sm text-ink-400">同步数据后，未来事件会显示在这里。</div>}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-lg border border-ink-100 bg-white">
            <div className="border-b border-ink-100 px-5 py-4"><h3 className="font-bold text-ink-900">观察名单</h3><p className="mt-0.5 text-xs text-ink-400">只追踪与你的研究和持仓相关的公司</p></div>
            <div className="divide-y divide-ink-100">
              {dashboard?.watchlist.length ? dashboard.watchlist.slice(0, 6).map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                  <button type="button" onClick={() => setEditingWatchlistItem(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded bg-ink-50 text-xs font-bold text-ink-800">{item.symbol}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink-900">{item.name}</span><span className="mt-0.5 block text-[11px] text-ink-400">{item.industry || '行业待补充'} · {item.thesis ? '已有研究论点' : '待建立论点'}</span></span>
                  </button>
                  <button type="button" aria-label="移除观察公司" onClick={async () => { await api.deleteWatchlistItem(item.id); await load(); }} className="rounded p-2 text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              )) : <div className="px-5 py-10 text-center text-sm text-ink-400">添加持仓之外想持续研究的公司。</div>}
            </div>
          </section>

          <section className="rounded-lg border border-ink-100 bg-white">
            <div className="border-b border-ink-100 px-5 py-4"><h3 className="font-bold text-ink-900">最近研究</h3></div>
            <div className="divide-y divide-ink-100">
              {dashboard?.recent_documents.length ? dashboard.recent_documents.slice(0, 4).map((document) => (
                <div key={document.id} className="flex gap-3 px-5 py-3.5">
                  <FileText size={16} className="mt-0.5 shrink-0 text-ink-300" />
                  <div className="min-w-0"><div className="truncate text-sm font-semibold text-ink-900">{document.title}</div><div className="mt-1 line-clamp-1 text-xs text-ink-400">{document.summary || '暂无摘要'}</div></div>
                </div>
              )) : <div className="px-5 py-10 text-center text-sm text-ink-400">导入简报或在研究库创建第一篇笔记。</div>}
            </div>
          </section>
        </div>
      </div>

      {dashboard?.sources.length ? (
        <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-ink-100 bg-white px-5 py-3 text-xs text-ink-400">
          <span className="font-semibold text-ink-600">数据源</span>
          {dashboard.sources.map((source) => (
            <span key={source.source} className="inline-flex items-center gap-1.5" title={source.last_error || undefined}>
              {source.status === 'healthy' ? <CheckCircle2 size={13} className="text-emerald-600" /> : <AlertCircle size={13} className="text-amber-600" />}
              {source.source} · {source.item_count}
            </span>
          ))}
        </section>
      ) : null}

      {missingThesis > 0 && (
        <p className="text-xs text-ink-400">观察名单中还有 {missingThesis} 家公司尚未补充研究论点，可点击公司继续完善。</p>
      )}

      {watchlistOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">添加观察公司</h3><p className="mt-1 text-sm text-ink-400">用于财报、SEC 文件和公司研究提醒。</p></div><button type="button" onClick={() => setWatchlistOpen(false)} className="rounded p-2 text-ink-400 hover:bg-ink-50"><X size={18} /></button></div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">股票代码<input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="NVDA" className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 uppercase" /></label><label className="text-sm font-medium">公司名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="NVIDIA" className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3" /></label></div>
            <label className="mt-4 block text-sm font-medium">所属行业<input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="半导体" className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3" /></label>
            <button type="button" onClick={addWatchlist} className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink-950 text-sm font-semibold text-white"><Building2 size={16} /> 加入观察名单</button>
          </div>
        </div>
      )}

      {editingWatchlistItem && (
        <WatchlistResearchModal item={editingWatchlistItem} onClose={() => setEditingWatchlistItem(null)} onSaved={load} />
      )}

      {briefPreview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">确认导入每日简报</h3><p className="mt-1 text-sm text-ink-400">确认前不会写入研究库。</p></div><button type="button" onClick={() => setBriefPreview(null)} className="rounded p-2 text-ink-400 hover:bg-ink-50"><X size={18} /></button></div>
            <div className="mt-5 rounded-md border border-ink-100 bg-ink-50 p-4"><div className="font-semibold text-ink-900">{briefPreview.title}</div><div className="mt-2 text-xs text-ink-400">{briefPreview.as_of_date} · {briefPreview.word_count.toLocaleString()} 字符</div><p className="mt-3 text-sm leading-6 text-ink-600">{briefPreview.summary || '暂无摘要'}</p></div>
            {briefPreview.warnings.map((warning) => <p key={warning} className="mt-3 text-sm text-amber-700">{warning}</p>)}
            <button type="button" onClick={confirmBrief} disabled={importing} className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink-950 text-sm font-semibold text-white disabled:opacity-50">{importing ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} 确认发布到研究库</button>
          </div>
        </div>
      )}
    </div>
  );
}
