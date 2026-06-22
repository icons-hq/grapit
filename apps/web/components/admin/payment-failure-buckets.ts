import type { PaymentFailureBucket } from '@grabit/shared';

export const PAYMENT_FAILURE_BUCKET_LABELS: Record<PaymentFailureBucket, string> = {
  local_deadline_expired: '내부 시간 만료',
  provider_expired: 'Toss 만료',
  provider_aborted: 'Toss 실패/중단',
  buyer_cancelled_before_confirm: '승인 전 취소',
  unreconciled_provider_expired: 'Toss 만료 수신/미반영',
  compensated_cancel: '자동 취소 보상',
  other: '원인 확인 필요',
};

export function getPaymentFailureBucketLabel(
  bucket: PaymentFailureBucket | null,
): string | null {
  if (!bucket) return null;
  return PAYMENT_FAILURE_BUCKET_LABELS[bucket] ?? '원인 확인 필요';
}
