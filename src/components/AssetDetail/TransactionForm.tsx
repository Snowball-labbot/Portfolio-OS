import { useEffect, useMemo, useRef, useState } from 'react';
import { PlusCircle, RefreshCw } from 'lucide-react';
import { AssetItem, AssetType, FlowClass, TransactionItem } from '@/types';
import { useAssetStore } from '@/store/useAssetStore';
import { api, getErrorMessage } from '@/lib/api';

interface TransactionFormProps {
  asset: AssetItem;
}

function quoteKind(asset: AssetItem) {
  if (asset.market === 'CN') return 'fund';
  if (asset.type === AssetType.FUND || asset.type === AssetType.BOND) return 'fund';
  return 'stock';
}

function formatNative(value: number, currency: string) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function beijingTimeInput() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return parts.replace(' ', 'T');
}

export function TransactionForm({ asset }: TransactionFormProps) {
  const { addTransaction, assets } = useAssetStore();
  const isCash = asset.type === AssetType.CASH;
  const cashAccounts = useMemo(
    () => assets
      .filter((item) => item.type === AssetType.CASH)
      .sort((left, right) => {
        const leftScore = Number(left.group === asset.group) * 2 + Number(left.currency === asset.currency);
        const rightScore = Number(right.group === asset.group) * 2 + Number(right.currency === asset.currency);
        return rightScore - leftScore;
      }),
    [asset.currency, asset.group, assets],
  );
  const preferredCash = useMemo(
    () => cashAccounts.find((item) => item.group === asset.group && item.currency === asset.currency)
      || cashAccounts.find((item) => item.group === asset.group)
      || cashAccounts.find((item) => item.currency === asset.currency)
      || cashAccounts[0],
    [asset.currency, asset.group, cashAccounts],
  );

  const [type, setType] = useState<TransactionItem['type']>(isCash ? 'cash_in' : 'buy');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState(isCash ? '1' : asset.current_price ? String(asset.current_price) : '');
  const [fee, setFee] = useState('0');
  const [exchangeRate, setExchangeRate] = useState(String(asset.exchange_rate_to_cny || 1));
  const [note, setNote] = useState('');
  const [tradeDate, setTradeDate] = useState(beijingTimeInput);
  const [flowClass, setFlowClass] = useState<FlowClass>(isCash ? 'external_contribution' : 'internal_trade');
  const [settleCash, setSettleCash] = useState(Boolean(!isCash && preferredCash));
  const [cashHoldingId, setCashHoldingId] = useState(preferredCash?.id || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [cashExchangeRate, setCashExchangeRate] = useState(String(preferredCash?.exchange_rate_to_cny || 1));
  const [success, setSuccess] = useState('');
  const submitting = useRef(false);
  const requestKey = useRef<{ fingerprint: string; id: string } | null>(null);
  const syncVersion = useRef(0);

  useEffect(() => {
    syncVersion.current += 1;
    setSyncing(false);
  }, [tradeDate, type, cashHoldingId]);

  useEffect(() => {
    if (type === 'adjustment') {
      setFlowClass('valuation_correction');
      setQuantity('0');
    } else if (settleCash && !isCash) {
      setFlowClass('internal_trade');
    } else {
      setFlowClass(type === 'cash_out' || type === 'sell' ? 'external_withdrawal' : 'external_contribution');
    }
  }, [isCash, settleCash, type]);

  const canSyncQuote = Boolean(!isCash && asset.market && asset.symbol);
  const selectedCash = cashAccounts.find((item) => item.id === cashHoldingId);
  const parsedQuantity = Number(quantity || 0);
  const parsedPrice = isCash || type === 'income' ? 1 : Number(unitPrice || 0);
  const parsedFee = Number(fee || 0);
  const grossTradeValue = parsedQuantity * parsedPrice;
  const settlementRatio = selectedCash && selectedCash.currency !== asset.currency
    ? Number(exchangeRate || asset.exchange_rate_to_cny || 1)
      / Number(cashExchangeRate)
    : 1;
  const cashEffect = type === 'buy'
    ? -(grossTradeValue + parsedFee) * settlementRatio
    : type === 'sell'
      ? (grossTradeValue - parsedFee) * settlementRatio
      : type === 'income'
        ? (parsedQuantity - parsedFee) * settlementRatio
      : 0;
  const estimatedRealizedGain = type === 'sell'
    ? grossTradeValue - parsedFee - parsedQuantity * Number(asset.avg_cost || 0)
    : 0;

  const syncQuote = async () => {
    if (!asset.market || !asset.symbol) return;
    setSyncing(true);
    setError('');
    const version = ++syncVersion.current;
    try {
      const today = beijingTimeInput().slice(0, 10);
      const date = tradeDate.slice(0, 10);
      const quote = date && date < today
        ? await api.historicalQuote(asset.market, asset.symbol, quoteKind(asset), date)
        : await api.quoteMarket(asset.market, asset.symbol, quoteKind(asset));
      const cashQuote = selectedCash && selectedCash.currency !== asset.currency
        ? await api.fxRate(selectedCash.currency, date < today ? date : undefined) : null;
      if (version !== syncVersion.current) return;
      setUnitPrice(String(quote.price));
      setExchangeRate(String(quote.exchange_rate_to_cny));
      if (cashQuote) setCashExchangeRate(String(cashQuote.exchange_rate_to_cny));
      setNote((current) => current || `按 ${quote.quote_source} 同步行情`);
    } catch (err: unknown) {
      if (version === syncVersion.current) setError(getErrorMessage(err, '同步行情失败，请手动填写单价和汇率。'));
    } finally {
      if (version === syncVersion.current) setSyncing(false);
    }
  };

  const changeType = (nextType: TransactionItem['type']) => {
    setType(nextType);
    if (nextType === 'income') {
      setUnitPrice('1');
      setFlowClass('internal_trade');
      setSettleCash(true);
    } else if (!isCash && unitPrice === '1') {
      setUnitPrice(asset.current_price ? String(asset.current_price) : '');
    }
  };

  const syncCashRate = async () => {
    setSyncing(true);
    setError('');
    const version = ++syncVersion.current;
    try {
      const date = tradeDate.slice(0, 10);
      const historical = date < beijingTimeInput().slice(0, 10) ? date : undefined;
      const quote = await api.fxRate(asset.currency, historical);
      const cashQuote = selectedCash && selectedCash.currency !== asset.currency
        ? await api.fxRate(selectedCash.currency, historical) : null;
      if (version !== syncVersion.current) return;
      setExchangeRate(String(quote.exchange_rate_to_cny));
      if (cashQuote) setCashExchangeRate(String(cashQuote.exchange_rate_to_cny));
    } catch (err: unknown) {
      if (version === syncVersion.current) setError(getErrorMessage(err, '同步汇率失败，请手动填写。'));
    } finally {
      if (version === syncVersion.current) setSyncing(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || syncing) return;
    setSuccess('');
    const parsedExchangeRate = Number(exchangeRate || 1);
    if (
      !Number.isFinite(parsedQuantity)
      || parsedQuantity < 0
      || !Number.isFinite(parsedPrice)
      || parsedPrice < 0
      || !Number.isFinite(parsedExchangeRate)
      || parsedExchangeRate <= 0
      || parsedFee < 0
      || !Number.isFinite(parsedFee)
      || (settleCash && (!Number.isFinite(settlementRatio) || settlementRatio <= 0))
    ) {
      setError('请输入有效的金额、价格、费用和汇率');
      return;
    }
    if (!tradeDate || Number.isNaN(new Date(`${tradeDate}:00+08:00`).getTime()) || tradeDate > beijingTimeInput()) {
      setError('请填写不晚于当前的北京时间');
      return;
    }
    if (['buy', 'sell'].includes(type) && parsedPrice <= 0) {
      setError('成交单价必须大于零');
      return;
    }
    if ((type === 'sell' && parsedFee > grossTradeValue) || (type === 'income' && parsedFee >= parsedQuantity)) {
      setError('费用不能超过到账金额');
      return;
    }
    if (type !== 'adjustment' && parsedQuantity <= 0) {
      setError(isCash ? '请输入现金金额' : '请输入交易份额');
      return;
    }
    if (tradeDate.slice(0, 10) === beijingTimeInput().slice(0, 10) && type === 'sell' && parsedQuantity > Number(asset.quantity)) {
      setError('卖出份额超过当前持仓');
      return;
    }
    if (tradeDate.slice(0, 10) === beijingTimeInput().slice(0, 10) && type === 'cash_out' && parsedQuantity + parsedFee > Number(asset.quantity)) {
      setError('取出金额与费用超过当前现金余额');
      return;
    }
    if (!isCash && settleCash && !cashHoldingId) {
      setError('请选择用于结算的现金账户');
      return;
    }
    if (type === 'income' && (!settleCash || !cashHoldingId)) {
      setError('分红或利息必须进入一个现金账户');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const payload = {
        type,
        quantity: parsedQuantity,
        unit_price: parsedPrice,
        fee: parsedFee,
        currency: asset.currency,
        exchange_rate_to_cny: parsedExchangeRate,
        settle_cash: !isCash && type !== 'adjustment' && settleCash,
        cash_holding_id: !isCash && type !== 'adjustment' && settleCash ? cashHoldingId : undefined,
        cash_exchange_rate_to_cny: settleCash && selectedCash?.currency !== asset.currency ? Number(cashExchangeRate) : undefined,
        trade_date: new Date(`${tradeDate}:00+08:00`).toISOString(),
        flow_class: flowClass,
        note: note || undefined,
      };
      const fingerprint = JSON.stringify(payload);
      if (requestKey.current?.fingerprint !== fingerprint) requestKey.current = { fingerprint, id: crypto.randomUUID() };
      await addTransaction(asset.id, { ...payload, client_request_id: requestKey.current.id });
      requestKey.current = null;
      setQuantity('');
      setNote('');
      setSuccess('流水已保存，持仓与现金结算已更新');
    } catch (err: unknown) {
      setError(getErrorMessage(err, '保存流水失败'));
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  };

  const options = isCash
    ? [
      { value: 'cash_in', label: '存入现金' },
      { value: 'cash_out', label: '取出现金' },
    ]
    : [
      { value: 'buy', label: '买入/追加' },
      { value: 'sell', label: '卖出/减少' },
      { value: 'income', label: '分红/利息' },
      { value: 'adjustment', label: '价格/手动调整' },
    ];

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-ink-100 bg-white p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-ink-900">{isCash ? '现金流水' : '交易流水'}</h3>
          <p className="mt-1 text-xs text-ink-400">
            {isCash
              ? '记录外部存取；账户之间移动资金请使用下方资金划转。'
              : '买卖可选择任意币种现金账户；分红和利息进入现金账户，不改变持仓成本。'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-500">{asset.currency}</span>
          <button
            type="button"
            onClick={isCash || type === 'income' ? syncCashRate : syncQuote}
            disabled={(type !== 'income' && !isCash && !canSyncQuote) || syncing || saving}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-600 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:opacity-40"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {isCash || type === 'income' ? '同步汇率' : '同步行情'}
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${isCash ? 'md:grid-cols-4' : 'md:grid-cols-5'}`}>
        <select
          value={type}
          onChange={(event) => changeType(event.target.value as TransactionItem['type'])}
          className="h-10 rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-800 outline-none focus:border-brand-500"
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input
          type="number"
          value={quantity}
          aria-label={isCash ? '现金金额' : type === 'income' ? '分红金额' : '交易份额'}
          disabled={type === 'adjustment'}
          onChange={(event) => setQuantity(event.target.value)}
          step="0.0001"
          min="0"
          placeholder={isCash ? `金额 ${asset.currency}` : type === 'income' ? `分红金额 ${asset.currency}` : '份额/股数'}
          className="h-10 rounded-md border border-ink-200 px-3 text-sm text-ink-800 outline-none placeholder:text-ink-300 focus:border-brand-500"
        />
        {!isCash && type !== 'income' && (
          <input
            type="number"
            value={unitPrice}
            aria-label="成交单价"
            onChange={(event) => setUnitPrice(event.target.value)}
            step="0.0001"
            min="0"
            placeholder="成交/最新单价"
            className="h-10 rounded-md border border-ink-200 px-3 text-sm text-ink-800 outline-none placeholder:text-ink-300 focus:border-brand-500"
          />
        )}
        <input
          type="number"
          value={exchangeRate}
          aria-label="交易币种兑人民币汇率"
          onChange={(event) => setExchangeRate(event.target.value)}
          step="any"
          min="0"
          placeholder="兑人民币"
          className="h-10 rounded-md border border-ink-200 px-3 text-sm text-ink-800 outline-none placeholder:text-ink-300 focus:border-brand-500"
        />
        <input
          type="number"
          value={fee}
          aria-label="费用"
          onChange={(event) => setFee(event.target.value)}
          step="0.01"
          min="0"
          placeholder={`费用 ${asset.currency}`}
          className="h-10 rounded-md border border-ink-200 px-3 text-sm text-ink-800 outline-none placeholder:text-ink-300 focus:border-brand-500"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-xs font-semibold text-ink-500">
          交易时间（北京时间）
          <input
            type="datetime-local"
            max={beijingTimeInput()}
            required
            value={tradeDate}
            onChange={(event) => setTradeDate(event.target.value)}
            className="h-10 w-full rounded-md border border-ink-200 bg-white px-3 text-sm font-normal text-ink-800 outline-none focus:border-brand-500"
          />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-ink-500">
          资金性质
          <select
            value={flowClass}
            onChange={(event) => setFlowClass(event.target.value as FlowClass)}
            disabled={(settleCash && !isCash) || type === 'adjustment'}
            className="h-10 w-full rounded-md border border-ink-200 bg-white px-3 text-sm font-normal text-ink-800 outline-none focus:border-brand-500 disabled:bg-ink-50"
          >
            {settleCash && !isCash && <option value="internal_trade">现金账户结算</option>}
            {!settleCash || isCash ? <>
              {type === 'buy' || type === 'cash_in' ? <>
                <option value="external_contribution">外部资金买入/存入</option>
                <option value="opening_balance">补录期初持仓</option>
              </> : <option value="external_withdrawal">款项转出个人组合</option>}
            </> : null}
            {type === 'adjustment' && <option value="valuation_correction">估值修正</option>}
          </select>
        </label>
      </div>

      {!isCash && type !== 'adjustment' && (
        <div className="rounded-md border border-ink-100 bg-ink-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-700">
              <input
                type="checkbox"
                checked={settleCash}
                onChange={(event) => setSettleCash(event.target.checked)}
                disabled={cashAccounts.length === 0 || type === 'income'}
                className="h-4 w-4 rounded border-ink-300 text-brand-600"
              />
              {type === 'sell'
                ? '卖出款自动进入现金账户'
                : type === 'income'
                  ? '分红/利息自动进入现金账户'
                  : '从现金账户自动扣款'}
            </label>
            <select
              value={cashHoldingId}
              aria-label="现金结算账户"
              onChange={(event) => {
                setCashHoldingId(event.target.value);
                setCashExchangeRate(String(cashAccounts.find((item) => item.id === event.target.value)?.exchange_rate_to_cny || 1));
              }}
              disabled={!settleCash || cashAccounts.length === 0}
              className="h-9 min-w-[230px] rounded-md border border-ink-200 bg-white px-3 text-xs text-ink-700 disabled:opacity-50"
            >
              <option value="">选择现金结算账户</option>
              {cashAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {formatNative(item.quantity, item.currency)}
                </option>
              ))}
            </select>
          </div>
          {settleCash && selectedCash && selectedCash.currency !== asset.currency && (
            <label className="mt-3 flex items-center gap-3 text-xs text-ink-600">
              {selectedCash.currency}/CNY 结算汇率
              <input type="number" aria-label="结算币种兑人民币汇率" value={cashExchangeRate} onChange={(event) => setCashExchangeRate(event.target.value)} min="0" step="any" className="h-9 w-36 rounded-md border border-ink-200 px-3" />
            </label>
          )}
          {cashAccounts.length === 0 ? (
            <p className="mt-2 text-xs text-amber-600">
              暂无现金账户，请先新增现金账户后再启用自动结算。
            </p>
          ) : settleCash && parsedQuantity > 0 && parsedPrice > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
              <span>
                {type === 'buy' ? '预计扣款' : '预计到账'}：
                {formatNative(Math.abs(cashEffect), selectedCash?.currency || asset.currency)}
              </span>
              {selectedCash && selectedCash.currency !== asset.currency && (
                <span>
                  参考换算：1 {asset.currency} ≈ {settlementRatio.toFixed(6)} {selectedCash.currency}
                  （按当前填写汇率结算）
                </span>
              )}
              {['sell', 'income'].includes(type) && (
                <span className={estimatedRealizedGain >= 0 ? 'text-red-600' : 'text-emerald-600'}>
                  {type === 'income' ? '本次投资收益' : '预计已实现盈亏'}：
                  {type === 'income'
                    ? formatNative(Math.max(parsedQuantity - parsedFee, 0), asset.currency)
                    : `${estimatedRealizedGain >= 0 ? '+' : ''}${formatNative(estimatedRealizedGain, asset.currency)}`}
                </span>
              )}
              {selectedCash && type === 'buy' && (
                <span>
                  扣款后余额：
                  {formatNative(Number(selectedCash.quantity) + cashEffect, selectedCash.currency)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="备注，可选"
          className="h-10 flex-1 rounded-md border border-ink-200 px-3 text-sm text-ink-800 outline-none placeholder:text-ink-300 focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={saving || syncing}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <PlusCircle size={16} />
          保存
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
    </form>
  );
}
