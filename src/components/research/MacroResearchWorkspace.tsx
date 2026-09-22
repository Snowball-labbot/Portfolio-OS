import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ExternalLink, Loader2, Search, X } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type { ResearchEvent } from '@/types';
import { ResearchLibrary } from './ResearchLibrary';


function eventTime(value?: string | null) {
  if (!value) return '日期待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function MacroResearchWorkspace() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    api.researchEvents(90, 'macro')
      .then(setEvents)
      .catch((loadError) => setError(getErrorMessage(loadError, '宏观事件证据加载失败')))
      .finally(() => setLoading(false));
  }, [open]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return events;
    return events.filter((event) => (
      event.title.toLowerCase().includes(normalized)
      || event.source.toLowerCase().includes(normalized)
      || event.indicator_code?.toLowerCase().includes(normalized)
    ));
  }, [events, query]);

  return (
    <>
      <ResearchLibrary
        scope="macro"
        headerAction={(
          <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 hover:border-brand-400 hover:text-brand-700">
            <CalendarRange size={15} /> 事件证据
          </button>
        )}
      />

      {open && (
        <div className="fixed inset-0 z-[90] bg-ink-950/35 backdrop-blur-[1px]" onMouseDown={() => setOpen(false)}>
          <aside className="absolute inset-y-0 right-0 flex w-[620px] max-w-[calc(100vw-40px)] flex-col bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-ink-100 px-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-950 text-white"><CalendarRange size={18} /></span>
              <div className="min-w-0 flex-1"><h2 className="font-bold text-ink-950">宏观事件证据</h2><p className="mt-0.5 text-xs text-ink-400">事实先进入时间流，结论再沉淀到研究文章</p></div>
              <button type="button" onClick={() => setOpen(false)} title="关闭" className="rounded-md p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-900"><X size={18} /></button>
            </header>
            <div className="border-b border-ink-100 p-4">
              <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索指标、事件或来源" className="h-10 w-full rounded-md border border-ink-200 pl-9 pr-3 text-sm" /></div>
            </div>
            {error && <div className="mx-4 mt-4 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>}
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-56 items-center justify-center"><Loader2 size={20} className="animate-spin text-brand-600" /></div>
              ) : visible.length ? (
                <div className="divide-y divide-ink-100">
                  {visible.map((event) => (
                    <article key={event.id} className="px-5 py-4">
                      <div className="flex items-start gap-4">
                        <div className="w-[112px] shrink-0 text-xs font-semibold text-ink-500">{eventTime(event.scheduled_at)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${event.importance >= 3 ? 'bg-red-500' : event.importance === 2 ? 'bg-amber-400' : 'bg-ink-300'}`} /><h3 className="text-sm font-semibold leading-5 text-ink-900">{event.title}</h3></div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                            <div><span className="text-ink-400">实际</span><div className="mt-0.5 font-semibold text-ink-800">{event.actual || '待发布'}</div></div>
                            <div><span className="text-ink-400">预期</span><div className="mt-0.5 font-semibold text-ink-800">{event.consensus || '—'}</div></div>
                            <div><span className="text-ink-400">前值</span><div className="mt-0.5 font-semibold text-ink-800">{event.previous || '—'}</div></div>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-400"><span>{event.source}</span>{event.reference_period && <><span>·</span><span>{event.reference_period}</span></>}{event.source_url && <a href={event.source_url} target="_blank" rel="noreferrer" title="打开原始来源" className="ml-auto rounded p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-900"><ExternalLink size={13} /></a>}</div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="px-5 py-16 text-center text-sm text-ink-400">当前筛选没有事件。</div>}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
