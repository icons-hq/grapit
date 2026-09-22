'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { apiUrl } from '@/lib/api-url';
import { useAuthStore } from '@/stores/use-auth-store';
import { getClientLocale } from '@/lib/i18n/client-copy';
import type {
  EmailVerificationRequestResponse,
  ReservationListItem,
  ReservationDetail,
  AdminBookingDetail,
  AdminBookingFunnelStatus,
  AdminBookingListResponse,
  AdminReservationExportFilter,
  PaymentStatus,
  RefundPreviewResponse,
  TicketItemRefundPreviewResponse,
  CancellationExpectation,
  TicketEmailDelivery,
  UserProfile,
} from '@grabit/shared';

export type ReservationExportPayload = AdminReservationExportFilter & {
  exportType: 'raw_pii' | 'failed_cancelled_contacts' | 'active_ticket_manifest';
  reason: string;
};

export interface ReservationExportDownload {
  blob: Blob;
  filename: string;
}

export function useMyReservations(status?: string) {
  const userId = useAuthStore((state) => state.user?.id);
  const locale = getClientLocale();
  return useQuery({
    queryKey: ['reservations', 'me', userId, status ?? 'all', locale],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('locale', locale);
      if (status && status !== 'all') params.set('status', status);
      return apiClient.get<ReservationListItem[]>(
        `/api/v1/users/me/reservations${params.toString() ? `?${params.toString()}` : ''}`,
      );
    },
    enabled: Boolean(userId),
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[2] === userId && previousQuery?.queryKey[4] === locale ? previousData : undefined,
  });
}

export function useReservationDetail(id: string) {
  const userId = useAuthStore((state) => state.user?.id);
  const locale = getClientLocale();
  return useQuery({
    queryKey: ['reservations', id, userId, locale],
    queryFn: () =>
      apiClient.get<ReservationDetail>(`/api/v1/reservations/${id}?locale=${locale}`),
    enabled: !!id && !!userId,
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, expected }: { id: string; reason: string; expected?: CancellationExpectation }) =>
      apiClient.post<RefundPreviewResponse>(`/api/v1/reservations/${id}/refund`, { reason, ...expected }),
    onSuccess: () => {
      invalidateAfterCancellation(queryClient);
    },
  });
}

export function useRefundPreview(id: string | null, enabled = true, ticketItemId?: string | null) {
  const userId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: ['reservations', id, 'refund-preview', userId, ticketItemId ?? null],
    queryFn: () =>
      apiClient.get<RefundPreviewResponse | TicketItemRefundPreviewResponse>(
        ticketItemId ? `/api/v1/reservations/${id}/ticket-items/${ticketItemId}/refund-preview`
          : `/api/v1/reservations/${id}/refund-preview`,
        { showErrorToast: false },
      ),
    enabled: Boolean(id) && enabled,
  });
}

export function useCancelTicketItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ticketItemId, reason, expected }: { id: string; ticketItemId: string; reason: string; expected?: CancellationExpectation }) =>
      apiClient.put<ReservationDetail>(`/api/v1/reservations/${id}/ticket-items/${ticketItemId}/cancel`, { reason, ...expected }),
    onSettled: () => { invalidateAfterCancellation(queryClient); },
  });
}

function invalidateAfterCancellation(queryClient: ReturnType<typeof useQueryClient>) {
  // A successful cancellation makes its open quote ineligible. Refresh the
  // ledger, and mark quotes stale for the next opening without querying them.
  void queryClient.invalidateQueries({ queryKey: ['reservations'],
    predicate: ({ queryKey }) => queryKey[2] !== 'refund-preview' });
  void queryClient.invalidateQueries({ queryKey: ['reservations'],
    predicate: ({ queryKey }) => queryKey[2] === 'refund-preview', refetchType: 'none' });
}

export type AdminRefundPreviewOptions = {
  fullRefundOverride?: boolean;
  enteredTicketOverride?: boolean;
};

export function useRequestAccountEmailVerification() {
  return useMutation({
    mutationFn: ({ email, locale = 'ko' }: { email: string; locale?: string }) =>
      apiClient.post<EmailVerificationRequestResponse>(
        '/api/v1/auth/email-verification/account-email/request',
        { email, locale },
      ),
  });
}

export function useVerifyAccountEmail() {
  return useMutation({
    mutationFn: ({ email, code }: { email: string; code: string }) =>
      apiClient.post<{ verified: boolean; user: UserProfile }>(
        '/api/v1/auth/email-verification/account-email/verify',
        { email, code },
      ),
  });
}

