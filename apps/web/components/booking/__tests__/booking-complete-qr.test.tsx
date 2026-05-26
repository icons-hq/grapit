import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { BookingComplete } from '@/components/booking/booking-complete';
import type { ReservationDetail } from '@grabit/shared';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const rawQrToken = 'raw-token-booking-complete-should-not-render';
const rawQrJti = 'raw-jti-booking-complete-should-not-render';
const rawPaymentKey = 'raw-payment-key-booking-complete-should-not-render';

function createReservation(
  overrides: Partial<ReservationDetail> = {},
): ReservationDetail {
  return {
    id: 'booking-complete-reservation',
    reservationNumber: 'GRP-27-BOOKING-QR',
    status: 'CONFIRMED',
    performanceTitle: 'Phase 27 Booking QR Performance',
    posterUrl: null,
    showDateTime: '2026-07-04T10:00:00.000Z',
    venue: 'Phase 27 Hall',
    seats: [
      {
        seatId: 'seat-1',
        seatKey: '1F:A-1',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        row: 'A',
        number: '1',
        price: 77000,
      },
    ],
    totalAmount: 77000,
    createdAt: '2026-05-22T06:00:00.000Z',
    paymentMethod: 'CARD',
    paidAt: '2026-05-22T06:01:00.000Z',
    cancelDeadline: '2026-07-01T14:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    paymentKey: rawPaymentKey,
    queueAdmission: {
      queueSessionId: 'queue-booking-complete-qr',
      admissionToken: 'admission-booking-complete-qr',
      refreshFamilyId: 'family-booking-complete-qr',
      deviceSlotKey: 'device-booking-complete-qr',
      admittedAt: '2026-05-22T05:55:00.000Z',
      activeUntilAt: '2026-05-22T06:10:00.000Z',
      reentryGraceUntilAt: '2026-05-22T06:12:00.000Z',
    },
    paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
    bookingPolicy: {
      maxTicketsPerOrder: 1,
      cancellationChangePolicy: 'CANCEL_ONLY',
      sameGradeChangeEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
    },
    refundTimeline: {
      currentState: 'COMPLETED',
      requestedAt: '2026-05-22T06:01:00.000Z',
      customerServiceCtaVisible: false,
    },
    cancelledSeatHold: null,
    qrTicket: {
      token: rawQrToken,
      jti: rawQrJti,
      status: 'ACTIVE',
      issuedAt: '2026-05-22T06:02:00.000Z',
      emailScheduledAt: '2026-07-03T10:00:00.000Z',
      emailedAt: null,
    },
    ...overrides,
  };
}

describe('BookingComplete QR ticket card', () => {
  it('renders a real QR image for active buyer tickets without visible raw secrets', () => {
    render(<BookingComplete booking={createReservation()} />);

    const qrImage = screen.getByTestId('qr-ticket-image');
    expect(qrImage).toBeInTheDocument();
    expect(qrImage).toHaveAttribute(
      'data-qr-url',
      `https://heygrabit.com/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`,
    );
    expect(qrImage.querySelector('svg, canvas, img')).not.toBeNull();

    expect(screen.getByText('현장 검표 결과가 최종 입장 기준입니다.')).toBeInTheDocument();
    expect(screen.getAllByText('GRP-27-BOOKING-QR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Phase 27 Booking QR Performance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 1번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('QR 활성').length).toBeGreaterThan(0);

    expect(screen.queryByText(rawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawQrJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/https:\/\/heygrabit\.com\/field\/check-in/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('티켓 ID')).not.toBeInTheDocument();
  });
});
