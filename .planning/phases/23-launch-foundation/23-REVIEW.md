---
phase: 23-launch-foundation
reviewed: 2026-05-07T04:12:05Z
depth: standard
files_reviewed: 168
files_reviewed_list:
  - packages/shared/src/flags.ts
  - packages/shared/src/flags.test.ts
  - packages/shared/src/constants/locales.ts
  - packages/shared/src/constants/locales.test.ts
  - packages/shared/src/types/i18n.types.ts
  - packages/shared/src/schemas/consent.schema.ts
  - packages/shared/src/index.ts
  - packages/shared/src/constants/index.ts
  - packages/shared/package.json
  - apps/api/src/database/schema/launch-foundation.schema.spec.ts
  - apps/api/src/database/schema/email-verification-tokens.ts
  - apps/api/src/database/schema/consent-items.ts
  - apps/api/src/database/schema/consent-audit-logs.ts
  - apps/api/src/database/schema/translation-sources.ts
  - apps/api/src/database/schema/translation-drafts.ts
  - apps/api/src/database/schema/legal-content.ts
  - apps/api/src/database/migrations/0007_phase23_launch_foundation.sql
  - apps/api/src/database/migrations/meta/0007_snapshot.json
  - apps/api/src/database/schema/users.ts
  - apps/api/src/database/schema/refresh-tokens.ts
  - apps/api/src/database/schema/index.ts
  - apps/api/src/database/migrations/meta/_journal.json
  - apps/api/src/modules/feature-flags/feature-flags.module.ts
  - apps/api/src/modules/feature-flags/feature-flags.service.ts
  - apps/api/src/modules/feature-flags/feature-flags.service.spec.ts
  - apps/api/src/app.module.ts
  - apps/api/src/modules/booking/booking.module.ts
  - apps/api/src/modules/booking/booking.service.ts
  - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
  - apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts
  - apps/api/src/modules/reservation/reservation.module.ts
  - apps/api/src/modules/reservation/reservation.service.ts
  - apps/api/src/modules/reservation/reservation.service.spec.ts
  - apps/api/test/booking-cluster-lua.integration.spec.ts
  - apps/web/i18n/routing.ts
  - apps/web/i18n/request.ts
  - apps/web/i18n/routing.test.ts
  - apps/web/messages/ko.json
  - apps/web/messages/en.json
  - apps/web/messages/th.json
  - apps/web/messages/zh-CN.json
  - apps/web/messages/zh-TW.json
  - apps/web/app/sitemap.ts
  - apps/web/app/__tests__/sitemap.test.ts
  - apps/web/package.json
  - apps/web/proxy.ts
  - apps/web/app/layout.tsx
  - apps/web/next.config.ts
  - apps/api/src/modules/translation/translation.module.ts
  - apps/api/src/modules/translation/translation.controller.ts
  - apps/api/src/modules/translation/translation.service.ts
  - apps/api/src/modules/translation/translation.service.spec.ts
  - apps/api/src/modules/translation/deepl.client.ts
  - apps/api/src/modules/translation/deepl.client.spec.ts
  - .env.example
  - apps/web/app/api/runtime-flags/route.ts
  - apps/web/lib/runtime-flags.ts
  - apps/web/hooks/use-runtime-flags.ts
  - apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx
  - apps/web/hooks/use-booking.ts
  - apps/web/hooks/__tests__/use-booking.test.tsx
  - apps/web/components/booking/booking-page.tsx
  - apps/web/components/booking/seat-selection-panel.tsx
  - apps/web/components/booking/seat-selection-sheet.tsx
  - apps/web/app/booking/[performanceId]/confirm/page.tsx
  - apps/web/app/performance/[id]/page.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
  - apps/web/app/auth/verify-email/page.tsx
  - apps/web/components/auth/auth-launch-copy.ts
  - apps/web/components/auth/email-verification-status.tsx
  - apps/web/components/auth/__tests__/auth-email-verification.test.tsx
  - apps/web/components/auth/phone-verification.tsx
  - apps/web/components/auth/login-form.tsx
  - apps/web/components/auth/signup-form.tsx
  - packages/shared/src/i18n/launch-copy-keys.ts
  - packages/shared/src/i18n/launch-copy-keys.test.ts
  - packages/shared/src/types/auth.types.ts
  - apps/web/components/auth/__tests__/signup-consent.test.tsx
  - apps/web/components/auth/__tests__/signup-submit-consent.test.tsx
  - packages/shared/src/schemas/auth.schema.test.ts
  - apps/api/src/modules/auth/dto/auth-consent.dto.spec.ts
  - apps/web/components/auth/signup-step2.tsx
  - packages/shared/src/schemas/auth.schema.ts
  - apps/api/src/modules/auth/dto/register.dto.ts
  - apps/api/src/modules/auth/dto/social-register.dto.ts
  - apps/api/src/modules/auth/auth.service.ts
  - apps/api/src/modules/auth/auth.service.spec.ts
  - apps/api/src/modules/auth/auth.controller.ts
  - apps/api/src/modules/auth/email/email.service.ts
  - apps/web/app/admin/translations/page.tsx
  - apps/web/components/admin/translation-review-table.tsx
  - apps/web/components/admin/translation-source-form.tsx
  - apps/web/components/admin/translation-review-detail-panel.tsx
  - apps/web/components/i18n/automatic-translation-label.tsx
  - apps/web/components/admin/__tests__/translation-review.test.tsx
  - apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx
  - apps/web/hooks/use-admin.ts
  - apps/web/components/admin/admin-sidebar.tsx
  - apps/web/app/admin/consent-audit/page.tsx
  - apps/web/components/admin/consent-audit-table.tsx
  - apps/web/components/admin/__tests__/consent-audit-table.test.tsx
  - apps/web/components/legal/legal-fallback-label.tsx
  - apps/web/app/legal/__tests__/legal-fallback.test.tsx
  - apps/web/app/legal/terms/page.tsx
  - apps/web/app/legal/privacy/page.tsx
  - apps/web/app/legal/marketing/page.tsx
  - apps/web/components/layout/footer.tsx
  - apps/web/components/layout/__tests__/footer.test.tsx
  - apps/web/lib/i18n/format.ts
  - apps/web/lib/i18n/format.test.ts
  - apps/web/components/i18n/kst-time.tsx
  - apps/web/components/i18n/currency-display.tsx
  - apps/web/components/i18n/__tests__/format-components.test.tsx
  - apps/web/components/ui/__tests__/phone-input-i18n.test.tsx
  - apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx
  - apps/web/components/ui/phone-input.tsx
  - apps/web/components/auth/__tests__/phone-verification.test.tsx
  - apps/web/components/i18n/locale-switcher.tsx
  - apps/web/components/i18n/locale-suggestion.tsx
  - apps/web/components/layout/__tests__/gnb-locale.test.tsx
  - apps/web/components/layout/__tests__/layout-shell-locale.test.tsx
  - apps/api/src/modules/user/user.controller.spec.ts
  - apps/api/src/modules/user/user.service.spec.ts
  - apps/web/app/layout-shell.tsx
  - apps/web/components/layout/gnb.tsx
  - apps/web/components/layout/mobile-menu.tsx
  - packages/shared/src/schemas/user.schema.ts
  - packages/shared/src/types/user.types.ts
  - apps/api/src/modules/user/user.service.ts
  - apps/api/src/modules/user/user.repository.ts
  - apps/web/content/legal/terms-of-service.en.md
  - apps/web/content/legal/privacy-policy.en.md
  - apps/web/content/legal/marketing-consent.en.md
  - apps/web/content/legal/__tests__/legal-content.test.ts
  - apps/web/lib/i18n/visible-copy.ts
  - apps/api/src/modules/translation/performance-translation-overlay.ts
  - apps/web/e2e/i18n-smoke.spec.ts
  - apps/web/components/auth/__tests__/signup-step1-i18n.test.tsx
  - packages/shared/src/schemas/performance.schema.ts
  - packages/shared/src/types/performance.types.ts
  - apps/api/src/database/seed.mjs
  - apps/api/src/modules/performance/performance.controller.ts
  - apps/api/src/modules/performance/performance.service.ts
  - apps/api/src/modules/search/search.service.ts
  - apps/api/src/modules/performance/performance.service.spec.ts
  - apps/api/src/modules/search/search.service.spec.ts
  - apps/web/app/__tests__/home-i18n.test.tsx
  - apps/web/app/auth/__tests__/auth-page-i18n.test.tsx
  - apps/web/app/auth/callback/page.tsx
  - apps/web/app/auth/page.tsx
  - apps/web/app/genre/[genre]/page.tsx
  - apps/web/app/page.tsx
  - apps/web/app/search/__tests__/search-i18n.test.tsx
  - apps/web/app/search/page.tsx
  - apps/web/components/auth/signup-step1.tsx
  - apps/web/components/home/genre-grid.tsx
  - apps/web/components/home/hot-section.tsx
  - apps/web/components/home/new-section.tsx
  - apps/web/components/performance/performance-card.tsx
  - apps/web/components/performance/status-badge.tsx
  - apps/web/hooks/use-performances.ts
  - apps/web/hooks/use-search.ts
  - apps/web/lib/i18n/visible-copy.test.ts
  - apps/web/components/booking/seat-map-viewer.tsx
  - apps/web/components/admin/svg-preview.tsx
  - apps/api/src/modules/admin/upload.service.ts
  - apps/api/src/modules/admin/local-upload.controller.ts
