import { z } from 'zod';

import { benefitEntitlementSchema } from './benefit.schema';

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

export const TICKET_SERVICE_FEE_KRW = 2000;

export const ticketItemStatusSchema = z.enum([
  'ACTIVE',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'EXPIRED',
]);
export const admissionStateSchema = z.enum(['NOT_ENTERED', 'ENTERED']);
export const qrCredentialStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED', 'ROTATED']);
export const ticketItemServiceFeeSchema = z.union([
  z.literal(0),
  z.literal(TICKET_SERVICE_FEE_KRW),
]);

export const ticketItemQrCredentialSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(1, 'QR token이 필요합니다'),
  jti: z.string().min(1, 'QR token JTI가 필요합니다'),
  status: qrCredentialStatusSchema,
  issuedAt: isoDatetime('QR 발급 시각'),
  rotatedAt: isoDatetime('QR 교체 시각').nullable().optional(),
  revokedAt: isoDatetime('QR 해지 시각').nullable().optional(),
});

export const ticketItemCancellationSchema = z.object({
  cancelledAt: isoDatetime('티켓 취소 시각'),
  cancelReason: z.string().min(1).max(200),
  cancellationFee: z.number().int().min(0),
  serviceFeeRefund: z.number().int().min(0),
  refundableAmount: z.number().int().min(0),
  refundStatus: z.enum(['REQUESTED', 'SENT_TO_PG', 'PROCESSING_AT_PG', 'COMPLETED', 'FAILED']),
  reopenState: z.enum(['HELD_CANCELLED', 'AVAILABLE', 'MANUAL_OPENED']),
  reopenAt: isoDatetime('좌석 재오픈 시각').nullable().optional(),
});

export const ticketItemSchema = z.object({
  id: z.string().uuid(),
  reservationId: z.string().uuid(),
  paymentId: z.string().uuid(),
  showtimeId: z.string().uuid(),
  seatId: z.string().min(1),
  seatKey: z.string().min(1),
  floorKey: z.string().min(1),
  floorLabel: z.string().min(1),
  row: z.string().min(1),
  number: z.string().min(1),
  tierName: z.string().min(1),
  price: z.number().int().min(0),
  serviceFee: ticketItemServiceFeeSchema,
  status: ticketItemStatusSchema,
  admissionState: admissionStateSchema,
  enteredAt: isoDatetime('입장 처리 시각').nullable(),
  qrCredential: ticketItemQrCredentialSchema.nullable(),
  cancellation: ticketItemCancellationSchema.nullable(),
  benefitEntitlements: z.array(benefitEntitlementSchema).default([]),
  isLegacyFallback: z.boolean().optional(),
});

export const ticketItemCancellationPolicyCodeSchema = z.enum([
  'SAME_DAY_BEFORE_MIDNIGHT',
  'WITHIN_7_DAYS_AFTER_BOOKING',
  'BOOKING_DAY_8_TO_SHOW_DAY_10',
  'SHOW_DAY_9_TO_7',
  'SHOW_DAY_6_TO_3',
  'SHOW_DAY_2_TO_1',
]);

export const ticketItemCancellationPreviewSchema = z.object({
  ticketItemId: z.string().uuid(),
  ticketPrice: z.number().int().min(0),
  serviceFee: ticketItemServiceFeeSchema,
  cancellationFee: z.number().int().min(0),
  serviceFeeRefund: z.number().int().min(0),
  refundableAmount: z.number().int().min(0),
  policyCode: ticketItemCancellationPolicyCodeSchema,
});

export type TicketItem = z.infer<typeof ticketItemSchema>;
export type TicketItemQrCredential = z.infer<typeof ticketItemQrCredentialSchema>;
export type TicketItemCancellation = z.infer<typeof ticketItemCancellationSchema>;
export type TicketItemCancellationPreview = z.infer<typeof ticketItemCancellationPreviewSchema>;
export type TicketItemCancellationPolicyCode = z.infer<typeof ticketItemCancellationPolicyCodeSchema>;
export type TicketItemServiceFee = z.infer<typeof ticketItemServiceFeeSchema>;
export type TicketItemStatus = z.infer<typeof ticketItemStatusSchema>;
export type AdmissionState = z.infer<typeof admissionStateSchema>;
export type QrCredentialStatus = z.infer<typeof qrCredentialStatusSchema>;
