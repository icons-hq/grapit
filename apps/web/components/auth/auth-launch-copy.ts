import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SUPPORTED_LOCALES,
} from '@grabit/shared';

import koMessages from '@/messages/ko.json';
import enMessages from '@/messages/en.json';
import thMessages from '@/messages/th.json';
import zhCNMessages from '@/messages/zh-CN.json';
import jaMessages from '@/messages/ja.json';

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const messagesByLocale = {
  ko: koMessages,
  en: enMessages,
  th: thMessages,
  'zh-CN': zhCNMessages,
  ja: jaMessages,
} as const;

export type AuthLaunchCopy = (typeof koMessages)['auth'] & {
  locale: SupportedLocale;
};

export function resolveAuthLocale(locale: string | undefined): SupportedLocale {
  return locale && isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function getAuthLaunchCopy(locale: string | undefined): AuthLaunchCopy {
  const resolvedLocale = resolveAuthLocale(locale);
  return {
    ...messagesByLocale[resolvedLocale].auth,
    locale: resolvedLocale,
  };
}
