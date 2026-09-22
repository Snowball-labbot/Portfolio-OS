import { useEffect, useState } from 'react';
import {
  Beaker,
  BookOpen,
  Check,
  FileJson2,
  FlaskConical,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type { QuantExperiment, QuantExperimentInput } from '@/types';
import { cn } from '@/lib/utils';
import { ResearchLibrary } from './ResearchLibrary';


const statusCopy: Record<string, { label: string; className: string }> = {
  idea: { label: '假设', className: 'bg-ink-50 text-ink-600' },
  testing: { label: '实验中', className: 'bg-amber-50 text-amber-700' },
  validated: { label: '已验证', className: 'bg-emerald-50 text-emerald-700' },
  retired: { label: '已停用', className: 'bg-red-50 text-red-700' },
};

interface ExperimentDraft {
  name: string;
  status: string;
  hypothesis: string;
  universe: string;
  benchmark: string;
  start_date: string;
  end_date: string;
  rebalance: string;
  parameters: string;
  metrics: string;
  notes: string;
}

function toDraft(experiment: QuantExperiment): ExperimentDraft {
  return {
    name: experiment.name,
    status: experiment.status,
    hypothesis: experiment.hypothesis,
    universe: experiment.universe.join(', '),
    benchmark: experiment.benchmark || '',
    start_date: experiment.start_date || '',
    end_date: experiment.end_date || '',
    rebalance: experiment.rebalance || '',
    parameters: JSON.stringify(experiment.parameters || {}, null, 2),
    metrics: JSON.stringify(experiment.metrics || {}, null, 2),
    notes: experiment.notes,
  };
}

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function formatMetric(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '—');
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number);
}

const metricLabels: Record<string, string> = {
  cagr: '年化收益',
  annual_return: '年化收益',
  max_drawdown: '最大回撤',
  sharpe: '夏普比率',
  volatility: '年化波动',
  win_rate: '胜率',
  turnover: '换手率',
};

