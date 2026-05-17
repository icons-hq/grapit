import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SUPPORTED_LOCALES,
} from '@grabit/shared';

import koMessages from '@/messages/ko.json';
import enMessages from '@/messages/en.json';
import thMessages from '@/messages/th.json';
import zhCNMessages from '@/messages/zh-CN.json';

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const messagesByLocale = {
  ko: koMessages,
  en: enMessages,
  th: thMessages,
  'zh-CN': zhCNMessages,
} as const;

export type VisibleCopy = typeof koMessages;

export function resolveVisibleCopyLocale(
  locale: string | undefined,
): SupportedLocale {
  return locale && isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function getVisibleCopy(locale: string | undefined): VisibleCopy {
  return messagesByLocale[resolveVisibleCopyLocale(locale)];
}
