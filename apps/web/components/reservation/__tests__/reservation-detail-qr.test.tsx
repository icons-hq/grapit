import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const rawQrToken = 'raw-token-reservation-detail-should-not-render';
const rawQrJti = 'raw-jti-reservation-detail-should-not-render';
const secondRawQrToken = 'raw-token-reservation-detail-seat-2-should-not-render';
const secondRawQrJti = 'raw-jti-reservation-detail-seat-2-should-not-render';
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
      {
        seatId: 'seat-2',
        seatKey: '1F:A-2',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        row: 'A',
        number: '2',
        price: 77000,
      },
    ],
    totalAmount: 154000,
    createdAt: '2026-05-22T06:00:00.000Z',
    paymentMethod: 'CARD',
    paidAt: '2026-05-22T06:01:00.000Z',
    cancelDeadline: '2099-07-01T14:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    paymentKey: rawPaymentKey,
    paymentInfo: {
      paymentKey: rawPaymentKey,
      method: 'CARD',
      amount: 154000,
      status: 'DONE',
      paidAt: '2026-05-22T06:01:00.000Z',
      paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
      },
    },
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
    ticketEmailDelivery: {
      email: 'customer@grabit.test',
      isEmailVerified: true,
      isPlaceholderEmail: false,
      canSend: true,
      status: 'ready',
      scheduledAt: '2026-07-03T10:00:00.000Z',
      lastSentAt: null,
    },
    ticketItems: [
      {
        id: '00000000-0000-4000-8000-000000000101',
        reservationId: 'reservation-detail-qr',
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
          token: rawQrToken,
          jti: rawQrJti,
          status: 'ACTIVE',
          issuedAt: '2026-05-22T06:02:00.000Z',
          rotatedAt: null,
          revokedAt: null,
        },
        cancellation: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        reservationId: 'reservation-detail-qr',
        paymentId: '00000000-0000-4000-8000-000000000201',
        showtimeId: '00000000-0000-4000-8000-000000000301',
        seatId: 'seat-2',
        seatKey: '1F:A-2',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        row: 'A',
        number: '2',
        price: 77000,
        serviceFee: 2000,
        status: 'ACTIVE',
        admissionState: 'NOT_ENTERED',
        enteredAt: null,
        qrCredential: {
          id: '00000000-0000-4000-8000-000000000402',
          token: secondRawQrToken,
          jti: secondRawQrJti,
          status: 'ACTIVE',
          issuedAt: '2026-05-22T06:02:00.000Z',
          rotatedAt: null,
          revokedAt: null,
        },
        cancellation: null,
      },
    ],
    ...overrides,
  };
}

