import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReservationDetailView } from '@/components/reservation/reservation-detail';
import type { ReservationDetail } from '@grabit/shared';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: vi.fn(),
  }),
}));

function createReservation(
  overrides: Partial<ReservationDetail> = {},
): ReservationDetail {
  return {
    id: 'reservation-1',
    reservationNumber: 'GRABIT-24001',
    status: 'CONFIRMED',
    performanceTitle: 'Girl Rules Fanmeet',
    posterUrl: null,
    showDateTime: '2026-07-18T10:00:00.000Z',
    venue: '동해문화예술관 대극장',
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
    createdAt: '2026-05-08T09:00:00.000Z',
    paymentMethod: '카드',
    paidAt: '2026-05-08T09:05:00.000Z',
    cancelDeadline: '2099-07-15T14:00:00.000Z',
    cancelledAt: '2026-05-08T10:00:00.000Z',
    cancelReason: '일정 변경',
    paymentKey: 'payment-key-1',
    queueAdmission: {
      queueId: 'queue-1',
      queueSessionId: 'queue-session-1',
      admissionToken: 'admission-token-1',
      issuedAt: '2026-05-08T08:55:00.000Z',
      expiresAt: '2026-05-08T09:55:00.000Z',
      graceExpiresAt: '2026-05-08T09:58:00.000Z',
    },
    paymentDeadlineAt: '2026-05-08T09:15:00.000Z',
    bookingPolicy: {
      maxTicketsPerOrder: 1,
      cancellationChangePolicy: 'CANCEL_ONLY',
      sameGradeChangeEnabled: false,
    },
    refundTimeline: {
      currentState: 'PROCESSING_AT_PG',
      requestedAt: '2026-05-08T10:00:00.000Z',
      sentToPgAt: '2026-05-08T10:01:00.000Z',
      processedAtPgAt: '2026-05-08T10:03:00.000Z',
      completedAt: null,
      failedAt: null,
      expectedDepositAt: '2026-05-11T03:00:00.000Z',
      customerServiceCtaVisible: true,
    },
    cancelledSeatHold: {
      status: 'HELD',
      releaseJobId: 'release-job-1',
      releaseAt: '2026-05-08T10:08:00.000Z',
      releaseWindowMinutes: {
        min: 1,
        max: 10,
      },
      manualOverrideAllowed: true,
    },
    qrTicket: {
      token: 'qr-token-1',
      jti: 'qr-jti-1',
      status: 'ACTIVE',
      issuedAt: '2026-05-08T09:06:00.000Z',
      emailScheduledAt: '2026-07-17T10:00:00.000Z',
      emailedAt: null,
    },
    ...overrides,
  };
}

describe('ReservationDetail refund timeline', () => {
  it('shows visible refund states and delay guidance while PG processing continues', () => {
    render(
      <ReservationDetailView
        reservation={createReservation()}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByText('환불 요청됨')).toBeInTheDocument();
    expect(screen.getByText('PG 전달됨')).toBeInTheDocument();
    expect(screen.getByText('환불 처리 중')).toBeInTheDocument();
    expect(screen.getByText('환불 완료')).toBeInTheDocument();
    expect(screen.getByText('환불 실패')).toBeInTheDocument();
    expect(
      screen.getByText(
        '취소된 좌석은 즉시 재오픈되지 않을 수 있으며, 잠시 후 다시 판매될 수 있습니다',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/예상 입금 시점/)).toBeInTheDocument();
    expect(screen.getByText(/고객센터/)).toBeInTheDocument();
  });

  it('keeps refund failure visible with follow-up guidance', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'CANCELLED',
          refundTimeline: {
            currentState: 'FAILED',
            requestedAt: '2026-05-08T10:00:00.000Z',
            sentToPgAt: '2026-05-08T10:01:00.000Z',
            processedAtPgAt: null,
            completedAt: null,
            failedAt: '2026-05-08T10:20:00.000Z',
            expectedDepositAt: null,
            customerServiceCtaVisible: true,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByText('환불 실패')).toBeInTheDocument();
    expect(screen.getByText(/환불 처리가 지연되었거나 실패했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/고객센터로 문의/)).toBeInTheDocument();
  });
});
