'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  FieldMonitorLogFilter,
  FieldMonitorLogRow,
  FieldMonitorSummary,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';

const MONITOR_REFRESH_INTERVAL_MS = 10_000;

export interface FieldMonitorSummaryInput {
  eventId?: string;
  showtimeId?: string;
  enabled?: boolean;
}

export function fieldMonitorRefetchInterval(): number | false {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.visibilityState === 'visible'
    ? MONITOR_REFRESH_INTERVAL_MS
    : false;
}

export function useFieldMonitorSummary({
  eventId,
  showtimeId,
  enabled = true,
}: FieldMonitorSummaryInput) {
  const query = useQuery({
    queryKey: [
      'field',
      'monitor',
      'summary',
      eventId ?? '',
      showtimeId ?? '',
    ],
    queryFn: () =>
      apiClient.get<FieldMonitorSummary>(
        `/api/v1/field/monitor/summary?${buildQueryString({
          eventId,
          showtimeId,
        })}` as `/${string}`,
        { showErrorToast: false },
      ),
    enabled: enabled && Boolean(eventId && showtimeId),
    refetchInterval: fieldMonitorRefetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    summary: query.data,
    manualRefresh: query.refetch,
  };
}

export function useFieldMonitorLogs({
  enabled = true,
  ...filter
}: FieldMonitorLogFilter & { enabled?: boolean }) {
  const query = useQuery({
    queryKey: ['field', 'monitor', 'logs', filter],
    queryFn: () =>
      apiClient.get<FieldMonitorLogRow[]>(
        `/api/v1/field/monitor/logs?${buildQueryString(filter)}` as `/${string}`,
        { showErrorToast: false },
      ),
    enabled: enabled && Boolean(filter.eventId && filter.showtimeId),
    refetchInterval: fieldMonitorRefetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    logs: query.data ?? [],
    manualRefresh: query.refetch,
  };
}

function buildQueryString(
  values: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();

  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return;
    }

    params.set(key, String(value));
  });

  return params.toString();
}
