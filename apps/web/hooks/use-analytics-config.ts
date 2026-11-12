'use client';
import { useQuery } from '@tanstack/react-query';
import type { AnalyticsConfig } from '@grabit/shared';
import { apiUrl } from '@/lib/api-url';
export function useAnalyticsConfig(enabled = true) {
  return useQuery({ queryKey: ['analytics', 'config'], enabled,
    queryFn: async () => { const response = await fetch(apiUrl('/api/v1/analytics/config'), { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(1500) }); if (!response.ok) throw new Error('Analytics config unavailable'); return response.json() as Promise<AnalyticsConfig>; },
    staleTime: (query) => query.state.data?.enabled || query.state.data?.aggregateEnabled ? 20000 : 300000,
    refetchInterval: (query) => query.state.status === 'error' ? false : query.state.data?.enabled || query.state.data?.aggregateEnabled ? 30000 : query.state.data?.environmentEnabled || query.state.data?.aggregateEnvironmentEnabled ? 300000 : false,
    retry: false,
  });
}
