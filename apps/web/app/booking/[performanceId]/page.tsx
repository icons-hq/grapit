'use client';

import { use } from 'react';
import { BookingPage } from '@/components/booking/booking-page';
import { QueueWaiting } from '@/components/booking/queue-waiting';
import { useQueue } from '@/hooks/use-queue';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useAuthStore } from '@/stores/use-auth-store';

export default function BookingRoute({
  params,
}: {
  params: Promise<{ performanceId: string }>;
}) {
  const { performanceId } = use(params);

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
    return (
      <QueueWaiting
        status="authRequired"
        position={0}
        etaSeconds={0}
        remainingSeats={0}
        autoEnter={false}
      />
    );
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
