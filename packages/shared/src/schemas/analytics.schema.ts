import type { AnalyticsCountsReport } from './analytics-counts.schema';
import { z } from 'zod';

export const ANALYTICS_NOTICE_VERSION = 'analytics-v2-replay';
export const ANALYTICS_RETENTION_DAYS = 90;
export const ANALYTICS_SESSION_MS = 30 * 60_000;
export const ANALYTICS_MAX_BATCH = 20;
export const analyticsEventNameSchema = z.enum(['page_view', 'performance_view', 'booking_start', 'queue_enter', 'seat_select', 'checkout_start', 'signup_start', 'link_click', 'scroll_depth', 'engagement', 'pointer_click']);
export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

/** Public catalogue identifiers only; customer/order/QR identifiers never survive. */
export function normalizeAnalyticsPath(value: string): string | null {
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\/(en|th|zh-CN|zh-TW)(?=\/|$)/, '').replace(/\/+$/, '') || '/';
  if (/^\/(admin|field|api|mypage|payment)(\/|$)/.test(path) || /^\/auth\//.test(path)) return null;
  const match = path.match(/^\/(performance|booking)\/([0-9a-f-]{36})(\/confirm)?$/i);
  if (match && z.string().uuid().safeParse(match[2]).success) return '/' + match[1] + '/' + match[2]!.toLowerCase() + (match[3] ?? '');
  if (path.startsWith('/booking/') || path.startsWith('/performance/')) return null;
  if (['/', '/auth', '/search', '/ranking', '/recent', '/upcoming', '/wishlist', '/categories', '/venues', '/ticket'].includes(path)) return path;
  if (/^\/genre\/[a-z_]+$/.test(path)) return path;
  if (path.startsWith('/legal')) return '/legal';
  if (/^\/(support|faq|notices)(\/|$)/.test(path)) return '/support';
  return '/other';
}
export function sanitizeAnalyticsCampaign(value: string | null | undefined): string | null {
  if (!value || !/^[\p{L}\p{N}_ .-]{1,80}$/u.test(value) || /\d{7,}/.test(value.replace(/20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])/g, ''))) return null;
  return value.trim().toLowerCase() || null;
}
const pathSchema = z.string().max(160).refine((p) => normalizeAnalyticsPath(p) === p);
const campaignSchema = z.string().refine((s) => sanitizeAnalyticsCampaign(s) === s).nullable();
export const analyticsTouchSchema = z.object({
  landingPath: pathSchema,
  referrerHost: z.string().max(120).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/).nullable(),
  source: campaignSchema, medium: campaignSchema, campaign: campaignSchema, term: campaignSchema, content: campaignSchema,
}).strict();
export type AnalyticsTouch = z.infer<typeof analyticsTouchSchema>;
export const analyticsEventSchema = z.object({
  id: z.string().uuid(), pageId: z.string().uuid(), name: analyticsEventNameSchema,
  path: pathSchema, previousPath: pathSchema.nullable(), at: z.string().datetime(),
  props: z.object({ performanceId: z.string().uuid().optional(), count: z.number().int().min(1).max(20).optional(),
    target: pathSchema.optional(), depth: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]).optional(), seconds: z.number().int().min(1).max(1800).optional(),
    x: z.number().int().min(0).max(100000).optional(), y: z.number().int().min(0).max(100000).optional(),
    viewportWidth: z.number().int().min(1).max(10000).optional(), viewportHeight: z.number().int().min(1).max(10000).optional(),
    documentWidth: z.number().int().min(1).max(100000).optional(), documentHeight: z.number().int().min(1).max(100000).optional(),
    scrollX: z.number().int().min(0).max(100000).optional(), scrollY: z.number().int().min(0).max(100000).optional(),
    pointer: z.enum(['mouse', 'touch', 'pen', 'keyboard']).optional(),
    element: z.enum(['link', 'button', 'input', 'image', 'other']).optional(),
    label: z.enum(['booking', 'signup', 'login', 'search', 'menu', 'navigation', 'other']).optional(),
  }).strict(),
}).strict().superRefine((event, ctx) => {
  const allowed: Record<AnalyticsEventName, string[]> = { page_view: [], performance_view: ['performanceId'], booking_start: ['performanceId'], queue_enter: ['performanceId'], seat_select: ['performanceId', 'count'], checkout_start: ['performanceId', 'count'], signup_start: [], link_click: ['target'], scroll_depth: ['depth'], engagement: ['seconds'], pointer_click: ['x', 'y', 'viewportWidth', 'viewportHeight', 'documentWidth', 'documentHeight', 'scrollX', 'scrollY', 'pointer', 'element', 'label'] };
  if (Object.keys(event.props).some((key) => !allowed[event.name].includes(key))) ctx.addIssue({ code: 'custom', message: '허용되지 않은 이벤트 속성입니다' });
  if (allowed[event.name].filter((key) => key !== 'count').some((key) => !(key in event.props))) ctx.addIssue({ code: 'custom', message: '이벤트 속성이 필요합니다' });
});
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export const analyticsBatchSchema = z.object({
  collectionConsent: z.literal(true), overseasConsent: z.literal(true),
  consentVersion: z.literal(ANALYTICS_NOTICE_VERSION), consentedAt: z.string().datetime(), visitorId: z.string().uuid(), sessionId: z.string().uuid(), touch: analyticsTouchSchema,
  device: z.enum(['mobile', 'tablet', 'desktop']), browser: z.enum(['chrome', 'safari', 'edge', 'firefox', 'samsung', 'other']),
  os: z.enum(['android', 'ios', 'windows', 'macos', 'linux', 'other']), screen: z.enum(['small', 'medium', 'large']),
  language: z.enum(['ko', 'en', 'th', 'zh', 'other']), events: z.array(analyticsEventSchema).min(1).max(ANALYTICS_MAX_BATCH),
}).strict().refine((batch) => Date.parse(batch.consentedAt) >= Date.now() - 90 * 86400000 && Date.parse(batch.consentedAt) <= Date.now() + 300000, '선택 동의 시각이 만료되었거나 유효하지 않습니다')
  .refine((batch) => batch.events.every((event) => Date.parse(event.at) >= Date.parse(batch.consentedAt)), '동의 이전의 행동은 수집할 수 없습니다');