findings:
  critical: 6
  warning: 2
  info: 0
  total: 8
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-05-07T04:12:05Z
**Depth:** standard
**Files Reviewed:** 168
**Status:** issues_found

## Summary

Phase 23 `*-SUMMARY.md` frontmatter의 `key-files`와 latest gap-closure diff 범위를 합쳐 source files를 standard depth로 검토했다. 23-19 gap closure의 i18n/search/auth/booking 변경은 별도로 추적했고, 관련 controller/service/schema까지 cross-reference했다.

핵심 결함은 실제 사용자 flow를 깨는 항목이다. Social OAuth completion은 API 필수 payload를 누락해 신규 social signup이 실패하고, seat map SVG는 업로드된 SVG를 sanitize 없이 inline HTML로 주입한다. Locale switching/search/mobile navigation도 locale contract를 깨는 회귀가 남아 있다.

## Critical Issues

### CR-01: [BLOCKER] Social OAuth completion payload omits required consent rows

**File:** `apps/web/app/auth/callback/page.tsx:127`

**Issue:** Social signup completion에서 `signupPayload`를 만들 때 `step2Data.consentItems`를 전송하지 않는다. 그런데 API는 `apps/api/src/modules/auth/dto/social-register.dto.ts:24`의 `consentItems`를 필수로 검증하고, `apps/api/src/modules/auth/auth.controller.ts:251`에서 schema parse를 수행한다. 결과적으로 신규 social user가 약관 동의 Step 2를 완료해도 `/api/v1/auth/social/complete-registration` 요청이 validation에서 실패한다. 만약 validation이 우회되더라도 `apps/api/src/modules/auth/auth.service.ts:648`의 consent audit persistence가 빠져 법적 동의 기록 contract가 깨진다.

