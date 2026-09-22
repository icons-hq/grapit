import { describe, expect, it } from 'vitest';
import { loginSchema } from '@grabit/shared';
import { authFormResolver } from '../auth-validation';
import { getLocalizedNavigationPath } from '../i18n/locale-path';
import { getClientLocale } from '../i18n/client-copy';

describe('buyer locale', () => {
  it('keeps credential validation but returns English errors on the English form', async () => {
    const result = await authFormResolver(loginSchema, 'en')({ email: 'invalid', password: '' }, undefined, { fields: {}, shouldUseNativeValidation: false });
    expect(result.errors).toMatchObject({ email: { message: 'Enter a valid email address' }, password: { message: 'Enter your password' } });
  });
  it('localizes nested verification returns and removes external destinations', () => {
    const destination = getLocalizedNavigationPath('/en/auth', new URLSearchParams({ returnTo: '/en/mypage?tab=settings&returnTo=%2Fen%2Fbooking%2Fshow' }).toString(), 'th');
    const settings = new URL(new URL(destination, 'http://localhost').searchParams.get('returnTo')!, 'http://localhost');
    expect(settings.pathname).toBe('/th/mypage');
    expect(settings.searchParams.get('returnTo')).toBe('/th/booking/show');
    expect(getLocalizedNavigationPath('/en/auth', 'returnTo=https%3A%2F%2Fevil.test', 'th')).toBe('/th/auth');
  });

  it('honors an explicit Korean URL over a previous language cookie', () => {
    document.cookie = 'NEXT_LOCALE=en';
    window.history.replaceState(null, '', '/mypage');
    expect(getClientLocale()).toBe('ko');
    window.history.replaceState(null, '', '/th/mypage');
    expect(getClientLocale()).toBe('th');
    document.cookie = 'NEXT_LOCALE=;max-age=0';
  });
});
