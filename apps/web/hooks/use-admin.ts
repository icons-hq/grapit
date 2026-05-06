'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  ConsentAuditFilters,
  ConsentAuditRow,
} from '@/components/admin/consent-audit-table';
import type {
  PerformanceListResponse,
  PerformanceWithDetails,
  Banner,
  CreatePerformanceInput,
  UpdatePerformanceInput,
  CreateBannerInput,
  SeatMapConfigInput,
} from '@grabit/shared';

export type TranslationTargetLocale = 'en' | 'th' | 'zh-CN' | 'zh-TW';
export type TranslationQueueStatus =
  | 'draft'
  | 'review'
  | 'published'
  | 'stale'
  | 'legal_blocked';
export type TranslationQueueFilterStatus = Exclude<
  TranslationQueueStatus,
  'legal_blocked'
>;

export interface TranslationQueueFilters {
  contentType?: string;
  locale?: TranslationTargetLocale | '';
  status?: TranslationQueueFilterStatus | '';
  updatedFrom?: string;
  updatedTo?: string;
}

export interface CreateTranslationSourceInput {
  entityType: string;
  entityId: string;
  field: string;
  sourceText: string;
}

export interface TranslationSource {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  sourceLocale: 'ko';
  sourceText: string;
  contentHash: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface TranslationDraft {
  id: string;
  sourceId: string;
  contentType: string;
  field?: string;
  sourceTitle?: string;
  sourceText?: string;
  locale: TranslationTargetLocale;
  status: TranslationQueueStatus;
  translatedText: string;
  updatedAt: string;
  reviewerId: string | null;
  automaticTranslationLabel?: boolean;
  isMachineTranslated?: boolean;
  translatedBy?: string;
}

export interface ReviewTranslationDraftInput {
  draftId: string;
  translatedText: string;
}

function toApiDateTime(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function buildConsentAuditSearchParams(filters: ConsentAuditFilters) {
  const params = new URLSearchParams();
  const user = filters.user?.trim();

  if (user) {
    if (user.includes('@')) {
      params.set('email', user);
    } else {
      params.set('userId', user);
    }
  }
  if (filters.item) params.set('itemKey', filters.item);
  if (filters.version) params.set('version', filters.version);
  if (filters.language) params.set('language', filters.language);
  if (filters.from) params.set('from', toApiDateTime(filters.from) ?? filters.from);
  if (filters.to) params.set('to', toApiDateTime(filters.to) ?? filters.to);
  if (filters.ip) params.set('ip', filters.ip);

  return params;
}

function buildTranslationQueueSearchParams(filters: TranslationQueueFilters) {
  const params = new URLSearchParams();

  if (filters.contentType) params.set('contentType', filters.contentType);
  if (filters.locale) params.set('locale', filters.locale);
  if (filters.status) params.set('status', filters.status);
  if (filters.updatedFrom) {
    params.set(
      'updatedFrom',
      toApiDateTime(filters.updatedFrom) ?? filters.updatedFrom,
    );
  }
  if (filters.updatedTo) {
    params.set(
      'updatedTo',
      toApiDateTime(filters.updatedTo) ?? filters.updatedTo,
    );
  }

  return params;
}

// Performance list for admin table
export function useAdminPerformances(params: {
  status?: string;
  search?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'performances', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params.status) searchParams.set('status', params.status);
      if (params.search) searchParams.set('search', params.search);
      searchParams.set('page', String(params.page ?? 1));
      return apiClient.get<PerformanceListResponse>(
        `/api/v1/admin/performances?${searchParams.toString()}`,
      );
    },
  });
}

export function useTranslationQueue(filters: TranslationQueueFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'translations', filters],
    queryFn: () => {
      const searchParams = buildTranslationQueueSearchParams(filters);
      const query = searchParams.toString();
      return apiClient.get<TranslationDraft[]>(
        `/api/v1/admin/translations/queue${query ? `?${query}` : ''}`,
      );
    },
  });
}

export function useCreateTranslationSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTranslationSourceInput) =>
      apiClient.post<TranslationSource>(
        '/api/v1/admin/translations/sources',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'translations'] });
    },
  });
}

export function useGenerateTranslationDrafts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      apiClient.post<TranslationDraft[]>(
        `/api/v1/admin/translations/sources/${sourceId}/drafts`,
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'translations'] });
    },
  });
}

export function useReviewTranslationDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      draftId,
      translatedText,
    }: ReviewTranslationDraftInput) =>
      apiClient.post<TranslationDraft>(
        `/api/v1/admin/translations/drafts/${draftId}/review`,
        { translatedText },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'translations'] });
    },
  });
}

export function usePublishTranslationDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) =>
      apiClient.post<TranslationDraft>(
        `/api/v1/admin/translations/drafts/${draftId}/publish`,
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'translations'] });
    },
  });
}

export function useAdminConsentAudit(filters: ConsentAuditFilters) {
  return useQuery({
    queryKey: ['admin', 'consent-audit', filters],
    queryFn: () => {
      const searchParams = buildConsentAuditSearchParams(filters);
      const query = searchParams.toString();
      return apiClient.get<ConsentAuditRow[]>(
        `/api/v1/admin/consent-audit${query ? `?${query}` : ''}`,
      );
    },
  });
}

// Performance detail for edit form
export function useAdminPerformanceDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'performance', id],
    queryFn: () =>
      apiClient.get<PerformanceWithDetails>(`/api/v1/performances/${id}`),
    enabled: !!id,
  });
}

// Create performance
export function useCreatePerformance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePerformanceInput) =>
      apiClient.post<PerformanceWithDetails>(
        '/api/v1/admin/performances',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'performances'] });
    },
  });
}

// Update performance
export function useUpdatePerformance(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdatePerformanceInput) =>
      apiClient.put<PerformanceWithDetails>(
        `/api/v1/admin/performances/${id}`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'performances'] });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'performance', id],
      });
    },
  });
}

// Delete performance
export function useDeletePerformance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/api/v1/admin/performances/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'performances'] });
    },
  });
}

// Presigned upload URL
export function usePresignedUpload() {
  return useMutation({
    mutationFn: (params: {
      folder: string;
      contentType: string;
      extension: string;
    }) =>
      apiClient.post<{
        uploadUrl: string;
        publicUrl: string;
        key: string;
        mode: 'local' | 'r2';
      }>('/api/v1/admin/upload/presigned', params),
  });
}

// Save seat map config
export function useSaveSeatMap(performanceId: string) {
  return useMutation({
    mutationFn: (data: {
      svgUrl: string;
      seatConfig: SeatMapConfigInput;
      totalSeats: number;
    }) =>
      apiClient.post(
        `/api/v1/admin/performances/${performanceId}/seat-map`,
        data,
      ),
  });
}

// Banner hooks
export function useAdminBanners() {
  return useQuery({
    queryKey: ['admin', 'banners'],
    queryFn: () => apiClient.get<Banner[]>('/api/v1/admin/banners'),
  });
}

export function useCreateBanner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBannerInput) =>
      apiClient.post<Banner>('/api/v1/admin/banners', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'banners'] });
    },
  });
}

// Update banner (edit individual banner fields)
export function useUpdateBanner(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CreateBannerInput>) =>
      apiClient.put<Banner>(`/api/v1/admin/banners/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'banners'] });
    },
  });
}

export function useDeleteBanner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/api/v1/admin/banners/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'banners'] });
    },
  });
}

export function useReorderBanners() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      apiClient.put('/api/v1/admin/banners/reorder', { orderedIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'banners'] });
    },
  });
}
