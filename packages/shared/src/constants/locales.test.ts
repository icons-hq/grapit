import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LOCALE_PREFIXES,
  SUPPORTED_LOCALES,
  isSupportedLocale,
} from './locales';

describe('launch locale constants', () => {
  it('supports exactly the four active launch locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['ko', 'en', 'th', 'zh-CN']);
    expect(DEFAULT_LOCALE).toBe('ko');
  });

  it('keeps Korean prefixless and foreign locales prefixed', () => {
    expect(LOCALE_PREFIXES).toEqual({
      ko: '/',
      en: '/en',
      th: '/th',
      'zh-CN': '/zh-CN',
    });
  });

  it('provides display labels for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale]).toEqual(
        expect.objectContaining({
          native: expect.any(String),
          english: expect.any(String),
        }),
      );
    }
  });

  it('checks whether a runtime string is a supported locale', () => {
    expect(isSupportedLocale('ko')).toBe(true);
    expect(isSupportedLocale('zh-CN')).toBe(true);
    expect(isSupportedLocale(['zh', 'TW'].join('-'))).toBe(false);
    expect(isSupportedLocale(['j', 'a'].join(''))).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
  });
});