function QuantLab({ onOpenDocuments }: { onOpenDocuments: () => void }) {
  const [experiments, setExperiments] = useState<QuantExperiment[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<ExperimentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selected = experiments.find((item) => item.id === selectedId) || null;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await api.quantExperiments();
      setExperiments(next);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id || '');
    } catch (loadError) {
      setError(getErrorMessage(loadError, '量化实验加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setDraft(selected ? toDraft(selected) : null); }, [selected]);

  const createExperiment = async () => {
    setSaving(true);
    try {
      const experiment = await api.createQuantExperiment({
        name: '未命名策略实验',
        status: 'idea',
        hypothesis: '',
        universe: [],
        benchmark: 'SPY',
        start_date: null,
        end_date: null,
        rebalance: 'monthly',
        parameters: {},
        metrics: {},
        notes: '',
      });
      setExperiments((current) => [experiment, ...current]);
      setSelectedId(experiment.id);
      setDraft(toDraft(experiment));
    } catch (createError) {
      setError(getErrorMessage(createError, '创建实验失败'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    setError('');
    try {
      const payload: QuantExperimentInput = {
        name: draft.name.trim() || '未命名策略实验',
        status: draft.status,
        hypothesis: draft.hypothesis,
        universe: draft.universe.split(/[,，\n]/).map((item) => item.trim().toUpperCase()).filter(Boolean),
        benchmark: draft.benchmark.trim().toUpperCase() || null,
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
        rebalance: draft.rebalance.trim() || null,
        parameters: parseObject(draft.parameters, '策略参数'),
        metrics: parseObject(draft.metrics, '回测指标'),
        notes: draft.notes,
      };
      const updated = await api.updateQuantExperiment(selected.id, payload);
      setExperiments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDraft(toDraft(updated));
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存实验失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`确认删除“${selected.name}”？`)) return;
    try {
      await api.deleteQuantExperiment(selected.id);
      const next = experiments.filter((item) => item.id !== selected.id);
      setExperiments(next);
      setSelectedId(next[0]?.id || '');
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, '删除实验失败'));
    }
  };

  const metricEntries = selected
    ? Object.entries(selected.metrics || {}).filter(([, value]) => value != null).slice(0, 6)
    : [];

  if (loading) return <div className="flex min-h-[520px] items-center justify-center"><Loader2 className="animate-spin text-brand-600" /></div>;

  return (
    <div className="p-4 md:p-5 lg:p-6">
      {error && <div className="mx-auto mb-4 flex max-w-[1280px] items-center gap-2 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button type="button" onClick={() => setError('')} className="ml-auto"><X size={15} /></button></div>}
      <div className="mx-auto grid min-h-[calc(100vh-141px)] max-w-[1280px] overflow-hidden rounded-lg border border-ink-100 bg-white lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="border-r border-ink-100 bg-ink-50/45">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3.5"><div><h3 className="text-sm font-bold text-ink-900">实验记录</h3><p className="mt-0.5 text-[11px] text-ink-400">按最近更新时间排列</p></div><div className="flex items-center gap-1"><button type="button" onClick={onOpenDocuments} title="研究文档" className="flex h-8 w-8 items-center justify-center rounded-md border border-ink-100 bg-white text-ink-500 hover:text-ink-900"><BookOpen size={15} /></button><button type="button" onClick={createExperiment} disabled={saving} title="新建实验" className="flex h-8 w-8 items-center justify-center rounded-md border border-ink-100 bg-white text-ink-500 hover:text-ink-900 disabled:opacity-40"><Plus size={15} /></button></div></div>
          <nav className="custom-scrollbar max-h-[calc(100vh-211px)] divide-y divide-ink-100 overflow-y-auto">
            {experiments.length ? experiments.map((item) => {
              const status = statusCopy[item.status] || statusCopy.idea;
              return <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn('w-full px-4 py-4 text-left hover:bg-white', selectedId === item.id && 'bg-white shadow-[inset_3px_0_0_#2563eb]')}><div className="flex items-start gap-2"><Beaker size={15} className={cn('mt-0.5 shrink-0', selectedId === item.id ? 'text-brand-600' : 'text-ink-300')} /><div className="min-w-0 flex-1"><div className="line-clamp-2 text-sm font-semibold leading-5 text-ink-900">{item.name}</div><div className="mt-2 flex items-center justify-between gap-2"><span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', status.className)}>{status.label}</span><span className="text-[9px] text-ink-300">{new Date(item.updated_at).toLocaleDateString('zh-CN')}</span></div></div></div></button>;
            }) : <div className="px-5 py-16 text-center"><FlaskConical size={24} className="mx-auto text-ink-200" /><p className="mt-3 text-sm text-ink-400">还没有实验记录。</p><button type="button" onClick={createExperiment} className="mt-3 text-xs font-semibold text-brand-700">建立第一个策略假设</button></div>}
          </nav>
        </aside>

        <main className="min-w-0">
          {selected && draft ? (
            <>
              <header className="flex min-h-[64px] items-center gap-3 border-b border-ink-100 px-5 py-3">
                <div className="min-w-0 flex-1"><h3 className="truncate text-base font-bold text-ink-950">{selected.name}</h3><p className="mt-0.5 text-[11px] text-ink-400">更新于 {new Date(selected.updated_at).toLocaleString('zh-CN')}</p></div>
                <button type="button" onClick={remove} title="删除实验" className="rounded-md border border-ink-100 p-2 text-ink-400 hover:border-red-100 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                <button type="button" onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-ink-950 px-4 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存实验</button>
              </header>
              <div className="custom-scrollbar max-h-[calc(100vh-205px)] overflow-y-auto p-5 lg:p-7">
                {metricEntries.length > 0 && <section className="mb-6 grid grid-cols-3 divide-x divide-ink-100 border-y border-ink-100 sm:grid-cols-6">{metricEntries.map(([key, value]) => <div key={key} className="px-3 py-3"><div className="truncate text-[9px] text-ink-400">{metricLabels[key] || key}</div><div className="mt-1 truncate text-sm font-bold text-ink-900">{formatMetric(value)}</div></div>)}</section>}

                <section>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]"><label className="text-xs font-semibold text-ink-500">实验名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 text-sm font-semibold text-ink-900" /></label><label className="text-xs font-semibold text-ink-500">状态<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-ink-200 bg-white px-3 text-sm"><option value="idea">假设</option><option value="testing">实验中</option><option value="validated">已验证</option><option value="retired">已停用</option></select></label></div>
                  <label className="mt-4 block text-xs font-semibold text-ink-500">可证伪的策略假设<textarea value={draft.hypothesis} onChange={(event) => setDraft({ ...draft, hypothesis: event.target.value })} rows={4} placeholder="例如：过去 12 个月相对强势且盈利预期上修的行业龙头，在月频再平衡下未来 3 个月具有超额收益。" className="mt-2 w-full resize-y rounded-md border border-ink-200 p-3 text-sm leading-6" /></label>
                </section>

                <section className="mt-7 border-t border-ink-100 pt-6">
                  <h4 className="text-sm font-bold text-ink-900">实验边界</h4>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><label className="text-xs font-semibold text-ink-500">股票池 / 标的<input value={draft.universe} onChange={(event) => setDraft({ ...draft, universe: event.target.value })} placeholder="NVDA, MSFT, AVGO" className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 text-sm" /></label><label className="text-xs font-semibold text-ink-500">基准<input value={draft.benchmark} onChange={(event) => setDraft({ ...draft, benchmark: event.target.value })} placeholder="SPY" className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 text-sm uppercase" /></label><label className="text-xs font-semibold text-ink-500">再平衡频率<input value={draft.rebalance} onChange={(event) => setDraft({ ...draft, rebalance: event.target.value })} placeholder="monthly" className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 text-sm" /></label><label className="text-xs font-semibold text-ink-500">回测开始<input type="date" value={draft.start_date} onChange={(event) => setDraft({ ...draft, start_date: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 text-sm" /></label><label className="text-xs font-semibold text-ink-500">回测结束<input type="date" value={draft.end_date} onChange={(event) => setDraft({ ...draft, end_date: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 text-sm" /></label></div>
                </section>

                <section className="mt-7 grid gap-5 border-t border-ink-100 pt-6 lg:grid-cols-2">
                  <label className="text-xs font-semibold text-ink-500"><span className="inline-flex items-center gap-2"><FileJson2 size={14} /> 策略参数 JSON</span><textarea value={draft.parameters} onChange={(event) => setDraft({ ...draft, parameters: event.target.value })} className="custom-scrollbar mt-2 min-h-[220px] w-full resize-y rounded-md border border-ink-200 p-3 font-mono text-xs leading-5" /></label>
                  <label className="text-xs font-semibold text-ink-500"><span className="inline-flex items-center gap-2"><Check size={14} /> 回测指标 JSON</span><textarea value={draft.metrics} onChange={(event) => setDraft({ ...draft, metrics: event.target.value })} placeholder={'{\n  "cagr": 0,\n  "max_drawdown": 0,\n  "sharpe": 0\n}'} className="custom-scrollbar mt-2 min-h-[220px] w-full resize-y rounded-md border border-ink-200 p-3 font-mono text-xs leading-5" /></label>
                </section>

                <section className="mt-7 border-t border-ink-100 pt-6"><label className="text-xs font-semibold text-ink-500">实验记录、偏差检查与失效条件<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={7} placeholder="记录数据泄漏检查、交易成本、样本外结果、失败实验和下一步。" className="mt-2 w-full resize-y rounded-md border border-ink-200 p-3 text-sm leading-6" /></label></section>
                <p className="mt-5 text-[10px] leading-5 text-ink-300">当前版本负责保存可复核的实验定义与结果，不自动生成回测数字。接入回测引擎后，结果应写回同一实验记录，并保留参数、数据版本与运行时间。</p>
              </div>
            </>
          ) : <div className="flex min-h-[560px] items-center justify-center p-8"><div className="max-w-md text-center"><FlaskConical size={30} className="mx-auto text-ink-200" /><h3 className="mt-4 text-lg font-bold text-ink-900">让每个策略都有可证伪的实验记录</h3><p className="mt-3 text-sm leading-7 text-ink-400">固定假设、数据区间、基准、参数和评价指标，再记录成功与失败结果。</p><button type="button" onClick={createExperiment} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-ink-950 px-4 text-xs font-semibold text-white"><Plus size={14} /> 新建实验</button></div></div>}
        </main>
      </div>
    </div>
  );
}

export function QuantWorkspace() {
  const [view, setView] = useState<'lab' | 'documents'>('lab');
  if (view === 'documents') {
    return <ResearchLibrary scope="quant" headerAction={<button type="button" onClick={() => setView('lab')} className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 hover:border-brand-400 hover:text-brand-700"><FlaskConical size={15} /> 实验台</button>} />;
  }
  return <QuantLab onOpenDocuments={() => setView('documents')} />;
}
