import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { BookingComplete } from '@/components/booking/booking-complete';
import type { BenefitEntitlement, ReservationDetail } from '@grabit/shared';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/components/reservation/ticket-email-delivery-panel', () => ({
  TicketEmailDeliveryPanel: () => (
    <div>QR 티켓 안내 메일은 공연 24시간 전에 다시 발송됩니다.</div>
  ),
}));

const rawQrToken = 'raw-token-booking-complete-should-not-render';
const rawQrJti = 'raw-jti-booking-complete-should-not-render';
const secondRawQrToken = 'raw-token-booking-complete-seat-2-should-not-render';
const secondRawQrJti = 'raw-jti-booking-complete-seat-2-should-not-render';
const rawPaymentKey = 'raw-payment-key-booking-complete-should-not-render';
const firstTicketItemId = '00000000-0000-4000-8000-000000000101';
const secondTicketItemId = '00000000-0000-4000-8000-000000000102';
const showtimeId = '00000000-0000-4000-8000-000000000301';
const benefitRunId = '00000000-0000-4000-8000-000000000701';
const longBenefitName =
  '공연장 현장 수령 전용 초장문 다국어 혜택명 줄바꿈 검증용 패키지 혜택';

function benefitDisplayCopy(name: string) {
  return {
    ko: { name, description: `${name} 설명` },
    en: { name, description: `${name} description` },
    'zh-CN': { name, description: `${name} 说明` },
    th: { name, description: `${name} description` },
  };
}

function includedBenefit(
  overrides: Partial<BenefitEntitlement> = {},
): BenefitEntitlement {
  return {
    id: '00000000-0000-4000-8000-000000000801',
    ticketItemId: firstTicketItemId,
    showtimeId,
    runId: null,
    source: 'configuration',
    benefitIdentity: 'benefit_included_poster',
    kind: 'included',
    displayCopy: benefitDisplayCopy(longBenefitName),
    state: 'active',
    assignedAt: '2026-05-22T06:02:00.000Z',
    redeemedAt: null,
    attachedToTicket: true,
    ...overrides,
  } as BenefitEntitlement;
}

function limitedBenefit(
  overrides: Partial<BenefitEntitlement> = {},
): BenefitEntitlement {
  return {
    id: '00000000-0000-4000-8000-000000000802',
    ticketItemId: firstTicketItemId,
    showtimeId,
    runId: benefitRunId,
    source: 'live_run',
    benefitIdentity: 'benefit_limited_meet',
    kind: 'limited',
    displayCopy: benefitDisplayCopy('6:1 이벤트 참여권'),
    state: 'redeemed',
    assignedAt: '2026-05-22T06:03:00.000Z',
    redeemedAt: '2026-07-04T08:30:00.000Z',
    runMode: 'live',
    attachedToTicket: true,
    ...overrides,
  } as BenefitEntitlement;
}

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
    cancelDeadline: '2026-07-01T14:00:00.000Z',
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
    ticketEmailDelivery: {
      email: 'customer@grabit.test',
      isEmailVerified: true,
      isPlaceholderEmail: false,
      canSend: true,
      status: 'ready',
      scheduledAt: '2026-07-03T10:00:00.000Z',
      lastSentAt: null,
    },
    paymentFailureDiagnostic: null,
    ticketItems: [
      {
        id: firstTicketItemId,
        reservationId: 'booking-complete-reservation',
        paymentId: '00000000-0000-4000-8000-000000000201',
        showtimeId,
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
        benefitEntitlements: [],
        cancellation: null,
      },
      {
        id: secondTicketItemId,
        reservationId: 'booking-complete-reservation',
        paymentId: '00000000-0000-4000-8000-000000000201',
        showtimeId,
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
        benefitEntitlements: [],
        cancellation: null,
      },
    ],
    ...overrides,
  };
}

