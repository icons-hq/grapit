import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PerformanceWithDetails } from '@grabit/shared';
import { TicketBookingPanel } from '../ticket-booking-panel';
import { getKstCalendarKey } from '@/lib/booking-datetime';

const clock = vi.hoisted(() => ({ now: Date.parse('2099-01-01T17:59:00+09:00') }));
vi.mock('@/hooks/use-showtime-sales-clock', () => ({ useShowtimeSalesClock: () => clock.now }));
vi.mock('@/components/booking/date-picker', () => ({
  DatePicker: ({ availableDates, onSelect }: { availableDates: Date[]; onSelect: (date: Date) => void }) => (
    <div>{availableDates.map(date => <button key={date.toISOString()} type="button" onClick={() => onSelect(date)}>
      {getKstCalendarKey(date.toISOString())}
    </button>)}</div>
  ),
}));

const performance = {
  id: 'performance', showtimes: [
    { id: 'first', performanceId: 'performance', dateTime: '2099-01-01T18:00:00+09:00' },
    { id: 'second', performanceId: 'performance', dateTime: '2099-01-02T18:00:00+09:00' },
  ], priceTiers: [{ id: 'vip', performanceId: 'performance', tierName: 'VIP', price: 50000, sortOrder: 0 }],
} as PerformanceWithDetails;

describe('TicketBookingPanel mobile schedule recovery', () => {
  beforeEach(() => { clock.now = Date.parse('2099-01-01T17:59:00+09:00'); });

  it('lets the buyer open the calendar after the selected day sells no more showtimes', async () => {
    const user = userEvent.setup();
    const props = { performance, locale: 'ko' as const, available: true, verificationRequired: false, disabledMessage: null };
    const view = render(<TicketBookingPanel {...props} />);
    await user.click(within(view.container.querySelector('aside')!).getByRole('button', { name: '2099-01-01' }));
    clock.now = Date.parse('2099-01-01T18:00:00+09:00');
    view.rerender(<TicketBookingPanel {...props} />);
    const mobile = within(view.container.querySelector('.ticket-mobile-booking') as HTMLElement);
    const trigger = mobile.getByRole('button');
    expect(trigger).toBeEnabled();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '2099-01-02' }));
    expect(within(dialog).getByRole('link', { name: '예매하기' })).toHaveAttribute('href', '/booking/performance?showtimeId=second');
  });
});
