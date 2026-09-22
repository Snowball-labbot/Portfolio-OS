import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Save, X } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { WatchlistItem } from '@/types';

interface WatchlistResearchModalProps {
  item: WatchlistItem;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

type FormState = {
  name: string;
  industry: string;
  stance: string;
  thesis: string;
  fairValueLow: string;
  fairValueHigh: string;
  currency: string;
  catalysts: string;
  risks: string;
  invalidation: string;
  irUrl: string;
  nextReviewAt: string;
};

function formFromItem(item: WatchlistItem): FormState {
  return {
    name: item.name,
    industry: item.industry || '',
    stance: item.stance || 'research',
    thesis: item.thesis || '',
    fairValueLow: item.fair_value_low?.toString() || '',
    fairValueHigh: item.fair_value_high?.toString() || '',
    currency: item.currency || 'USD',
    catalysts: item.catalysts || '',
    risks: item.risks || '',
    invalidation: item.invalidation || '',
    irUrl: item.ir_url || '',
    nextReviewAt: item.next_review_at?.slice(0, 10) || '',
  };
}

export function WatchlistResearchModal({ item, onClose, onSaved }: WatchlistResearchModalProps) {
  const [form, setForm] = useState<FormState>(() => formFromItem(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setForm(formFromItem(item)), [item]);

  const field = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateWatchlistItem(item.id, {
        name: form.name.trim() || item.symbol,
        industry: form.industry.trim() || null,
        stance: form.stance,
        thesis: form.thesis.trim() || null,
        fair_value_low: form.fairValueLow ? Number(form.fairValueLow) : null,
        fair_value_high: form.fairValueHigh ? Number(form.fairValueHigh) : null,
        currency: form.currency.trim().toUpperCase() || 'USD',
        catalysts: form.catalysts.trim() || null,
        risks: form.risks.trim() || null,
        invalidation: form.invalidation.trim() || null,
        ir_url: form.irUrl.trim() || null,
        next_review_at: form.nextReviewAt ? `${form.nextReviewAt}T09:00:00+08:00` : null,
      });
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存公司研究卡失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-100 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-ink-950 px-2 py-1 text-xs font-bold text-white">{item.symbol}</span>
              <h3 className="text-lg font-bold text-ink-950">公司研究决策卡</h3>
            </div>
            <p className="mt-2 text-sm text-ink-400">把事实、判断和证伪条件放在同一处，便于后续复盘。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded p-2 text-ink-400 hover:bg-ink-50"><X size={18} /></button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          {error && <div className="mb-4 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm font-medium text-ink-700">公司名称<input value={form.name} onChange={(event) => field('name', event.target.value)} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3" /></label>
            <label className="text-sm font-medium text-ink-700">所属行业<input value={form.industry} onChange={(event) => field('industry', event.target.value)} placeholder="半导体" className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3" /></label>
            <label className="text-sm font-medium text-ink-700">研究状态<select value={form.stance} onChange={(event) => field('stance', event.target.value)} className="mt-2 h-10 w-full rounded-md border border-ink-200 bg-white px-3"><option value="research">研究中</option><option value="positive">积极关注</option><option value="neutral">中性观察</option><option value="avoid">暂不考虑</option></select></label>
          </div>

          <label className="mt-4 block text-sm font-medium text-ink-700">核心投资论点<textarea value={form.thesis} onChange={(event) => field('thesis', event.target.value)} placeholder="为什么值得持续研究？最关键的价值驱动是什么？" className="mt-2 min-h-28 w-full resize-y rounded-md border border-ink-200 px-3 py-2 leading-6" /></label>

          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_0.7fr_1fr]">
            <label className="text-sm font-medium text-ink-700">估值下沿<input type="number" min="0" value={form.fairValueLow} onChange={(event) => field('fairValueLow', event.target.value)} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3" /></label>
            <label className="text-sm font-medium text-ink-700">估值上沿<input type="number" min="0" value={form.fairValueHigh} onChange={(event) => field('fairValueHigh', event.target.value)} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3" /></label>
            <label className="text-sm font-medium text-ink-700">币种<input maxLength={3} value={form.currency} onChange={(event) => field('currency', event.target.value)} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3 uppercase" /></label>
            <label className="text-sm font-medium text-ink-700">下次复盘<input type="date" value={form.nextReviewAt} onChange={(event) => field('nextReviewAt', event.target.value)} className="mt-2 h-10 w-full rounded-md border border-ink-200 px-3" /></label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-ink-700">潜在催化剂<textarea value={form.catalysts} onChange={(event) => field('catalysts', event.target.value)} placeholder="产品周期、财报、行业政策、产能变化……" className="mt-2 min-h-24 w-full resize-y rounded-md border border-ink-200 px-3 py-2 leading-6" /></label>
            <label className="text-sm font-medium text-ink-700">主要风险<textarea value={form.risks} onChange={(event) => field('risks', event.target.value)} placeholder="竞争、估值、周期、监管、治理……" className="mt-2 min-h-24 w-full resize-y rounded-md border border-ink-200 px-3 py-2 leading-6" /></label>
          </div>
          <label className="mt-4 block text-sm font-medium text-ink-700">证伪条件<textarea value={form.invalidation} onChange={(event) => field('invalidation', event.target.value)} placeholder="出现什么事实后，应承认原论点不再成立？" className="mt-2 min-h-20 w-full resize-y rounded-md border border-ink-200 px-3 py-2 leading-6" /></label>
          <label className="mt-4 block text-sm font-medium text-ink-700">投资者关系页面<div className="relative mt-2"><input type="url" value={form.irUrl} onChange={(event) => field('irUrl', event.target.value)} placeholder="https://investor.example.com" className="h-10 w-full rounded-md border border-ink-200 px-3 pr-10" />{form.irUrl && <a href={form.irUrl} target="_blank" rel="noreferrer" aria-label="打开投资者关系页面" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-400 hover:bg-ink-50"><ExternalLink size={15} /></a>}</div></label>
        </div>

        <footer className="flex justify-end gap-2 border-t border-ink-100 px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-ink-200 px-4 text-sm font-semibold text-ink-700">取消</button>
          <button type="button" onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}保存研究卡</button>
        </footer>
      </div>
    </div>
  );
}