export type AnalyticsBatch = z.infer<typeof analyticsBatchSchema>;
export const analyticsIdentifySchema = z.object({ visitorId: z.string().uuid(), sessionId: z.string().uuid(), consentVersion: z.literal(ANALYTICS_NOTICE_VERSION) }).strict();
export const analyticsSettingsSchema = z.object({ enabled: z.boolean(), policyAcknowledged: z.boolean().optional() }).strict().refine((s) => !s.enabled || s.policyAcknowledged === true, '고지·동의·시행 확인이 필요합니다');
export const analyticsQuerySchema = z.object({ since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }), granularity: z.enum(['hour', 'day']).default('hour') }).strict().refine(({ since, until }) => {
  const duration = Date.parse(until) - Date.parse(since); return duration > 0 && duration <= 90 * 86400000;
}, '조회 기간은 90일 이내여야 합니다');
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export interface AnalyticsConfig { enabled: boolean; environmentEnabled: boolean; noticeVersion: string; rawRetentionDays: number; aggregateEnabled?: boolean; aggregateEnvironmentEnabled?: boolean; }
export interface AnalyticsReport {
  aggregate?: AnalyticsCountsReport;
  since: string; until: string; generatedAt: string; config: AnalyticsConfig; lastCollectedAt: string | null; rollupThrough: string | null;
  summary: { visitors: number; sessions: number; pageViews: number; returningVisitors: number; previousVisitors: number; activeVisitors: number | null; signups: number; paidOrders: number; cancelledOrders: number; };
  trend: Array<{ hour: string; visitors: number; sessions: number; pageViews: number }>;
  funnel: Array<{ name: string; count: number; rate: number; dropoff: number }>;
  signupFunnel: Array<{ name: string; count: number; rate: number; dropoff: number }>;
  sources: Array<{ source: string; medium: string; campaign: string; term: string; content: string; sessions: number; signups: number; paidMembers: number }>;
  attribution: Array<{ model: 'first' | 'last'; source: string; campaign: string; signups: number; paidMembers: number }>;
  landingPages: Array<{ path: string; sessions: number; singlePageSessions: number }>;
  performances: Array<{ id: string; title: string; views: number; bookingSessions: number; checkoutSessions: number }>;
  engagement: Array<{ path: string; views: number; averageSeconds: number; deepScrolls: number; exits: number }>;
  dimensions: Array<{ dimension: string; value: string; sessions: number }>;
}
