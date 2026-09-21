import { describe, expect, it } from 'vitest';
import { loginSchema } from '@grabit/shared';
import { authFormResolver } from '../auth-validation';
import { getClientLocale } from '../i18n/client-copy';

describe('buyer locale', () => {
  it('keeps credential validation but returns English errors on the English form', async () => {
    const result = await authFormResolver(loginSchema, 'en')({ email: 'invalid', password: '' }, undefined, { fields: {}, shouldUseNativeValidation: false });
    expect(result.errors).toMatchObject({ email: { message: 'Enter a valid email address' }, password: { message: 'Enter your password' } });
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
