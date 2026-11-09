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
    expect(onChange).toHaveBeenCalledWith({ addonId: 'photo', seatKey: seat.seatKey, unitIndex: 1, selected: false });
  });
  it('does not offer the SVIP photo option to a VIP seat', () => {
    render(<BookingAddonOptions snapshot={snapshot} seats={[{ ...seat, tierName: 'VIP' }]} pending={false} onChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('선택한 좌석 등급에서는 구매할 수 없습니다.')).toBeInTheDocument();
  });
  it('keeps a paused option visible and lets its current holder deselect it', () => {
    const onChange = vi.fn();
    const paused = { ...snapshot, addons: snapshot.addons.map((addon) => ({ ...addon, active: false })),
      selections: [{ addonId: 'photo', seatKey: seat.seatKey, price: 150000, displayCopy, expiresAt: new Date().toISOString() }] };
    const { rerender } = render(<BookingAddonOptions snapshot={paused} seats={[seat]} pending={false} onChange={onChange} />);
    expect(screen.getByText('판매가 중단된 옵션입니다. 선택을 해제한 뒤 계속해주세요.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith({ addonId: 'photo', seatKey: seat.seatKey, unitIndex: 1, selected: false });
    rerender(<BookingAddonOptions snapshot={{ ...paused, selections: [] }} seats={[seat]} pending={false} onChange={onChange} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
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


describe('per-ticket addon quantities', () => {
  it('offers four photos and eight high-touch units for four eligible tickets', () => {
    const seats = [1, 2, 3, 4].map((number) => ({ ...seat, seatId: `A-${number}`, seatKey: `1F:A-${number}`, number: String(number) }));
    const photo = { ...snapshot.addons[0]!, maxPerTicket: 1, available: 58 };
    const highTouch = { ...photo, id: 'high-touch', maxPerTicket: 2, price: 80000, displayCopy: { ...displayCopy, ko: { name: '하이터치 추가 구매', description: '' } } };
    const onChange = vi.fn();
    render(<BookingAddonOptions snapshot={{ ...snapshot, addons: [photo, highTouch] }} seats={seats} pending={false} onChange={onChange} />);
    expect(screen.getAllByRole('checkbox', { name: /PHOTO/ })).toHaveLength(4);
    expect(screen.getAllByRole('checkbox', { name: /하이터치/ })).toHaveLength(8);
    expect(screen.getByText('티켓 1매당 최대 1개 · 선택 좌석 기준 최대 4개')).toBeInTheDocument();
    expect(screen.getByText('티켓 1매당 최대 2개 · 선택 좌석 기준 최대 8개')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '하이터치 추가 구매 · 1층 A-4 · 2/2' }));
    expect(onChange).toHaveBeenCalledWith({ addonId: 'high-touch', seatKey: '1F:A-4', unitIndex: 2, selected: true });
  });

  it('counts only eligible seats for photo but all tiers for high-touch', () => {
    const seats = [seat, { ...seat, seatKey: '1F:B-1', row: 'B', tierName: 'VIP' }];
    const photo = { ...snapshot.addons[0]!, maxPerTicket: 1, available: 58 };
    const highTouch = { ...photo, id: 'high-touch', maxPerTicket: 2, eligibleTierNames: ['SVIP', 'VIP'] };
    render(<BookingAddonOptions snapshot={{ ...snapshot, addons: [photo, highTouch] }} seats={seats} pending={false} onChange={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByText('티켓 1매당 최대 1개 · 선택 좌석 기준 최대 1개')).toBeInTheDocument();
    expect(screen.getByText('티켓 1매당 최대 2개 · 선택 좌석 기준 최대 4개')).toBeInTheDocument();
  });

  it('shows an independent pending state and allows another unit to be selected', () => {
    const addon = { ...snapshot.addons[0]!, maxPerTicket: 2, available: 10 };
    render(<BookingAddonOptions snapshot={{ ...snapshot, addons: [addon] }} seats={[seat]} pending={false}
      pendingSelections={[{ addonId: 'photo', seatKey: seat.seatKey, unitIndex: 1, selected: true }]} onChange={vi.fn()} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeChecked();
    expect(boxes[0]).toBeDisabled();
    expect(boxes[0]).toHaveAttribute('aria-busy', 'true');
    expect(boxes[1]).not.toBeChecked();
    expect(boxes[1]).toBeEnabled();
    expect(screen.getByText('선점 중…')).toBeInTheDocument();
    expect(screen.queryByText('선점 완료')).not.toBeInTheDocument();
  });
});
