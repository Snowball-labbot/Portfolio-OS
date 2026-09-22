import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type { ExposureProfile } from '@/types';

interface ExposureRow {
  profile_code: string;
  weight_pct: string;
}

export function ExposureEditor({ holdingId }: { holdingId: string }) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<ExposureProfile[]>([]);
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([api.exposureProfiles(), api.holdingExposures(holdingId)])
      .then(([nextProfiles, result]) => {
        setProfiles(nextProfiles);
        setRows(result.items.map((item) => ({
          profile_code: item.profile_code,
          weight_pct: String(item.weight_pct),
        })));
        setSource(result.items.some((item) => item.mapping_source === 'manual') ? '手动设置' : '自动识别');
      })
      .catch((error) => setMessage(getErrorMessage(error, '暴露映射加载失败')));
  }, [holdingId]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.weight_pct || 0), 0), [rows]);
  const summary = rows
    .map((row) => `${profiles.find((profile) => profile.code === row.profile_code)?.name || row.profile_code} ${Number(row.weight_pct || 0).toFixed(0)}%`)
    .join(' · ');

  const updateRow = (index: number, patch: Partial<ExposureRow>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const save = async () => {
    if (Math.abs(total - 100) > 0.01) {
      setMessage('各项比例合计必须为 100%');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await api.updateHoldingExposures(holdingId, rows.map((row) => ({
        profile_code: row.profile_code,
        weight_pct: Number(row.weight_pct),
      })));
      setSource('手动设置');
      setMessage('已保存，组合透视将使用这组映射。');
    } catch (error) {
      setMessage(getErrorMessage(error, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-ink-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left md:px-6"
      >
        <span className="flex min-w-0 items-center gap-3">
          <SlidersHorizontal size={18} className="shrink-0 text-ink-400" />
          <span className="min-w-0">
            <strong className="block text-sm text-ink-900">核心暴露映射</strong>
            <small className="block truncate text-xs text-ink-400">{summary || '正在识别'} · {source || '-'}</small>
          </span>
        </span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>

      {open && (
        <div className="border-t border-ink-100 px-5 py-4 md:px-6">
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={`${row.profile_code}-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_34px] gap-2">
                <select
                  value={row.profile_code}
                  onChange={(event) => updateRow(index, { profile_code: event.target.value })}
                  className="h-9 min-w-0 rounded border border-ink-200 bg-white px-3 text-sm text-ink-700"
                >
                  {profiles.map((profile) => <option key={profile.code} value={profile.code}>{profile.name}</option>)}
                </select>
                <label className="relative">
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={row.weight_pct}
                    onChange={(event) => updateRow(index, { weight_pct: event.target.value })}
                    className="h-9 w-full rounded border border-ink-200 px-3 pr-7 text-right text-sm tabular-nums"
                  />
                  <span className="pointer-events-none absolute right-2 top-2 text-xs text-ink-400">%</span>
                </label>
                <button
                  type="button"
                  title="删除这一项"
                  disabled={rows.length === 1}
                  onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                  className="flex h-9 items-center justify-center rounded border border-ink-200 text-ink-400 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setRows((current) => [...current, { profile_code: profiles[0]?.code || 'OTHER', weight_pct: '0' }])}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-ink-200 px-3 text-xs font-semibold text-ink-600"
            >
              <Plus size={14} /> 拆分暴露
            </button>
            <span className={`text-xs font-semibold ${Math.abs(total - 100) <= 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>合计 {total.toFixed(2)}%</span>
            <button
              type="button"
              disabled={saving || Math.abs(total - 100) > 0.01}
              onClick={save}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-ink-950 px-3 text-xs font-semibold text-white disabled:opacity-40"
            >
              <Save size={14} /> {saving ? '保存中' : '保存映射'}
            </button>
          </div>
          {message && <p className="mt-2 text-xs text-ink-500">{message}</p>}
        </div>
      )}
    </section>
  );
}