**Fix:**

```tsx
const consentItems = step2Data.consentItems.map((item) => ({
  consentItemId: item.consentItemId,
  version: item.version,
  consented: item.consented,
  sourceFlow: 'social_completion' as const,
}));

const signupPayload = {
  provider,
  socialId,
  email: signupData.email,
  name: signupData.name,
  phoneNumber: step2Data.phoneNumber,
  birthDate: step2Data.birthDate,
  consentItems,
};
```

`SignupStep2`가 source flow를 prop으로 받을 수 있게 만들고, social callback POST body에 `consentItems`가 포함되는 regression test를 추가해야 한다.

### CR-02: [BLOCKER] Uploaded seat-map SVG can execute script in the booking page

**File:** `apps/web/components/booking/seat-map-viewer.tsx:527`

**Issue:** `svgUrl`에서 가져온 SVG를 `DOMParser`로 처리한 뒤 `dangerouslySetInnerHTML`로 두 번 inline render한다(`apps/web/components/booking/seat-map-viewer.tsx:527`, `apps/web/components/booking/seat-map-viewer.tsx:545`). Parsing과 seat element mutation은 `onload`, `onclick`, `foreignObject`, `javascript:` href 같은 executable SVG payload를 제거하지 않는다. Admin upload path도 `image/svg+xml`을 허용하고(`apps/api/src/modules/admin/upload.service.ts:132`), preview는 XML parse 가능 여부만 확인한다(`apps/web/components/admin/svg-preview.tsx:52`). 악성 SVG가 seat map으로 등록되면 booking page를 여는 사용자 브라우저에서 XSS가 발생할 수 있다.

