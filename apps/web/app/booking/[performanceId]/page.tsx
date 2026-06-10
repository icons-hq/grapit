'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { BookingPage } from '@/components/booking/booking-page';
import { QueueWaiting } from '@/components/booking/queue-waiting';
import { useQueue } from '@/hooks/use-queue';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useAuthStore } from '@/stores/use-auth-store';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

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
    isAdminBookingBypassActive,
    isResolved: runtimeFlagsResolved,
  } = useBookingAvailability();
  const { isInitialized: authInitialized, accessToken } = useAuthStore();
  const queue = useQueue({
    performanceId,
    enabled:
      runtimeFlagsResolved &&
      authInitialized &&
      Boolean(accessToken) &&
      bookingAvailable &&
      !isAdminBookingBypassActive,
  });

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
    return <BookingPage performanceId={performanceId} />;
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
