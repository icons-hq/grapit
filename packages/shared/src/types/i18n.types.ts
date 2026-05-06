import type { SUPPORTED_LOCALES } from '../constants/locales';

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type LocalePreferenceSource = 'url' | 'explicit-switch' | 'user-profile' | 'cookie' | 'default';

export interface LocaleResolution {
  locale: SupportedLocale;
  source: LocalePreferenceSource;
  cookieLocale?: SupportedLocale;
  userProfileLocale?: SupportedLocale;
  urlLocale?: SupportedLocale;
  shouldPersistCookie: boolean;
  shouldPersistUserProfile: boolean;
}

// D-06 precedence: url > explicit-switch > user-profile > cookie > ko
export const LOCALE_RESOLUTION_PRECEDENCE = [
  'url',
  'explicit-switch',
  'user-profile',
  'cookie',
  'ko',
] as const;
