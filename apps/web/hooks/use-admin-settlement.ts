'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AdminSettlementReconciliation,
  SettlementExportDataset,
  SettlementSummary,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { apiUrl } from '@/lib/api-url';
import { useAuthStore } from '@/stores/use-auth-store';

export interface AdminSettlementFilters {
  eventId?: string;
  showtimeId?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  reservationStatus?: string;
  entryStatus?: string;
  refundStatus?: string;
}

export interface AdminSettlementExportPayload {
  eventId: string;
  showtimeId?: string;
  dateFrom?: string;
  dateTo?: string;
  dataset: SettlementExportDataset;
  reason: string;
}

export interface AdminSettlementExportDownload {
  blob: Blob;
  filename: string;
}

export function useAdminSettlementSummary(
  filters: AdminSettlementFilters,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;

  return useQuery({
    queryKey: ['admin', 'settlement', 'summary', filters],
    queryFn: () =>
      apiClient.get<SettlementSummary>(
        `/api/v1/admin/settlement/summary?${buildApiQuery(filters)}` as `/${string}`,
        { showErrorToast: false },
      ),
    enabled: enabled && Boolean(filters.eventId),
  });
}

export function useAdminSettlementReconciliation(
  filters: AdminSettlementFilters,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;

  return useQuery({
    queryKey: ['admin', 'settlement', 'reconciliation', filters.eventId],
    queryFn: () =>
      apiClient.get<AdminSettlementReconciliation>(
        `/api/v1/admin/settlement/reconciliation?${buildReconciliationQuery(filters)}` as `/${string}`,
        { showErrorToast: false },
      ),
    enabled: enabled && Boolean(filters.eventId),
  });
}

export function useAdminSettlementExport() {
  return useMutation({
    mutationFn: async (
      payload: AdminSettlementExportPayload,
    ): Promise<AdminSettlementExportDownload> => {
      const { accessToken } = useAuthStore.getState();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(apiUrl('/api/v1/admin/settlement/export'), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(compactExportPayload(payload)),
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

function buildReconciliationQuery(filters: AdminSettlementFilters): string {
  const params = new URLSearchParams();

  if (filters.eventId && filters.eventId !== 'all') {
    params.set('eventId', filters.eventId);
  }

  return params.toString();
}

function buildApiQuery(filters: AdminSettlementFilters): string {
  const params = new URLSearchParams();

  (['eventId', 'showtimeId', 'dateFrom', 'dateTo'] as const).forEach((key) => {
    const value = filters[key];
    if (value && value !== 'all') {
      params.set(key, value);
    }
  });

  return params.toString();
}

function compactExportPayload(
  payload: AdminSettlementExportPayload,
): AdminSettlementExportPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== ''),
  ) as AdminSettlementExportPayload;
}

async function resolveExportErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: unknown };
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message;
    }
  } catch {
    // Fall through to the generic operator-facing message.
  }

  return '정산 CSV 내보내기에 실패했습니다.';
}

function resolveExportFilename(contentDisposition: string | null): string {
  const fallback = 'settlement-export.csv';
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match = /filename\*=UTF-8''(?<filename>[^;]+)/i.exec(contentDisposition);
  if (utf8Match?.groups?.['filename']) {
    return decodeURIComponent(utf8Match.groups['filename']);
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
