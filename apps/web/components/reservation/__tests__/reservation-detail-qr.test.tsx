import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { ReservationDetailView } from '@/components/reservation/reservation-detail';
import type { ReservationDetail } from '@grabit/shared';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: vi.fn(),
  }),
}));

const rawQrToken = 'raw-token-reservation-detail-should-not-render';
const rawQrJti = 'raw-jti-reservation-detail-should-not-render';
const rawPaymentKey = 'raw-payment-key-reservation-detail-should-not-render';

function createReservation(
  overrides: Partial<ReservationDetail> = {},
): ReservationDetail {
  return {
    id: 'reservation-detail-qr',
    reservationNumber: 'GRP-27-DETAIL-QR',
    status: 'CONFIRMED',
    performanceTitle: 'Phase 27 Detail QR Performance',
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
    cancelDeadline: '2099-07-01T14:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    paymentKey: rawPaymentKey,
    queueAdmission: {
      queueSessionId: 'queue-reservation-detail-qr',
      admissionToken: 'admission-reservation-detail-qr',
      refreshFamilyId: 'family-reservation-detail-qr',
      deviceSlotKey: 'device-reservation-detail-qr',
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

describe('ReservationDetailView QR ticket card', () => {
  it('renders a real QR image for active buyer tickets without visible raw secrets', () => {
    render(
      <ReservationDetailView
        reservation={createReservation()}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    const qrImage = screen.getByTestId('qr-ticket-image');
    expect(qrImage).toBeInTheDocument();
    expect(qrImage).toHaveAttribute(
      'data-qr-url',
      `https://heygrabit.com/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`,
    );
    expect(qrImage.querySelector('svg, canvas, img')).not.toBeNull();

    expect(screen.getByText('현장 검표 결과가 최종 입장 기준입니다.')).toBeInTheDocument();
    expect(screen.getAllByText('GRP-27-DETAIL-QR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Phase 27 Detail QR Performance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 1번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('QR 활성').length).toBeGreaterThan(0);

    expect(screen.queryByText(rawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawQrJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/https:\/\/heygrabit\.com\/field\/check-in/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('티켓 ID')).not.toBeInTheDocument();
    expect(screen.queryByText('발급 시각')).not.toBeInTheDocument();
    expect(screen.queryByText('안내 메일 예약')).not.toBeInTheDocument();
  });

  it('keeps the QR visible and shows entry completion after check-in', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          qrTicket: {
            token: rawQrToken,
            jti: rawQrJti,
            status: 'ACTIVE',
            entryStatus: 'ENTERED',
            enteredAt: '2026-07-04T09:05:00.000Z',
            issuedAt: '2026-05-22T06:02:00.000Z',
            emailScheduledAt: '2026-07-03T10:00:00.000Z',
            emailedAt: null,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByTestId('qr-ticket-image')).toBeInTheDocument();
    expect(screen.getAllByText('QR 활성').length).toBeGreaterThan(0);
    expect(screen.getByText('입장 완료')).toBeInTheDocument();
    expect(screen.getByText('입장 처리가 완료되었습니다.')).toBeInTheDocument();
    expect(
      screen.getByText('QR 티켓은 현장 혜택 확인 등 추가 처리에 계속 사용할 수 있습니다.'),
    ).toBeInTheDocument();
  });
});