**Fix:**

```tsx
import DOMPurify from 'dompurify';

const sanitizeSeatMapSvg = (svg: string) =>
  DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['onload', 'onclick', 'onerror', 'href', 'xlink:href'],
  });

setProcessedSvg(sanitizeSeatMapSvg(svg.outerHTML));
```

Client-side render 직전 sanitize와 server-side upload allowlist validation을 둘 다 적용해야 한다. Seat map에 필요한 SVG tag/attribute만 허용하고, malicious SVG fixture로 upload/render tests를 추가해야 한다.

### CR-03: [BLOCKER] Locale switcher drops query parameters

**File:** `apps/web/components/i18n/locale-switcher.tsx:58`

**Issue:** Locale 변경 시 `router.push(getLocalizedPathname(pathname, locale))`만 호출해서 현재 URL의 query string을 모두 버린다. 예를 들어 `/search?q=girl&page=2&genre=concert`에서 English로 바꾸면 `/en/search`로 이동해 검색어와 filter state가 사라진다. `apps/web/components/i18n/locale-suggestion.tsx:55`도 같은 방식으로 query를 버린다. Search page가 Phase 23 i18n smoke 대상인 만큼 locale 전환은 pathname뿐 아니라 URL state도 보존해야 한다.

**Fix:**

```tsx
const pathname = usePathname();
const searchParams = useSearchParams();

const handleLocaleChange = (locale: Locale) => {
  const localizedPath = getLocalizedPathname(pathname, locale);
  const query = searchParams.toString();

  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  router.push(query ? `${localizedPath}?${query}` : localizedPath);
  router.refresh();
};
```

`LocaleSwitcher`와 `LocaleSuggestion` 양쪽에 query preservation test를 추가해야 한다.

### CR-04: [BLOCKER] Localized search cannot find translated titles

**File:** `apps/api/src/modules/search/search.service.ts:36`

**Issue:** Search query condition은 `performances.searchVector`와 Korean canonical `performances.title`만 검색한다. Translation overlay는 result selection 이후에만 적용된다(`apps/api/src/modules/search/search.service.ts:74`). Seed data에는 Korean title `2026 걸룰스 팬미팅`과 translated title `2026 Girl Rules Fanmeeting`가 따로 있는데(`apps/api/src/database/seed.mjs:13`, `apps/api/src/database/seed.mjs:19`), `/en/search?q=girl`은 DB search 단계에서 Korean title과 match되지 않아 결과를 놓친다. `apps/web/e2e/i18n-smoke.spec.ts:105`는 `girl` query로 search page를 방문하지만 heading만 assert해서 empty result regression을 잡지 못한다.

**Fix:**

```ts
const translatedTitle = sql<string>`coalesce(${translationDrafts.title}, ${performances.title})`;

const searchCondition =
  locale === 'ko'
    ? baseSearchCondition
    : or(
        baseSearchCondition,
        ilike(translatedTitle, `%${query}%`),
        sql`to_tsvector('simple', ${translatedTitle}) @@ plainto_tsquery('simple', ${query})`,
      );
```

Published translation draft/source table을 locale 조건으로 join해 translated title도 검색 대상에 포함해야 한다. Service spec과 e2e smoke는 `/en/search?q=girl`에서 seeded performance title이 실제로 노출되는지 assert해야 한다.

### CR-05: [BLOCKER] Mobile authenticated navigation loses the active locale

**File:** `apps/web/components/layout/mobile-menu.tsx:135`

**Issue:** Authenticated mobile menu의 My Page link가 `href="/mypage"`로 고정되어 있다. Desktop GNB는 `apps/web/components/layout/gnb.tsx:245`에서 `getLocalizedPathname('/mypage', activeLocale)`를 사용하지만 mobile path는 locale prefix를 보존하지 않는다. `/en` 또는 `/th` 사용자가 mobile menu에서 My Page를 누르면 default-locale path로 빠져 locale routing/cookie contract가 깨진다.

**Fix:**

