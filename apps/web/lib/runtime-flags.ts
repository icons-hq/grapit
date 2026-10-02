import {
  DEFAULT_LOCALE,
  FLAG_NAMES,
  readFeatureFlags,
  type SupportedLocale,
} from '@grabit/shared';
import { recordServerTimeSample } from '@/lib/server-clock';

export type RuntimeFlags = ReturnType<typeof readFeatureFlags>;
/** `/api/runtime-flags` body: the flags plus the web server clock (epoch ms). */
export type RuntimeFlagsPayload = RuntimeFlags & { serverNow: number };
type RuntimeLocale = Extract<SupportedLocale, 'ko' | 'en' | 'th' | 'zh-CN'>;
const RUNTIME_LOCALES = ['ko', 'en', 'th', 'zh-CN'] as const;

export const BOOKING_DISABLED_COPY: Record<RuntimeLocale, string> = {
  ko: '예매는 추후 오픈 예정입니다',
  en: 'Ticket booking will open later',
  th: 'การจองบัตรจะเปิดให้บริการในภายหลัง',
  'zh-CN': '门票预订将于稍后开放',
};

export const BOOKING_VERIFICATION_REQUIRED_COPY: Record<RuntimeLocale, string> = {
  ko: '이메일 인증과 휴대폰 인증을 완료해야 예매할 수 있습니다.',
  en: 'Complete both email and phone verification before booking tickets.',
  th: 'กรุณายืนยันทั้งอีเมลและหมายเลขโทรศัพท์ก่อนจองบัตร',
  'zh-CN': '请先完成电子邮箱和手机号验证后再预订门票。',
};

export const BOOKING_ENDED_COPY: Record<RuntimeLocale, string> = {
  ko: '판매가 종료된 공연입니다',
  en: 'Ticket sales have ended',
  th: 'การจำหน่ายบัตรสิ้นสุดแล้ว',
  'zh-CN': '门票销售已结束',
};

export const BOOKING_AVAILABILITY_CHECKING_COPY: Record<RuntimeLocale, string> = {
  ko: '예매 가능 여부를 확인하고 있습니다',
  en: 'Checking ticket booking availability',
  th: 'กำลังตรวจสอบสถานะการจองบัตร',
  'zh-CN': '正在确认门票预订状态',
};

export const BOOKING_AVAILABILITY_UNAVAILABLE_COPY: Record<RuntimeLocale, string> = {
  ko: '예매 가능 여부를 확인하지 못했습니다. 잠시 후 자동으로 다시 확인합니다',
  en: 'Could not check booking availability. Retrying automatically',
  th: 'ตรวจสอบสถานะการจองไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ',
  'zh-CN': '暂时无法确认预订状态，系统将自动重试',
};

export class RuntimeFlagsUnavailableError extends Error {
  /** Server-requested wait (Retry-After on 429/503), when one was sent. */
  readonly retryAfterMs: number | null;

  constructor(
    message = 'Runtime flags are unavailable',
    options: { retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = 'RuntimeFlagsUnavailableError';
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/** Reads a Retry-After header (delta seconds or HTTP date) as milliseconds. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const dateMs = Date.parse(trimmed);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

export class BookingDisabledError extends Error {
  constructor(message = BOOKING_DISABLED_COPY.ko) {
    super(message);
    this.name = 'BookingDisabledError';
  }
}

export function getBookingDisabledCopy(locale: string | undefined): string {
  const candidate = locale ?? '';
  const supportedLocale = isRuntimeLocale(candidate)
    ? candidate
    : DEFAULT_LOCALE;
  return BOOKING_DISABLED_COPY[supportedLocale];
}

export function getBookingVerificationRequiredCopy(
  locale: string | undefined,
): string {
  const candidate = locale ?? '';
  const supportedLocale = isRuntimeLocale(candidate)
    ? candidate
    : DEFAULT_LOCALE;
  return BOOKING_VERIFICATION_REQUIRED_COPY[supportedLocale];
}

export function getBookingEndedCopy(locale: string | undefined): string {
  const candidate = locale ?? '';
  const supportedLocale = isRuntimeLocale(candidate)
    ? candidate
    : DEFAULT_LOCALE;
  return BOOKING_ENDED_COPY[supportedLocale];
}

export function getBookingAvailabilityCheckingCopy(
  locale: string | undefined,
): string {
  const candidate = locale ?? '';
  const supportedLocale = isRuntimeLocale(candidate)
    ? candidate
    : DEFAULT_LOCALE;
  return BOOKING_AVAILABILITY_CHECKING_COPY[supportedLocale];
}

export function getBookingAvailabilityUnavailableCopy(
  locale: string | undefined,
): string {
  const candidate = locale ?? '';
  const supportedLocale = isRuntimeLocale(candidate)
    ? candidate
    : DEFAULT_LOCALE;
  return BOOKING_AVAILABILITY_UNAVAILABLE_COPY[supportedLocale];
}

function isRuntimeLocale(value: string): value is RuntimeLocale {
  return (RUNTIME_LOCALES as readonly string[]).includes(value);
}

export function readRuntimeFlagsFromEnv(
  env: Record<string, string | undefined>,
): RuntimeFlags {
  return readFeatureFlags({
    [FLAG_NAMES.BOOKING_ENABLED]: env[FLAG_NAMES.BOOKING_ENABLED],
  });
}

export function buildRuntimeFlagsPayload(
  env: Record<string, string | undefined>,
  nowMs: number = Date.now(),
): RuntimeFlagsPayload {
  return {
    ...readRuntimeFlagsFromEnv(env),
    serverNow: nowMs,
  };
}

function isCachedResponse(response: Response): boolean {
  const age = Number(response.headers?.get('age') ?? 0);
  return Number.isFinite(age) && age > 0;
}

/**
 * Reads the runtime flags. A failed request throws instead of resolving to
 * "booking disabled", so react-query retries it and keeps the last good value
 * rather than caching a transient error as a real kill switch.
 */
export async function fetchRuntimeFlags(
  fetcher: typeof fetch = fetch,
): Promise<RuntimeFlags> {
  const requestStartedAtMs = Date.now();
  const response = await fetcher('/api/runtime-flags', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const responseReceivedAtMs = Date.now();

  if (!response.ok) {
    throw new RuntimeFlagsUnavailableError(
      `Runtime flags request failed with status ${response.status}`,
      { retryAfterMs: parseRetryAfterMs(response.headers?.get('retry-after')) },
    );
  }

  let flags: Partial<RuntimeFlagsPayload> | null;
  try {
    flags = (await response.json()) as Partial<RuntimeFlagsPayload> | null;
  } catch {
    throw new RuntimeFlagsUnavailableError('Runtime flags response is not JSON');
  }

  if (!flags || typeof flags !== 'object') {
    throw new RuntimeFlagsUnavailableError('Runtime flags response is empty');
  }

  // A cached copy carries a stale serverNow and would skew the clock offset.
  if (typeof flags.serverNow === 'number' && !isCachedResponse(response)) {
    recordServerTimeSample({
      serverNowMs: flags.serverNow,
      requestStartedAtMs,
      responseReceivedAtMs,
    });
  }

  return {
    bookingEnabled: flags.bookingEnabled === true,
  };
}
