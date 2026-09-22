import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { History, MinusCircle, PlusCircle } from 'lucide-react';
import { useAssetStore } from '@/store/useAssetStore';

const ITEMS_PER_PAGE = 10;

interface AssetSpecificHistoryProps {
  assetId: string;
}

const transactionLabels: Record<string, string> = {
  buy: '\u4e70\u5165/\u8ffd\u52a0',
  sell: '\u5356\u51fa/\u51cf\u5c11',
  adjustment: '\u4ef7\u683c/\u624b\u52a8\u8c03\u6574',
  cash_in: '\u73b0\u91d1\u6d41\u5165',
  cash_out: '\u73b0\u91d1\u6d41\u51fa',
  transfer_in: '转入',
  transfer_out: '转出',
  income: '分红/利息',
};

export function AssetSpecificHistory({ assetId }: AssetSpecificHistoryProps) {
  const { assets, transactionsByAsset, loadTransactions } = useAssetStore();
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    loadTransactions(assetId).catch((error) => console.error('Load transactions failed:', error));
  }, [assetId, loadTransactions]);

  const assetHistory = transactionsByAsset[assetId] || [];
  const totalPages = Math.ceil(assetHistory.length / ITEMS_PER_PAGE);
  const currentData = assetHistory.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  if (assetHistory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 py-10 text-gray-400">
        <History size={32} className="mb-2 opacity-20" />
        <p className="text-sm">{'\u8be5\u8d44\u4ea7\u6682\u65e0\u5386\u53f2\u8bb0\u5f55'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {currentData.map((item) => {
          const signed = ['sell', 'cash_out', 'transfer_out'].includes(item.type) ? -1 : 1;
          const gross = Number(item.quantity) * Number(item.unit_price);
          const value = item.type === 'sell'
            ? gross - Number(item.fee)
            : ['cash_out', 'transfer_out'].includes(item.type)
              ? gross + Number(item.fee)
              : gross;
          const relatedAsset = assets.find((asset) => asset.id === item.related_holding_id);
          const realizedGain = Number(item.realized_gain_native || 0);
          return (
            <div key={item.id} className="group flex items-center justify-between rounded-lg border border-gray-100 bg-white p-3 transition-shadow hover:shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`rounded-full p-1.5 ${signed > 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  {signed > 0 ? <PlusCircle size={16} /> : <MinusCircle size={16} />}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{transactionLabels[item.type] || item.type}</p>
                  <p className="text-xs text-gray-500">{dayjs(item.trade_date).format('YYYY-MM-DD HH:mm:ss')}</p>
                  {item.note && <p className="mt-0.5 text-xs text-gray-400">{item.note}</p>}
                  {relatedAsset && <p className="mt-0.5 text-xs text-brand-600">关联：{relatedAsset.name}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className={`font-mono text-sm font-bold ${signed > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {signed > 0 ? '+' : '-'}{item.currency} {Math.abs(value).toLocaleString()}
                </p>
                <p className="text-xs text-gray-500">{Number(item.quantity).toLocaleString()} x {Number(item.unit_price).toLocaleString()}</p>
                {['sell', 'income'].includes(item.type) && (
                  <p className={`mt-1 text-xs font-semibold ${realizedGain >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    已实现 {realizedGain >= 0 ? '+' : ''}{item.currency} {realizedGain.toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <button
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={currentPage === 1}
            className="rounded border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            {'\u4e0a\u4e00\u9875'}
          </button>
          <span className="self-center text-xs text-gray-500">{currentPage} / {totalPages}</span>
          <button
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={currentPage === totalPages}
            className="rounded border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            {'\u4e0b\u4e00\u9875'}
          </button>
        </div>
      )}
    </div>
  );
}
