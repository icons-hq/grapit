import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  LOCALE_SUGGESTION_COOKIE,
  getSuggestedLocaleFromAcceptLanguage,
  resolveLocaleFromPathname,
  routing,
} from './i18n/routing';

const localeMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  // Admin auth is handled client-side in admin/layout.tsx.
  // Server-side cookie check removed because the refreshToken cookie
  // is set on the API domain (separate Cloud Run service) and is not
  // visible to the web domain.
  if (request.nextUrl.pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const response = localeMiddleware(request);
  const activeLocale = resolveLocaleFromPathname(request.nextUrl.pathname).locale;
  const suggestedLocale = getSuggestedLocaleFromAcceptLanguage(
    request.headers.get('accept-language'),
    activeLocale,
  );

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

export const config = {
  matcher: ['/admin/:path*', '/((?!api|_next|.*\\..*).*)'],
};
