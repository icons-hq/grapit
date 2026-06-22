import { z } from 'zod';

import { benefitEntitlementSchema } from './benefit.schema';
import { consentCaptureItemSchema } from './consent.schema';
import { ticketItemSchema } from './ticket-item.schema';

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

const dateOnly = (label: string) =>
  z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}은 YYYY-MM-DD 형식이어야 합니다`)
    .refine(isValidDateOnly, `${label}이 유효하지 않습니다`);

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const seatSelectionBaseSchema = z.object({
  seatId: z.string().min(1, '좌석 ID가 필요합니다'),
  tierName: z.string().min(1, '등급명이 필요합니다'),
  tierColor: z.string().min(1, '등급 색상은 비어 있을 수 없습니다').optional(),
  price: z.number().int().min(0, '가격은 0 이상이어야 합니다'),
  row: z.string().min(1, '열 정보가 필요합니다'),
  number: z.string().min(1, '좌석 번호가 필요합니다'),
});

export const floorAwareSeatSelectionSchema = seatSelectionBaseSchema.extend({
  floorKey: z.string().min(1, '층 키가 필요합니다'),
  floorLabel: z.string().min(1, '층 라벨이 필요합니다'),
  seatKey: z.string().min(1, '층 포함 좌석 키가 필요합니다'),
});

export const queueAdmissionSchema = z.object({
  queueSessionId: z.string().min(1, '대기열 세션 ID가 필요합니다'),
  admissionToken: z.string().min(1, '대기열 admission token이 필요합니다'),
  refreshFamilyId: z.string().min(1, 'refresh family ID가 필요합니다'),
  deviceSlotKey: z.string().min(1, 'device slot key가 필요합니다'),
  admittedAt: isoDatetime('입장 승인 시각'),
  activeUntilAt: isoDatetime('입장 활성 만료 시각'),
  reentryGraceUntilAt: isoDatetime('재입장 grace 시각'),
});

export const bookingPolicySchema = z.object({
  maxTicketsPerOrder: z
    .number()
    .int()
    .positive('최대 예매 매수는 1 이상이어야 합니다'),
  cancellationChangePolicy: z.enum([
    'CANCEL_ONLY',
    'SAME_GRADE_CHANGE',
    'MANUAL_REOPEN_ONLY',
  ]),
  sameGradeChangeEnabled: z.boolean(),
  paymentWindowMinutes: z
    .number()
    .int()
    .positive('결제 가능 시간은 1분 이상이어야 합니다')
    .optional(),
  seatHoldMinutes: z
    .number()
    .int()
    .positive('좌석 hold 시간은 1분 이상이어야 합니다')
    .optional(),
});

export const overseasPaymentConsentSchema = z.object({
  required: z.boolean(),
  agreed: z.boolean(),
  agreementVersion: z.string().min(1, '해외 결제 동의 버전이 필요합니다'),
  agreedAt: isoDatetime('해외 결제 동의 시각').nullable().optional(),
  fxRateDisclaimer: z.string().min(1).nullable().optional(),
  refundDelayNotice: z.string().min(1).nullable().optional(),
});

function isPositiveProviderDecimalString(value: string): boolean {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return false;
  }

  const [whole, fraction = ''] = value.split('.');
  const amountMinor =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return amountMinor > 0n;
}

const providerDecimalStringSchema = z
  .string()
  .refine(
    isPositiveProviderDecimalString,
    'provider charge amount는 positive decimal string이어야 합니다',
  );

export const providerChargeQuoteSchema = z.object({
  currency: z.literal('USD'),
  amountMinor: z.number().int().positive('provider charge amount는 0보다 커야 합니다'),
  amountDecimal: providerDecimalStringSchema,
  rate: z.string().regex(/^\d+(\.\d+)?$/, 'provider charge rate는 decimal string이어야 합니다'),
  quotedAt: isoDatetime('provider charge quote 시각'),
});

export const paymentMethodSchema = z.object({
  method: z.enum([
    'CARD',
    'VIRTUAL_ACCOUNT',
    'TRANSFER',
    'MOBILE_PHONE',
    'FOREIGN_EASY_PAY',
    'SIMPLE_PAY',
  ]),
  provider: z.enum([
    'CARD',
    'TOSS_PAY',
    'NAVER_PAY',
    'KAKAOPAY',
    'ALIPAY_PLUS',
    'TRUEMONEY',
    'PAYPAL',
  ]),
  currency: z.string().min(1).optional(),
  pendingUrlRequired: z.boolean().optional(),
  overseasPaymentConsent: overseasPaymentConsentSchema.optional(),
});

export const refundTimelineSchema = z.object({
  currentState: z.enum([
    'REQUESTED',
    'SENT_TO_PG',
    'PROCESSING_AT_PG',
    'COMPLETED',
    'FAILED',
  ]),
  requestedAt: isoDatetime('환불 요청 시각'),
  sentToPgAt: isoDatetime('PG 전송 시각').nullable().optional(),
  processedAtPgAt: isoDatetime('PG 처리 시각').nullable().optional(),
  completedAt: isoDatetime('환불 완료 시각').nullable().optional(),
  failedAt: isoDatetime('환불 실패 시각').nullable().optional(),
  expectedDepositAt: isoDatetime('환불 예정 입금 시각').nullable().optional(),
  customerServiceCtaVisible: z.boolean(),
});

export const cancelledSeatHoldSchema = z.object({
  status: z.enum(['HELD', 'RELEASED', 'MANUAL_OPENED']),
  releaseJobId: z.string().min(1).nullable().optional(),
  releaseAt: isoDatetime('좌석 재오픈 시각').nullable().optional(),
  releaseWindowMinutes: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
  manualOverrideAllowed: z.boolean(),
});

export const qrTicketSchema = z.object({
  id: z.string().uuid().optional(),
  ticketItemId: z.string().uuid().nullable().optional(),
  seatIdentity: z.object({
    seatId: z.string().min(1),
    seatKey: z.string().min(1),
    floorKey: z.string().min(1),
    floorLabel: z.string().min(1),
    row: z.string().min(1),
    number: z.string().min(1),
    tierName: z.string().min(1),
  }).optional(),
  token: z.string(),
  jti: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED', 'USED', 'EXPIRED']),
  entryStatus: z.enum(['NOT_ENTERED', 'ENTERED']).optional(),
  enteredAt: isoDatetime('입장 처리 시각').nullable().optional(),
  issuedAt: isoDatetime('QR 발급 시각'),
  emailScheduledAt: isoDatetime('QR 이메일 예약 시각').nullable().optional(),
  emailedAt: isoDatetime('QR 이메일 발송 시각').nullable().optional(),
}).superRefine((ticket, ctx) => {
  if (ticket.status !== 'ACTIVE') {
    return;
  }
  if (ticket.token.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      type: 'string',
      inclusive: true,
      message: 'QR token이 필요합니다',
      path: ['token'],
    });
  }
  if (ticket.jti.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      type: 'string',
      inclusive: true,
      message: 'QR token JTI가 필요합니다',
      path: ['jti'],
    });
  }
});

export const ticketEmailDeliveryStatusSchema = z.enum([
  'verification_required',
  'ready',
  'sent',
]);

export const ticketEmailDeliverySchema = z.object({
  email: z.string().email(),
  isEmailVerified: z.boolean(),
  isPlaceholderEmail: z.boolean(),
  canSend: z.boolean(),
  status: ticketEmailDeliveryStatusSchema,
  scheduledAt: isoDatetime('QR 이메일 예약 시각').nullable(),
  lastSentAt: isoDatetime('QR 이메일 최종 발송 시각').nullable(),
});

export const prepareReservationSchema = z.object({
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
  showtimeId: z.string().uuid('유효한 회차 ID가 필요합니다'),
  seats: z
    .array(floorAwareSeatSelectionSchema)
    .min(1, '최소 1개의 좌석을 선택해야 합니다'),
  amount: z.number().int().positive('결제 금액은 0보다 커야 합니다'),
  consentItems: z.preprocess(
    (value) => value ?? [],
    z
      .array(consentCaptureItemSchema.extend({ sourceFlow: z.literal('booking') }))
      .min(1, '예매 동의 항목이 필요합니다'),
  ),
  queueAdmission: queueAdmissionSchema,
  paymentDeadlineAt: isoDatetime('결제 마감 시각'),
  bookingPolicy: bookingPolicySchema,
  paymentMethod: paymentMethodSchema,
});

export type PrepareReservationInput = z.infer<typeof prepareReservationSchema>;

export const prepareReservationResponseSchema = z.object({
  reservationId: z.string().uuid('유효한 reservation ID가 필요합니다'),
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
  queueAdmission: queueAdmissionSchema,
  paymentDeadlineAt: isoDatetime('결제 마감 시각'),
  bookingPolicy: bookingPolicySchema,
  paymentMethod: paymentMethodSchema,
  providerChargeQuote: providerChargeQuoteSchema.optional(),
  checkoutEnabled: z.boolean().optional(),
  disabledReason: z.string().min(1).optional(),
});

export type PrepareReservationResponseInput = z.infer<
  typeof prepareReservationResponseSchema
>;

const confirmPaymentBaseSchema = z.object({
  paymentKey: z.string().min(1, '결제 키가 필요합니다'),
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
});

export const confirmPaymentSchema = z.union([
  confirmPaymentBaseSchema.extend({
    provider: z.literal('PAYPAL'),
    providerChargeAmount: providerDecimalStringSchema,
    amount: z.never().optional(),
  }),
  confirmPaymentBaseSchema.extend({
    provider: z.literal('OVERSEAS_CARD'),
    providerChargeAmount: providerDecimalStringSchema,
    amount: z.never().optional(),
  }),
  confirmPaymentBaseSchema.extend({
    provider: z.literal('OVERSEAS_CARD'),
    amount: z.number().int().positive('결제 금액은 0보다 커야 합니다'),
    providerChargeAmount: z.never().optional(),
  }),
  confirmPaymentBaseSchema.extend({
    amount: z.number().int().positive('결제 금액은 0보다 커야 합니다'),
    provider: z.never().optional(),
    providerChargeAmount: z.never().optional(),
  }),
]);

export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

export const cancelReservationSchema = z.object({
  reason: z
    .string()
    .min(1, '취소 사유를 입력해주세요')
    .max(200, '취소 사유는 200자 이내로 입력해주세요'),
});

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

export const cancelTicketItemSchema = cancelReservationSchema;

export type CancelTicketItemInput = z.infer<typeof cancelTicketItemSchema>;

export const adminRefundSchema = z.object({
  reason: z
    .string()
    .min(1, '환불 사유를 입력해주세요')
    .max(200, '환불 사유는 200자 이내로 입력해주세요'),
});

export type AdminRefundInput = z.infer<typeof adminRefundSchema>;

export const paymentInfoSchema = z.object({
  paymentKey: z.string().min(1, '결제 키가 필요합니다'),
  method: z.string().min(1, '결제 수단이 필요합니다'),
  amount: z.number().int().min(0, '결제 금액은 0 이상이어야 합니다'),
  status: z.enum([
    'READY',
    'IN_PROGRESS',
    'DONE',
    'CANCELED',
    'ABORTED',
    'EXPIRED',
  ]),
  paidAt: isoDatetime('결제 완료 시각').nullable(),
  paymentDeadlineAt: isoDatetime('결제 마감 시각').nullable().optional(),
  paymentMethod: paymentMethodSchema.optional(),
});

export const adminBookingFunnelStatusSchema = z.enum([
  'SOLD',
  'PAYMENT_PENDING',
  'PAYMENT_PROCESSING',
  'PAYMENT_FAILED',
  'CANCEL_PROCESSING',
  'CANCELLED',
  'PARTIAL_CANCELLED',
]);

export const paymentFailureBucketSchema = z.enum([
  'local_deadline_expired',
  'provider_expired',
  'provider_aborted',
  'buyer_cancelled_before_confirm',
  'unreconciled_provider_expired',
  'compensated_cancel',
  'other',
]);

const paymentStatusSchema = z.enum([
  'READY',
  'IN_PROGRESS',
  'DONE',
  'CANCELED',
  'ABORTED',
  'EXPIRED',
]);

export const paymentFailureDiagnosticSchema = z.object({
  kind: z.string().min(1, '진단 종류가 필요합니다'),
  code: z.string().min(1, '진단 코드가 필요합니다'),
  message: z.string().min(1, '진단 메시지가 필요합니다'),
  source: z.string().min(1, '진단 출처가 필요합니다'),
  recordedAt: isoDatetime('진단 기록 시각'),
  providerCheckStatus: z.string().min(1, 'provider 확인 상태가 필요합니다'),
  providerCheckedAt: isoDatetime('provider 확인 시각').nullable(),
  providerCheckMessage: z.string().min(1).nullable(),
});

export const paymentMethodAttributionSchema = z.object({
  label: z.string().min(1, '결제 수단 라벨이 필요합니다'),
  method: z.string().min(1).nullable(),
  provider: z.string().min(1).nullable(),
  currency: z.string().min(1).nullable(),
  source: z.string().min(1, '결제 수단 출처가 필요합니다'),
});

const adminBookingQueryPageSchema = z
  .union([
    z.string().regex(/^[1-9]\d*$/, 'page는 양의 정수여야 합니다'),
    z.number().int('page는 정수여야 합니다').positive('page는 양의 정수여야 합니다'),
  ])
  .transform((value) => Number(value))
  .default(1);

export const adminBookingListQuerySchema = z.object({
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED']).optional(),
  reservationStatus: z
    .enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED'])
    .optional(),
  performanceId: z.string().uuid('유효한 공연 ID가 필요합니다').optional(),
  showtimeId: z.string().uuid('유효한 회차 ID가 필요합니다').optional(),
  funnelStatus: adminBookingFunnelStatusSchema.optional(),
  paymentStatus: paymentStatusSchema.optional(),
  paymentMethod: z.enum([
    'CARD',
    'VIRTUAL_ACCOUNT',
    'TRANSFER',
    'MOBILE_PHONE',
    'FOREIGN_EASY_PAY',
    'SIMPLE_PAY',
  ]).optional(),
  audienceRegion: z.enum(['domestic', 'overseas']).optional(),
  seatTier: z.string().trim().min(1, '좌석 등급이 필요합니다').optional(),
  floorKey: z.string().trim().min(1, '층 키가 필요합니다').optional(),
  seatQuery: z.string().trim().min(1, '좌석 검색어가 필요합니다').optional(),
  dateFrom: dateOnly('조회 시작일').optional(),
  dateTo: dateOnly('조회 종료일').optional(),
  search: z.string().trim().min(1).optional(),
  page: adminBookingQueryPageSchema,
}).superRefine((value, ctx) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateTo'],
      message: '조회 종료일은 시작일 이후여야 합니다',
    });
  }
});

export type AdminBookingListQueryInput = z.infer<
  typeof adminBookingListQuerySchema
>;

export const ticketStatusCountsSchema = z.object({
  ACTIVE: z.number().int().min(0),
  CANCELLATION_PENDING: z.number().int().min(0),
  CANCELLED: z.number().int().min(0),
  EXPIRED: z.number().int().min(0),
});

export const bookingStatsSchema = z.object({
  totalBookings: z.number().int().min(0),
  totalRevenue: z.number().int().min(0),
  cancelRate: z.number().int().min(0),
  soldCount: z.number().int().min(0),
  pendingPaymentCount: z.number().int().min(0),
  paymentProcessingCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  expiredPaymentCount: z.number().int().min(0),
  abortedPaymentCount: z.number().int().min(0),
  localDeadlineExpiredCount: z.number().int().min(0),
  providerExpiredCount: z.number().int().min(0),
  providerAbortedCount: z.number().int().min(0),
  buyerCancelledBeforeConfirmCount: z.number().int().min(0),
  unreconciledProviderExpiredCount: z.number().int().min(0),
  compensatedCancelCount: z.number().int().min(0),
  otherPaymentFailureCount: z.number().int().min(0),
  cancelProcessingCount: z.number().int().min(0),
  cancelledCount: z.number().int().min(0),
  partialCancelledCount: z.number().int().min(0),
  completedRevenue: z.number().int().min(0),
}).superRefine((stats, ctx) => {
  if (stats.totalRevenue !== stats.completedRevenue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'totalRevenue는 completedRevenue와 같아야 합니다',
      path: ['totalRevenue'],
    });
  }
});

export const adminBookingTierStatsSchema = z.object({
  tierName: z.string().min(1, '좌석 등급명이 필요합니다'),
  price: z.number().int().min(0),
  soldSeats: z.number().int().min(0),
  activeRevenue: z.number().int().min(0),
  averageTicketAmount: z.number().int().min(0),
  cancelProcessingSeats: z.number().int().min(0),
  cancelledSeats: z.number().int().min(0),
  enteredSeats: z.number().int().min(0),
  totalSeats: z.number().int().min(0).nullable(),
  remainingSeats: z.number().int().min(0).nullable(),
  sellThroughRate: z.number().int().min(0).max(100).nullable(),
});

export const reservationListItemSchema = z.object({
  id: z.string().uuid('유효한 reservation ID가 필요합니다'),
  reservationNumber: z.string().min(1, '예매 번호가 필요합니다'),
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED']),
  performanceTitle: z.string().min(1, '공연명이 필요합니다'),
  posterUrl: z.string().url().nullable(),
  showDateTime: isoDatetime('공연 시각'),
  venue: z.string().min(1, '공연장이 필요합니다'),
  seats: z
    .array(floorAwareSeatSelectionSchema)
    .min(1, '좌석 정보가 최소 1개 필요합니다'),
  totalAmount: z.number().int().min(0, '총 결제 금액은 0 이상이어야 합니다'),
  createdAt: isoDatetime('생성 시각'),
});

export const reservationDetailSchema = reservationListItemSchema.extend({
  performanceId: z.string().uuid('유효한 performance ID가 필요합니다').optional(),
  showtimeId: z.string().uuid('유효한 showtime ID가 필요합니다').optional(),
  tossOrderId: z.string().min(1, 'Toss 주문 ID가 필요합니다').nullable().optional(),
  paymentMethod: z.string().min(1, '결제 수단 라벨이 필요합니다').nullable(),
  paidAt: isoDatetime('결제 완료 시각').nullable(),
  cancelDeadline: isoDatetime('취소 마감 시각'),
  cancelledAt: isoDatetime('취소 시각').nullable(),
  cancelReason: z.string().max(200).nullable(),
  paymentKey: z.string().min(1, '결제 키가 필요합니다').nullable(),
  paymentInfo: paymentInfoSchema.nullable(),
  queueAdmission: queueAdmissionSchema,
  paymentDeadlineAt: isoDatetime('결제 마감 시각'),
  bookingPolicy: bookingPolicySchema,
  refundTimeline: refundTimelineSchema,
  cancelledSeatHold: cancelledSeatHoldSchema.nullable(),
  qrTicket: qrTicketSchema,
  ticketEmailDelivery: ticketEmailDeliverySchema,
  paymentFailureDiagnostic: paymentFailureDiagnosticSchema.nullable().default(null),
  ticketItems: z.array(ticketItemSchema),
});

export const adminBookingListItemSchema = z.object({
  id: z.string().uuid('유효한 reservation ID가 필요합니다'),
  reservationNumber: z.string().min(1, '예매 번호가 필요합니다'),
  tossOrderId: z.string().min(1, 'Toss 주문 ID가 필요합니다').nullable(),
  userName: z.string().min(1, '예매자명이 필요합니다'),
  userEmail: z.string().email('예매자 이메일 형식이 올바르지 않습니다'),
  userCountry: z.string().min(1, '예매자 국가가 필요합니다'),
  performanceTitle: z.string().min(1, '공연명이 필요합니다'),
  showDateTime: isoDatetime('공연 시각'),
  seats: z.array(floorAwareSeatSelectionSchema),
  totalAmount: z.number().int().min(0, '총 결제 금액은 0 이상이어야 합니다'),
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED']),
  funnelStatus: adminBookingFunnelStatusSchema,
  paymentStatus: paymentStatusSchema.nullable(),
  paymentMethod: z.string().min(1, '결제 수단이 필요합니다').nullable(),
  paymentFailureBucket: paymentFailureBucketSchema.nullable(),
  paymentFailureDiagnostic: paymentFailureDiagnosticSchema.nullable(),
  paymentMethodAttribution: paymentMethodAttributionSchema,
  ticketStatusCounts: ticketStatusCountsSchema,
  createdAt: isoDatetime('생성 시각'),
});

export const adminTicketItemSchema = floorAwareSeatSelectionSchema.extend({
  id: z.string().uuid('유효한 ticket item ID가 필요합니다'),
  reservationId: z.string().uuid('유효한 reservation ID가 필요합니다'),
  paymentId: z.string().uuid('유효한 payment ID가 필요합니다'),
  showtimeId: z.string().uuid('유효한 showtime ID가 필요합니다'),
  serviceFee: z.number().int().min(0),
  status: z.enum(['ACTIVE', 'CANCELLATION_PENDING', 'CANCELLED', 'EXPIRED']),
  admissionState: z.enum(['NOT_ENTERED', 'ENTERED']),
  enteredAt: isoDatetime('입장 처리 시각').nullable(),
  cancelledAt: isoDatetime('취소 시각').nullable(),
  cancelReason: z.string().max(200).nullable(),
  cancellationFee: z.number().int().min(0),
  serviceFeeRefund: z.number().int().min(0),
  refundableAmount: z.number().int().min(0),
  reopenState: z.enum([
    'NOT_REQUIRED',
    'HELD_CANCELLED',
    'AVAILABLE',
    'MANUAL_OPENED',
  ]),
  reopenHoldUntil: isoDatetime('좌석 재오픈 hold 만료 시각').nullable(),
  benefitEntitlements: z.array(benefitEntitlementSchema).default([]),
});

export const adminBookingDetailSchema = adminBookingListItemSchema.extend({
  userPhone: z.string().min(1, '예매자 전화번호가 필요합니다'),
  paymentAttemptedAt: isoDatetime('결제 시도 시각').nullable(),
  paymentCompletedAt: isoDatetime('결제 완료 처리 시각').nullable(),
  paymentInfo: paymentInfoSchema.nullable(),
  ticketItems: z.array(adminTicketItemSchema),
});

export const adminBookingListResponseSchema = z.object({
  bookings: z.array(adminBookingListItemSchema),
  stats: bookingStatsSchema,
  tierStats: z.array(adminBookingTierStatsSchema),
  total: z.number().int().min(0),
});
