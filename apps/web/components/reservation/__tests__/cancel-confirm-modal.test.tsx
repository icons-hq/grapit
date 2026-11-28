import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CancelConfirmModal } from '../cancel-confirm-modal';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';

const copy = getVisibleCopy('ko').reservation.cancel;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterAll(() => { HTMLElement.prototype.scrollIntoView = scrollIntoView; });
const quote = { originalPaymentAmount: 104000, ticketSubtotal: 50000, ticketServiceFeeTotal: 2000,
  cancellationFeeTotal: 0, serviceFeeRefundTotal: 2000, refundableAmount: 52000,
  policyCodes: ['SAME_DAY_BEFORE_MIDNIGHT' as const], items: [] };

describe('Cancellation confirmation', () => {
  it('shows the combined refund and requires a new confirmation after a quote changes', async () => {
    const displayCopy = { name: '하이터치', description: '추가 구매' };
    const summary = { version: 'a'.repeat(64), refundableAmount: 152000, cancellationFeeTotal: 0,
      charges: [{ reservationNumber: 'ADD-1', paidAmount: 100000, refundableAmount: 100000,
        providerRefund: { currency: 'KRW' as const, amountMinor: 100000, amountDecimal: '100000' },
        products: [{ quantity: 2, displayCopy: { ko: displayCopy, en: displayCopy, th: displayCopy, 'zh-CN': displayCopy } }] }] };
    const props = { open: true, onOpenChange: vi.fn(), refundAmount: 52000, cancellationQuote: quote,
      paymentMethod: '카드', onConfirm: vi.fn(), isLoading: false };
    const view = render(<CancelConfirmModal {...props} buyerSummary={summary} />);
    expect(screen.getByText(/하이터치 × 2/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: copy.reasons[0] }));
    fireEvent.click(screen.getByRole('button', { name: copy.finalCheck }));
    expect(screen.getByRole('button', { name: /152,000.*예매 전체 취소/ })).toBeTruthy();
    view.rerender(<CancelConfirmModal {...props} buyerSummary={{ ...summary, version: 'b'.repeat(64) }} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(props.onConfirm).not.toHaveBeenCalled();
    view.unmount();
  });

  it('closes only after the request finishes and prevents a duplicate submission', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onOpenChange = vi.fn();
    render(<CancelConfirmModal open onOpenChange={onOpenChange} refundAmount={52000}
      cancellationQuote={quote} paymentMethod="카드" onConfirm={onConfirm} isLoading={false} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: copy.reasons[0] }));
    fireEvent.click(screen.getByRole('button', { name: copy.finalCheck }));
    const confirm = screen.getByRole('button', { name: copy.confirmCta });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