export function useSendReservationTicketEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ reservationId }: { reservationId: string }) =>
      apiClient.post<{ ticketEmailDelivery: TicketEmailDelivery }>(
        `/api/v1/tickets/reservations/${reservationId}/email`,
      ),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['reservations', variables.reservationId],
      });
      queryClient.invalidateQueries({ queryKey: ['reservations', 'me'] });
    },
  });
}

export function useAdminBookings(params: {
  status?: string;
  performanceId?: string;
  showtimeId?: string;
  funnelStatus?: AdminBookingFunnelStatus | 'all';
  paymentStatus?: PaymentStatus | 'all';
  paymentMethod?: string;
  audienceRegion?: 'domestic' | 'overseas' | 'all';
  seatTier?: string;
  floorKey?: string;
  seatQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'bookings', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params.status && params.status !== 'all')
        searchParams.set('status', params.status);
      if (params.performanceId)
        searchParams.set('performanceId', params.performanceId);
      if (params.showtimeId)
        searchParams.set('showtimeId', params.showtimeId);
      if (params.funnelStatus && params.funnelStatus !== 'all')
        searchParams.set('funnelStatus', params.funnelStatus);
      if (params.paymentStatus && params.paymentStatus !== 'all')
        searchParams.set('paymentStatus', params.paymentStatus);
      if (params.paymentMethod && params.paymentMethod !== 'all')
        searchParams.set('paymentMethod', params.paymentMethod);
      if (params.audienceRegion && params.audienceRegion !== 'all')
        searchParams.set('audienceRegion', params.audienceRegion);
      if (params.seatTier) searchParams.set('seatTier', params.seatTier);
      if (params.floorKey) searchParams.set('floorKey', params.floorKey);
      if (params.seatQuery) searchParams.set('seatQuery', params.seatQuery);
      if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
      if (params.dateTo) searchParams.set('dateTo', params.dateTo);
      if (params.search) searchParams.set('search', params.search);
      searchParams.set('page', String(params.page ?? 1));
      return apiClient.get<AdminBookingListResponse>(
        `/api/v1/admin/bookings?${searchParams.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}

export function useAdminBookingDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'bookings', id],
    queryFn: () =>
      apiClient.get<AdminBookingDetail>(
        `/api/v1/admin/bookings/${id}`,
      ),
    enabled: !!id,
  });
}

export function useAdminRefundPreview(
  id: string | null,
  options: AdminRefundPreviewOptions,
  enabled = true,
) {
  return useQuery({
    queryKey: ['admin', 'bookings', id, 'refund-preview', options],
    queryFn: () => {
      const searchParams = new URLSearchParams({
        fullRefundOverride: String(options.fullRefundOverride ?? false),
        enteredTicketOverride: String(options.enteredTicketOverride ?? false),
      });
      return apiClient.get<RefundPreviewResponse>(
        `/api/v1/admin/bookings/${id}/refund-preview?${searchParams.toString()}`,
      );
    },
    enabled: Boolean(id) && enabled,
  });
}

export function useAdminRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      reason,
      fullRefundOverride,
      enteredTicketOverride,
    }: {
      id: string;
      reason: string;
      fullRefundOverride?: boolean;
      enteredTicketOverride?: boolean;
    }) =>
      apiClient.post(`/api/v1/admin/bookings/${id}/refund`, {
        reason,
        fullRefundOverride,
        enteredTicketOverride,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] });
    },
  });
}

export function useReservationExport() {
  return useMutation({
    mutationFn: async (
      filters: ReservationExportPayload,
    ): Promise<ReservationExportDownload> => {
      const { accessToken } = useAuthStore.getState();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(apiUrl('/api/v1/admin/bookings/export'), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(filters),
      });

      if (!response.ok) {
        throw new Error(await resolveExportErrorMessage(response));
      }

      const blob = await response.blob();
      const filename = resolveExportFilename(
        response.headers.get('content-disposition'),
      );

      downloadBlob(blob, filename);

      return { blob, filename };
    },
  });
}

async function resolveExportErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: unknown };
    if (typeof data.message === 'string') {
      return data.message;
    }
  } catch {
    // Fall through to the generic operator-facing message.
  }

  return '예약자 CSV 내보내기에 실패했습니다.';
}

function resolveExportFilename(contentDisposition: string | null): string {
  const fallback = 'reservation-export-raw.csv';
  if (!contentDisposition) {
    return fallback;
  }

  const match = /filename="?(?<filename>[^";]+)"?/i.exec(contentDisposition);
  return match?.groups?.['filename'] ?? fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
