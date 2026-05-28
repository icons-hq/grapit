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
      `https://heygrabit.com/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`,
    );
    expect(qrImages[1]).toHaveAttribute(
      'data-qr-url',
      `https://heygrabit.com/field/check-in?ticket=${encodeURIComponent(secondRawQrToken)}`,
    );
    expect(qrImages[0]?.querySelector('svg, canvas, img')).not.toBeNull();
    expect(qrImages[1]?.querySelector('svg, canvas, img')).not.toBeNull();

    expect(screen.getAllByText('현장 검표 결과가 최종 입장 기준입니다.')).toHaveLength(2);
    expect(screen.getAllByText('GRP-27-DETAIL-QR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Phase 27 Detail QR Performance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 1번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 2번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('QR 활성').length).toBeGreaterThan(0);

    expect(screen.queryByText(rawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawQrJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(secondRawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(secondRawQrJti, { exact: true })).not.toBeInTheDocument();
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

  it('shows cancellation-pending ticket items as unavailable and keeps their cancel action disabled', () => {
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
        onCancelTicketItem={vi.fn()}
        isCancellingTicketItem={false}
      />,
    );

    expect(screen.getAllByTestId('qr-ticket-image')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '이 티켓 취소' })).toHaveLength(1);
    const pendingCard = screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000102');
    expect(within(pendingCard).getAllByText('취소 확인 중').length).toBeGreaterThan(0);
    expect(within(pendingCard).getByText('취소 확인 중입니다.')).toBeInTheDocument();
    expect(
      within(pendingCard).getByText('부분취소 결과를 확인 중입니다. 처리 완료 전까지 QR 티켓은 사용할 수 없습니다.'),
    ).toBeInTheDocument();
    expect(within(pendingCard).queryByRole('button', { name: '이 티켓 취소' })).not.toBeInTheDocument();
  });

  it('keeps all cancelled seat-level ticket cards visible after full per-ticket cancellation', () => {
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

  it('opens ticket-item cancellation dialog only from active not-entered ticket cards', () => {
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
        onCancelTicketItem={vi.fn()}
        isCancellingTicketItem={false}
      />,
    );

    const cancelButtons = screen.getAllByRole('button', { name: '이 티켓 취소' });
    expect(cancelButtons).toHaveLength(1);

    fireEvent.click(cancelButtons[0]!);

    expect(screen.getByText('티켓을 취소하시겠습니까?')).toBeInTheDocument();
    expect(screen.getByText('선택한 좌석 1장만 취소됩니다. 취소 수수료와 예매 수수료 환불 여부는 NOL Ticket 기준으로 티켓별 적용됩니다.')).toBeInTheDocument();
    expect(screen.getAllByText('VIP A열 1번').length).toBeGreaterThan(0);
  });

  it('keeps per-ticket cancellation available on the prior Seoul date after the legacy cancel deadline hour', () => {
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
        onCancelTicketItem={vi.fn()}
        isCancellingTicketItem={false}
      />,
    );

    expect(screen.getAllByRole('button', { name: '이 티켓 취소' })).toHaveLength(2);
  });
});
