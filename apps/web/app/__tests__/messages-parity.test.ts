import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = ['ko', 'en', 'th', 'zh-CN'] as const;
const GUARDED_CUSTOMER_FILES = [
  'app/layout.tsx',
  'app/error.tsx',
  'app/global-error.tsx',
  'app/not-found.tsx',
  'app/auth/reset-password/page.tsx',
  'app/booking/[performanceId]/confirm/page.tsx',
  'app/booking/[performanceId]/complete/page.tsx',
  'app/mypage/page.tsx',
  'components/auth/profile-form.tsx',
  'components/booking/booking-complete.tsx',
  'components/booking/toss-payment-widget.tsx',
  'components/layout/network-banner.tsx',
  'components/legal/legal-fallback-label.tsx',
  'components/reservation/cancel-confirm-modal.tsx',
  'components/reservation/refund-timeline.tsx',
  'components/reservation/reservation-card.tsx',
  'components/reservation/reservation-detail.tsx',
  'components/reservation/reservation-list.tsx',
  'components/reservation/ticket-email-delivery-panel.tsx',
  'hooks/use-socket.ts',
  'lib/api-client.ts',
  'lib/error-messages.ts',
  'lib/i18n/client-copy.ts',
] as const;
const CUSTOMER_LOCALIZED_MESSAGE_PREFIXES = [
  'reservation.',
  'mypage.',
  'profile.',
  'resetPassword.',
] as const;
const LOCALE_SCRIPT_PATTERN = {
  th: /[\u0E00-\u0E7F]/,
  'zh-CN': /[\u3400-\u9FFF]/,
} as const;

const ALLOWED_KOREAN_SOURCE_PATTERNS: RegExp[] = [
  /'페이팔'|페이팔:/,
  /[{}.`'"]열|[{}.`'"]번|외 .*건|외 .*석|원[`'"]/,
  /'동의'|'미동의'|'남성'|'여성'|'선택안함'/,
  /locale === 'ko'/,
  /DEFAULT_STATUS_MESSAGES|잘못된 요청|접근 권한|요청하신 정보|서버 응답|요청이 너무 많|서버에 문제/,
  /LEGACY_LOCK_FAILURE_MESSAGES|좌석 점유 시간이 만료|이미 다른 사용자가 선택/,
  /LEGACY_FLOOR_LABEL|기본/,
  /환불 요청|환불 실패|예매 취소 요청|결제수단|결제사|카드사|수동 확인/,
  /취소된 좌석은 즉시 재오픈/,
  /프로필이 수정|일시적인 오류|로그아웃|회원 탈퇴|진행 중인 예매|계정 상태|관리자 계정|일반 회원|이메일 .*인증/,
];

function flattenMessages(value: unknown, prefix = ''): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? { [prefix]: value } : {};
  }

  return Object.entries(value).reduce<Record<string, unknown>>(
    (acc, [key, child]) => ({
      ...acc,
      ...flattenMessages(child, prefix ? `${prefix}.${key}` : key),
    }),
    {},
  );
}

function readMessages(locale: (typeof LOCALES)[number]) {
  const raw = readFileSync(
    join(process.cwd(), 'messages', `${locale}.json`),
    'utf8',
  );
  return flattenMessages(JSON.parse(raw));
}

describe('public locale messages', () => {
  it('keeps all locale message files key-compatible and non-empty', () => {
    const flattened = Object.fromEntries(
      LOCALES.map((locale) => [locale, readMessages(locale)]),
    );
    const baselineKeys = Object.keys(flattened.ko).sort();

    for (const locale of LOCALES) {
      expect(Object.keys(flattened[locale]).sort()).toEqual(baselineKeys);

      const emptyKeys = Object.entries(flattened[locale])
        .filter(([, value]) => typeof value === 'string' && value.trim() === '')
        .map(([key]) => key);
      expect(emptyKeys).toEqual([]);
    }
  });

  it('stores localized metadata outside Korean', () => {
    const english = readMessages('en');
    const thai = readMessages('th');
    const chinese = readMessages('zh-CN');

    expect(String(english['metadata.title'])).not.toMatch(/[가-힣]/);
    expect(String(thai['metadata.title'])).not.toMatch(/[가-힣]/);
    expect(String(chinese['metadata.title'])).not.toMatch(/[가-힣]/);
  });

  it('keeps non-Korean locale messages free of Korean fallback copy', () => {
    for (const locale of ['en', 'th', 'zh-CN'] as const) {
      const koreanFallbackKeys = Object.entries(readMessages(locale))
        .filter(([, value]) => typeof value === 'string' && /[가-힣]/.test(value))
        .map(([key]) => key);

      expect(koreanFallbackKeys).toEqual([]);
    }
  });

  it('keeps Thai and Chinese customer messages localized instead of English fallback', () => {
    for (const locale of ['th', 'zh-CN'] as const) {
      const scriptPattern = LOCALE_SCRIPT_PATTERN[locale];
      const fallbackKeys = Object.entries(readMessages(locale))
        .filter(([key, value]) => {
          if (!CUSTOMER_LOCALIZED_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            return false;
          }
          if (key === 'mypage.titlePrefix') return false;
          if (typeof value !== 'string') return false;

          const normalized = value
            .replace(/\{\w+\}/g, '')
            .replace(/\b(QR|URL|Toss|Grabit|PAYPAL|USD|KRW)\b/g, '')
            .replace(/[\d\s.,:()/-]/g, '');

          return /[A-Za-z]/.test(normalized) && !scriptPattern.test(normalized);
        })
        .map(([key]) => key);

      expect(fallbackKeys).toEqual([]);
    }
  });

  it('keeps guarded customer-facing source Korean literals explicit', () => {
    const violations: string[] = [];

    for (const relativePath of GUARDED_CUSTOMER_FILES) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
      source.split('\n').forEach((line, index) => {
        if (!/[가-힣]/.test(line)) return;
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (ALLOWED_KOREAN_SOURCE_PATTERNS.some((pattern) => pattern.test(line))) {
          return;
        }
        violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(violations).toEqual([]);
  });
});
