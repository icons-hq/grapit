'use client';

import { use, useEffect, useRef } from 'react';
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
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';

/** Warn this long before the queue access window closes. */
const QUEUE_ACCESS_WARNING_LEAD_MS = 2 * 60_000;

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
  const queueAccessExpiresAtMs = queue.isReady
    ? parseServerDeadline(queue.activeUntilAt)
    : null;
  const queueAccessExpired = useServerTimeReached(queueAccessExpiresAtMs);
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
          onRetry={() => {
            void queue.retry();
          }}
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
      onRetry={() => {
        void queue.retry();
      }}
      onEnterNow={queue.enterNow}
    />
  );
}
