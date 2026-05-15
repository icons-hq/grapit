'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  AdminSeatOperationHistory,
  AdminSeatOperationRequest,
} from '@grabit/shared';

type SeatInventoryOperation = Extract<
  AdminSeatOperationRequest['operation'],
  'seat.disable' | 'seat.reactivate'
>;

export interface AdminSeatOperationPayload {
  showtimeId: string;
  seatKey: string;
  reservationId?: string;
  reason: string;
}

export interface AdminManualOpenSeatPayload {
  reservationId: string;
  reason: string;
}

export interface AdminSeatOperationHistoryFilters {
  showtimeId: string;
  seatKey?: string;
  limit?: number;
}

export interface AdminSeatOperationHistoryResponse {
  rows: AdminSeatOperationHistory[];
}

export const adminSeatOperationQueryKeys = {
  all: ['admin', 'seat-operations'] as const,
  history: (filters: AdminSeatOperationHistoryFilters) =>
    [
      ...adminSeatOperationQueryKeys.all,
      'history',
      normalizeHistoryFilters(filters),
    ] as const,
};

export function useAdminSeatOperationHistory(
  filters: AdminSeatOperationHistoryFilters,
) {
  const normalized = normalizeHistoryFilters(filters);

  return useQuery({
    queryKey: adminSeatOperationQueryKeys.history(normalized),
    queryFn: () =>
      apiClient.get<AdminSeatOperationHistoryResponse>(
        buildHistoryPath(normalized),
      ),
    enabled: normalized.showtimeId.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useDisableAdminSeat() {
  return useSeatOperationMutation('seat.disable');
}

export function useReactivateAdminSeat() {
  return useSeatOperationMutation('seat.reactivate');
}

export function useAdminManualOpenSeat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ reservationId, reason }: AdminManualOpenSeatPayload) =>
      apiClient.post<{ message: string }>(
        `/api/v1/admin/bookings/${reservationId}/manual-open`,
        {
          reason: reason.trim(),
          confirmed: true,
        },
      ),
    onSuccess: () => {
      invalidateSeatOperationSurfaces(queryClient);
    },
  });
}

function useSeatOperationMutation(operation: SeatInventoryOperation) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AdminSeatOperationPayload) =>
      apiClient.post<AdminSeatOperationHistory>(
        endpointForOperation(operation),
        compactPayload({
          showtimeId: payload.showtimeId.trim(),
          seatKey: payload.seatKey.trim(),
          reservationId: payload.reservationId?.trim(),
          reason: payload.reason.trim(),
          confirmed: true,
        }),
      ),
    onSuccess: () => {
      invalidateSeatOperationSurfaces(queryClient);
    },
  });
}

function invalidateSeatOperationSurfaces(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] });
  queryClient.invalidateQueries({ queryKey: adminSeatOperationQueryKeys.all });
}

function endpointForOperation(operation: SeatInventoryOperation): `/${string}` {
  if (operation === 'seat.disable') {
    return '/api/v1/admin/seat-operations/disable';
  }

  return '/api/v1/admin/seat-operations/reactivate';
}

function normalizeHistoryFilters(
  filters: AdminSeatOperationHistoryFilters,
): Required<Pick<AdminSeatOperationHistoryFilters, 'showtimeId' | 'limit'>> &
  Pick<AdminSeatOperationHistoryFilters, 'seatKey'> {
  return {
    showtimeId: filters.showtimeId.trim(),
    seatKey: filters.seatKey?.trim() || undefined,
    limit: filters.limit ?? 50,
  };
}

function buildHistoryPath(
  filters: ReturnType<typeof normalizeHistoryFilters>,
): `/${string}` {
  const params = new URLSearchParams();
  params.set('showtimeId', filters.showtimeId);
  if (filters.seatKey) {
    params.set('seatKey', filters.seatKey);
  }
  params.set('limit', String(filters.limit));

  return `/api/v1/admin/seat-operations/history?${params.toString()}`;
}

function compactPayload(
  payload: AdminSeatOperationPayload & { confirmed: true },
): AdminSeatOperationPayload & { confirmed: true } {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  ) as AdminSeatOperationPayload & { confirmed: true };
}
