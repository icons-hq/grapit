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

vi.mock('@/components/reservation/ticket-email-delivery-panel', () => ({
  TicketEmailDeliveryPanel: () => (
    <div>QR 티켓 안내 메일은 공연 24시간 전에 다시 발송됩니다.</div>
  ),
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
    paymentInfo: {
      paymentKey: 'payment-key-1',
      method: 'CARD',
      amount: 77000,
      status: 'DONE',
      paidAt: '2026-05-08T09:05:00.000Z',
      paymentDeadlineAt: '2026-05-08T09:15:00.000Z',
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
      },
    },
    queueAdmission: {
      queueSessionId: 'queue-session-1',
      admissionToken: 'admission-token-1',
      refreshFamilyId: 'refresh-family-1',
      deviceSlotKey: 'device-slot-1',
      admittedAt: '2026-05-08T08:55:00.000Z',
      activeUntilAt: '2026-05-08T09:55:00.000Z',
      reentryGraceUntilAt: '2026-05-08T09:58:00.000Z',
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
    ticketEmailDelivery: {
      email: 'customer@grabit.test',
      isEmailVerified: true,
      isPlaceholderEmail: false,
      canSend: true,
      status: 'ready',
      scheduledAt: '2026-07-17T10:00:00.000Z',
      lastSentAt: null,
    },
    paymentFailureDiagnostic: null,
    ticketItems: [
      {
        id: '00000000-0000-4000-8000-000000000101',
        reservationId: 'reservation-1',
        paymentId: '00000000-0000-4000-8000-000000000201',
        showtimeId: '00000000-0000-4000-8000-000000000301',
        seatId: 'seat-1',
        seatKey: '1F:A-1',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        row: 'A',
        number: '1',
        price: 77000,
        serviceFee: 2000,
        status: 'ACTIVE',
        admissionState: 'NOT_ENTERED',
        enteredAt: null,
        qrCredential: {
          id: '00000000-0000-4000-8000-000000000401',
          token: 'qr-token-1',
          jti: 'qr-jti-1',
          status: 'ACTIVE',
          issuedAt: '2026-05-08T09:06:00.000Z',
          rotatedAt: null,
          revokedAt: null,
        },
        cancellation: null,
      },
    ],
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
    expect(screen.getByText('환불 요청 전달됨')).toBeInTheDocument();
    expect(screen.queryByText('PG 전달됨')).not.toBeInTheDocument();
    expect(screen.getAllByText('환불 처리 중').length).toBeGreaterThan(0);
    expect(screen.getByText('환불 완료')).toBeInTheDocument();
    expect(screen.getAllByText('환불 실패').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        '취소된 좌석은 즉시 재오픈되지 않을 수 있으며, 잠시 후 다시 판매될 수 있습니다',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('예상 입금 시점').length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('고객센터');
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

    expect(screen.getAllByText('환불 실패').length).toBeGreaterThan(0);
    expect(screen.getByText(/환불 처리가 지연되었거나 실패했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/고객센터로 문의/)).toBeInTheDocument();
  });
});
