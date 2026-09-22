import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { useAssetStore } from '@/store/useAssetStore';
import { ASSET_CONFIG } from '@/constants/assets';
import { AssetType, FlowClass, MarketInstrument } from '@/types';
import { cn } from '@/lib/utils';
import { api, getErrorMessage } from '@/lib/api';

interface AssetInputFormProps {
  onSuccess?: () => void;
}

const quoteEnabledTypes = new Set<AssetType>([AssetType.FUND, AssetType.STOCK, AssetType.BOND]);
type MarketCode = 'CN' | 'US' | 'KR';

function inferMarket(value: string, type: AssetType): MarketCode {
  const text = value.trim();
  if (/\.(KS|KQ)$/i.test(text)) return 'KR';
  if (/^[A-Z]{1,6}$/i.test(text)) return 'US';
  if (type === AssetType.STOCK && /^0\d{5}$/.test(text)) return 'KR';
  if (/^\d{5,6}$/.test(text)) return 'CN';
  if (type === AssetType.FUND || type === AssetType.BOND) return 'CN';
  return 'US';
}

function inferKind(market: MarketCode): 'fund' | 'stock' {
  return market === 'CN' ? 'fund' : 'stock';
}

function marketLabel(market: string) {
  if (market === 'US') return '美股';
  if (market === 'KR') return '韩股';
  return '基金';
}