describe('BookingComplete QR ticket card', () => {
  it('renders one QR image per active ticket item without visible raw secrets', () => {
    render(<BookingComplete booking={createReservation()} />);

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
    expect(screen.getAllByText('GRP-27-BOOKING-QR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Phase 27 Booking QR Performance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 1번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VIP A열 2번').length).toBeGreaterThan(0);
    expect(screen.getAllByText('QR 활성').length).toBeGreaterThan(0);
    const firstQrCard = screen.getByTestId(`qr-ticket-card-${firstTicketItemId}`);
    expect(within(firstQrCard).getByTestId(`qr-ticket-seat-label-${firstTicketItemId}`)).toHaveClass(
      'break-words',
      'text-2xl',
      'font-bold',
    );
    expect(within(firstQrCard).getByTestId(`qr-ticket-seat-detail-${firstTicketItemId}`)).toHaveClass(
      'text-lg',
      'font-bold',
    );
    expect(within(firstQrCard).getByText('QR 활성')).toHaveClass('px-3', 'py-1', 'text-sm');

    expect(screen.queryByText(rawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawQrJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(secondRawQrToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(secondRawQrJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawPaymentKey, { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/\/field\/check-in/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('티켓 ID')).not.toBeInTheDocument();
  });

  it('shows buyer benefit entitlements under each ticket item QR card without actions or outbound copy', () => {
    const reservation = createReservation();
    render(
      <BookingComplete
        booking={createReservation({
          ticketItems: [
            {
              ...reservation.ticketItems[0]!,
              benefitEntitlements: [
                includedBenefit(),
                limitedBenefit(),
              ],
            },
            {
              ...reservation.ticketItems[1]!,
              status: 'CANCELLED',
              qrCredential: null,
              benefitEntitlements: [
                includedBenefit({
                  id: '00000000-0000-4000-8000-000000000803',
                  ticketItemId: secondTicketItemId,
                  displayCopy: benefitDisplayCopy('취소 좌석 포함 혜택'),
                  state: 'active',
                }),
                limitedBenefit({
                  id: '00000000-0000-4000-8000-000000000804',
                  ticketItemId: secondTicketItemId,
                  displayCopy: benefitDisplayCopy('취소 전 사용 혜택'),
                  state: 'redeemed',
                  redeemedAt: '2026-07-04T08:45:00.000Z',
                }),
              ],
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
      />,
    );

    const activeCard = screen.getByTestId(`qr-ticket-card-${firstTicketItemId}`);
    const activeBenefits = within(activeCard).getByTestId(`ticket-benefits-${firstTicketItemId}`);
    expect(within(activeBenefits).getByText('혜택')).toBeInTheDocument();
    const longName = within(activeBenefits).getByText(longBenefitName);
    expect(longName).toHaveClass('break-words');
    expect(within(activeBenefits).getByText('포함')).toBeInTheDocument();
    expect(within(activeBenefits).getByText('한정')).toBeInTheDocument();
    expect(within(activeBenefits).getByText('사용 가능')).toBeInTheDocument();
    expect(within(activeBenefits).getByText('사용됨')).toBeInTheDocument();
    expect(within(activeBenefits).getByText(/^사용 일시:/)).toBeInTheDocument();
    expect(within(activeBenefits).queryAllByRole('button')).toHaveLength(0);
    expect(within(activeBenefits).queryByText(/메일|문자|알림|발송/)).not.toBeInTheDocument();

    const cancelledCard = screen.getByTestId(`qr-ticket-card-${secondTicketItemId}`);
    const cancelledBenefits = within(cancelledCard).getByTestId(`ticket-benefits-${secondTicketItemId}`);
    expect(within(cancelledBenefits).getByText('취소 좌석 포함 혜택')).toBeInTheDocument();
    expect(within(cancelledBenefits).getByText('비활성')).toBeInTheDocument();
    expect(within(cancelledBenefits).getByText('취소 전 사용 혜택')).toBeInTheDocument();
    expect(within(cancelledBenefits).getByText('사용됨')).toBeInTheDocument();
    expect(within(cancelledBenefits).getByText(/^사용 일시:/)).toBeInTheDocument();
    expect(within(cancelledBenefits).queryByText('사용 가능')).not.toBeInTheDocument();
    expect(within(cancelledBenefits).queryAllByRole('button')).toHaveLength(0);
  });

  it('shows cancelled ticket items as unavailable instead of pending QR issuance', () => {
    const reservation = createReservation();
    render(
      <BookingComplete
        booking={createReservation({
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

  it('shows cancellation-pending ticket items as confirmation in progress without QR access', () => {
    const reservation = createReservation();
    render(
      <BookingComplete
        booking={createReservation({
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
      />,
    );

    expect(screen.getAllByTestId('qr-ticket-image')).toHaveLength(1);
    const pendingCard = screen.getByTestId('qr-ticket-card-00000000-0000-4000-8000-000000000102');
    expect(within(pendingCard).getAllByText('취소 확인 중').length).toBeGreaterThan(0);
    expect(within(pendingCard).getByText('취소 확인 중입니다.')).toBeInTheDocument();
    expect(
      within(pendingCard).getByText('부분취소 결과를 확인 중입니다. 처리 완료 전까지 QR 티켓은 사용할 수 없습니다.'),
    ).toBeInTheDocument();
    expect(
      within(pendingCard).queryByText('잠시 후 새로고침하거나 마이페이지에서 다시 확인하세요.'),
    ).not.toBeInTheDocument();
  });
});
