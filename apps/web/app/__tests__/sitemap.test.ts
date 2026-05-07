import { describe, expect, it } from 'vitest';
import { LOCALE_PREFIXES, SUPPORTED_LOCALES } from '@grabit/shared';
import sitemap, { buildLocalizedAlternates, getLocalizedUrl } from '../sitemap';

const SITE_URL = 'https://heygrabit.com';

describe('localized sitemap', () => {
  it('builds prefixless Korean URLs and prefixed foreign URLs', () => {
    expect(getLocalizedUrl('/', 'ko')).toBe(`${SITE_URL}/`);
    expect(getLocalizedUrl('/legal/terms', 'ko')).toBe(`${SITE_URL}/legal/terms`);

    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'ko') continue;

      expect(LOCALE_PREFIXES[locale]).toBe(`/${locale}`);
      expect(getLocalizedUrl('/', locale)).toBe(`${SITE_URL}/${locale}`);
      expect(getLocalizedUrl('/legal/terms', locale)).toBe(
        `${SITE_URL}/${locale}/legal/terms`,
      );
    }
  });

  it('returns hreflang alternates for all launch locales', () => {
    const alternates = buildLocalizedAlternates('/legal/privacy');

    for (const locale of SUPPORTED_LOCALES) {
      expect(alternates).toHaveProperty(locale);
    }

    expect(alternates.ko).toBe(`${SITE_URL}/legal/privacy`);
    expect(alternates.en).toBe(`${SITE_URL}/en/legal/privacy`);
    expect(alternates.th).toBe(`${SITE_URL}/th/legal/privacy`);
    expect(alternates['zh-CN']).toBe(`${SITE_URL}/zh-CN/legal/privacy`);
    expect(alternates['zh-TW']).toBe(`${SITE_URL}/zh-TW/legal/privacy`);
  });

  it('includes root and public legal surfaces with localized alternates', () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(`${SITE_URL}/`);
    expect(urls).toContain(`${SITE_URL}/legal/terms`);
    expect(urls).toContain(`${SITE_URL}/legal/privacy`);
    expect(urls).toContain(`${SITE_URL}/legal/marketing`);
    expect(urls).not.toContain(`${SITE_URL}/ko`);

    for (const entry of entries) {
      expect(entry.url).not.toContain(`${SITE_URL}/ko`);
      expect(entry.alternates?.languages).toEqual(
        buildLocalizedAlternates(new URL(entry.url).pathname),
      );
    }
  });
});
