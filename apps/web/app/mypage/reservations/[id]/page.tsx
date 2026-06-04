'use client';

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
import type { ReservationDetail } from '@grabit/shared';
import { toast } from 'sonner';

interface ReservationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ReservationDetailPage({ params }: ReservationDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: reservation, isLoading, isError, refetch } = useReservationDetail(id);
  const cancelMutation = useCancelReservation();
  const cancelTicketItemMutation = useCancelTicketItem();

  async function handleCancel(reason: string) {
    try {
      await cancelMutation.mutateAsync({ id, reason });
      toast.success('예매가 취소되었습니다');
      refetch();
    } catch {
      toast.error('취소 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  async function handleCancelTicketItem(ticketItemId: string, reason: string) {
    try {
      await cancelTicketItemMutation.mutateAsync({
        reservationId: id,
        ticketItemId,
        reason,
      });
      toast.success('티켓이 취소되었습니다');
      refetch();
    } catch (error) {
      toast.error('티켓 취소 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
      throw error;
    }
  }

  function handleResumePayment(target: ReservationDetail) {
    if (!target.performanceId || !target.showtimeId || !target.tossOrderId) {
      toast.error('결제 정보를 복원하지 못했습니다. 좌석을 다시 선택해주세요.');
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
      `/booking/${target.performanceId}/confirm?resumeOrderId=${encodeURIComponent(target.tossOrderId)}`,
    );
  }

  return (
    <AuthGuard>
      <main className="mx-auto max-w-[720px] px-4 py-6 md:px-6 md:py-8">
        {isLoading && <ReservationDetailSkeleton />}

        {isError && (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-base font-semibold text-gray-900">
              예매 정보를 불러오지 못했습니다.
            </p>
            <Button className="mt-4" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        )}

        {reservation && (
          <ReservationDetailView
            reservation={reservation}
            onCancel={handleCancel}
            isCancelling={cancelMutation.isPending}
            onResumePayment={handleResumePayment}
            onCancelTicketItem={handleCancelTicketItem}
            isCancellingTicketItem={cancelTicketItemMutation.isPending}
          />
        )}
      </main>
    </AuthGuard>
  );
}
