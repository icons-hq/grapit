import { describe, expect, it } from 'vitest';
import {
  AREUN_GL_PROMO,
  AREUN_GL_PROMO_PLACEMENTS,
  buildAreunGlPromoHref,
  getAreunGlPromoCopy,
  isAreunGlPromoActive,
  isAreunGlPromoGenre,
  resolveAreunGlPromoLanguage,
} from './areun-gl-promo';

describe('Areun GL promo campaign', () => {
  it('tags every placement with its own utm_medium on the Areun GL landing page', () => {
    const mediums = AREUN_GL_PROMO_PLACEMENTS.map((placement) => {
      const url = new URL(buildAreunGlPromoHref(placement, 'ko'));
      expect(`${url.origin}${url.pathname}`).toBe('https://areun.ai/gl');
      expect(url.searchParams.get('utm_source')).toBe('grabit');
      expect(url.searchParams.get('utm_campaign')).toBe('girlrules-fanmeeting-2026-11');
      expect(url.searchParams.get('utm_content')).toBe('ko');
      return url.searchParams.get('utm_medium');
    });

    expect(mediums).toEqual(['home_banner', 'booking_complete', 'reservation_detail']);
  });

  it('records the copy language in utm_content', () => {
    const url = new URL(buildAreunGlPromoHref('home_banner', 'en'));
    expect(url.searchParams.get('utm_content')).toBe('en');
  });

  it('shows Korean copy on Korean screens and English everywhere else', () => {
    expect(resolveAreunGlPromoLanguage('ko')).toBe('ko');
    expect(resolveAreunGlPromoLanguage('en')).toBe('en');
    expect(resolveAreunGlPromoLanguage('th')).toBe('en');
    expect(resolveAreunGlPromoLanguage('zh-CN')).toBe('en');
    expect(resolveAreunGlPromoLanguage(undefined)).toBe('en');

    expect(getAreunGlPromoCopy('ko')).toMatchObject({ badge: '광고', note: null });
    expect(getAreunGlPromoCopy('en')).toMatchObject({ badge: 'Ad', note: 'Areun is available in Korean.' });
  });

  it('ends at 2027-02-14 00:00 KST', () => {
    const endsAt = Date.parse('2027-02-14T00:00:00+09:00');
    expect(AREUN_GL_PROMO.endsAt).toBe(endsAt);
    expect(isAreunGlPromoActive(Date.parse('2026-11-11T12:00:00+09:00'))).toBe(true);
    expect(isAreunGlPromoActive(endsAt - 1)).toBe(true);
    expect(isAreunGlPromoActive(endsAt)).toBe(false);
  });

  it('targets fan-meeting (artist_celebrity) performances only', () => {
    expect(isAreunGlPromoGenre('artist_celebrity')).toBe(true);
    expect(isAreunGlPromoGenre('musical')).toBe(false);
    expect(isAreunGlPromoGenre(undefined)).toBe(false);
    expect(isAreunGlPromoGenre(null)).toBe(false);
  });
});
