import { describe, expect, it } from 'vitest';
import {
  formatEventTimeWithKstAnchor,
  formatKrwWithEstimate,
} from './format';
import type { SupportedLocale } from '@grabit/shared';

const locales = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as SupportedLocale[];

describe('formatEventTimeWithKstAnchor', () => {
  it.each(locales)('keeps an explicit KST anchor for %s', (locale) => {
    const result = formatEventTimeWithKstAnchor(
      '2026-07-04T09:00:00.000Z',
      locale,
      {
        localTimeZone: 'America/Los_Angeles',
      },
    );

    expect(result.kst).toBe('2026.07.04 18:00 KST');
    expect(result.combined).toContain('KST');
    expect(result.local).toBeTruthy();
  });

  it('uses Intl locale formatting for secondary local time', () => {
    const th = formatEventTimeWithKstAnchor(
      '2026-07-04T09:00:00.000Z',
      'th',
      {
        localTimeZone: 'Asia/Bangkok',
      },
    );
    const zhTw = formatEventTimeWithKstAnchor(
      '2026-07-04T09:00:00.000Z',
      'zh-TW' as SupportedLocale,
      {
        localTimeZone: 'Asia/Taipei',
      },
    );

    expect(th.local).toContain('16:00');
    expect(zhTw.local).toContain('17:00');
  });
});

describe('formatKrwWithEstimate', () => {
  it.each(locales)(
    'keeps KRW source, estimated local amount, and disclaimer for %s',
    (locale) => {
      const result = formatKrwWithEstimate(110000, locale, {
        currency: 'THB',
        rate: 0.025,
      });

      expect(result.source).toBe('KRW 110,000');
      expect(result.estimate).toContain('THB');
      expect(result.estimate).toContain('2,750');
      expect(result.disclaimer).toMatch(/exchange rate may change|환율/);
      expect(result.combined).toContain(result.source);
      expect(result.combined).toContain(result.disclaimer);
    },
  );
});
