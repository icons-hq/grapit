export const SUPPORTED_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'ja'] as const;

export const DEFAULT_LOCALE = 'ko';

export const LOCALE_PREFIXES = {
  ko: '/',
  en: '/en',
  th: '/th',
  'zh-CN': '/zh-CN',
  'ja': '/ja',
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
  'ja': {
    native: '日本語',
    english: 'Japanese',
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
