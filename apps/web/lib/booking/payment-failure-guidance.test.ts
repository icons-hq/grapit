import { describe, expect, it } from 'vitest';
import type { PaymentFailureDiagnostic } from '@grabit/shared';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import {
  getDiagnosticPaymentFailureGuidance,
  getPaymentFailureGuidance,
} from './payment-failure-guidance';

const koCopy = getVisibleCopy('ko').booking.paymentFailureGuidance;
const providerMessagePrefix = getVisibleCopy('ko').booking.paymentRecovery.providerMessagePrefix;

function guidanceFor(code: string, providerMessage?: string | null) {
  return getPaymentFailureGuidance({
    code,
    providerMessage,
    copy: koCopy,
    providerMessagePrefix,
  });
}

describe('getPaymentFailureGuidance', () => {
  it.each([
    [
      'NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT',
      '할부 결제를 사용할 수 없는 카드이거나 가맹점입니다.',
    ],
    ['PAYMENT_DEADLINE_EXPIRED', '결제 가능 시간이 만료되었습니다.'],
    ['PAYMENT_EXPIRED', '결제 가능 시간이 만료되었습니다.'],
    ['PAYMENT_ABORTED', '결제가 중단되었거나 승인되지 않았습니다.'],
    ['PAY_PROCESS_ABORTED', '결제가 중단되었거나 승인되지 않았습니다.'],
    ['PAY_PROCESS_CANCELED', '결제가 취소되었습니다.'],
    ['PAYMENT_CANCELED_BEFORE_CONFIRM', '결제가 취소되었습니다.'],
    ['UNKNOWN_PROVIDER_CODE', '결제를 완료하지 못했습니다.'],
  ])('maps %s to localized customer guidance', (code, title) => {
    expect(guidanceFor(code).title).toBe(title);
  });

  it('keeps distinct Toss failUrl messages as secondary provider text', () => {
    expect(
      guidanceFor(
        'NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT',
        '할부가 지원되지 않는 카드 또는 가맹점 입니다.',
      ).providerMessage,
    ).toBe('결제사 응답: 할부가 지원되지 않는 카드 또는 가맹점 입니다.');
  });

  it('does not treat stored diagnostics as provider response copy', () => {
    const diagnostic: PaymentFailureDiagnostic = {
      kind: 'payment_cancelled_before_confirm',
      code: 'PAYMENT_CANCELED_BEFORE_CONFIRM',
      message: '결제 승인 전 취소되었습니다.',
      source: 'payment_webhook_events',
      recordedAt: '2026-06-15T02:05:00.000Z',
      providerCheckStatus: 'confirmed',
      providerCheckedAt: null,
      providerCheckMessage: null,
    };

    const guidance = getDiagnosticPaymentFailureGuidance({
      diagnostic,
      copy: koCopy,
      providerMessagePrefix,
    });

    expect(guidance?.title).toBe('결제가 취소되었습니다.');
    expect(guidance?.providerMessage).toBeNull();
  });
});
