import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2, X } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import type { AISettingsInput } from '@/types';


interface AISettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onConfiguredChange: (configured: boolean) => void;
}

const presets: Record<string, Pick<AISettingsInput, 'base_url' | 'model' | 'vision_model'>> = {
  agnes: {
    base_url: 'https://api.agnes-ai.cn/v1',
    model: 'agnes-2.5-flash',
    vision_model: 'agnes-2.5-flash',
  },
  'openai-compatible': {
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    vision_model: 'gpt-4.1-mini',
  },
  custom: { base_url: '', model: '', vision_model: '' },
};

const emptyForm: AISettingsInput = {
  provider: 'agnes',
  base_url: presets.agnes.base_url,
  api_key: '',
  model: presets.agnes.model,
  vision_model: presets.agnes.vision_model,
};

export function AISettingsDialog({ open, onClose, onConfiguredChange }: AISettingsDialogProps) {
  const [form, setForm] = useState<AISettingsInput>(emptyForm);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMessage(null);
    api.aiSettings()
      .then((settings) => {
        setForm({
          provider: settings.provider || 'agnes',
          base_url: settings.base_url,
          api_key: '',
          model: settings.model,
          vision_model: settings.vision_model,
        });
        setMaskedKey(settings.masked_api_key);
        onConfiguredChange(settings.configured);
      })
      .catch((error) => setMessage({ tone: 'error', text: getErrorMessage(error, '无法读取 AI 配置。') }))
      .finally(() => setLoading(false));
  }, [open, onConfiguredChange]);

  if (!open) return null;

  const payload = (): AISettingsInput => ({
    ...form,
    api_key: form.api_key?.trim() || null,
    vision_model: form.vision_model?.trim() || form.model,
  });

  const testConnection = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.testAiSettings(payload());
      setMessage({ tone: 'success', text: result.message });
    } catch (error) {
      setMessage({ tone: 'error', text: getErrorMessage(error, '连接测试失败。') });
    } finally {
      setTesting(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const settings = await api.saveAiSettings(payload());
      setMaskedKey(settings.masked_api_key);
      setForm((current) => ({ ...current, api_key: '' }));
      onConfiguredChange(settings.configured);
      setMessage({ tone: 'success', text: 'AI API 已安全保存并立即生效。' });
    } catch (error) {
      setMessage({ tone: 'error', text: getErrorMessage(error, '保存 AI 配置失败。') });
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    if (!window.confirm('清除本机保存的 AI API 配置？策略助手与自动复盘将暂停。')) return;
    setLoading(true);
    try {
      await api.clearAiSettings();
      setForm(emptyForm);
      setMaskedKey(null);
      onConfiguredChange(false);
      setMessage({ tone: 'success', text: 'AI API 配置已清除。' });
    } catch (error) {
      setMessage({ tone: 'error', text: getErrorMessage(error, '清除配置失败。') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/40 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="AI API 设置">
      <form onSubmit={save} className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-ink-100 px-6 py-5">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-950 text-white"><KeyRound size={18} /></span>
            <div>
              <h2 className="text-lg font-bold text-ink-950">AI API</h2>
              <p className="mt-0.5 text-xs text-ink-400">用于策略助手、每日新闻整理和持仓复盘。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-800" aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <label className="block text-sm font-semibold text-ink-700">
            服务商
            <select
              value={form.provider}
              onChange={(event) => {
                const provider = event.target.value;
                setForm((current) => ({ ...current, provider, ...presets[provider] }));
              }}
              className="mt-1.5 h-10 w-full rounded-md border border-ink-200 bg-white px-3 font-normal text-ink-900 outline-none focus:border-brand-500"
            >
              <option value="agnes">Agnes</option>
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="custom">自定义</option>
            </select>
          </label>

          <label className="block text-sm font-semibold text-ink-700">
            API Base URL
            <input required value={form.base_url} onChange={(event) => setForm((current) => ({ ...current, base_url: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-ink-200 px-3 font-normal text-ink-900 outline-none focus:border-brand-500" />
          </label>

          <label className="block text-sm font-semibold text-ink-700">
            API Key
            <span className="relative mt-1.5 block">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.api_key || ''}
                placeholder={maskedKey ? `已保存 ${maskedKey}` : '输入 API Key'}
                onChange={(event) => setForm((current) => ({ ...current, api_key: event.target.value }))}
                className="h-10 w-full rounded-md border border-ink-200 px-3 pr-10 font-normal text-ink-900 outline-none focus:border-brand-500"
              />
              <button type="button" onClick={() => setShowKey((value) => !value)} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center text-ink-400 hover:text-ink-800" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm font-semibold text-ink-700">对话模型<input required value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-ink-200 px-3 font-normal text-ink-900 outline-none focus:border-brand-500" /></label>
            <label className="block text-sm font-semibold text-ink-700">视觉模型<input value={form.vision_model || ''} onChange={(event) => setForm((current) => ({ ...current, vision_model: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-ink-200 px-3 font-normal text-ink-900 outline-none focus:border-brand-500" /></label>
          </div>

          <div className="flex items-center gap-2 rounded-md bg-ink-50 px-3 py-2.5 text-xs text-ink-500">
            <ShieldCheck size={15} className="shrink-0 text-emerald-600" />
            API Key 使用 Windows DPAPI 加密，仅当前 Windows 用户可解密；不会写入资产数据库或备份。
          </div>

          {message && <div className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-sm ${message.tone === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.tone === 'success' && <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}{message.text}</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-ink-100 bg-ink-50 px-6 py-4">
          {maskedKey && <button type="button" onClick={clear} disabled={loading || testing} className="mr-auto inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={15} />清除</button>}
          <button type="button" onClick={testConnection} disabled={loading || testing} className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-700 hover:border-ink-300 disabled:opacity-50">{testing && <Loader2 size={15} className="animate-spin" />}测试连接</button>
          <button type="submit" disabled={loading || testing} className="inline-flex h-9 items-center gap-2 rounded-md bg-ink-950 px-4 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50">{loading && <Loader2 size={15} className="animate-spin" />}保存配置</button>
        </div>
      </form>
    </div>
  );
}
