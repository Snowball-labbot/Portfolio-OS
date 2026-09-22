import { useMemo, useState } from 'react';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';
import { AssetItem, AssetType } from '@/types';
import { api, getErrorMessage } from '@/lib/api';
import { useAssetStore } from '@/store/useAssetStore';

interface CashTransferFormProps {
  asset: AssetItem;
}

function formatNative(value: number, currency: string) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function CashTransferForm({ asset }: CashTransferFormProps) {
  const { assets, transferCash } = useAssetStore();
  const destinations = useMemo(
    () => assets.filter((item) => item.type === AssetType.CASH && item.id !== asset.id),
    [asset.id, assets],
  );
  const [destinationId, setDestinationId] = useState('');
  const [sourceAmount, setSourceAmount] = useState('');
  const [destinationAmount, setDestinationAmount] = useState('');
  const [sourceRate, setSourceRate] = useState(String(asset.exchange_rate_to_cny || 1));
  const [destinationRate, setDestinationRate] = useState('1');
  const [fee, setFee] = useState('0');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const destination = destinations.find((item) => item.id === destinationId);
  const sourceNumber = Number(sourceAmount || 0);
  const destinationNumber = Number(destinationAmount || 0);
  const feeNumber = Number(fee || 0);
  const sourceRateNumber = Number(sourceRate || 0);
  const destinationRateNumber = Number(destinationRate || 0);
  const sourceAfter = Number(asset.quantity) - sourceNumber - feeNumber;
  const destinationAfter = Number(destination?.quantity || 0) + destinationNumber;
  const valueDifferenceCny = destinationNumber * destinationRateNumber
    - sourceNumber * sourceRateNumber
    - feeNumber * sourceRateNumber;

  const selectDestination = (id: string) => {
    setDestinationId(id);
    const next = destinations.find((item) => item.id === id);
    if (!next) return;
    setDestinationRate(String(next.exchange_rate_to_cny || 1));
    if (next.currency === asset.currency && sourceAmount) {
      setDestinationAmount(sourceAmount);
    }
  };

  const syncRates = async () => {
    if (!destination) return;
    setSyncing(true);
    setError('');
    try {
      const [sourceQuote, destinationQuote] = await Promise.all([
        api.fxRate(asset.currency),
        api.fxRate(destination.currency),
      ]);
      setSourceRate(String(sourceQuote.exchange_rate_to_cny));
      setDestinationRate(String(destinationQuote.exchange_rate_to_cny));
    } catch (err: unknown) {
      setError(getErrorMessage(err, '同步汇率失败，请手动填写。'));
    } finally {
      setSyncing(false);
    }
  };

  const estimateArrival = () => {
    if (!destination || sourceRateNumber <= 0 || destinationRateNumber <= 0) return;
    const availableValueCny = Math.max(0, sourceNumber * sourceRateNumber);
    setDestinationAmount((availableValueCny / destinationRateNumber).toFixed(2));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !destination
      || sourceNumber <= 0
      || destinationNumber <= 0
      || sourceRateNumber <= 0
      || destinationRateNumber <= 0
      || feeNumber < 0
    ) {
      setError('请选择目标现金账户，并填写有效金额和汇率。');
      return;
    }
    if (sourceNumber + feeNumber > Number(asset.quantity)) {
      setError('转出金额与手续费超过当前现金余额。');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await transferCash({
        source_holding_id: asset.id,
        destination_holding_id: destination.id,
        source_amount: sourceNumber,
        destination_amount: destinationNumber,
        source_exchange_rate_to_cny: sourceRateNumber,
        destination_exchange_rate_to_cny: destinationRateNumber,
        fee: feeNumber,
        note: note || undefined,
      });
      setSourceAmount('');
      setDestinationAmount('');
      setFee('0');
      setNote('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, '资金划转失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-ink-100 bg-white p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-ink-900">资金划转与换汇</h3>
          <p className="mt-1 text-xs text-ink-400">在现金账户间生成成对流水，内部划转不重复计算为新增资产。</p>
        </div>
        <button
          type="button"
          onClick={syncRates}
          disabled={!destination || syncing || saving}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 px-3 text-xs font-semibold text-ink-600 hover:border-brand-500 hover:text-brand-700 disabled:opacity-40"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          同步汇率
        </button>
      </div>

      {destinations.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-4 py-5 text-sm text-ink-500">
          请先新增另一个现金资产，例如“港卡 HKD 现金”或“IBKR USD 现金”。
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-500">转出账户</label>
              <div className="flex h-10 items-center rounded-md border border-ink-100 bg-ink-50 px-3 text-sm text-ink-700">
                {asset.name} · {formatNative(asset.quantity, asset.currency)}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-500">转入账户</label>
              <select
                value={destinationId}
                onChange={(event) => selectDestination(event.target.value)}
                className="h-10 w-full rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-800"
              >
                <option value="">选择现金账户</option>
                {destinations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.currency} · {item.group || '未分组'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <input
              type="number"
              min="0"
              step="0.01"
              value={sourceAmount}
              onChange={(event) => {
                setSourceAmount(event.target.value);
                if (destination?.currency === asset.currency) setDestinationAmount(event.target.value);
              }}
              placeholder={`转出金额 ${asset.currency}`}
              className="h-10 rounded-md border border-ink-200 px-3 text-sm"
            />
            <input
              type="number"
              min="0"
              step="any"
              value={sourceRate}
              onChange={(event) => setSourceRate(event.target.value)}
              placeholder={`${asset.currency}/CNY`}
              className="h-10 rounded-md border border-ink-200 px-3 text-sm"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={destinationAmount}
              onChange={(event) => setDestinationAmount(event.target.value)}
              placeholder={`实际到账 ${destination?.currency || ''}`}
              className="h-10 rounded-md border border-ink-200 px-3 text-sm"
            />
            <input
              type="number"
              min="0"
              step="any"
              value={destinationRate}
              onChange={(event) => setDestinationRate(event.target.value)}
              placeholder={`${destination?.currency || '目标币种'}/CNY`}
              className="h-10 rounded-md border border-ink-200 px-3 text-sm"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={fee}
              onChange={(event) => setFee(event.target.value)}
              placeholder={`手续费 ${asset.currency}`}
              className="h-10 rounded-md border border-ink-200 px-3 text-sm"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="备注，例如：余额宝换汇后转入港卡"
              className="h-10 flex-1 rounded-md border border-ink-200 px-3 text-sm"
            />
            <button
              type="button"
              onClick={estimateArrival}
              disabled={!destination || sourceNumber <= 0}
              className="h-10 rounded-md border border-ink-200 px-4 text-xs font-semibold text-ink-600 hover:border-brand-500 hover:text-brand-700 disabled:opacity-40"
            >
              按汇率估算到账
            </button>
          </div>

          {destination && sourceNumber > 0 && destinationNumber > 0 && (
            <div className="grid gap-3 rounded-md bg-ink-50 p-4 text-xs sm:grid-cols-3">
              <div>
                <div className="text-ink-400">转出后</div>
                <div className="mt-1 font-semibold text-ink-800">{formatNative(sourceAfter, asset.currency)}</div>
              </div>
              <div>
                <div className="text-ink-400">转入后</div>
                <div className="mt-1 font-semibold text-ink-800">{formatNative(destinationAfter, destination.currency)}</div>
              </div>
              <div>
                <div className="text-ink-400">折算差额（含费用）</div>
                <div className={`mt-1 font-semibold ${valueDifferenceCny >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {valueDifferenceCny >= 0 ? '+' : ''}¥{valueDifferenceCny.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !destination}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
          >
            <ArrowRightLeft size={16} />
            确认划转
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
