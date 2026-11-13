import { z } from 'zod';

export const AUDIENCE_CONSENT_VERSION = 'interests-v1';
export const AUDIENCE_RETENTION_DAYS = 90;
export const GA4_CONSENT_VERSION = 'google-interests-v1';
export const audienceTagKindSchema = z.enum(['artist', 'activity', 'benefit']);
export type AudienceTagKind = z.infer<typeof audienceTagKindSchema>;
const label = z.string().trim().min(1).max(80);
export const audienceTagInputSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_-]{1,59}$/),
  kind: audienceTagKindSchema,
  labels: z.object({ ko: label, en: label, th: label.optional(), 'zh-CN': label.optional() }).strict(),
  active: z.boolean().default(true),
}).strict();
export type AudienceTagInput = z.infer<typeof audienceTagInputSchema>;
export type AudienceTag = AudienceTagInput & { id: string };
const tagIds = z.array(z.string().uuid()).max(15).refine((ids) => new Set(ids).size === ids.length, '중복된 관심 태그입니다');
export const audiencePreferencesInputSchema = z.object({
  tagIds,
  consentVersion: z.literal(AUDIENCE_CONSENT_VERSION),
  collectionConsent: z.literal(true),
  useBehavior: z.boolean(),
}).strict();
export type AudiencePreferencesInput = z.infer<typeof audiencePreferencesInputSchema>;
export interface AudiencePreferences {
  tagIds: string[];
  consentVersion: string | null;
  consentedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  behaviorSince: string | null;
  marketingConsent: boolean;
}
export const audiencePerformanceTagsSchema = z.object({ tagIds }).strict();
export const audienceQuerySchema = z.object({
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }),
}).strict().refine(({ since, until }) => Date.parse(until) > Date.parse(since) && Date.parse(until) - Date.parse(since) <= 90 * 86400000, '최근 90일 이내의 조회 기간을 선택해주세요');
export type AudienceQuery = z.infer<typeof audienceQuerySchema>;
export const audienceProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  search: z.string().trim().max(100).default(''),
  tagId: z.string().uuid().optional(),
  marketingOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).strict();
export type AudienceProfilesQuery = z.infer<typeof audienceProfilesQuerySchema>;
export interface AudienceProfileSummary {
  userId: string;
  name: string;
  email: string;
  tagIds: string[];
  updatedAt: string;
  expiresAt: string;
  behaviorSince: string | null;
  marketingConsent: boolean;
}
export interface AudienceInterestEvidence {
  tagId: string;
  level: 'low' | 'medium' | 'high';
  viewDays: number;
  favorites: number;
  checkouts: number;
  purchases: number;
  lastAt: string;
}
export interface AudienceProfile extends AudienceProfileSummary {
  inferred: AudienceInterestEvidence[];
  purchaseStage: 'unknown' | 'viewed' | 'saved' | 'checkout' | 'purchased';
  observedSince: string | null;
}
export interface AudienceOverview {
  activeProfiles: number;
  behaviorProfiles: number;
  marketingProfiles: number;
  segments: Array<{ tagId: string; members: number; marketingMembers: number }>;
}
export interface AudiencePerformance {
  id: string; title: string; publishState: string; genre: string; tagIds: string[];
}
export interface CreativePerformance {
  source: string; medium: string; campaign: string; content: string;
  sessions: number; visitors: number; signupSessions: number; favoriteSessions: number;
  checkoutSessions: number; paidSessions: number; paidOrders: number;
  signupRate: number; favoriteRate: number; paymentRate: number;
}
export interface CreativeReport {
  since: string; until: string; generatedAt: string;
  totalGroups: number; rows: CreativePerformance[];
}
export interface Ga4Config {
  enabled: boolean;
  measurementId: string | null;
  noticeVersion: string;
  transferCountries: string[];
}
export interface Ga4InterestReport {
  state: 'not_configured' | 'ready' | 'empty' | 'permission_denied' | 'quota_exceeded' | 'unavailable' | 'refreshing';
  propertyId: string | null;
  startDate: string; endDate: string;
  fetchedAt: string | null;
  cached: boolean;
  subjectToThresholding: boolean;
  dataLossFromOtherRow: boolean;
  sampled: boolean;
  emptyReason: string | null;
  timeZone: string | null;
  rowCount: number;
  rows: Array<{ interest: string; activeUsers: number }>;
}

/** Only public catalogue pages. Never send account/order/search input to Google. */
export function normalizeGa4Path(pathname: string): string | null {
  const path = pathname.split(/[?#]/, 1)[0]!.replace(/^\/(en|th|zh-CN|zh-TW)(?=\/|$)/, '').replace(/\/+$/, '') || '/';
  if (['/', '/categories', '/ranking', '/upcoming', '/venues', '/ticket'].includes(path)) return path;
  if (/^\/genre\/[a-z_]+$/.test(path)) return path;
  const id = path.match(/^\/performance\/([0-9a-f-]{36})$/i)?.[1];
  return id && z.string().uuid().safeParse(id).success ? `/performance/${id.toLowerCase()}` : null;
}

/** Uses only the existing account birthday locally; never sent to Google. */
export function isAdultForGoogleInterests(birthDate: string | undefined, now = Date.now()): boolean {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const birthday = new Date(`${birthDate}T00:00:00Z`);
  if (!Number.isFinite(birthday.getTime()) || birthday.toISOString().slice(0, 10) !== birthDate) return false;
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  return birthDate <= `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
}