```tsx
<Link
  href={getLocalizedPathname('/mypage', activeLocale)}
  className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
  onClick={onClose}
>
  {user.name}
</Link>
```

Authenticated mobile menu를 foreign locale에서 render하는 test를 추가해 `/en/mypage` 같은 localized href를 검증해야 한다.

### CR-06: [BLOCKER] Signup consent step still renders Korean-only visible copy

**File:** `apps/web/components/auth/signup-step2.tsx:31`

**Issue:** Signup Step 2의 법적 동의 UI가 Korean strings로 hardcode되어 있다. `CONSENT_METADATA` title/description, `CROSS_BORDER_TRANSFER_WARNING`, "전체 동의", "필수", "선택", "보기", "이전", "회원가입 완료", dialog copy가 모두 Korean이다(`apps/web/components/auth/signup-step2.tsx:31`, `apps/web/components/auth/signup-step2.tsx:63`, `apps/web/components/auth/signup-step2.tsx:208`, `apps/web/components/auth/signup-step2.tsx:251`, `apps/web/components/auth/signup-step2.tsx:263`, `apps/web/components/auth/signup-step2.tsx:284`). Phase 23은 visible launch copy를 five locale로 노출하는 contract인데, foreign-locale user가 회원가입 필수 동의 단계에서 Korean-only UI를 보게 된다.

**Fix:**

```ts
export interface AuthConsentCopy {
  selectAll: string;
  required: string;
  optional: string;
  view: string;
  previous: string;
  submit: string;
  items: Record<string, { title: string; description: string }>;
}
```

`packages/shared/src/i18n/launch-copy-keys.ts`와 message files에 `auth.consent.*` key를 추가하고, `SignupStep2`가 `useLocale()` 기반 copy만 render하게 바꿔야 한다. Korean-only assertion test 대신 `en`, `th`, `zh-CN`, `zh-TW`에서 consent labels/buttons가 localized되는 tests를 추가해야 한다.

## Warnings

### WR-01: [WARNING] Booking disabled page still exposes untranslated booking controls

**File:** `apps/web/components/booking/booking-page.tsx:428`

**Issue:** `bookingDisabled` 상태에서 localized disabled card를 보여주지만, 같은 render tree 아래의 seat selection UI와 booking controls는 계속 Korean hardcode를 노출한다. 예: "좌석 선택", "다른 고객이 선택 중입니다", "선택한 좌석", "예매하기" 등이 `apps/web/components/booking/booking-page.tsx:428`, `apps/web/components/booking/seat-selection-panel.tsx:65`, `apps/web/components/booking/seat-selection-sheet.tsx:132`에 남아 있다. `/booking/:id`가 i18n smoke 대상이면 foreign locale disabled flow가 Korean booking shell을 함께 보여주는 regression이 된다.

**Fix:** Booking disabled 상태에서는 seat selection components를 render하지 말고 localized disabled-only state로 short-circuit하거나, booking namespace를 message files에 추가해 모든 booking controls를 locale-aware copy로 전환해야 한다. E2E smoke에는 foreign locale booking route에서 Korean visible copy가 없는지 또는 disabled-only state가 노출되는지 검증을 추가한다.

### WR-02: [WARNING] Initial signup verification email ignores the active locale

**File:** `apps/api/src/modules/auth/auth.service.ts:150`

**Issue:** 일반 signup 직후 발송되는 verification email locale이 `'ko'`로 hardcode되어 있다. `EmailService.sendEmailVerificationEmail`은 locale별 subject/body를 지원하지만(`apps/api/src/modules/auth/email/email.service.ts:135`), `register.dto.ts`와 `apps/web/components/auth/signup-form.tsx:53`의 register payload에는 locale이 없어서 최초 signup email은 항상 Korean이다. Resend/request verification path만 locale-aware라서 foreign user의 첫 transactional email이 page locale과 불일치한다.

**Fix:** `registerSchema`/`RegisterDto`에 supported `locale`을 추가하고, `SignupForm`이 active locale을 payload로 보낸 뒤 `AuthService.register()`에서 해당 locale을 `issueEmailVerificationForUser()`에 전달해야 한다. API service spec과 frontend submit test에 non-Korean locale case를 추가한다.

---

_Reviewed: 2026-05-07T04:12:05Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
