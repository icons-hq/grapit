import {
  DEFAULT_LOCALE,
  FLAG_NAMES,
  isSupportedLocale,
  readFeatureFlags,
  type SupportedLocale,
} from '@grabit/shared';

export type RuntimeFlags = ReturnType<typeof readFeatureFlags>;

export const BOOKING_DISABLED_COPY: Record<SupportedLocale, string> = {
  ko: '예매는 5월말 오픈 예정입니다',
  en: 'Ticket booking opens in late May',
  th: 'การจองบัตรจะเปิดปลายเดือนพฤษภาคม',
  'zh-CN': '门票预订预计于5月下旬开放',
  'zh-TW': '門票預訂預計於5月下旬開放',
};

export class BookingDisabledError extends Error {
  constructor(message = BOOKING_DISABLED_COPY.ko) {
    super(message);
    this.name = 'BookingDisabledError';
  }
}

export function getBookingDisabledCopy(locale: string | undefined): string {
  const candidate = locale ?? '';
  const supportedLocale = isSupportedLocale(candidate)
    ? candidate
    : DEFAULT_LOCALE;
  return BOOKING_DISABLED_COPY[supportedLocale];
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
