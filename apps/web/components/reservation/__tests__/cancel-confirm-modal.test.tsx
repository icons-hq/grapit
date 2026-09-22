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
