import {
  DEFAULT_LOCALE,
  FLAG_NAMES,
  readFeatureFlags,
  type SupportedLocale,
} from '@grabit/shared';

export type RuntimeFlags = ReturnType<typeof readFeatureFlags>;
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

export async function fetchRuntimeFlags(
  fetcher: typeof fetch = fetch,
): Promise<RuntimeFlags> {
  try {
    const response = await fetcher('/api/runtime-flags', {
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      return { bookingEnabled: false };
    }

    const flags = (await response.json()) as Partial<RuntimeFlags>;
    return {
      bookingEnabled: flags.bookingEnabled === true,
    };
  } catch {
    return { bookingEnabled: false };
  }
}
