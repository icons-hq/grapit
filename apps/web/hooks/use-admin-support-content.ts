'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export type SupportContentLocale = 'ko' | 'en' | 'th' | 'zh-CN' | 'zh-TW';
export type SupportContentReviewState =
  | 'draft'
  | 'review'
  | 'approved'
  | 'published'
  | 'archived';
export type SupportContentTranslationUse = 'manual' | 'assisted';
export type SupportContentType = 'faq' | 'notice';
export type SupportFaqCategory =
  | 'general'
  | 'event_info'
  | 'booking'
  | 'payment_error'
  | 'refund_unprocessed'
  | 'refund_dispute'
  | 'signup_failure'
  | 'account'
  | 'ticket_delivery'
  | 'seat_accessibility'
  | 'abuse_fraud'
  | 'other';
export type SupportNoticeCategory =
  | 'general'
  | 'urgent'
  | 'maintenance'
  | 'payment'
  | 'refund'
  | 'signup'
  | 'event';
export type SupportNoticePriority = 'low' | 'normal' | 'high' | 'urgent';
export type SupportNoticeStatus =
  | 'draft'
  | 'review'
  | 'scheduled'
  | 'published'
  | 'archived';

export interface SupportContentListFilters {
  type?: SupportContentType;
  locale?: SupportContentLocale | '';
  reviewState?: SupportContentReviewState | '';
  includeArchived?: boolean;
}

export interface AdminSupportFaq {
  id: string;
  category: SupportFaqCategory;
  locale: SupportContentLocale;
  question: string;
  answer: string;
  sortOrder: number;
  isPinned: boolean;
  reviewState: SupportContentReviewState;
  translationUse: 'none' | SupportContentTranslationUse;
  translationUseLabel: '자동 번역 검수본' | null;
  canPublish: boolean;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSupportNotice {
  id: string;
  category: SupportNoticeCategory;
  locale: SupportContentLocale;
  title: string;
  body: string;
  status: SupportNoticeStatus;
  priority: SupportNoticePriority;
  reviewState: SupportContentReviewState;
  translationUse: 'none' | SupportContentTranslationUse;
  translationUseLabel: '자동 번역 검수본' | null;
  canPublish: boolean;
  scheduledAt: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSupportContentList {
  faqs: AdminSupportFaq[];
  notices: AdminSupportNotice[];
}

export interface CreateSupportFaqInput {
  category: SupportFaqCategory;
  locale: SupportContentLocale;
  question: string;
  answer: string;
  sortOrder?: number;
  isPinned?: boolean;
  translationUse?: SupportContentTranslationUse;
}

export interface UpdateSupportFaqInput {
  category?: SupportFaqCategory;
  question?: string;
  answer?: string;
  sortOrder?: number;
  isPinned?: boolean;
  translationUse?: SupportContentTranslationUse;
}

export interface CreateSupportNoticeInput {
  category: SupportNoticeCategory;
  locale: SupportContentLocale;
  title: string;
  body: string;
  priority?: SupportNoticePriority;
  scheduledAt?: string | null;
  translationUse?: SupportContentTranslationUse;
}

export interface UpdateSupportNoticeInput {
  category?: SupportNoticeCategory;
  title?: string;
  body?: string;
  priority?: SupportNoticePriority;
  scheduledAt?: string | null;
  translationUse?: SupportContentTranslationUse;
}

export const supportContentQueryKey = ['admin', 'support-content'] as const;
export const operationsInboxQueryKey = ['admin', 'operations'] as const;

function buildSupportContentSearchParams(filters: SupportContentListFilters) {
  const params = new URLSearchParams();

  if (filters.type) params.set('type', filters.type);
  if (filters.locale) params.set('locale', filters.locale);
  if (filters.reviewState) params.set('reviewState', filters.reviewState);
  if (filters.includeArchived) params.set('includeArchived', 'true');

  return params;
}

function invalidateSupportContentFamilies(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.invalidateQueries({ queryKey: [...supportContentQueryKey] });
  queryClient.invalidateQueries({ queryKey: [...operationsInboxQueryKey] });
}

export function useAdminSupportContent(
  filters: SupportContentListFilters = {},
) {
  return useQuery({
    queryKey: [...supportContentQueryKey, filters],
    queryFn: () => {
      const params = buildSupportContentSearchParams(filters);
      const query = params.toString();
      return apiClient.get<AdminSupportContentList>(
        `/api/v1/admin/support-content${query ? `?${query}` : ''}`,
      );
    },
  });
}

export function useCreateSupportFaq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupportFaqInput) =>
      apiClient.post<AdminSupportFaq>(
        '/api/v1/admin/support-content/faqs',
        input,
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function useUpdateSupportFaq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSupportFaqInput }) =>
      apiClient.patch<AdminSupportFaq>(
        `/api/v1/admin/support-content/faqs/${id}`,
        input,
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function useReviewSupportFaq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<AdminSupportFaq>(
        `/api/v1/admin/support-content/faqs/${id}/review`,
        {},
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function usePublishSupportFaq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<AdminSupportFaq>(
        `/api/v1/admin/support-content/faqs/${id}/publish`,
        {},
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function useArchiveSupportFaq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<AdminSupportFaq>(
        `/api/v1/admin/support-content/faqs/${id}/archive`,
        {},
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function useCreateSupportNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupportNoticeInput) =>
      apiClient.post<AdminSupportNotice>(
        '/api/v1/admin/support-content/notices',
        input,
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function useUpdateSupportNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateSupportNoticeInput;
    }) =>
      apiClient.patch<AdminSupportNotice>(
        `/api/v1/admin/support-content/notices/${id}`,
        input,
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function useReviewSupportNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<AdminSupportNotice>(
        `/api/v1/admin/support-content/notices/${id}/review`,
        {},
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function usePublishSupportNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<AdminSupportNotice>(
        `/api/v1/admin/support-content/notices/${id}/publish`,
        {},
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}

export function useArchiveSupportNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<AdminSupportNotice>(
        `/api/v1/admin/support-content/notices/${id}/archive`,
        {},
      ),
    onSuccess: () => invalidateSupportContentFamilies(queryClient),
  });
}
