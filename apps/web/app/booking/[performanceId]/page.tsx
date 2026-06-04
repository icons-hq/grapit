'use client';

import { use } from 'react';
import { AuthGuard } from '@/components/auth/auth-guard';
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

  if (!runtimeFlagsResolved || !authInitialized) {
    return (
      <AuthGuard>
        <QueueWaiting
          status="loading"
          position={0}
          etaSeconds={0}
          remainingSeats={0}
          autoEnter={false}
        />
      </AuthGuard>
    );
  }

  if (!bookingAvailable || isAdminBookingBypassActive || queue.isReady) {
    return (
      <AuthGuard>
        <BookingPage performanceId={performanceId} />
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
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
    </AuthGuard>
  );
}
