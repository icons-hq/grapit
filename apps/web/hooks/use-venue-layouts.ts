'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateVenueLayoutInput, VenueLayoutDetail, VenueLayoutSummary } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';

export function useVenueLayouts(venueName: string) {
  return useQuery({ queryKey: ['admin-venue-layouts', venueName], enabled: !!venueName.trim(), staleTime: 30_000,
    queryFn: () => apiClient.get<VenueLayoutSummary[]>(`/api/v1/admin/venue-layouts?${new URLSearchParams({ venueName })}`),
  });
}

export function useSaveVenueLayout() {
  const queries = useQueryClient();
  return useMutation({ mutationFn: (input: CreateVenueLayoutInput) =>
    apiClient.post<VenueLayoutDetail>('/api/v1/admin/venue-layouts', input),
  onSuccess: (layout) => queries.invalidateQueries({ queryKey: ['admin-venue-layouts', layout.venueName] }),
  });
}

export function loadVenueLayout(id: string) {
  return apiClient.get<VenueLayoutDetail>(`/api/v1/admin/venue-layouts/${id}`);
}
