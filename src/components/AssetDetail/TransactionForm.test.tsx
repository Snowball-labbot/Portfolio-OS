// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssetItem, AssetType } from '@/types';
import { TransactionForm } from './TransactionForm';

const state = vi.hoisted(() => ({ assets: [] as AssetItem[], addTransaction: vi.fn() }));
vi.mock('@/store/useAssetStore', () => ({ useAssetStore: () => state }));

const stock = {
  id: 'stock', type: AssetType.STOCK, name: 'Example', group: 'IBKR', currency: 'USD',
  quantity: 10, current_price: 100, exchange_rate_to_cny: 7.2,
} as AssetItem;
const cash = { ...stock, id: 'cash', type: AssetType.CASH, name: 'HKD cash', currency: 'HKD', quantity: 10000, exchange_rate_to_cny: 0.9 };

describe('TransactionForm', () => {
  beforeEach(() => {
    state.assets = [stock, cash];
    state.addTransaction.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('preserves edited inputs when live asset quotes refresh', () => {
    const { rerender } = render(<TransactionForm asset={stock} />);
    fireEvent.change(screen.getByLabelText('交易份额'), { target: { value: '2' } });
    rerender(<TransactionForm asset={{ ...stock, current_price: 110 }} />);
    expect((screen.getByLabelText('交易份额') as HTMLInputElement).value).toBe('2');
  });

  it('sends the preview FX and one idempotent request', async () => {
    render(<TransactionForm asset={stock} />);
    fireEvent.change(screen.getByLabelText('交易份额'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    fireEvent.click(screen.getByRole('button', { name: /保存|保存中/ }));
    await waitFor(() => expect(state.addTransaction).toHaveBeenCalledTimes(1));
    const payload = state.addTransaction.mock.calls[0][1];
    expect(payload.cash_exchange_rate_to_cny).toBe(0.9);
    expect(payload.exchange_rate_to_cny).toBe(7.2);
    expect(payload.client_request_id).toBeTruthy();
    expect(new Date(payload.trade_date).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
