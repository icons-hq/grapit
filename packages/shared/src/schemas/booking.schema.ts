import { z } from 'zod';
import { consentCaptureItemSchema } from './consent.schema';

const seatSelectionSchema = z.object({
  seatId: z.string().min(1, '좌석 ID가 필요합니다'),
  tierName: z.string().min(1, '등급명이 필요합니다'),
  price: z.number().int().min(0, '가격은 0 이상이어야 합니다'),
  row: z.string().min(1, '열 정보가 필요합니다'),
  number: z.string().min(1, '좌석 번호가 필요합니다'),
});

export const prepareReservationSchema = z.object({
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
  showtimeId: z.string().uuid('유효한 회차 ID가 필요합니다'),
  seats: z.array(seatSelectionSchema).min(1, '최소 1개의 좌석을 선택해야 합니다'),
  amount: z.number().int().positive('결제 금액은 0보다 커야 합니다'),
  consentItems: z.preprocess(
    (value) => value ?? [],
    z
      .array(consentCaptureItemSchema.extend({ sourceFlow: z.literal('booking') }))
      .min(1, '예매 동의 항목이 필요합니다'),
  ),
});

export type PrepareReservationInput = z.infer<typeof prepareReservationSchema>;

export const confirmPaymentSchema = z.object({
  paymentKey: z.string().min(1, '결제 키가 필요합니다'),
  orderId: z.string().min(1, '주문 ID가 필요합니다'),
  amount: z.number().int().positive('결제 금액은 0보다 커야 합니다'),
});

export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

export const cancelReservationSchema = z.object({
  reason: z.string().min(1, '취소 사유를 입력해주세요').max(200, '취소 사유는 200자 이내로 입력해주세요'),
});

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

export const adminRefundSchema = z.object({
  reason: z.string().min(1, '환불 사유를 입력해주세요').max(200, '환불 사유는 200자 이내로 입력해주세요'),
});

export type AdminRefundInput = z.infer<typeof adminRefundSchema>;
