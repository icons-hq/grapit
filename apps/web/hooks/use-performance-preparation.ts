'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePerformanceDraftInput, PerformanceDraft, PerformancePreparation, SavePerformanceDraftInput } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { invalidatePublicPerformanceQueries } from '@/lib/catalog-freshness';

export function usePerformancePreparation(id: string, enabled = true) {
  return useQuery({ queryKey: ['admin', 'preparation', id], enabled: Boolean(id) && enabled,
    queryFn: () => apiClient.get<PerformancePreparation>(`/api/v1/admin/performances/${id}/preparation`) });
}

export function usePerformanceDrafts(performanceId?: string, enabled = true) {
  return useQuery({ queryKey: ['admin', 'performance-drafts', performanceId ?? 'all'], enabled,
    queryFn: () => apiClient.get<PerformanceDraft[]>(`/api/v1/admin/performance-drafts${performanceId ? `?performanceId=${performanceId}` : ''}`) });
}

export function usePerformanceDraft(id: string) {
  return useQuery({ queryKey: ['admin', 'performance-draft', id], enabled: Boolean(id),
    queryFn: () => apiClient.get<PerformanceDraft>(`/api/v1/admin/performance-drafts/${id}`) });
}

export function useSavePerformanceDraft() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: { id?: string; revision?: number } & CreatePerformanceDraftInput) => input.id
    ? apiClient.put<PerformanceDraft>(`/api/v1/admin/performance-drafts/${input.id}`, {
      expectedRevision: input.revision!, data: input.data, step: input.step,
    } satisfies SavePerformanceDraftInput, { showErrorToast: false })
    : apiClient.post<PerformanceDraft>('/api/v1/admin/performance-drafts', input, { showErrorToast: false }),
  onSuccess: (draft) => {
    client.setQueryData(['admin', 'performance-draft', draft.id], draft);
    void client.invalidateQueries({ queryKey: ['admin', 'performance-drafts'] });
  } });
}

export function useApplyPerformanceDraft() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, revision }: { id: string; revision: number }) =>
    apiClient.post<PerformanceDraft>(`/api/v1/admin/performance-drafts/${id}/apply`, { expectedRevision: revision }, { showErrorToast: false }),
  onSuccess: (draft) => {
    void client.invalidateQueries({ queryKey: ['admin', 'performance-drafts'] });
    void client.invalidateQueries({ queryKey: ['admin', 'performance', draft.performanceId] });
    void client.invalidateQueries({ queryKey: ['admin', 'preparation', draft.performanceId] });
    void client.invalidateQueries({ queryKey: ['admin', 'performances'] });
    invalidatePublicPerformanceQueries(client, draft.performanceId ?? undefined);
  } });
}
