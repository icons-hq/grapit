import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PaymentInfo } from '@grabit/shared';
import { z } from 'zod';
import type { TossPaymentResponse } from './toss-payments.client.js';

export const VIRTUAL_ACCOUNT_MID = 'gsangwbzqu';
export const AWAITING_DEPOSIT = 'awaiting_deposit';
export const DEPOSIT_REVERSED = 'deposit_reversed';

const refundAccount = z.object({
  bank: z.string().min(1).max(30),
  accountNumber: z.string().regex(/^\d{6,20}$/),
  holderName: z.string().min(1).max(60),
});
const bankDetails = z.object({
  bankCode: z.string().min(1).max(12),
  // Toss sandbox issues non-transferable account numbers prefixed with X.
  accountNumber: z.string().regex(/^X?\d{5,20}$/i),
  dueDate: z.string().datetime({ offset: true }),
});

export type RefundAccount = z.infer<typeof refundAccount>;

export function getVirtualAccountDetails(metadata: unknown): PaymentInfo['virtualAccount'] {
  const parsed = z.object({ virtualAccount: bankDetails }).safeParse(metadata);
  return parsed.success ? parsed.data.virtualAccount : undefined;
}

export function matchesDepositSecret(secret: string, digest: unknown): boolean {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(createHash('sha256').update(secret).digest(), Buffer.from(digest, 'hex'));
}

function refundKey(encoded: string): Buffer {
  if (!virtualAccountRefundConfigured(encoded)) {
    throw new ServiceUnavailableException('가상계좌 환불 설정을 확인해주세요.');
  }
  return Buffer.from(encoded, 'base64');
}

export function virtualAccountRefundConfigured(encoded: string): boolean {
  if (typeof encoded !== 'string') return false;
  const key = Buffer.from(encoded, 'base64');
  return key.length === 32 && key.toString('base64') === encoded;
}

export function issueVirtualAccountMetadata(payment: TossPaymentResponse, encodedKey: string, expectedMid: string) {
  const details = bankDetails.safeParse(payment.virtualAccount);
  const response = payment.virtualAccount?.refundReceiveAccount;
  const refund = refundAccount.safeParse(response && { ...response, bank: response.bankCode });
  if (!details.success || !refund.success || typeof payment.secret !== 'string' || !payment.secret || payment.mId !== expectedMid) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', refundKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(payment.paymentKey));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(refund.data), 'utf8'), cipher.final()]);
  return {
    virtualAccount: details.data,
    depositSecretHash: createHash('sha256').update(payment.secret).digest('hex'),
    sealedRefundAccount: [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.'),
  };
}

export function openRefundAccount(sealed: string, paymentKey: string, encodedKey: string): RefundAccount {
  const [iv, tag, ciphertext] = sealed.split('.').map(part => Buffer.from(part, 'base64'));
  if (!iv || !tag || !ciphertext) throw new Error('Invalid sealed refund account');
  const decipher = createDecipheriv('aes-256-gcm', refundKey(encodedKey), iv);
  decipher.setAAD(Buffer.from(paymentKey));
  decipher.setAuthTag(tag);
  return refundAccount.parse(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString()));
}
