import type { Genre } from '@grabit/shared';

/**
 * Areun (areun.ai) GL partner promo shown during the fan-meeting campaign.
 *
 * Placements map one-to-one to `utm_medium` so Areun's /admin/analytics
 * campaign table (grouped by source/medium/campaign) separates each slot.
 * Areun stores only the landing URL's utm_* values, so the link carries all
 * attribution; Grabit records nothing about the click.
 */
export const AREUN_GL_PROMO = {
  landingUrl: 'https://areun.ai/gl',
  utmSource: 'grabit',
  utmCampaign: 'girlrules-fanmeeting-2026-11',
  imageSrc: '/promo/areun-gl/gl-two-shot.webp',
  /** Hidden from 2027-02-14 00:00 KST, the day after the NAMTANFILM show (2027-02-13 KST). */
  endsAt: Date.parse('2027-02-14T00:00:00+09:00'),
  /** Booking-complete and reservation-detail cards only appear for these genres. */
  targetGenres: ['artist_celebrity'] as readonly Genre[],
} as const;

export const AREUN_GL_PROMO_PLACEMENTS = [
  'home_banner',
  'booking_complete',
  'reservation_detail',
] as const;

export type AreunGlPromoPlacement = (typeof AREUN_GL_PROMO_PLACEMENTS)[number];

export type AreunGlPromoLanguage = 'ko' | 'en';

export interface AreunGlPromoCopy {
  language: AreunGlPromoLanguage;
  regionLabel: string;
  badge: string;
  brand: string;
  title: string;
  body: string;
  note: string | null;
  cta: string;
  newTab: string;
}

const COPY: Record<AreunGlPromoLanguage, AreunGlPromoCopy> = {
  ko: {
    language: 'ko',
    regionLabel: '광고',
    badge: '광고',
    brand: '아른',
    title: '팬미팅 기다리는 동안, GL 서사에 과몰입',
    body: '걸크러시 언니부터 7년 만의 재회까지. 아른 오피셜 GL 8작과 직접 대화해 보세요.',
    note: null,
    cta: 'GL 8작 보러 가기',
    newTab: '새 창에서 열림',
  },
  en: {
    language: 'en',
    regionLabel: 'Advertisement',
    badge: 'Ad',
    brand: 'Areun',
    title: 'Fan meeting countdown? Get lost in a GL story',
    body: 'From a girl-crush unnie to a reunion seven years later, chat with the leads of 8 official GL stories.',
    note: 'Areun is available in Korean.',
    cta: 'See the 8 GL stories',
    newTab: 'opens in a new tab',
  },
};

/** Korean screens show Korean copy; every other Grabit locale shows English. */
export function resolveAreunGlPromoLanguage(locale: string | undefined): AreunGlPromoLanguage {
  return locale === 'ko' ? 'ko' : 'en';
}

export function getAreunGlPromoCopy(locale: string | undefined): AreunGlPromoCopy {
  return COPY[resolveAreunGlPromoLanguage(locale)];
}

export function isAreunGlPromoActive(now: number = Date.now()): boolean {
  return now < AREUN_GL_PROMO.endsAt;
}

export function isAreunGlPromoGenre(genre: string | null | undefined): boolean {
  return !!genre && (AREUN_GL_PROMO.targetGenres as readonly string[]).includes(genre);
}

export function buildAreunGlPromoHref(
  placement: AreunGlPromoPlacement,
  language: AreunGlPromoLanguage,
): string {
  const url = new URL(AREUN_GL_PROMO.landingUrl);
  url.searchParams.set('utm_source', AREUN_GL_PROMO.utmSource);
  url.searchParams.set('utm_medium', placement);
  url.searchParams.set('utm_campaign', AREUN_GL_PROMO.utmCampaign);
  url.searchParams.set('utm_content', language);
  return url.toString();
}
