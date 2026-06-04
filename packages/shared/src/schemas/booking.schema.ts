import { z } from 'zod';

import { consentCaptureItemSchema } from './consent.schema';
import { ticketItemSchema } from './ticket-item.schema';

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

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
    amount: z.number().int().positive('결제 금액은 0보다 커야 합니다').optional(),
    providerChargeAmount: providerDecimalStringSchema.optional(),
  }).superRefine((value, ctx) => {
    if ((value.amount === undefined) === (value.providerChargeAmount === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '해외카드 결제 금액이 필요합니다',
        path: ['amount'],
      });
    }
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
  paymentMethod: z.string().min(1, '결제 수단 라벨이 필요합니다'),
  paidAt: isoDatetime('결제 완료 시각'),
  cancelDeadline: isoDatetime('취소 마감 시각'),
  cancelledAt: isoDatetime('취소 시각').nullable(),
  cancelReason: z.string().max(200).nullable(),
  paymentKey: z.string().min(1, '결제 키가 필요합니다'),
  queueAdmission: queueAdmissionSchema,
  paymentDeadlineAt: isoDatetime('결제 마감 시각'),
  bookingPolicy: bookingPolicySchema,
  refundTimeline: refundTimelineSchema,
  cancelledSeatHold: cancelledSeatHoldSchema.nullable(),
  qrTicket: qrTicketSchema,
  ticketEmailDelivery: ticketEmailDeliverySchema,
  ticketItems: z.array(ticketItemSchema),
});