describe('ReservationDetailView QR ticket card', () => {
  const realDate = Date;

  function setSystemTime(iso: string) {
    vi.setSystemTime(new realDate(iso));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one QR image per active ticket item without visible raw secrets', () => {
    render(
      <ReservationDetailView
        reservation={createReservation()}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    const qrImages = screen.getAllByTestId('qr-ticket-image');
    expect(qrImages).toHaveLength(2);
    expect(qrImages[0]).toHaveAttribute(
      'data-qr-url',
      `http://localhost:3000/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`,
    );
    expect(qrImages[1]).toHaveAttribute(
      'data-qr-url',
      `http://localhost:3000/field/check-in?ticket=${encodeURIComponent(secondRawQrToken)}`,
    );
    expect(qrImages[0]?.querySelector('svg, canvas, img')).not.toBeNull();
    expect(qrImages[1]?.querySelector('svg, canvas, img')).not.toBeNull();

    expect(screen.getAllByText('현장 검표 결과가 최종 입장 기준입니다.')).toHaveLength(2);
    expect(screen.getAllByText('GRP-27-DETAIL-QR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Phase 27 Detail QR Performance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 1번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 2번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('QR 활성').length).toBeGreaterThan(0);
    expect(screen.queryByText('결제를 완료할 수 없음')).not.toBeInTheDocument();

    expect(screen.queryByText(rawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawQrJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(secondRawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(secondRawQrJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/\/field\/check-in/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('티켓 ID')).not.toBeInTheDocument();
    expect(screen.queryByText('발급 시각')).not.toBeInTheDocument();
    expect(screen.queryByText('안내 메일 예약')).not.toBeInTheDocument();
  });

  it('shows pending payment details without QR tickets and exposes a resume payment action', () => {
    const onResumePayment = vi.fn();

    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'PENDING_PAYMENT',
          paidAt: null,
          paymentMethod: null,
          paymentKey: null,
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'CARD',
            amount: 160000,
            status: 'READY',
            paidAt: null,
            paymentDeadlineAt: '2099-05-22T06:08:00.000Z',
          },
          tossOrderId: 'GRP-20260604-7O7YM',
          performanceId: 'performance-girl-rules',
          showtimeId: 'showtime-girl-rules',
          paymentDeadlineAt: '2099-05-22T06:08:00.000Z',
          ticketItems: [],
          qrTicket: {
            token: '',
            jti: '',
            status: 'REVOKED',
            entryStatus: 'NOT_ENTERED',
            enteredAt: null,
            issuedAt: '2026-05-22T06:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
        onResumePayment={onResumePayment}
      />,
    );

    expect(screen.getByText('결제대기')).toBeInTheDocument();
    expect(screen.getByText('결제 전')).toBeInTheDocument();
    expect(screen.getByText('160,000원')).toBeInTheDocument();
    expect(screen.getByText('현재 단계')).toBeInTheDocument();
    expect(screen.getByText('결제 대기 중')).toBeInTheDocument();
    expect(screen.getByText('다음 절차')).toBeInTheDocument();
    expect(screen.getByText('결제 완료 후 예매와 QR 티켓이 확정됩니다.')).toBeInTheDocument();
    expect(screen.getByText('고객이 할 일')).toBeInTheDocument();
    expect(screen.getByText('결제 계속하기를 눌러 결제를 마무리해주세요.')).toBeInTheDocument();
    expect(screen.getByText('예상 소요')).toBeInTheDocument();
    expect(screen.getByText(/결제 마감:/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText('QR 티켓')).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '결제 계속하기' }));
    expect(onResumePayment).toHaveBeenCalledWith(expect.objectContaining({
      reservationNumber: 'GRP-27-DETAIL-QR',
      tossOrderId: 'GRP-20260604-7O7YM',
    }));
  });

  it('shows payment confirmation progress without exposing internal payment terms', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'PENDING_PAYMENT',
          paidAt: null,
          paymentMethod: null,
          paymentKey: null,
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'FOREIGN_EASY_PAY',
            amount: 154000,
            status: 'IN_PROGRESS',
            paidAt: null,
            paymentDeadlineAt: '2099-05-22T06:08:00.000Z',
          },
          paymentDeadlineAt: '2099-05-22T06:08:00.000Z',
          ticketItems: [],
          qrTicket: {
            token: '',
            jti: '',
            status: 'REVOKED',
            entryStatus: 'NOT_ENTERED',
            enteredAt: null,
            issuedAt: '2026-05-22T06:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
        onResumePayment={vi.fn()}
      />,
    );

    expect(screen.getByText('결제 확인 중')).toBeInTheDocument();
    expect(screen.getByText('결제가 확인되면 예매와 QR 티켓이 자동으로 확정됩니다.')).toBeInTheDocument();
    expect(screen.getByText('새 결제를 다시 시도하지 말고 잠시 후 예매 내역을 확인해주세요.')).toBeInTheDocument();
    expect(screen.getByText('보통 수 분 이내')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '결제 계속하기' })).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/FOREIGN_EASY_PAY/)).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
  });

  it('treats approved payment awaiting booking finalization as confirmation progress', () => {
    const onResumePayment = vi.fn();

    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'PENDING_PAYMENT',
          paidAt: null,
          paymentMethod: null,
          paymentKey: null,
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'CARD',
            amount: 154000,
            status: 'DONE',
            paidAt: '2026-05-22T06:01:00.000Z',
            paymentDeadlineAt: '2099-05-22T06:08:00.000Z',
          },
          paymentDeadlineAt: '2099-05-22T06:08:00.000Z',
          ticketItems: [],
          qrTicket: {
            token: '',
            jti: '',
            status: 'REVOKED',
            entryStatus: 'NOT_ENTERED',
            enteredAt: null,
            issuedAt: '2026-05-22T06:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
        onResumePayment={onResumePayment}
      />,
    );

    expect(screen.getByText('결제 확인 중')).toBeInTheDocument();
    expect(screen.getByText('새 결제를 다시 시도하지 말고 잠시 후 예매 내역을 확인해주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '결제 계속하기' })).not.toBeInTheDocument();
    expect(onResumePayment).not.toHaveBeenCalled();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
  });

  it('keeps approved payment in confirmation progress even after the payment deadline', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'PENDING_PAYMENT',
          paidAt: null,
          paymentMethod: null,
          paymentKey: null,
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'CARD',
            amount: 154000,
            status: 'DONE',
            paidAt: '2026-05-22T06:01:00.000Z',
            paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
          },
          paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
          ticketItems: [],
          qrTicket: {
            token: '',
            jti: '',
            status: 'REVOKED',
            entryStatus: 'NOT_ENTERED',
            enteredAt: null,
            issuedAt: '2026-05-22T06:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
        onResumePayment={vi.fn()}
      />,
    );

    expect(screen.getByText('결제 확인 중')).toBeInTheDocument();
    expect(screen.getByText('새 결제를 다시 시도하지 말고 잠시 후 예매 내역을 확인해주세요.')).toBeInTheDocument();
    expect(screen.queryByText('결제를 완료할 수 없음')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '결제 계속하기' })).not.toBeInTheDocument();
  });

  it('guides failed or expired payments to restart seat selection instead of resuming payment', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'FAILED',
          paidAt: null,
          paymentMethod: null,
          paymentKey: null,
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'CARD',
            amount: 154000,
            status: 'EXPIRED',
            paidAt: null,
            paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
          },
          paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
          ticketItems: [],
          qrTicket: {
            token: '',
            jti: '',
            status: 'REVOKED',
            entryStatus: 'NOT_ENTERED',
            enteredAt: null,
            issuedAt: '2026-05-22T06:00:00.000Z',
            emailScheduledAt: null,
            emailedAt: null,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
        onResumePayment={vi.fn()}
      />,
    );

    expect(screen.getByText('결제를 완료할 수 없음')).toBeInTheDocument();
    expect(screen.getByText('좌석을 다시 선택해 새 결제를 시작해주세요.')).toBeInTheDocument();
    expect(screen.getByText('이전 결제 화면은 닫고 공연 페이지에서 다시 예매해주세요.')).toBeInTheDocument();
    expect(screen.getByText('새 결제 시 다시 안내')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '결제 계속하기' })).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
  });

  it('shows cancel and refund processing progress in customer language', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'CANCELLED',
          cancelledAt: '2026-05-23T06:00:00.000Z',
          cancelReason: '일정 변경',
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'CARD',
            amount: 154000,
            status: 'CANCELED',
            paidAt: '2026-05-22T06:01:00.000Z',
            paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
          },
          refundTimeline: {
            currentState: 'PROCESSING_AT_PG',
            requestedAt: '2026-05-23T06:00:00.000Z',
            sentToPgAt: '2026-05-23T06:01:00.000Z',
            processedAtPgAt: '2026-05-23T06:02:00.000Z',
            completedAt: null,
            failedAt: null,
            expectedDepositAt: '2026-05-27T06:00:00.000Z',
            customerServiceCtaVisible: false,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByText('취소/환불 처리 중')).toBeInTheDocument();
    expect(screen.getByText('결제 수단으로 환불이 순차 반영됩니다.')).toBeInTheDocument();
    expect(screen.getByText('추가 요청 없이 진행 현황을 확인해주세요.')).toBeInTheDocument();
    expect(screen.getByText(/예상 입금:/)).toBeInTheDocument();
    expect(screen.queryByText(/PG/)).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
  });

  it('shows completed cancellation progress after refund completion', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'CANCELLED',
          cancelledAt: '2026-05-23T06:00:00.000Z',
          cancelReason: '일정 변경',
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'CARD',
            amount: 154000,
            status: 'CANCELED',
            paidAt: '2026-05-22T06:01:00.000Z',
            paymentDeadlineAt: '2026-05-22T06:08:00.000Z',
          },
          refundTimeline: {
            currentState: 'COMPLETED',
            requestedAt: '2026-05-23T06:00:00.000Z',
            sentToPgAt: '2026-05-23T06:01:00.000Z',
            processedAtPgAt: '2026-05-23T06:02:00.000Z',
            completedAt: '2026-05-23T06:03:00.000Z',
            failedAt: null,
            expectedDepositAt: null,
            customerServiceCtaVisible: false,
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByText('취소 완료')).toBeInTheDocument();
    expect(screen.getAllByText('환불 반영이 완료되었습니다.').length).toBeGreaterThan(0);
    expect(screen.getByText('예매 상세에서 취소 정보를 확인할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByText('완료됨')).toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
  });

  it('keeps the QR visible and shows entry completion after check-in', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          ticketItems: [
            {
              ...createReservation().ticketItems[0]!,
              admissionState: 'ENTERED',
              enteredAt: '2026-07-04T09:05:00.000Z',
            },
            createReservation().ticketItems[1]!,
          ],
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getAllByTestId('qr-ticket-image')).toHaveLength(2);
    expect(screen.getAllByText('QR 활성').length).toBeGreaterThan(0);
    const enteredCard = screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000101');
    const pendingCard = screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000102');
    expect(within(enteredCard).getByText('입장 완료')).toBeInTheDocument();
    expect(within(enteredCard).getByText('입장 처리가 완료되었습니다.')).toBeInTheDocument();
    expect(within(pendingCard).getByText('입장 전')).toBeInTheDocument();
    expect(within(pendingCard).queryByText('입장 완료')).not.toBeInTheDocument();
    expect(
      screen.getByText('QR 티켓은 현장 혜택 확인 등 추가 처리에 계속 사용할 수 있습니다.'),
    ).toBeInTheDocument();
  });

  it('shows cancelled ticket items as unavailable instead of pending QR issuance', () => {
    const reservation = createReservation();
    render(
      <ReservationDetailView
        reservation={createReservation({
          ticketItems: [
            reservation.ticketItems[0]!,
            {
              ...reservation.ticketItems[1]!,
              status: 'CANCELLED',
              qrCredential: null,
              cancellation: {
                cancelledAt: '2026-05-23T06:00:00.000Z',
                cancelReason: '부분 취소',
                cancellationFee: 0,
                serviceFeeRefund: 2000,
                refundableAmount: 79000,
                refundStatus: 'REQUESTED',
                reopenState: 'AVAILABLE',
                reopenAt: null,
              },
            },
          ],
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getAllByTestId('qr-ticket-image')).toHaveLength(1);
    const cancelledCard = screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000102');
    expect(within(cancelledCard).getAllByText('취소됨').length).toBeGreaterThan(0);
    expect(within(cancelledCard).getByText('취소된 티켓입니다.')).toBeInTheDocument();
    expect(within(cancelledCard).getByText('이 좌석의 QR 티켓은 사용할 수 없습니다.')).toBeInTheDocument();
    expect(
      within(cancelledCard).queryByText('잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.'),
    ).not.toBeInTheDocument();
  });

  it('shows cancellation-pending ticket items as unavailable without ticket-level cancel actions', () => {
    vi.useFakeTimers();
    setSystemTime('2026-06-01T00:00:00.000Z');

    const reservation = createReservation();
    render(
      <ReservationDetailView
        reservation={createReservation({
          ticketItems: [
            reservation.ticketItems[0]!,
            {
              ...reservation.ticketItems[1]!,
              status: 'CANCELLATION_PENDING',
              qrCredential: null,
              cancellation: {
                cancelledAt: '2026-05-23T06:00:00.000Z',
                cancelReason: '부분 취소',
                cancellationFee: 0,
                serviceFeeRefund: 2000,
                refundableAmount: 79000,
                refundStatus: 'PROCESSING_AT_PG',
                reopenState: 'HELD_CANCELLED',
                reopenAt: null,
              },
            },
          ],
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getAllByTestId('qr-ticket-image')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '이 티켓 취소' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '예매 취소' })).toBeInTheDocument();
    const pendingCard = screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000102');
    expect(within(pendingCard).getAllByText('취소 확인 중').length).toBeGreaterThan(0);
    expect(within(pendingCard).getByText('취소 확인 중입니다.')).toBeInTheDocument();
    expect(
      within(pendingCard).getByText('부분취소 결과를 확인 중입니다. 처리 완료 전까지 QR 티켓은 사용할 수 없습니다.'),
    ).toBeInTheDocument();
    expect(within(pendingCard).queryByRole('button', { name: '이 티켓 취소' })).not.toBeInTheDocument();
  });

  it('keeps all cancelled seat-level ticket cards visible after cancellation', () => {
    const reservation = createReservation();
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'CANCELLED',
          cancelledAt: '2026-05-23T06:00:00.000Z',
          cancelReason: '전 좌석 개별 취소',
          ticketItems: reservation.ticketItems.map((ticketItem) => ({
            ...ticketItem,
            status: 'CANCELLED',
            qrCredential: null,
            cancellation: {
              cancelledAt: '2026-05-23T06:00:00.000Z',
              cancelReason: '개별 취소',
              cancellationFee: 0,
              serviceFeeRefund: 2000,
              refundableAmount: 79000,
              refundStatus: 'COMPLETED',
              reopenState: 'AVAILABLE',
              reopenAt: null,
            },
          })),
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.queryAllByTestId('qr-ticket-image')).toHaveLength(0);
    expect(screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000101')).toBeInTheDocument();
    expect(screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000102')).toBeInTheDocument();
    expect(screen.getAllByText('취소된 티켓입니다.')).toHaveLength(2);
    expect(screen.getByText('좌석별 티켓 상태를 확인할 수 있습니다. 취소된 티켓의 QR은 표시되지 않습니다.')).toBeInTheDocument();
  });

  it('shows whole-reservation cancellation for active seat-level reservations', () => {
    render(
      <ReservationDetailView
        reservation={createReservation()}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByRole('button', { name: '예매 취소' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 티켓 취소' })).not.toBeInTheDocument();
    expect(screen.queryByText('티켓을 취소하시겠습니까?')).not.toBeInTheDocument();
  });

  it('shows whole-reservation cancellation for legacy reservations without ticket items', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({ ticketItems: [] })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByRole('button', { name: '예매 취소' })).toBeInTheDocument();
  });

  it('shows whole-reservation cancellation for legacy fallback ticket items', () => {
    const reservation = createReservation();

    render(
      <ReservationDetailView
        reservation={createReservation({
          ticketItems: reservation.ticketItems.map((ticketItem) => ({
            ...ticketItem,
            qrCredential: null,
            isLegacyFallback: true,
          })),
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByRole('button', { name: '예매 취소' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 티켓 취소' })).not.toBeInTheDocument();
  });

  it('does not expose ticket-item cancellation on active not-entered ticket cards', () => {
    const reservation = createReservation();
    render(
      <ReservationDetailView
        reservation={createReservation({
          ticketItems: [
            reservation.ticketItems[0]!,
            {
              ...reservation.ticketItems[1]!,
              admissionState: 'ENTERED',
              enteredAt: '2026-07-04T09:05:00.000Z',
            },
          ],
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.queryByRole('button', { name: '이 티켓 취소' })).not.toBeInTheDocument();
    expect(screen.queryByText('티켓을 취소하시겠습니까?')).not.toBeInTheDocument();
    expect(screen.getAllByText('VIP A열 1번').length).toBeGreaterThan(0);
  });

  it('keeps ticket-item cancellation hidden on the prior Seoul date after the legacy cancel deadline hour', () => {
    vi.useFakeTimers();
    setSystemTime('2026-07-03T14:30:00.000Z');

    render(
      <ReservationDetailView
        reservation={createReservation({
          showDateTime: '2026-07-04T10:00:00.000Z',
          cancelDeadline: '2026-07-03T10:00:00.000Z',
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.queryByRole('button', { name: '이 티켓 취소' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '예매 취소' })).toBeInTheDocument();
  });
});
