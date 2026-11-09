'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { benefitRedemptionResponseSchema, type BenefitRedemptionRequest, type BenefitRedemptionResponse, type ReservationDetail } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';

export function useBuyerBenefitRedeem(reservationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BenefitRedemptionRequest) => {
      const response = await apiClient.post<BenefitRedemptionResponse>('/api/v1/tickets/benefits/redeem', input, { showErrorToast: false });
      return benefitRedemptionResponseSchema.parse(response);
    },
    onMutate: () => ({ buyerId: useAuthStore.getState().user?.id }),
    onSuccess: (response, _input, context) => {
      if (context?.buyerId !== useAuthStore.getState().user?.id) return;
      const entitlement = response.benefitEntitlement;
      if (!entitlement) return;
      queryClient.setQueriesData<ReservationDetail>({ queryKey: ['reservations', reservationId],
        predicate: ({ queryKey }) => queryKey.length === 4 && queryKey[2] === context?.buyerId }, (reservation) => reservation?.ticketItems ? {
          ...reservation,
          ticketItems: reservation.ticketItems.map((ticket) => ticket.id === entitlement.ticketItemId ? {
            ...ticket, benefitEntitlements: ticket.benefitEntitlements.map((benefit) => benefit.id === entitlement.id ? entitlement : benefit),
          } : ticket),
        } : reservation);
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['reservations', reservationId] }); },
  });
}
