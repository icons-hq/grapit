'use client';

import { use } from 'react';
import { BookingPage } from '@/components/booking/booking-page';
import { QueueWaiting } from '@/components/booking/queue-waiting';
import { useQueue } from '@/hooks/use-queue';
import { useBookingAvailability } from '@/hooks/use-booking-availability';

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
  const queue = useQueue({
    performanceId,
    enabled: runtimeFlagsResolved && bookingAvailable && !isAdminBookingBypassActive,
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

  if (!bookingAvailable || isAdminBookingBypassActive || queue.isReady) {
    return <BookingPage performanceId={performanceId} />;
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
