'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { BookingPage } from '@/components/booking/booking-page';
import { QueueWaiting } from '@/components/booking/queue-waiting';
import { useQueue } from '@/hooks/use-queue';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useServerTimeReached } from '@/hooks/use-server-clock';
import { useAuthStore } from '@/stores/use-auth-store';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { buildAuthRoute } from '@/lib/auth-return';
import { parseServerDeadline } from '@/lib/booking/queue-access';
import { getServerNowMs } from '@/lib/server-clock';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';

/** Warn this long before the queue access window closes. */
const QUEUE_ACCESS_WARNING_LEAD_MS = 2 * 60_000;

/**
 * How the access window looked when the queue last handed the route a ready
 * admission. `ready` mirrors the last seen `queue.isReady` so each new arrival
 * (first entry, rejoin) is judged once.
 */
type QueueArrival = {
  ready: boolean;
  windowClosedOnArrival: boolean;
};

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

  const {
    bookingAvailable,
    verificationRequiredForBooking,
    isAdminBookingBypassActive,
    isResolved: runtimeFlagsResolved,
    isError: runtimeFlagsError,
    refetch: refetchRuntimeFlags,
  } = useBookingAvailability();
  const { isInitialized: authInitialized, accessToken, user } = useAuthStore();
  const queue = useQueue({
    performanceId,
    enabled:
      runtimeFlagsResolved &&
      authInitialized &&
      Boolean(accessToken) &&
      bookingAvailable &&
      !isAdminBookingBypassActive,
  });

  // Seat locks and prepare both require the queue access window (activeUntilAt)
  // on the server; payment recovery only extends payment confirmation. The seat
  // screen therefore counts down to it, warns ahead and leaves when it closes.
  const activeUntilAtMs = parseServerDeadline(queue.activeUntilAt);
  const [queueArrival, setQueueArrival] = useState<QueueArrival>({
    ready: false,
    windowClosedOnArrival: false,
  });
  let currentArrival = queueArrival;
  if (queueArrival.ready !== queue.isReady) {
    // Judged once per arrival (derived state, not an effect) so the decision
    // does not flip while the user stays on the seat screen.
    currentArrival = {
      ready: queue.isReady,
      windowClosedOnArrival:
        queue.isReady &&
        activeUntilAtMs !== null &&
        getServerNowMs() >= activeUntilAtMs,
    };
    setQueueArrival(currentArrival);
  }
  // An admission whose window had already closed when it arrived (the server
  // still reports it, e.g. PAYMENT_RECOVERY after an abandoned payment) cannot
  // be replaced by rejoining until the server expires it, which happens on the
  // first seat lock attempt. Trapping it on the expired screen would loop for up
  // to the recovery grace, so the seat screen keeps the pre-existing path and
  // only a window that was open on arrival is counted down and closed here.
  const queueAccessExpiresAtMs =
    queue.isReady && !currentArrival.windowClosedOnArrival
      ? activeUntilAtMs
      : null;
  const queueAccessExpired = useServerTimeReached(queueAccessExpiresAtMs);

  // A rejoin the user asked for stays pending until a new position is issued:
  // when the server answers with the expired old admission (expired by the
  // reconcile on that request or by a rejected seat lock), enter once more
  // instead of asking for a second click.
  const rejoinPendingRef = useRef(false);
  const { retry: retryQueue, status: queueStatus } = queue;
  const rejoinQueue = useCallback(() => {
    rejoinPendingRef.current = true;
    void retryQueue();
  }, [retryQueue]);

  useEffect(() => {
    if (!rejoinPendingRef.current) {
      return;
    }
    if (
      queueStatus === 'waiting' ||
      (queue.isReady && queueAccessExpiresAtMs !== null && !queueAccessExpired)
    ) {
      rejoinPendingRef.current = false;
      return;
    }
    if (queueStatus === 'expired' && !queue.isReady) {
      rejoinPendingRef.current = false;
      void retryQueue();
    }
  }, [
    queue.isReady,
    queueAccessExpired,
    queueAccessExpiresAtMs,
    queueStatus,
    retryQueue,
  ]);

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
      bookingAvailable &&
      !isAdminBookingBypassActive
    ) {
      router.replace(authRedirectPath);
    }
  }, [
    accessToken,
    authInitialized,
    authRedirectPath,
    bookingAvailable,
    isAdminBookingBypassActive,
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

  if (!bookingAvailable || isAdminBookingBypassActive) {
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

  if (queue.isReady) {
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
      />
    );
  }

  if (queue.status === 'loading') {
    return null;
  }

  return (
    <QueueWaiting
      status={queue.status}
      position={queue.position}
      etaSeconds={queue.etaSeconds}
      remainingSeats={queue.remainingSeats}
      autoEnter={queue.autoEnter}
      onRetry={rejoinQueue}
      onEnterNow={queue.enterNow}
    />
  );
}