export function AssetInputForm({ onSuccess }: AssetInputFormProps) {
  const { addAsset, assets } = useAssetStore();
  const [type, setType] = useState<AssetType>(AssetType.FUND);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [symbol, setSymbol] = useState('');
  const [market, setMarket] = useState<MarketCode>('CN');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [latestPrice, setLatestPrice] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [fee, setFee] = useState('0');
  const [flowClass, setFlowClass] = useState<FlowClass>('opening_balance');
  const [candidates, setCandidates] = useState<MarketInstrument[]>([]);
  const [searching, setSearching] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState('');
  const [error, setError] = useState('');
  const isCash = type === AssetType.CASH;

  const existingGroups = useMemo(() => Array.from(new Set(
    assets.filter((asset) => asset.type === type && asset.group).map((asset) => asset.group as string)
  )), [assets, type]);

  useEffect(() => {
    const query = symbol.trim();
    if (!quoteEnabledTypes.has(type) || query.length < 2) {
      setCandidates([]);
      setQuoteMessage('');
      return;
    }

    const nextMarket = inferMarket(query, type);
    setMarket(nextMarket);
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setQuoteMessage('');
      try {
        const results = await api.searchMarket(query, nextMarket);
        setCandidates(results);
        if (results.length === 0) {
          setQuoteMessage('没有匹配行情，可以继续手动填写价格');
        }
      } catch (err: unknown) {
        setCandidates([]);
        setQuoteMessage(getErrorMessage(err, '行情查询失败，可以继续手动填写价格'));
      } finally {
        setSearching(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [symbol, type]);

  const applyQuote = (quote: MarketInstrument & { exchange_rate_to_cny?: number | null }) => {
    const nextMarket: MarketCode = quote.market === 'US' ? 'US' : quote.market === 'KR' ? 'KR' : 'CN';
    setMarket(nextMarket);
    setSymbol(quote.symbol);
    setName(quote.name);
    setCurrency(quote.currency || (nextMarket === 'US' ? 'USD' : nextMarket === 'KR' ? 'KRW' : 'CNY'));
    setType((previousType) => {
      if (previousType === AssetType.BOND) return AssetType.BOND;
      if (nextMarket === 'US' || nextMarket === 'KR') return AssetType.STOCK;
      return AssetType.FUND;
    });

    if (quote.price !== undefined && quote.price !== null) {
      const price = String(quote.price);
      setLatestPrice(price);
      if (!unitPrice) setUnitPrice(price);
    }

    if (quote.exchange_rate_to_cny) {
      setExchangeRate(String(quote.exchange_rate_to_cny));
    } else if (nextMarket === 'CN') {
      setExchangeRate('1');
    }
  };

  const selectCandidate = async (candidate: MarketInstrument) => {
    applyQuote(candidate);
    setCandidates([]);
    setQuoteMessage(candidate.price ? '已带出最新价格' : '已绑定代码，正在获取最新价格');

    try {
      const quote = await api.quoteMarket(candidate.market, candidate.symbol, candidate.kind);
      applyQuote(quote);
      setQuoteMessage('已自动绑定最新价格');
    } catch (err: unknown) {
      setQuoteMessage(getErrorMessage(err, '最新价格获取失败，可以手动填写价格'));
    }
  };

  const refreshTypedSymbol = async () => {
    const query = symbol.trim();
    if (!query || !quoteEnabledTypes.has(type)) return;
    const nextMarket = inferMarket(query, type);
    setSearching(true);
    setQuoteMessage('');
    try {
      const quote = await api.quoteMarket(nextMarket, query, inferKind(nextMarket));
      applyQuote(quote);
      setQuoteMessage('已自动绑定最新价格');
    } catch (err: unknown) {
      setQuoteMessage(getErrorMessage(err, '行情获取失败，可以手动填写价格'));
    } finally {
      setSearching(false);
    }
  };

  const refreshCashRate = async () => {
    if (!isCash) return;
    try {
      const quote = await api.fxRate(currency);
      setExchangeRate(String(quote.exchange_rate_to_cny));
      setQuoteMessage(`已同步 ${quote.currency}/CNY 汇率`);
    } catch (err: unknown) {
      setQuoteMessage(getErrorMessage(err, '汇率同步失败，可以继续手动填写'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numQuantity = parseFloat(quantity);
    const buyPrice = isCash ? 1 : parseFloat(unitPrice || latestPrice);
    const currentPrice = isCash ? 1 : parseFloat(latestPrice || unitPrice);
    const numFee = parseFloat(fee || '0');
    const numExchangeRate = parseFloat(exchangeRate || '1');

    if (isNaN(numQuantity) || numQuantity < 0 || isNaN(buyPrice) || buyPrice < 0 || isNaN(currentPrice) || currentPrice < 0 || isNaN(numExchangeRate) || numExchangeRate <= 0) {
      setError('请输入有效的份额、成本、价格和汇率');
      return;
    }

    try {
      await addAsset({
        type,
        name: name || symbol || `${ASSET_CONFIG[type].label}持仓`,
        group: group || undefined,
        market: !isCash && symbol ? market : undefined,
        symbol: !isCash ? symbol || undefined : undefined,
        currency: currency.toUpperCase(),
        quantity: numQuantity,
        unit_price: buyPrice,
        current_price: currentPrice,
        fee: isNaN(numFee) ? 0 : numFee,
        exchange_rate_to_cny: numExchangeRate,
        flow_class: flowClass,
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, '添加资产失败'));
      return;
    }

    setName('');
    setGroup('');
    setSymbol('');
    setQuantity('1');
    setUnitPrice('');
    setLatestPrice('');
    setCurrency('CNY');
    setExchangeRate('1');
    setFee('0');
    setFlowClass('opening_balance');
    setCandidates([]);
    setQuoteMessage('');
    setError('');
    onSuccess?.();
  };

  return (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">资产类型</label>
              <select
                value={type}
                onChange={(e) => {
                  const nextType = e.target.value as AssetType;
                  setType(nextType);
                  if (nextType !== AssetType.STOCK) {
                    setMarket('CN');
                    setCurrency('CNY');
                    setExchangeRate('1');
                  } else {
                    setMarket('US');
                    setCurrency('USD');
                  }
                  if (nextType === AssetType.CASH) {
                    setSymbol('');
                    setUnitPrice('1');
                    setLatestPrice('1');
                    setQuantity('0');
                  }
                  setCandidates([]);
                  setQuoteMessage('');
                }}
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              >
                {Object.entries(ASSET_CONFIG).map(([assetType, config]) => (
                  <option key={assetType} value={assetType}>{config.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">行情代码/名称</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  value={symbol}
                  onChange={(e) => {
                    setSymbol(e.target.value);
                    if (error) setError('');
                  }}
                  onBlur={refreshTypedSymbol}
                  disabled={isCash}
                  placeholder={isCash ? '现金账户不需要行情代码' : '可选：017091 / AAPL / 005930.KS'}
                  className="flex h-10 w-full rounded-md border border-ink-200 bg-white py-2 pl-9 pr-10 text-sm text-ink-800"
                />
                {symbol && (
                  <button
                    type="button"
                    onClick={() => {
                      setSymbol('');
                      setCandidates([]);
                      setQuoteMessage('');
                    }}
                    className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  >
                    <X size={14} />
                  </button>
                )}
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" size={16} />}
                {candidates.length > 0 && (
                  <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    {candidates.map((candidate) => (
                      <button
                        key={`${candidate.market}-${candidate.symbol}-${candidate.name}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectCandidate(candidate)}
                        className="w-full border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-gray-50"
                      >
                        <div className="font-medium text-gray-900">
                          {candidate.name} ({candidate.symbol}) - {marketLabel(candidate.market)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {candidate.currency}{candidate.price ? ` · 最新价 ${Number(candidate.price).toLocaleString()}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {quoteMessage && <p className="text-xs text-gray-500">{quoteMessage}</p>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">资产名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入资产名称"
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">子文件夹/分组</label>
              <input
                type="text"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="输入或选择分组"
                list="groups-list"
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              />
              <datalist id="groups-list">
                {existingGroups.map((item) => <option key={item} value={item} />)}
              </datalist>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">{isCash ? '现金余额' : '持有份额/股数'}</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  if (error) setError('');
                }}
                step="0.0001"
                min="0"
                placeholder="0"
                className={cn("flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800", error ? "border-red-500" : "")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">{isCash ? '现金单位价格' : '买入单位成本'}</label>
              <input
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                disabled={isCash}
                step="0.0001"
                min="0"
                placeholder={isCash ? '固定为 1' : '可改成真实买入成本'}
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.35fr_1fr_1fr]">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">币种</label>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                onBlur={refreshCashRate}
                maxLength={3}
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              />
            </div>
            <div className="space-y-2">
              <label className="whitespace-nowrap text-sm font-medium leading-none">最新单位价格</label>
              <input
                type="number"
                value={latestPrice}
                onChange={(e) => setLatestPrice(e.target.value)}
                disabled={isCash}
                step="0.0001"
                min="0"
                placeholder={isCash ? '固定为 1' : '自动或手动'}
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">兑人民币</label>
              <input
                type="number"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                step="any"
                min="0"
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">费用</label>
              <input
                type="number"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                step="0.01"
                min="0"
                className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">初始资金来源</label>
            <select
              value={flowClass}
              onChange={(event) => setFlowClass(event.target.value as FlowClass)}
              className="flex h-10 w-full rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-800"
            >
              <option value="opening_balance">仅补录期初持仓</option>
              <option value="external_contribution">使用外部资金买入 / 存入</option>
              <option value="internal_trade">使用现有现金账户结算（后续流水中联动）</option>
            </select>
            <p className="text-xs text-ink-400">期初持仓和内部交易不会被当作新增投资收益。</p>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-md bg-ink-950 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-800 disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus className="mr-2 h-4 w-4" /> 添加持仓
          </button>
        </form>
  );
}
