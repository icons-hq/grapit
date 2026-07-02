import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReservationDetailView } from '@/components/reservation/reservation-detail';
import { apiClient } from '@/lib/api-client';
import type { BenefitEntitlement, ReservationDetail } from '@grabit/shared';

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

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const rawQrToken = 'raw-token-reservation-detail-should-not-render';
const rawQrJti = 'raw-jti-reservation-detail-should-not-render';
const secondRawQrToken = 'raw-token-reservation-detail-seat-2-should-not-render';
const secondRawQrJti = 'raw-jti-reservation-detail-seat-2-should-not-render';
const rawPaymentKey = 'raw-payment-key-reservation-detail-should-not-render';
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

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function render(ui: ReactNode) {
  return rtlRender(
    <QueryClientProvider client={createQueryClient()}>
      {ui}
    </QueryClientProvider>,
  );
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
        tierColor: '#6C3CE0',
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
        tierColor: '#6C3CE0',
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
    paymentFailureDiagnostic: null,
    ticketItems: [
      {
        id: firstTicketItemId,
        reservationId: 'reservation-detail-qr',
        paymentId: '00000000-0000-4000-8000-000000000201',
        showtimeId,
        seatId: 'seat-1',
        seatKey: '1F:A-1',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        tierColor: '#6C3CE0',
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
        reservationId: 'reservation-detail-qr',
        paymentId: '00000000-0000-4000-8000-000000000201',
        showtimeId,
        seatId: 'seat-2',
        seatKey: '1F:A-2',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        tierColor: '#6C3CE0',
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

function createRefundPreviewResponse(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: 'reservation-detail-qr',
    reservationNumber: 'GRP-27-DETAIL-QR',
    paymentKey: rawPaymentKey,
    refundableAmount: 154000,
    canRequestRefund: true,
    cancelledSeatHoldWindowMinutes: { min: 1, max: 10 },
    refundTimeline: null,
    cancellationQuote: {
      originalPaymentAmount: 154000,
      ticketSubtotal: 154000,
      ticketServiceFeeTotal: 0,
      cancellationFeeTotal: 0,
      serviceFeeRefundTotal: 0,
      refundableAmount: 154000,
      policyCodes: ['WITHIN_7_DAYS_AFTER_BOOKING'],
      items: [
        {
          ticketItemId: firstTicketItemId,
          ticketPrice: 77000,
          serviceFee: 0,
          cancellationFee: 0,
          serviceFeeRefund: 0,
          refundableAmount: 77000,
          policyCode: 'WITHIN_7_DAYS_AFTER_BOOKING',
        },
        {
          ticketItemId: secondTicketItemId,
          ticketPrice: 77000,
          serviceFee: 0,
          cancellationFee: 0,
          serviceFeeRefund: 0,
          refundableAmount: 77000,
          policyCode: 'WITHIN_7_DAYS_AFTER_BOOKING',
        },
      ],
    },
    ...overrides,
  };
}

describe('ReservationDetailView QR ticket card', () => {
  const realDate = Date;

  function setSystemTime(iso: string) {
    vi.setSystemTime(new realDate(iso));
  }

  beforeEach(() => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      createRefundPreviewResponse(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
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
    const firstQrCard = screen.getByTestId(`qr-ticket-card-${firstTicketItemId}`);
    expect(within(firstQrCard).getByTestId(`qr-ticket-seat-label-${firstTicketItemId}`)).toHaveClass(
      'break-words',
      'text-2xl',
      'font-bold',
    );
    expect(within(firstQrCard).getByTestId(`qr-ticket-seat-label-highlight-${firstTicketItemId}`))
      .toHaveStyle({ backgroundColor: '#6C3CE0' });
    expect(within(firstQrCard).getByText('좌석 정보').nextElementSibling).toHaveClass(
      'text-lg',
      'font-bold',
    );
    expect(within(firstQrCard).getByTestId(`qr-ticket-seat-detail-highlight-${firstTicketItemId}`))
      .toHaveStyle({ backgroundColor: '#6C3CE0' });
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
    expect(screen.queryByText('발급 시각')).not.toBeInTheDocument();
    expect(screen.queryByText('안내 메일 예약')).not.toBeInTheDocument();
  });

  it('shows buyer benefit entitlements under each ticket item QR card without actions or outbound copy', () => {
    const reservation = createReservation();
    render(
      <ReservationDetailView
        reservation={createReservation({
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
        onCancel={vi.fn()}
        isCancelling={false}
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

  it('shows localized payment failure diagnostic guidance for failed reservations', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({
          status: 'FAILED',
          paymentInfo: {
            paymentKey: rawPaymentKey,
            method: 'CARD',
            amount: 154000,
            status: 'ABORTED',
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
          paymentFailureDiagnostic: {
            kind: 'payment_failed',
            code: 'NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT',
            message: '할부가 지원되지 않는 카드 또는 가맹점 입니다.',
            source: 'payment_webhook_events',
            recordedAt: '2026-05-22T06:09:00.000Z',
            providerCheckStatus: 'confirmed',
            providerCheckedAt: '2026-05-22T06:10:00.000Z',
            providerCheckMessage: 'ABORTED',
          },
        })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(screen.getByText('실패 사유')).toBeInTheDocument();
    expect(screen.getByText('할부 결제를 사용할 수 없는 카드이거나 가맹점입니다.')).toBeInTheDocument();
    expect(screen.getByText('일시불로 다시 시도하거나 다른 카드로 결제해주세요.')).toBeInTheDocument();
    expect(screen.queryByText('결제사 응답: 할부가 지원되지 않는 카드 또는 가맹점 입니다.'))
      .not.toBeInTheDocument();
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

  it('does not fetch the cancellation quote before opening the cancel modal', () => {
    render(
      <ReservationDetailView
        reservation={createReservation({ totalAmount: 158000 })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    expect(apiClient.get).not.toHaveBeenCalled();
    expect(screen.getByText('취소 진행 시 계산')).toBeInTheDocument();
    expect(screen.queryByText('취소수수료')).not.toBeInTheDocument();
  });

  it('shows the per-ticket cancellation quote in the whole-reservation cancel modal', async () => {
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      reservationId: 'reservation-detail-qr',
      reservationNumber: 'GRP-27-DETAIL-QR',
      paymentKey: rawPaymentKey,
      refundableAmount: 107800,
      canRequestRefund: true,
      cancelledSeatHoldWindowMinutes: { min: 1, max: 10 },
      refundTimeline: null,
      cancellationQuote: {
        originalPaymentAmount: 158000,
        ticketSubtotal: 154000,
        ticketServiceFeeTotal: 4000,
        cancellationFeeTotal: 46200,
        serviceFeeRefundTotal: 0,
        refundableAmount: 107800,
        policyCodes: ['SHOW_DAY_2_TO_1'],
        items: [
          {
            ticketItemId: firstTicketItemId,
            ticketPrice: 77000,
            serviceFee: 2000,
            cancellationFee: 23100,
            serviceFeeRefund: 0,
            refundableAmount: 53900,
            policyCode: 'SHOW_DAY_2_TO_1',
          },
          {
            ticketItemId: secondTicketItemId,
            ticketPrice: 77000,
            serviceFee: 2000,
            cancellationFee: 23100,
            serviceFeeRefund: 0,
            refundableAmount: 53900,
            policyCode: 'SHOW_DAY_2_TO_1',
          },
        ],
      },
    });

    render(
      <ReservationDetailView
        reservation={createReservation({ totalAmount: 158000 })}
        onCancel={vi.fn()}
        isCancelling={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '예매 취소' }));

    expect(await screen.findByText('취소수수료')).toBeInTheDocument();
    expect(screen.getAllByText('환불 예정 금액').length).toBeGreaterThan(0);
    expect(screen.getByText('₩107,800')).toBeInTheDocument();
    expect(screen.getByText('총 결제금액')).toBeInTheDocument();
    expect(screen.getByText('₩158,000')).toBeInTheDocument();
    expect(screen.getByText('티켓 금액')).toBeInTheDocument();
    expect(screen.getByText('₩154,000')).toBeInTheDocument();
    expect(screen.getByText('-₩46,200')).toBeInTheDocument();
    expect(screen.getByText('서비스수수료 환불')).toBeInTheDocument();
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
