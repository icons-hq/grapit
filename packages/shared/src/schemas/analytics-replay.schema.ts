import { z } from 'zod';
import { ANALYTICS_NOTICE_VERSION, analyticsQuerySchema, normalizeAnalyticsPath } from './analytics.schema';

export const ANALYTICS_REPLAY_RETENTION_DAYS = 14;
export const ANALYTICS_REPLAY_MAX_BYTES = 768 * 1024;
export const ANALYTICS_REPLAY_SESSION_BYTES = 10 * 1024 * 1024;
export type ReplayEvent = { type: number; timestamp: number; data: Record<string, unknown> };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const number = (v: unknown, max = 1e8) => typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(max, v)) : 0;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v.slice(0, 10000) : [];
const mask = (v: unknown) => typeof v === 'string' ? v.slice(0, 10000).replace(/\S/g, '*') : '';

/** No network loads, arbitrary attributes, input values, script or user text. Applied before transport AND storage. */
function css(value: unknown) {
  if (typeof value !== 'string') return '';
  const raw = value.slice(0, 400000).replace(/\/\*[\s\S]*?\*\//g, '');
  const decoded = raw.replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, hex: string) => String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16)))).replace(/\\([^\r\n])/g, '$1');
  // Reject escaped resource-loading tokens; retaining escaped selectors is
  // necessary for Tailwind but must not bypass URL filtering.
  const resources = /url\s*\(|@import|image-set\s*\(|expression\s*\(/gi;
  if ((decoded.match(resources)?.length ?? 0) !== (raw.match(resources)?.length ?? 0)) return '';
  return raw.replace(/@import\s+[^;]+;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'url("")').replace(/(?:-webkit-)?image-set\s*\([^)]*\)/gi, 'none')
    .replace(/(^|[;{])\s*content\s*:[^;{}]*(?:;|(?=\}))/gi, '$1')
    .replace(/--([\w-]+)\s*:([^;{}]*)(;|(?=\}))/g, (declaration, key: string, val: string) => /^(tw-|color-|spacing|radius|font-|animate-|container-|breakpoint-|tracking-|leading-|ease-|default-|foreground|background|border|input|ring|muted|primary|secondary|accent|destructive|card|popover|sidebar)/.test(key) && /^[\w\s#.,()%/+*-]*$/.test(val) ? declaration : '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/https?:[^\s"')]+/gi, '');
}
function attributes(value: unknown): Obj {
  const output: Obj = {};
  for (const [key, val] of Object.entries(obj(value))) {
    if (key === 'style' || key === '_cssText') output[key] = css(val);
    else if (key === 'class' && typeof val === 'string' && /^[\w\s\-:[\].()%/#,!>+~='"\\&*]*$/.test(val)) output[key] = val.slice(0, 2000);
    else if (['width', 'height', 'rr_width', 'rr_height', 'colspan', 'rowspan'].includes(key) && /^[\d.]+(?:px|%)?$/.test(String(val))) output[key] = String(val).slice(0, 20);
    else if (['hidden', 'disabled', 'checked', 'selected', 'multiple'].includes(key)) output[key] = '';
    else if (key === 'type' && ['text', 'password', 'email', 'tel', 'number', 'checkbox', 'radio', 'button', 'submit'].includes(String(val))) output[key] = val;
    else if (key === 'value') output[key] = mask(val);
  }
  return output;
}
function node(value: unknown, depth = 0): Obj {
  const n = obj(value); const type = number(n.type, 5); const id = number(n.id);
  if (depth > 80) return { type: 3, id, textContent: '' };
  if (type === 0) return { type, id, childNodes: list(n.childNodes).map((v) => node(v, depth + 1)) };
  if (type === 1) return { type, id, name: 'html', publicId: '', systemId: '' };
  if (type === 2) {
    const tag = typeof n.tagName === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(n.tagName) ? n.tagName : 'div';
    // rrweb inlines a linked stylesheet as a link with _cssText. Preserve the
    // sanitized inline sheet, without its original href or network request.
    if (tag === 'link' && typeof obj(n.attributes)._cssText === 'string') return { type, id, tagName: 'style', attributes: { _cssText: css(obj(n.attributes)._cssText) }, childNodes: [] };
    if (['script', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'link', 'meta', 'base'].includes(tag)) return { type, id, tagName: 'div', attributes: {}, childNodes: [] };
    return { type, id, tagName: tag, attributes: attributes(n.attributes), childNodes: list(n.childNodes).map((v) => node(v, depth + 1)), ...(n.isSVG ? { isSVG: true } : {}) };
  }
  return { type: 3, id, textContent: n.isStyle ? css(n.textContent) : mask(n.textContent), ...(n.isStyle ? { isStyle: true } : {}) };
}
export function sanitizeReplayEvent(value: unknown): ReplayEvent | null {
  const e = obj(value); const d = obj(e.data);
  if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) return null;
  const timestamp = e.timestamp;
  if (e.type === 4) return { type: 4, timestamp, data: { href: 'https://heygrabit.com/', width: number(d.width, 10000), height: number(d.height, 10000) } };
  if (e.type === 2) return { type: 2, timestamp, data: { node: node(d.node), initialOffset: { left: number(obj(d.initialOffset).left), top: number(obj(d.initialOffset).top) } } };
  if (e.type !== 3) return null;
  const source = d.source;
  let data: Obj;
  if (source === 0) data = { source,
    texts: list(d.texts).map((v) => ({ id: number(obj(v).id), value: mask(obj(v).value) })),
    attributes: list(d.attributes).map((v) => ({ id: number(obj(v).id), attributes: attributes(obj(v).attributes) })),
    removes: list(d.removes).map((v) => ({ parentId: number(obj(v).parentId), id: number(obj(v).id) })),
    adds: list(d.adds).map((v) => ({ parentId: number(obj(v).parentId), nextId: obj(v).nextId === null ? null : number(obj(v).nextId), node: node(obj(v).node) })),
  };
  else if (source === 1 || source === 6 || source === 12) data = { source, positions: list(d.positions).map((v) => ({ x: number(obj(v).x), y: number(obj(v).y), id: number(obj(v).id), timeOffset: number(obj(v).timeOffset) })) };
  else if (source === 2) data = { source, type: number(d.type, 10), id: number(d.id), x: number(d.x), y: number(d.y) };
  else if (source === 3) data = { source, id: number(d.id), x: number(d.x), y: number(d.y) };
  else if (source === 4) data = { source, width: number(d.width, 10000), height: number(d.height, 10000) };
  else if (source === 5) data = { source, id: number(d.id), text: mask(d.text), isChecked: d.isChecked === true };
  else return null;
  return { type: 3, timestamp, data };
}
export const analyticsReplayBatchSchema = z.object({
  id: z.string().uuid(), recordingId: z.string().uuid(), pageId: z.string().uuid(),
  visitorId: z.string().uuid(), sessionId: z.string().uuid(), consentVersion: z.literal(ANALYTICS_NOTICE_VERSION),
  path: z.string().max(160).refine((v) => normalizeAnalyticsPath(v) === v),
  events: z.array(z.unknown()).min(1).max(200).transform((events) => events.map(sanitizeReplayEvent).filter((e): e is ReplayEvent => e !== null)).refine((events) => events.length > 0),
}).strict();
export type AnalyticsReplayBatch = z.infer<typeof analyticsReplayBatchSchema>;
export const analyticsCursorSchema = z.string().max(80).refine((value) => {
  const parts = value.split('|');
  return parts.length === 2 && z.string().datetime({ offset: true }).safeParse(parts[0]).success && z.string().uuid().safeParse(parts[1]).success;
}, '올바른 조회 커서가 필요합니다');
export const analyticsVisitorsQuerySchema = z.object({
  since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }),
  before: analyticsCursorSchema.optional(), visitor: z.string().regex(/^[a-f0-9]{32}$/).optional(),
}).strict().refine((v) => analyticsQuerySchema.safeParse({ since: v.since, until: v.until }).success);
export type AnalyticsVisitorsQuery = z.infer<typeof analyticsVisitorsQuerySchema>;
export interface AnalyticsVisitorSession {
  id: string; visitorKey: string; userId: string | null; memberName: string | null; memberEmail: string | null;
  startedAt: string; lastSeenAt: string; device: string; browser: string; os: string; touch: { landingPath: string; source: string | null; campaign: string | null };
  events: number; clicks: number; recordings: number;
}
export interface AnalyticsSessionDetail {
  session: AnalyticsVisitorSession;
  events: Array<{ id: string; pageId: string; name: string; path: string; occurredAt: string; props: Record<string, string | number> }>;
  nextBefore: string | null;
  recordings: Array<{ id: string; pageId: string; path: string; startedAt: string; events: number; bytes: number }>;
}
