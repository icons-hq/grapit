import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALE_PREFIXES, SUPPORTED_LOCALES } from '@grabit/shared';
import {
  getSuggestedLocaleFromAcceptLanguage,
  LOCALE_SUGGESTION_COOKIE,
  resolveLocaleFromPathname,
  routing,
} from './routing';

describe('launch locale routing', () => {
  it('keeps Korean as the prefixless default and prefixes every foreign locale', () => {
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE);
    expect(routing.locales).toEqual([...SUPPORTED_LOCALES]);
    expect(routing.localePrefix).toBe('as-needed');

    expect(resolveLocaleFromPathname('/')).toEqual({
      locale: 'ko',
      pathnameWithoutLocale: '/',
    });
    expect(resolveLocaleFromPathname('/performance/123')).toEqual({
      locale: 'ko',
      pathnameWithoutLocale: '/performance/123',
    });

    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'ko') continue;

      expect(LOCALE_PREFIXES[locale]).toBe(`/${locale}`);
      expect(resolveLocaleFromPathname(`/${locale}`)).toEqual({
        locale,
        pathnameWithoutLocale: '/',
      });
      expect(resolveLocaleFromPathname(`/${locale}/performance/123`)).toEqual({
        locale,
        pathnameWithoutLocale: '/performance/123',
      });
    }
  });

  it('turns Accept-Language into suggestion state without changing the active URL locale', () => {
    expect(getSuggestedLocaleFromAcceptLanguage('th,en;q=0.8,ko;q=0.5', 'ko')).toBe('th');
    expect(getSuggestedLocaleFromAcceptLanguage('zh-Hant-TW,zh;q=0.9,en;q=0.5', 'ko')).toBe(
      'zh-TW',
    );
    expect(getSuggestedLocaleFromAcceptLanguage('zh-Hans-CN,en;q=0.5', 'ko')).toBe('zh-CN');
    expect(getSuggestedLocaleFromAcceptLanguage('ko,en;q=0.8', 'ko')).toBeNull();
    expect(getSuggestedLocaleFromAcceptLanguage('fr,de;q=0.8', 'ko')).toBeNull();
  });

  it('ships minimal messages for all launch locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messageFile = resolve(process.cwd(), 'messages', `${locale}.json`);

      expect(existsSync(messageFile)).toBe(true);

      const messages = JSON.parse(readFileSync(messageFile, 'utf8')) as {
        booking: { disabled: string };
        locale: { suggestion: string };
      };

      expect(messages.booking.disabled).toEqual(expect.any(String));
      expect(messages.booking.disabled.length).toBeGreaterThan(0);
      expect(messages.locale.suggestion).toEqual(expect.any(String));
      expect(messages.locale.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('keeps proxy suggest-never-redirect behavior explicit', () => {
    const proxySource = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8');

    expect(proxySource).toContain('createMiddleware');
    expect(LOCALE_SUGGESTION_COOKIE).toBe('locale-suggestion');
    expect(proxySource).toContain('LOCALE_SUGGESTION_COOKIE');
    expect(proxySource).not.toContain('NextResponse.redirect');
  });
});
