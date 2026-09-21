'use client';

import { getClientLocale } from '@/lib/i18n/client-copy';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/auth/auth-guard';
import { ReservationDetailView } from '@/components/reservation/reservation-detail';
import {
  useReservationDetail,
  useCancelReservation,
  useCancelTicketItem,
} from '@/hooks/use-reservations';
import { ReservationDetailSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { useBookingStore } from '@/stores/use-booking-store';
import type { ReservationDetail, CancellationExpectation } from '@grabit/shared';
import { toast } from 'sonner';
import { getCancellationCopy } from '@/lib/i18n/cancellation-copy';

interface ReservationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ReservationDetailPage({ params }: ReservationDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const locale = getClientLocale();
  const { data: reservation, isLoading, isError, refetch } = useReservationDetail(id);
  const cancelMutation = useCancelReservation();
  const cancelTicketMutation = useCancelTicketItem();
  const cancellationCopy = getCancellationCopy(locale);

  async function handleCancel(reason: string, ticketItemId?: string, expected?: CancellationExpectation) {
    try {
      if (ticketItemId) await cancelTicketMutation.mutateAsync({ id, ticketItemId, reason, expected });
      else {
        const result = await cancelMutation.mutateAsync({ id, reason, expected });
        if (result.refundTimeline?.currentState === 'FAILED') throw new Error(cancellationCopy.unknown);
      }
      toast.success(cancellationCopy.requested);
      await refetch();
    } catch (error) {
      toast.error(cancellationCopy.unknown);
      await refetch();
      throw error;
    }
  }

  function handleResumePayment(target: ReservationDetail) {
    if (!target.performanceId || !target.showtimeId || !target.tossOrderId) {
      toast.error(getCheckoutCopy(locale).unavailableBody);
      return;
    }
    const paymentDeadlineMs = Date.parse(target.paymentDeadlineAt);

    useBookingStore.getState().setBookingData({
      selectedSeats: target.seats,
      showtimeId: target.showtimeId,
      performanceId: target.performanceId,
      performanceTitle: target.performanceTitle,
      showDateTime: target.showDateTime,
      venue: target.venue,
      posterUrl: target.posterUrl,
      expiresAt: Number.isFinite(paymentDeadlineMs) ? paymentDeadlineMs : Date.now(),
    });
    router.push(
      `${getLocalizedPathname(`/booking/${target.performanceId}/confirm`, locale)}?resumeOrderId=${encodeURIComponent(target.tossOrderId)}`,
    );
  }

  return (
    <AuthGuard>
      <main className="mx-auto max-w-[720px] px-4 py-6 md:px-6 md:py-8">
        {isLoading && <ReservationDetailSkeleton />}

        {isError && (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-base font-semibold text-gray-900">
              {getVisibleCopy(locale).mypage.loadError}
            </p>
            <Button className="mt-4" onClick={() => refetch()}>
              {getVisibleCopy(locale).commonErrors.retry}
            </Button>
          </div>
        )}

        {reservation && (
          <ReservationDetailView
            reservation={reservation}
            onCancel={handleCancel}
            isCancelling={cancelMutation.isPending || cancelTicketMutation.isPending}
            onResumePayment={handleResumePayment}
          />
        )}
      </main>
    </AuthGuard>
  );
}
