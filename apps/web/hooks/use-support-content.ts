'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export type SupportContentLocale = 'ko' | 'en' | 'th' | 'zh-CN';
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

export interface PublicSupportFaq {
  id: string;
  category: SupportFaqCategory;
  locale: SupportContentLocale;
  question: string;
  answer: string;
  sortOrder: number;
  isPinned: boolean;
  updatedAt: string;
}

export interface PublicSupportNotice {
  id: string;
  category: SupportNoticeCategory;
  locale: SupportContentLocale;
  title: string;
  body: string;
  priority: SupportNoticePriority;
  publishedAt: string | null;
}

export interface PublicSupportContent {
  faqs: PublicSupportFaq[];
  notices: PublicSupportNotice[];
}

export function useSupportContent(locale: SupportContentLocale) {
  return useQuery({
    queryKey: ['support-content', locale],
    queryFn: () =>
      apiClient.get<PublicSupportContent>(
        `/api/v1/support-content?locale=${encodeURIComponent(locale)}`,
        { showErrorToast: false },
      ),
  });
}
