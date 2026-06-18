'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  BenefitConfiguration,
  BenefitConfigurationChangeRecord,
  BenefitDefinition,
  BenefitRunRecord,
  BenefitRunRecordListResponse,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { apiUrl } from '@/lib/api-url';
import { useAuthStore } from '@/stores/use-auth-store';

export interface SaveBenefitConfigurationPayload {
  showtimeId: string;
  benefits: BenefitDefinition[];
  reason?: string;
}

export interface RunBenefitTestPayload {
  showtimeId: string;
  configurationId?: string | null;
  operatorProvidedSeedRef?: string;
  configurationSnapshot?: {
    active: false;
    sourceConfigurationId?: string | null;
    capturedAt?: string;
    benefits: BenefitDefinition[];
  };
}

export interface RunBenefitLivePayload {
  showtimeId: string;
  configurationId: string;
  reason?: string;
}

export interface RollbackBenefitRunPayload {
  showtimeId: string;
  sourceRunId: string;
  reason: string;
}

export interface BenefitExportDownload {
  blob: Blob;
  filename: string;
}

export const adminBenefitsQueryKeys = {
  all: ['admin', 'benefits'] as const,
  configuration: (showtimeId: string) =>
    [...adminBenefitsQueryKeys.all, 'configuration', showtimeId.trim()] as const,
  changes: (showtimeId: string) =>
    [...adminBenefitsQueryKeys.all, 'changes', showtimeId.trim()] as const,
  runs: (showtimeId: string) =>
    [...adminBenefitsQueryKeys.all, 'runs', showtimeId.trim()] as const,
};

export function useAdminBenefitConfiguration(showtimeId: string) {
  const normalizedShowtimeId = showtimeId.trim();

  return useQuery({
    queryKey: adminBenefitsQueryKeys.configuration(normalizedShowtimeId),
    queryFn: () =>
      apiClient.get<BenefitConfiguration | null>(
        `/api/v1/admin/benefits/showtimes/${normalizedShowtimeId}/configuration`,
      ),
    enabled: normalizedShowtimeId.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useAdminBenefitConfigurationChanges(showtimeId: string) {
  const normalizedShowtimeId = showtimeId.trim();

  return useQuery({
    queryKey: adminBenefitsQueryKeys.changes(normalizedShowtimeId),
    queryFn: () =>
      apiClient.get<BenefitConfigurationChangeRecord[]>(
        `/api/v1/admin/benefits/showtimes/${normalizedShowtimeId}/configuration/changes?limit=20`,
      ),
    enabled: normalizedShowtimeId.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useAdminBenefitRuns(showtimeId: string) {
  const normalizedShowtimeId = showtimeId.trim();

  return useQuery({
    queryKey: adminBenefitsQueryKeys.runs(normalizedShowtimeId),
    queryFn: () =>
      apiClient.get<BenefitRunRecordListResponse>(
        `/api/v1/admin/benefits/showtimes/${normalizedShowtimeId}/runs`,
      ),
    enabled: normalizedShowtimeId.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useSaveAdminBenefitConfiguration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SaveBenefitConfigurationPayload) =>
      apiClient.put<BenefitConfiguration>(
        `/api/v1/admin/benefits/showtimes/${payload.showtimeId.trim()}/configuration`,
        {
          benefits: payload.benefits,
          reason: payload.reason?.trim() || undefined,
        },
      ),
    onSuccess: (_data, payload) => {
      invalidateShowtimeBenefitQueries(queryClient, payload.showtimeId);
    },
  });
}

export function useRunAdminBenefitTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: RunBenefitTestPayload) =>
      apiClient.post<BenefitRunRecord>(
        `/api/v1/admin/benefits/showtimes/${payload.showtimeId.trim()}/test-runs`,
        {
          configurationId: payload.configurationId ?? undefined,
          operatorProvidedSeedRef:
            payload.operatorProvidedSeedRef?.trim() || undefined,
          configurationSnapshot: payload.configurationSnapshot,
        },
      ),
    onSuccess: (_data, payload) => {
      invalidateShowtimeBenefitQueries(queryClient, payload.showtimeId);
    },
  });
}

export function useRunAdminBenefitLive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: RunBenefitLivePayload) =>
      apiClient.post<BenefitRunRecord>(
        `/api/v1/admin/benefits/showtimes/${payload.showtimeId.trim()}/live-runs`,
        {
          configurationId: payload.configurationId,
          reason: payload.reason?.trim() || undefined,
          confirmed: true,
        },
      ),
    onSuccess: (_data, payload) => {
      invalidateShowtimeBenefitQueries(queryClient, payload.showtimeId);
    },
  });
}

export function useRollbackAdminBenefitRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: RollbackBenefitRunPayload) =>
      apiClient.post<BenefitRunRecord>(
        `/api/v1/admin/benefits/showtimes/${payload.showtimeId.trim()}/rollback`,
        {
          sourceRunId: payload.sourceRunId,
          sourceRunMode: 'live',
          reason: payload.reason.trim(),
          confirmed: true,
        },
      ),
    onSuccess: (_data, payload) => {
      invalidateShowtimeBenefitQueries(queryClient, payload.showtimeId);
    },
  });
}

export function useAdminBenefitExport() {
  return useMutation({
    mutationFn: async ({
      path,
      fallbackFilename,
    }: {
      path: `/${string}`;
      fallbackFilename: string;
    }): Promise<BenefitExportDownload> => {
      const { accessToken } = useAuthStore.getState();
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(apiUrl(path), {
        method: 'GET',
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        throw new Error(await resolveExportErrorMessage(response));
      }

      const blob = await response.blob();
      const filename = resolveExportFilename(
        response.headers.get('content-disposition'),
        fallbackFilename,
      );
      downloadBlob(blob, filename);

      return { blob, filename };
    },
  });
}

function invalidateShowtimeBenefitQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  showtimeId: string,
) {
  const normalizedShowtimeId = showtimeId.trim();
  queryClient.invalidateQueries({
    queryKey: adminBenefitsQueryKeys.configuration(normalizedShowtimeId),
  });
  queryClient.invalidateQueries({
    queryKey: adminBenefitsQueryKeys.changes(normalizedShowtimeId),
  });
  queryClient.invalidateQueries({
    queryKey: adminBenefitsQueryKeys.runs(normalizedShowtimeId),
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

  return '혜택 CSV 내보내기에 실패했습니다.';
}

function resolveExportFilename(
  contentDisposition: string | null,
  fallbackFilename: string,
): string {
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const match = /filename="?(?<filename>[^";]+)"?/i.exec(contentDisposition);
  return match?.groups?.['filename'] ?? fallbackFilename;
}

function downloadBlob(blob: Blob, filename: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
