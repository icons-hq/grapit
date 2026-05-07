import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LOCALE_PREFIXES, SUPPORTED_LOCALES } from '@grabit/shared';
import proxy, { config as proxyConfig } from '../proxy';
import {
  getSuggestedLocaleFromAcceptLanguage,
  LOCALE_SUGGESTION_COOKIE,
  resolveLocaleFromPathname,
  routing,
} from './routing';

vi.mock('next-intl/middleware', async () => {
  const { NextResponse } =
    await vi.importActual<typeof import('next/server')>('next/server');

  return {
    default: () => (request: NextRequest) => {
      const pathname = request.nextUrl.pathname;
      const targetPathname = pathname === '/' ? '/ko' : `/ko${pathname}`;
      const requestHeaders = new Headers(request.headers);

      requestHeaders.set('x-next-intl-locale', 'ko');

      return NextResponse.rewrite(
        new URL(targetPathname, request.url),
        { request: { headers: requestHeaders } },
      );
    },
  };
});

describe('launch locale routing', () => {
  it('serves Korean flat routes without rewriting them to nonexistent /ko paths', () => {
    for (const pathname of ['/', '/auth']) {
      const response = runProxy(pathname);

      expect(getRewritePathname(response)).toBeNull();
      expect(getForwardedRequestHeader(response, 'x-next-intl-locale')).toBe('ko');
      expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('ko');
    }
  });

  it('ignores stale foreign NEXT_LOCALE cookies on prefixless Korean routes', () => {
    for (const pathname of ['/', '/auth']) {
      const response = runProxy(pathname, {
        cookie: 'NEXT_LOCALE=en',
      });

      expect(getRewritePathname(response)).toBeNull();
      expect(getForwardedRequestHeader(response, 'x-next-intl-locale')).toBe('ko');
      expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('ko');
    }
  });

  it('rewrites foreign locale prefixes to existing flat internal paths while carrying the active locale', () => {
    const cases = [
      ['/en/auth', '/auth', 'en'],
      ['/th/legal/terms', '/legal/terms', 'th'],
      ['/zh-CN/legal/privacy', '/legal/privacy', 'zh-CN'],
      ['/zh-TW/legal/marketing', '/legal/marketing', 'zh-TW'],
    ] as const;

    for (const [externalPathname, internalPathname, locale] of cases) {
      const response = runProxy(externalPathname);

      expect(getRewritePathname(response)).toBe(internalPathname);
      expect(getForwardedRequestHeader(response, 'x-next-intl-locale')).toBe(locale);
      expect(response.cookies.get('NEXT_LOCALE')?.value).toBe(locale);
    }
  });

  it('keeps api, next internals, static assets, and admin outside public locale routing', () => {
    const matcherSource = proxyConfig.matcher.join('\n');

    expect(matcherSource).toContain('api');
    expect(matcherSource).toContain('_next');
    expect(matcherSource).toContain('.*\\..*');

    const response = runProxy('/admin/consent-audit');

    expect(getRewritePathname(response)).toBeNull();
    expect(getForwardedRequestHeader(response, 'x-next-intl-locale')).toBeNull();
  });

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

    expect(proxySource).not.toContain('createMiddleware');
    expect(LOCALE_SUGGESTION_COOKIE).toBe('locale-suggestion');
    expect(proxySource).toContain('LOCALE_SUGGESTION_COOKIE');
    expect(proxySource).not.toContain('NextResponse.redirect');
  });
});

function runProxy(pathname: string, headers?: HeadersInit) {
  return proxy(
    new NextRequest(new URL(pathname, 'http://localhost:3000'), {
      headers,
    }),
  );
}

function getRewritePathname(response: Response) {
  const rewrite = response.headers.get('x-middleware-rewrite');
  if (!rewrite) return null;
  return new URL(rewrite, 'http://localhost:3000').pathname;
}

function getForwardedRequestHeader(response: Response, name: string) {
  return (
    response.headers.get(`x-middleware-request-${name.toLowerCase()}`) ??
    response.headers.get(name)
  );
}
