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
import type {
  ReservationListItem,
  ReservationDetail,
  AdminBookingDetail,
  AdminBookingFunnelStatus,
  AdminBookingListItem,
  AdminReservationExportFilter,
  BookingStats,
  PaymentStatus,
  TicketEmailDelivery,
  UserProfile,
} from '@grabit/shared';

export type ReservationExportPayload = AdminReservationExportFilter & {
  exportType: 'raw_pii';
  reason: string;
};

export interface ReservationExportDownload {
  blob: Blob;
  filename: string;
}

export function useMyReservations(status?: string) {
  return useQuery({
    queryKey: ['reservations', 'me', status ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status && status !== 'all') params.set('status', status);
      return apiClient.get<ReservationListItem[]>(
        `/api/v1/users/me/reservations${params.toString() ? `?${params.toString()}` : ''}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}

export function useReservationDetail(id: string) {
  return useQuery({
    queryKey: ['reservations', id],
    queryFn: () =>
      apiClient.get<ReservationDetail>(`/api/v1/reservations/${id}`),
    enabled: !!id,
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/api/v1/reservations/${id}/refund`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });
}

export function useRequestAccountEmailVerification() {
  return useMutation({
    mutationFn: ({ email, locale = 'ko' }: { email: string; locale?: string }) =>
      apiClient.post<{ message: string; expiresAt: string }>(
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
  funnelStatus?: AdminBookingFunnelStatus | 'all';
  paymentStatus?: PaymentStatus | 'all';
  paymentMethod?: string;
  audienceRegion?: 'domestic' | 'overseas' | 'all';
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
      if (params.funnelStatus && params.funnelStatus !== 'all')
        searchParams.set('funnelStatus', params.funnelStatus);
      if (params.paymentStatus && params.paymentStatus !== 'all')
        searchParams.set('paymentStatus', params.paymentStatus);
      if (params.paymentMethod && params.paymentMethod !== 'all')
        searchParams.set('paymentMethod', params.paymentMethod);
      if (params.audienceRegion && params.audienceRegion !== 'all')
        searchParams.set('audienceRegion', params.audienceRegion);
      if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
      if (params.dateTo) searchParams.set('dateTo', params.dateTo);
      if (params.search) searchParams.set('search', params.search);
      searchParams.set('page', String(params.page ?? 1));
      return apiClient.get<{
        bookings: AdminBookingListItem[];
        stats: BookingStats;
        total: number;
      }>(`/api/v1/admin/bookings?${searchParams.toString()}`);
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

export function useAdminRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/api/v1/admin/bookings/${id}/refund`, { reason }),
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
