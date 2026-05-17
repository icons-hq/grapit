import { describe, expect, it } from 'vitest';

import { getVisibleCopy } from './visible-copy';

describe('getVisibleCopy', () => {
  it('returns the canary-visible copy namespaces for a supported locale', () => {
    const copy = getVisibleCopy('en');

    expect(copy.nav.searchPlaceholder).toBe('Search shows or artists');
    expect(copy.home.hot).toBe('HOT');
    expect(copy.search.promptTitle).toBe('Search for shows');
    expect(copy.performance.bookCta).toBe('Book tickets');
    expect(copy.performance.upcomingDateLabel).toBe('Coming soon');
    expect(copy.booking.disabled).toBe('Ticket booking will open later');
    expect(copy.footer.terms).toBe('Terms of Service');
    expect(copy.auth.tabs.login).toBe('Login');
    expect(copy.auth.form.email).toBe('Email');
    expect(copy.auth.social.kakaoButton).toBe('Continue with Kakao');
    expect(copy.locale.dismiss).toBe('Later');
  });

  it('falls back to Korean copy for unsupported locale input', () => {
    const copy = getVisibleCopy('xx');

    expect(copy.nav.searchPlaceholder).toBe('공연명, 아티스트를 검색하세요');
    expect(copy.booking.disabled).toBe('예매는 추후 오픈 예정입니다');
    expect(copy.auth.tabs.login).toBe('로그인');
    expect(copy.locale.dismiss).toBe('나중에');
  });
});
