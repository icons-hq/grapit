import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DEFAULT_LOCALE } from '@grabit/shared';
import {
  LOCALE_SUGGESTION_COOKIE,
  getSuggestedLocaleFromAcceptLanguage,
  resolveLocaleFromPathname,
} from './i18n/routing';

const NEXT_INTL_LOCALE_HEADER = 'x-next-intl-locale';
const NEXT_LOCALE_COOKIE = 'NEXT_LOCALE';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export default function proxy(request: NextRequest) {
  const { locale: pathLocale, pathnameWithoutLocale } =
    resolveLocaleFromPathname(request.nextUrl.pathname);

  // Admin auth is handled client-side in admin/layout.tsx.
  // Server-side cookie check removed because the refreshToken cookie
  // is set on the API domain (separate Cloud Run service) and is not
  // visible to the web domain.
  if (
    isBypassedPathname(request.nextUrl.pathname) ||
    isBypassedPathname(pathnameWithoutLocale)
  ) {
    const requestHeaders = new Headers(request.headers);

    requestHeaders.delete(NEXT_INTL_LOCALE_HEADER);

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const activeLocale = pathLocale;
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set(NEXT_INTL_LOCALE_HEADER, activeLocale);

  const response =
    pathLocale === DEFAULT_LOCALE
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : rewriteToFlatPath(request, pathnameWithoutLocale, requestHeaders);
  const suggestedLocale = getSuggestedLocaleFromAcceptLanguage(
    request.headers.get('accept-language'),
    activeLocale,
  );

  response.cookies.set(NEXT_LOCALE_COOKIE, activeLocale, {
    httpOnly: false,
    maxAge: ONE_YEAR_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  if (suggestedLocale) {
    response.cookies.set(LOCALE_SUGGESTION_COOKIE, suggestedLocale, {
      httpOnly: false,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  return response;
}

function rewriteToFlatPath(
  request: NextRequest,
  pathnameWithoutLocale: string,
  requestHeaders: Headers,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathnameWithoutLocale;

  return NextResponse.rewrite(url, {
    request: { headers: requestHeaders },
  });
}

function isBypassedPathname(pathname: string) {
  return (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    /\.[^/]+$/.test(pathname)
  );
}

export const config = {
  matcher: ['/admin/:path*', '/((?!api|_next|.*\\..*).*)'],
};
