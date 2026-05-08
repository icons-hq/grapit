'use client';

import { use } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookingPage } from '@/components/booking/booking-page';
import { QueueWaiting } from '@/components/booking/queue-waiting';
import { useQueue } from '@/hooks/use-queue';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';

export default function BookingRoute({
  params,
}: {
  params: Promise<{ performanceId: string }>;
}) {
  const { performanceId } = use(params);

  const queryClient = useQueryClient();
  const runtimeFlagsState = queryClient.getQueryState<{
    bookingEnabled: boolean;
  }>(['runtime-flags']);
  const runtimeFlagsResolved = (runtimeFlagsState?.dataUpdatedAt ?? 0) > 0;
  const { bookingEnabled } = useRuntimeFlags();
  const queue = useQueue({
    performanceId,
    enabled: runtimeFlagsResolved && bookingEnabled,
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

  if (!bookingEnabled || queue.isReady) {
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
