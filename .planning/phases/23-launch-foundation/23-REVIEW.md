---
phase: 23-launch-foundation
reviewed: 2026-05-07T04:38:53Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - apps/web/lib/svg/safety.ts
  - apps/web/components/booking/seat-map-viewer.tsx
  - apps/web/components/booking/__tests__/seat-map-viewer.test.tsx
  - apps/web/components/admin/svg-preview.tsx
  - apps/web/components/admin/__tests__/svg-preview.test.tsx
  - apps/web/app/auth/callback/page.tsx
  - apps/web/components/auth/signup-step2.tsx
  - apps/api/src/modules/auth/dto/social-register.dto.ts
  - apps/api/src/modules/auth/auth.service.ts
  - apps/web/components/i18n/locale-switcher.tsx
  - apps/web/components/i18n/locale-suggestion.tsx
  - apps/api/src/modules/search/search.service.ts
  - apps/web/components/layout/mobile-menu.tsx
  - apps/web/components/booking/booking-page.tsx
  - apps/web/components/auth/auth-launch-copy.ts
  - apps/web/messages/ko.json
  - apps/web/messages/en.json
  - apps/web/messages/th.json
  - apps/web/messages/zh-CN.json
  - apps/web/messages/zh-TW.json
  - apps/web/components/auth/signup-form.tsx
  - apps/api/src/modules/auth/dto/register.dto.ts
  - apps/api/src/modules/auth/email/email.service.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 23: Code Review Report

**Reviewed:** 2026-05-07T04:38:53Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** clean

## Summary

Current HEAD `896dee19f55ef3276a6a771e16072e2e6257f419` (`fix(23): block svg style injection`)을 기준으로, 이전 report의 남은 CR-01인 SVG `<style>` document-wide CSS injection을 재검토했다.

`apps/web/lib/svg/safety.ts`는 shared sanitizer로 이동되어 `script`, `style`, `foreignObject`, embedded/object media 계열 tag를 normalized `localName`으로 차단하고, event handler, `href`/`xlink:href`/`src`, `javascript:`, unsafe `style` URL/expression attribute를 제거 또는 감지한다. `SeatMapViewer`는 `dangerouslySetInnerHTML` 전에 `sanitizeParsedSvg(doc)`를 호출하고, `SvgPreview`는 R2 upload 전에 `hasUnsafeSvgPayload(doc)`로 동일 정책을 적용한다.

Regression coverage도 확인했다. `seat-map-viewer.test.tsx`는 malicious SVG의 `<style>#outside-seat-map{display:none!important}</style>`가 inline render 전에 제거되는지 검증하고, `svg-preview.test.tsx`는 같은 payload가 admin upload 단계에서 거부되는지 검증한다.

All reviewed files meet quality standards. No issues found.

## Prior Finding Spot-Check

| Prior ID | Status | Evidence |
|----------|--------|----------|
| CR-01 Social OAuth consent payload | Fixed | `apps/web/app/auth/callback/page.tsx:128-144`가 `consentItems`를 social completion POST payload에 포함하고, `apps/web/components/auth/signup-step2.tsx:172-188` 및 callback page `:205-213`이 `sourceFlow="social_completion"` consent rows를 생성한다. Backend도 `apps/api/src/modules/auth/dto/social-register.dto.ts:18-26`, `apps/api/src/modules/auth/auth.service.ts:604-655`에서 required consent와 audit capture를 유지한다. |
| CR-02 Seat-map SVG XSS / CSS injection | Fixed | `apps/web/lib/svg/safety.ts:1-45`가 `<style>`을 포함한 unsafe SVG nodes/attrs를 sanitize하고, `SeatMapViewer`가 `apps/web/components/booking/seat-map-viewer.tsx:146-158`에서 sanitize 후 `:547`에 주입한다. `SvgPreview`는 `apps/web/components/admin/svg-preview.tsx:53-68`에서 upload 전 unsafe payload를 reject한다. |
| CR-03 Locale switcher query preservation | Fixed | `LocaleSwitcher`와 `LocaleSuggestion`가 각각 `apps/web/components/i18n/locale-switcher.tsx:59-64`, `apps/web/components/i18n/locale-suggestion.tsx:57-62`에서 `appendSearchParams(..., searchParams.toString())`를 유지한다. |
| CR-04 Translated-title search | Fixed | `apps/api/src/modules/search/search.service.ts:39-63`가 non-default locale 검색에서 published translated title condition을 포함한다. |
| CR-05 Mobile My Page locale | Fixed | `apps/web/components/layout/mobile-menu.tsx:134-136`가 `/mypage` hardcode 대신 `getLocalizedPathname('/mypage', activeLocale)`를 사용한다. |
| CR-06 Signup consent visible copy | Fixed | `apps/web/components/auth/signup-step2.tsx:135-180`가 active locale copy와 consent row language를 사용하고, five-locale message keys가 `apps/web/messages/*.json:77-115`에 유지되어 있다. |
| WR-01 Booking disabled controls | Fixed | `apps/web/components/booking/booking-page.tsx:406-435`가 disabled booking state에서 booking flow controls를 render하지 않고 status panel로 short-circuit한다. |
| WR-02 Signup email locale | Fixed | `apps/web/components/auth/signup-form.tsx:53-68`가 active `locale`을 register payload에 포함하고, `apps/api/src/modules/auth/dto/register.dto.ts:32-34`, `apps/api/src/modules/auth/auth.service.ts:150-154`, `apps/api/src/modules/auth/email/email.service.ts:137-200`가 localized verification email path를 유지한다. |

## Verification

- `pnpm --filter @grabit/web test -- seat-map-viewer.test.tsx svg-preview.test.tsx` passed: 51 test files, 328 tests. Existing React `act(...)` and jsdom not-implemented stderr warnings appeared, but no test failed.
- `pnpm --filter @grabit/web typecheck` passed.

---

_Reviewed: 2026-05-07T04:38:53Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
