'use client';
import { useQuery } from '@tanstack/react-query';
import type { SignupMonitoringQuery, SignupMonitoringResponse } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';

export function useSignupMonitoring(query: SignupMonitoringQuery) {
  const search = new URLSearchParams({ period: query.period });
  if (query.period === 'announcement' && query.since) search.set('since', query.since);
  return useQuery({
    queryKey: ['admin', 'users', 'signup-monitoring', query.period, query.since],
    queryFn: () => apiClient.get<SignupMonitoringResponse>(`/api/v1/admin/users/signup-monitoring?${search}`, { showErrorToast: false }),
    enabled: query.period !== 'announcement' || !!query.since,
    staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false,
  });
}
