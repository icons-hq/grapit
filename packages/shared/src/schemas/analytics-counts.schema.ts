import { z } from 'zod';
import { normalizeAnalyticsPath } from './analytics.schema';

export const analyticsCountPageSchema = z.enum(['home', 'performance', 'booking', 'auth', 'search', 'support', 'other']);
export const analyticsCountNameSchema = z.enum(['page_view', 'performance_view', 'booking_start', 'signup_start', 'queue_enter', 'seat_select', 'checkout_start', 'link_click', 'scroll_75', 'engaged_30s']);
export const analyticsCountsSchema = z.object({ counts: z.array(z.object({
  page: analyticsCountPageSchema, name: analyticsCountNameSchema, count: z.number().int().min(1).max(20),
}).strict()).min(1).max(20) }).strict().refine((batch) => batch.counts.reduce((sum, row) => sum + row.count, 0) <= 20, '최대 20회 집계만 전송할 수 있습니다');
export type AnalyticsCounts = z.infer<typeof analyticsCountsSchema>;
export type AnalyticsCountPage = z.infer<typeof analyticsCountPageSchema>;
export type AnalyticsCountName = z.infer<typeof analyticsCountNameSchema>;
export function analyticsCountPage(pathname: string): AnalyticsCountPage | null {
  const path = normalizeAnalyticsPath(pathname.replace(/^\/(ko|en|th|zh-CN)(?=\/|$)/, '') || '/');
  if (path === null || path === '/legal') return null;
  if (path === '/') return 'home';
  if (path.startsWith('/performance/')) return 'performance';
  if (path.startsWith('/booking/')) return 'booking';
  if (path === '/auth') return 'auth';
  if (path === '/search') return 'search';
  if (path === '/support') return 'support';
  return 'other';
}
export interface AnalyticsCountsReport {
  startedAt: string | null;
  updatedAt: string | null;
  counts: Array<{ hour: string; page: AnalyticsCountPage; name: AnalyticsCountName; count: number }>;
  history: Array<{ hour: string; source: string; metric: string; count: number; sampled: boolean; observedThrough: string }>;
}
export const analyticsTrafficHistoryImportSchema = z.object({
  observedThrough: z.string().datetime({ offset: true }),
  rows: z.array(z.object({
    bucket: z.string().datetime({ offset: true }).refine((value) => Date.parse(value) % 3600000 === 0),
    source: z.enum(['cloudflare_zone', 'cloudflare_public_html']),
    metric: z.enum(['requests', 'html_page_views', 'html_requests_estimated']),
    count: z.number().int().min(0).max(1000000000), sampled: z.boolean(),
  }).strict()).min(1).max(5000),
}).strict().refine(({ rows }) => new Set(rows.map((r) => `${r.bucket}:${r.source}:${r.metric}`)).size === rows.length, '중복 시간대/지표입니다');
