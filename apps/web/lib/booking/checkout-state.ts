import type { ReservationDetail } from '@grabit/shared';

type CheckoutSnapshot = Pick<ReservationDetail,
  'status' | 'paymentInfo' | 'paymentDeadlineAt' | 'checkoutStartedAt' | 'checkoutPaymentMethod'>;

export type CheckoutState = 'confirmed' | 'processing' | 'failed' | 'expired' | 'ready' | 'unavailable';

/** A local timeout or a missing callback cannot prove that a provider did not charge. */
export function getCheckoutState(reservation: CheckoutSnapshot, nowMs: number): CheckoutState {
  if (reservation.status === 'CONFIRMED') return 'confirmed';
  const paymentStatus = reservation.paymentInfo?.status;
  if (paymentStatus === 'IN_PROGRESS' || paymentStatus === 'DONE' || paymentStatus === 'PARTIAL_CANCELED') {
    return 'processing';
  }
  if (reservation.checkoutStartedAt && (!paymentStatus || paymentStatus === 'READY')) {
    return 'processing';
  }
  if (reservation.status !== 'PENDING_PAYMENT' || (paymentStatus && paymentStatus !== 'READY')) {
    return 'failed';
  }
  const deadlineMs = Date.parse(reservation.paymentDeadlineAt);
  if (!Number.isFinite(deadlineMs)) return 'unavailable';
  if (deadlineMs <= nowMs) return 'expired';
  if (reservation.checkoutPaymentMethod === null) return 'unavailable';
  return 'ready';
}
