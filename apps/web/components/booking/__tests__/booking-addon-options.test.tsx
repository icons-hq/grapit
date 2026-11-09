import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { BookingAddonSnapshot } from '@grabit/shared';
import { BookingAddonOptions } from '../booking-addon-options';
import { CheckoutAmountSummary } from '../order-summary';

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));
const seat = { seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', tierName: 'SVIP', row: 'A', number: '1', price: 380000 };
const displayCopy = { ko: { name: 'PHOTO 2:1 추가 구매', description: '유료 옵션' }, en: { name: 'PHOTO 2:1', description: 'Paid option' },
  th: { name: 'PHOTO 2:1', description: 'Paid option' }, 'zh-CN': { name: 'PHOTO 2:1', description: 'Paid option' } };
const snapshot: BookingAddonSnapshot = { showtimeId: 'show', generatedAt: new Date().toISOString(), nextExpiryAt: null,
  addons: [{ id: 'photo', identity: 'photo', displayCopy, price: 150000, capacity: 58, eligibleTierNames: ['SVIP'], active: true, sortOrder: 0, available: 0, held: 58, sold: 0 }], selections: [] };

describe('limited paid options and checkout amounts', () => {
  it('blocks a sold-out option but permits its holder to release it', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BookingAddonOptions snapshot={snapshot} seats={[seat]} pending={false} onChange={onChange} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    const held = { ...snapshot, selections: [{ addonId: 'photo', seatKey: seat.seatKey, price: 150000, displayCopy, expiresAt: new Date().toISOString() }] };
    rerender(<BookingAddonOptions snapshot={held} seats={[seat]} pending={false} onChange={onChange} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith({ addonId: 'photo', seatKey: seat.seatKey, selected: false });
  });
  it('does not offer the SVIP photo option to a VIP seat', () => {
    render(<BookingAddonOptions snapshot={snapshot} seats={[{ ...seat, tierName: 'VIP' }]} pending={false} onChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('선택한 좌석 등급에서는 구매할 수 없습니다.')).toBeInTheDocument();
  });
  it('shows the separate add-on amount and the combined ticket payment', () => {
    render(<CheckoutAmountSummary seats={[seat]} totalPrice={532000} addons={[
      { addonId: 'photo', seatKey: seat.seatKey, price: 150000, displayCopy, expiresAt: new Date().toISOString() },
    ]} />);
    expect(screen.getByText('KRW 380,000')).toBeInTheDocument();
    expect(screen.getByText('KRW 150,000')).toBeInTheDocument();
    expect(screen.getByText('KRW 2,000')).toBeInTheDocument();
    expect(screen.getByText('KRW 532,000')).toBeInTheDocument();
  });
});
