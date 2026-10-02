'use client';

import { use, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { CreditCard } from 'lucide-react';
import { BookingPage } from '@/components/booking/booking-page';
import { QueueWaiting } from '@/components/booking/queue-waiting';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardFooter, CardHeader } from '@/components/ui/card';
import { useQueue } from '@/hooks/use-queue';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useUnlockAllSeats } from '@/hooks/use-booking';
import { useServerTimeReached } from '@/hooks/use-server-clock';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { buildAuthRoute } from '@/lib/auth-return';
import {
  getQueuePaymentRecoveryCopy,
  parseServerDeadline,
} from '@/lib/booking/queue-access';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';

/** Warn this long before the queue access window closes. */
const QUEUE_ACCESS_WARNING_LEAD_MS = 2 * 60_000;

/**
 * An admission whose seat window closed while an order still awaits payment.
 * Seat locks would be refused, so the route only offers to continue that
 * payment (or to look at the reservation).
 */
function QueuePaymentRecovery({
  locale,
  resumeHref,
  reservationsHref,
}: {
  locale: string;
  resumeHref: string;
  reservationsHref: string;
}) {
  const copy = getQueuePaymentRecoveryCopy(locale);

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-50 via-white to-[#f3efff] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center">
        <Card className="w-full gap-0 overflow-hidden border-neutral-200/80 bg-white/95 py-0 shadow-xl shadow-black/5">
          <CardHeader className="gap-4 border-b bg-gradient-to-r from-white to-neutral-50/90 pt-6 pb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-4" role="status">
                <Badge variant="secondary">{copy.badge}</Badge>
                <div className="space-y-2">
                  <h1 className="break-keep text-2xl font-semibold tracking-tight text-neutral-950 sm:text-[28px]">
                    {copy.title}
                  </h1>
                  <p className="max-w-2xl whitespace-normal break-keep text-base leading-7 text-neutral-600">
                    {copy.body}
                  </p>
                </div>
              </div>
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-[#f5f5f7] text-[#6c3ce0]">
                <CreditCard className="size-7" aria-hidden="true" />
              </div>
            </div>
          </CardHeader>
          <CardFooter className="flex flex-col gap-3 bg-neutral-50/80 px-6 py-5 sm:flex-row sm:justify-end">
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href={reservationsHref}>{copy.reservations}</Link>
            </Button>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href={resumeHref}>{copy.resume}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

export default function BookingRoute({
  params,
}: {
  params: Promise<{ performanceId: string }>;
}) {
  const router = useRouter();
  const locale = resolveVisibleCopyLocale(useLocale());
  const { performanceId } = use(params);
  const bookingPath = getLocalizedPathname(`/booking/${performanceId}`, locale);
  const authRedirectPath = `${getLocalizedPathname('/auth', locale)}?returnTo=${encodeURIComponent(bookingPath)}`;
  const performancePath = getLocalizedPathname(`/performance/${performanceId}`, locale);
  const homePath = getLocalizedPathname('/', locale);
  const reservationsPath = `${getLocalizedPathname('/mypage', locale)}?tab=reservations`;

  const {
    bookingAvailable,
    verificationRequiredForBooking,
    isAdminBookingBypassActive,
    isResolved: runtimeFlagsResolved,
    isError: runtimeFlagsError,
    refetch: refetchRuntimeFlags,
  } = useBookingAvailability();
  const { isInitialized: authInitialized, accessToken, user } = useAuthStore();
  const queueGated = bookingAvailable && !isAdminBookingBypassActive;
  const queue = useQueue({
    performanceId,
    enabled:
      runtimeFlagsResolved &&
      authInitialized &&
      Boolean(accessToken) &&
      queueGated,
  });
  const {
    isReady: queueIsReady,
    recheck: recheckQueue,
    recoveryOrderId,
    retry: retryQueue,
  } = queue;

  // Seat locks and prepare both require the queue access window (activeUntilAt)
  // on the server; payment recovery only extends payment confirmation. The seat
  // screen therefore counts down to it, warns ahead and leaves when it closes.
  // The queue never reports an admission whose window already closed as ready.
  const queueAccessExpiresAtMs = queueIsReady
    ? parseServerDeadline(queue.activeUntilAt)
    : null;
  const queueAccessExpired = useServerTimeReached(queueAccessExpiresAtMs);
  const showsSeatScreen = queueGated && queueIsReady && !queueAccessExpired;

  const rejoinQueue = useCallback(() => {
    void retryQueue();
  }, [retryQueue]);
  const recheckQueueAccess = useCallback(() => {
    void recheckQueue();
  }, [recheckQueue]);

  // Leaving the seat screen because the access ended (window closed, the
  // admission was used up in another tab, the server expired it) releases the
  // seats it held at once instead of leaving them locked for the rest of the
  // seat hold, where neither the owner nor anybody else can buy them. The
  // release waits for the server's answer (the status check at the window
  // end): an order still awaiting payment keeps its seats for recovery.
  const { mutate: releaseShowtimeSeats } = useUnlockAllSeats();
  const seatScreenShownRef = useRef(false);
  useEffect(() => {
    if (showsSeatScreen) {
      seatScreenShownRef.current = true;
      return;
    }
    if (!seatScreenShownRef.current) {
      return;
    }
    if (recoveryOrderId) {
      seatScreenShownRef.current = false;
      return;
    }
    if (queueIsReady) {
      // Closed on this device's server-corrected clock, or the seat screen is
      // hidden for another reason (booking disabled): wait for the server.
      return;
    }

    seatScreenShownRef.current = false;
    const { selectedShowtimeId } = useBookingStore.getState();
    if (selectedShowtimeId) {
      releaseShowtimeSeats({ showtimeId: selectedShowtimeId });
    }
    useBookingStore.getState().clearSeats();
  }, [queueIsReady, recoveryOrderId, releaseShowtimeSeats, showsSeatScreen]);

  const queueAccessEndingSoon = useServerTimeReached(
    queueAccessExpiresAtMs === null
      ? null
      : queueAccessExpiresAtMs - QUEUE_ACCESS_WARNING_LEAD_MS,
  );
  const queueAccessWarningShownForRef = useRef<number | null>(null);
  const queueAccessEndingSoonMessage =
    getVisibleCopy(locale).booking.queue.accessEndingSoon;

  useEffect(() => {
    if (
      queueAccessExpiresAtMs === null ||
      !queueAccessEndingSoon ||
      queueAccessExpired ||
      queueAccessWarningShownForRef.current === queueAccessExpiresAtMs
    ) {
      return;
    }

    queueAccessWarningShownForRef.current = queueAccessExpiresAtMs;
    toast.warning(queueAccessEndingSoonMessage, {
      id: 'queue-access-ending-soon',
      duration: 10_000,
    });
  }, [
    queueAccessEndingSoon,
    queueAccessEndingSoonMessage,
    queueAccessExpired,
    queueAccessExpiresAtMs,
  ]);

  const verificationPath = user && verificationRequiredForBooking
    ? !user.isEmailVerified
      ? buildAuthRoute('/auth/verify-email', locale, { email: user.email, returnTo: bookingPath })
      : `${getLocalizedPathname('/mypage', locale)}?tab=settings&returnTo=${encodeURIComponent(bookingPath)}`
    : null;

  useEffect(() => {
    if (authInitialized && verificationPath) router.replace(verificationPath);
  }, [authInitialized, router, verificationPath]);

  useEffect(() => {
    if (
      runtimeFlagsResolved &&
      authInitialized &&
      !accessToken &&
      queueGated
    ) {
      router.replace(authRedirectPath);
    }
  }, [
    accessToken,
    authInitialized,
    authRedirectPath,
    queueGated,
    router,
    runtimeFlagsResolved,
  ]);

  if (!runtimeFlagsResolved) {
    // A failed flag check is retried (also automatically), never shown as
    // "booking opens later".
    return (
      <QueueWaiting
        status={runtimeFlagsError ? 'retry' : 'loading'}
        position={0}
        etaSeconds={0}
        remainingSeats={0}
        autoEnter={false}
        onRetry={
          runtimeFlagsError
            ? () => {
                void refetchRuntimeFlags();
              }
            : undefined
        }
      />
    );
  }

  if (authInitialized && verificationPath) return null;

  if (!queueGated) {
    return <BookingPage performanceId={performanceId} />;
  }

  if (!authInitialized) {
    return (
      <QueueWaiting
        status="loading"
        position={0}
        etaSeconds={0}
        remainingSeats={0}
        autoEnter={false}
      />
    );
  }

  if (!accessToken) {
    return null;
  }

  if (recoveryOrderId) {
    return (
      <QueuePaymentRecovery
        locale={locale}
        resumeHref={`${getLocalizedPathname(`/booking/${performanceId}/confirm`, locale)}?resumeOrderId=${encodeURIComponent(recoveryOrderId)}`}
        reservationsHref={reservationsPath}
      />
    );
  }

  if (queueIsReady) {
    if (queueAccessExpired) {
      return (
        <QueueWaiting
          status="expired"
          position={0}
          etaSeconds={0}
          remainingSeats={queue.remainingSeats}
          autoEnter={false}
          onRetry={rejoinQueue}
        />
      );
    }

    return (
      <BookingPage
        performanceId={performanceId}
        queueAccessExpiresAt={queueAccessExpiresAtMs}
        onQueueAccessRejected={recheckQueueAccess}
      />
    );
  }

  if (queue.status === 'loading') {
    // Immediate admissions skip the queue surface; a slow queue entry shows the
    // loading surface instead of a blank page.
    if (!queue.isSlowLoading) {
      return null;
    }

    return (
      <QueueWaiting
        status="loading"
        position={0}
        etaSeconds={0}
        remainingSeats={0}
        autoEnter={false}
      />
    );
  }

  return (
    <QueueWaiting
      status={queue.status}
      position={queue.position}
      etaSeconds={queue.etaSeconds}
      etaMinSeconds={queue.etaMinSeconds}
      etaUnavailable={queue.etaUnavailable}
      remainingSeats={queue.remainingSeats}
      autoEnter={queue.autoEnter}
      bookingOpensAt={queue.bookingOpensAt}
      closedReason={queue.closedReason}
      onRetry={rejoinQueue}
      onEnterNow={queue.enterNow}
      onBack={() => {
        // A missing performance has no detail page to go back to.
        router.push(queue.closedReason === 'notFound' ? homePath : performancePath);
      }}
    />
  );
}
