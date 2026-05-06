import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SUPPORTED_LOCALES,
} from '@grabit/shared';

import koMessages from '@/messages/ko.json';
import enMessages from '@/messages/en.json';
import thMessages from '@/messages/th.json';
import zhCNMessages from '@/messages/zh-CN.json';
import zhTWMessages from '@/messages/zh-TW.json';

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const messagesByLocale = {
  ko: koMessages,
  en: enMessages,
  th: thMessages,
  'zh-CN': zhCNMessages,
  'zh-TW': zhTWMessages,
} as const;

export type AuthLaunchCopy = (typeof koMessages)['auth'];

export function resolveAuthLocale(locale: string | undefined): SupportedLocale {
  return locale && isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function getAuthLaunchCopy(locale: string | undefined): AuthLaunchCopy {
  return messagesByLocale[resolveAuthLocale(locale)].auth;
}
