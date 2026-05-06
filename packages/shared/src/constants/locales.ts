export const SUPPORTED_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;

export const DEFAULT_LOCALE = 'ko';

export const LOCALE_PREFIXES = {
  ko: '/',
  en: '/en',
  th: '/th',
  'zh-CN': '/zh-CN',
  'zh-TW': '/zh-TW',
} as const satisfies Record<(typeof SUPPORTED_LOCALES)[number], string>;

export const LOCALE_LABELS = {
  ko: {
    native: '한국어',
    english: 'Korean',
  },
  en: {
    native: 'English',
    english: 'English',
  },
  th: {
    native: 'ไทย',
    english: 'Thai',
  },
  'zh-CN': {
    native: '简体中文',
    english: 'Simplified Chinese',
  },
  'zh-TW': {
    native: '繁體中文',
    english: 'Traditional Chinese',
  },
} as const satisfies Record<
  (typeof SUPPORTED_LOCALES)[number],
  {
    native: string;
    english: string;
  }
>;

export function isSupportedLocale(value: string): value is (typeof SUPPORTED_LOCALES)[number] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
