'use client';

import { useId } from 'react';
import Link from 'next/link';
import type { ReservationDetail, SupportedLocale } from '@grabit/shared';
import { isMerchantConfirmedCheckoutMethod } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { getPaymentRecoveryCopy } from '@/lib/booking/payment-recovery-copy';
import { getCheckoutState } from '@/lib/booking/checkout-state';
import { getServerNowMs } from '@/lib/server-clock';
import { useServerTimeReached } from '@/hooks/use-server-clock';
import { formatEventTimeWithKstAnchor } from '@/lib/i18n/format';

export type PaymentRecoverySnapshot = Pick<ReservationDetail,
  'status' | 'paymentInfo' | 'paymentDeadlineAt' | 'checkoutStartedAt' | 'checkoutPaymentMethod'>;

/** Presentation only. Neither a browser return nor elapsed time unlocks payment. */
export function PaymentRecoveryPanel({ reservation, locale, onCheck, checking = false,
  checkedAt, providerUnavailable = false, onReselect, onChangeMethod, changingMethod = false, changeError,
}: {
  reservation: PaymentRecoverySnapshot;
  locale: SupportedLocale;
  onCheck?: () => void | Promise<unknown>;
  checking?: boolean;
  checkedAt?: number;
  providerUnavailable?: boolean;
  onReselect?: () => void;
  onChangeMethod?: () => void | Promise<unknown>;
  changingMethod?: boolean;
  changeError?: string | null;
}) {
  const copy = getPaymentRecoveryCopy(locale);
  const checkoutCopy = getCheckoutCopy(locale);
  const reasonId = useId();
  const now = getServerNowMs();
  const state = getCheckoutState(reservation, now);
  const ended = state === 'failed' || state === 'expired';
  const canChangeMethod = !ended && reservation.status === 'PENDING_PAYMENT'
    && !reservation.paymentInfo && isMerchantConfirmedCheckoutMethod(reservation.checkoutPaymentMethod)
    && Boolean(onChangeMethod);
  const approved = ['DONE', 'PARTIAL_CANCELED'].includes(reservation.paymentInfo?.status ?? '');
  const pending = reservation.paymentInfo?.status === 'IN_PROGRESS';
  const started = Date.parse(reservation.checkoutStartedAt ?? '');
  const reviewOverdue = useServerTimeReached(Number.isFinite(started) ? started + 10 * 60_000 : null);
  const delayed = !approved && !ended && reviewOverdue;
  const deadline = Date.parse(reservation.paymentDeadlineAt);
  const asyncWallet = ['ALIPAY_PLUS', 'TRUEMONEY'].includes(reservation.checkoutPaymentMethod?.provider ?? '');
  const deadlinePassed = useServerTimeReached(Number.isFinite(deadline) ? deadline : null);
  const title = ended ? copy.endedTitle : approved ? copy.finalizingTitle
    : delayed ? copy.delayedTitle : pending ? copy.pendingTitle : copy.unknownTitle;
  const body = ended ? copy.endedBody : approved ? copy.finalizingBody
    : delayed ? copy.delayedBody : pending ? copy.pendingBody : copy.unknownBody;
  return (
    <section aria-label={title} className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5">
      <div role="status" className="space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {asyncWallet && !approved && !ended && !delayed && <p className="text-sm text-muted-foreground">{copy.asyncEstimate}</p>}
      {!approved && !ended && Number.isFinite(deadline) && (
        <p className="text-sm">{deadlinePassed ? copy.deadlinePassed
          : `${copy.deadline}: ${formatEventTimeWithKstAnchor(reservation.paymentDeadlineAt, locale, { includeLocalTime: false }).kst}`}</p>
      )}
      {checkedAt ? <p className="text-xs text-muted-foreground">{copy.lastChecked}: <time dateTime={new Date(checkedAt).toISOString()}>{new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(checkedAt)}</time></p> : null}
      {providerUnavailable && <p role="alert" className="text-sm text-amber-800">{copy.providerUnavailable}</p>}
      {changeError && <p role="alert" className="text-sm text-amber-800">{changeError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button disabled={checking || changingMethod || !onCheck} onClick={() => void onCheck?.()}>{checking ? copy.checking : copy.check}</Button>
        {ended && onReselect ? <Button variant="outline" onClick={onReselect}>{checkoutCopy.reselect}</Button>
          : !approved && !ended ? <Button variant="outline" disabled={!canChangeMethod || changingMethod}
            onClick={() => void onChangeMethod?.()} aria-describedby={reasonId}>{changingMethod ? copy.ending : copy.changeMethod}</Button> : null}
      </div>
      {!approved && !ended && <p id={reasonId} className="text-sm text-muted-foreground">{canChangeMethod ? copy.changeAvailable : copy.changeBlocked}</p>}
      {canChangeMethod && onReselect && <Button variant="ghost" disabled={changingMethod} onClick={onReselect}>{checkoutCopy.reselect}</Button>}
      <Link className="inline-block text-sm text-primary underline" href={getLocalizedPathname('/support', locale)}>{checkoutCopy.support}</Link>
    </section>
  );
}
