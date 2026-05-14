import {
  DEFAULT_LOCALE,
  type SupportedLocale,
} from '@grabit/shared';

export type EventTimeFormatOptions = {
  localTimeZone?: string;
  includeLocalTime?: boolean;
};

export type FormattedEventTime = {
  kst: string;
  local: string | null;
  combined: string;
};

export type ExchangeRateEstimate = {
  currency: string;
  rate: number;
};

export type FormattedCurrencyEstimate = {
  source: string;
  estimate: string;
  disclaimer: string;
  combined: string;
};

const KST_TIME_ZONE = 'Asia/Seoul';
type PublicFormattingLocale =
  | Extract<SupportedLocale, 'ko' | 'en' | 'th' | 'zh-CN'>
  | 'zh-TW';
type FormattingLocaleInput = SupportedLocale | 'zh-TW';
const PUBLIC_FORMATTING_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;

const LOCALE_CURRENCY: Record<PublicFormattingLocale, string> = {
  ko: 'KRW',
  en: 'USD',
  th: 'THB',
  'zh-CN': 'CNY',
  'zh-TW': 'TWD',
};

export const DEFAULT_EXCHANGE_RATES: Record<PublicFormattingLocale, ExchangeRateEstimate> = {
  ko: { currency: 'KRW', rate: 1 },
  en: { currency: 'USD', rate: 0.00072 },
  th: { currency: 'THB', rate: 0.025 },
  'zh-CN': { currency: 'CNY', rate: 0.0052 },
  'zh-TW': { currency: 'TWD', rate: 0.023 },
};

export function normalizeSupportedLocale(locale: string | undefined): PublicFormattingLocale {
  if (locale && isPublicFormattingLocale(locale)) return locale;
  return DEFAULT_LOCALE;
}

function isPublicFormattingLocale(value: string): value is PublicFormattingLocale {
  return (PUBLIC_FORMATTING_LOCALES as readonly string[]).includes(value);
}

export function formatEventTimeWithKstAnchor(
  input: string | Date,
  locale: FormattingLocaleInput,
  options: EventTimeFormatOptions = {},
): FormattedEventTime {
  const date = toValidDate(input);
  const publicLocale = normalizeSupportedLocale(locale);

  if (!date) {
    return {
      kst: 'Invalid date KST',
      local: null,
      combined: 'Invalid date KST',
    };
  }

  const kst = `${formatDateTimeInTimeZone(date, KST_TIME_ZONE)} KST`;
  const includeLocalTime = options.includeLocalTime ?? true;
  const localTimeZone = options.localTimeZone ?? getResolvedTimeZone();
  const local = includeLocalTime
    ? formatLocalTime(date, publicLocale, localTimeZone)
    : null;

  return {
    kst,
    local,
    combined: local ? `${kst} (${local})` : kst,
  };
}

export function formatKrwWithEstimate(
  krwAmount: number,
  locale: FormattingLocaleInput,
  exchangeRate?: ExchangeRateEstimate,
): FormattedCurrencyEstimate {
  const publicLocale = normalizeSupportedLocale(locale);
  const resolvedExchangeRate = exchangeRate ?? DEFAULT_EXCHANGE_RATES[publicLocale];
  const source = `KRW ${formatWholeNumber(krwAmount)}`;
  const currency = resolvedExchangeRate.currency || LOCALE_CURRENCY[publicLocale];
  const estimatedAmount = Math.round(krwAmount * resolvedExchangeRate.rate);
  const estimate = `approx. ${currency} ${formatWholeNumber(estimatedAmount)}`;
  const disclaimer = getExchangeRateDisclaimer(publicLocale);

  return {
    source,
    estimate,
    disclaimer,
    combined: `${source} (${estimate}, ${disclaimer})`,
  };
}

function toValidDate(input: string | Date): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  const hour = values.hour === '24' ? '00' : values.hour;
  return `${values.year}.${values.month}.${values.day} ${hour}:${values.minute}`;
}

function formatLocalTime(
  date: Date,
  locale: PublicFormattingLocale,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

function getResolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || KST_TIME_ZONE;
}

function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function getExchangeRateDisclaimer(locale: PublicFormattingLocale): string {
  if (locale === 'ko') {
    return '예상 환산 금액이며 환율은 변동될 수 있습니다.';
  }

  return 'estimated local price; exchange rate may change';
}
