---
phase: 23-launch-foundation
plan: "19"
subsystem: i18n
tags: [nextjs, nestjs, i18n, playwright, drizzle, translation-overlay]

requires:
  - phase: 23-launch-foundation
    provides: "Flat locale routing, booking-disabled runtime flag, translation draft schema, and Phase 23 UAT baseline"
provides:
  - "Five-locale visible copy contract for public launch surfaces"
  - "Prefix-preserving navigation for GNB, mobile menu, search, genre, performance, auth, and booking links"
  - "Reviewed machine translation overlay for public performance APIs"
  - "Stable Phase 23 i18n smoke fixture with UUID 00000000-0000-4000-8000-000000000023"
  - "Dedicated Playwright i18n smoke independent from admin login and live SMS state"
affects: [phase-26-canary, public-web, performance-api, auth-ui, booking-disabled]

tech-stack:
  added: []
  patterns:
    - "Locale-aware visible copy resolved through shared manifest plus per-locale message files"
    - "Public performance translations overlaid only from published review drafts"
    - "Canary smoke isolates i18n route/copy behavior from auth-admin/SMS dependencies"

key-files:
  created:
    - apps/web/lib/i18n/visible-copy.ts
    - apps/api/src/modules/translation/performance-translation-overlay.ts
    - apps/web/e2e/i18n-smoke.spec.ts
    - apps/web/components/auth/__tests__/signup-step1-i18n.test.tsx
  modified:
    - packages/shared/src/i18n/launch-copy-keys.ts
    - packages/shared/src/schemas/performance.schema.ts
    - packages/shared/src/types/performance.types.ts
    - apps/web/messages/ko.json
    - apps/web/messages/en.json
    - apps/web/messages/th.json
    - apps/web/messages/zh-CN.json
    - apps/web/messages/zh-TW.json
    - apps/api/src/database/seed.mjs
    - apps/api/src/modules/performance/performance.controller.ts
    - apps/api/src/modules/performance/performance.service.ts
    - apps/api/src/modules/search/search.service.ts
    - .planning/phases/23-launch-foundation/23-UAT.md

key-decisions:
  - "Use stable UUID 00000000-0000-4000-8000-000000000023 as the Phase 23 i18n smoke fixture instead of invalid test-performance."
  - "Overlay only published performance translation drafts for non-Korean locales and mark public content as machine_reviewed."
  - "Keep the dedicated i18n smoke independent from admin login and live SMS E2E state."

patterns-established:
  - "Locale query propagation: web hooks pass active locale to API list/detail/search requests."
  - "Translation labeling: automaticTranslationLabel is true only when a published draft actually overlays a public field."
  - "Smoke isolation: Playwright neutralizes unauthenticated refresh noise while still failing on unrelated console errors and hydration issues."

requirements-completed: [FLAG-02, I18N-01, I18N-02, TRANS-01, TRANS-02, AUTH-01]

duration: 40min
completed: 2026-05-07T03:55:06Z
---

# Phase 23 Plan 19: i18n Remediation Gap Closure Summary

**Five-locale launch copy, prefix-preserving public navigation, reviewed performance translation overlay, and a stable i18n canary smoke fixture**

## Performance

- **Duration:** 40min
- **Started:** 2026-05-07T03:15:40Z
- **Completed:** 2026-05-07T03:55:06Z
- **Tasks:** 4 completed
- **Files modified:** 50

## Accomplishments

- Expanded the launch copy manifest and all five message files for nav, home, search, performance, booking-disabled, and auth form/tab copy.
- Rewired public launch surfaces so foreign-locale users keep `/en`, `/th`, `/zh-CN`, or `/zh-TW` prefixes through GNB, mobile menu, search, genre, performance, auth, and booking paths.
- Exposed reviewed published performance translations from API detail/list/search/home responses with `automaticTranslationLabel=true` and `translatedBy='machine_reviewed'`.
- Replaced the invalid `test-performance` UAT fixture with stable UUID `00000000-0000-4000-8000-000000000023`, seeded with showtime, price tiers, seat map, and reviewed translations.
- Added `apps/web/e2e/i18n-smoke.spec.ts` covering all five locales across home, auth, search, performance detail, and booking-disabled routes without admin login or live SMS dependencies.
- Resolved post-review i18n blockers for social signup consent payloads, consent step localization, query-preserving locale switches, translated-title search, authenticated mobile navigation, disabled booking controls, localized signup verification email, and unsafe inline SVG handling.

## Task Commits

1. **Task 1 RED: visible copy contract tests** - `a9980ed` (`test`)
2. **Task 1 GREEN: visible launch copy contract** - `d13c990` (`feat`)
3. **Task 2: localized public launch surfaces** - `bdd6256` (`feat`)
4. **Task 3 RED: performance translation overlay tests** - `98322cc` (`test`)
5. **Task 3 GREEN: reviewed performance translations** - `6f03e9f` (`feat`)
6. **Task 3 auto-fix: metadata test typing** - `1970f9b` (`fix`)
7. **Task 4: i18n canary smoke and UAT evidence** - `6ecc558` (`test`)
8. **Task 2 auto-fix: signup password step copy** - `290afb3` (`fix`)

_Plan metadata commit is recorded separately after this summary and state updates._

## Verification

Passed:

- `pnpm --filter @grabit/shared test -- launch-copy-keys.test.ts`
- `pnpm --filter @grabit/web test -- visible-copy.test.ts`
- `node -e "const fs=require('fs'); const locales=['ko','en','th','zh-CN','zh-TW']; for (const l of locales) { const m=JSON.parse(fs.readFileSync('apps/web/messages/'+l+'.json','utf8')); for (const p of ['nav.searchPlaceholder','home.hot','search.promptTitle','performance.bookCta','booking.disabled','auth.tabs.login','auth.form.email']) { let v=m; for (const k of p.split('.')) v=v?.[k]; if (!v) throw new Error(l+' missing '+p); } }"`
- `pnpm --filter @grabit/web test -- gnb-locale.test.tsx layout-shell-locale.test.tsx home-i18n.test.tsx search-i18n.test.tsx auth-page-i18n.test.tsx booking-disabled-runtime.test.tsx performance-detail-formatting.test.tsx performance-detail-translation-label.test.tsx`
- `pnpm --filter @grabit/web typecheck`
- `! rg -n "\"HOT 공연\"|\"신규 오픈\"|\"장르별 바로가기\"|\"공연을 검색하세요\"|\"공연 정보를 불러오지 못했습니다\"|\"예매하기\"|\"로그인 중\\.\\.\\.\"|\"회원가입이 완료되었습니다\"" apps/web/app apps/web/components apps/web/hooks -g '!**/__tests__/**' -g '!**/*.test.tsx' -g '!**/*.test.ts'`
- `pnpm --filter @grabit/api test -- performance.service.spec.ts search.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/web test -- performance-detail-translation-label.test.tsx`
- `rg -n "00000000-0000-4000-8000-000000000023|PHASE23_I18N_SMOKE_PERFORMANCE_ID|automaticTranslationLabel|machine_reviewed" apps/api/src apps/web/hooks packages/shared/src`
- `pnpm --filter @grabit/api seed`
- `pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --reporter=line`
- `pnpm --filter @grabit/web test -- visible-copy.test.ts home-i18n.test.tsx search-i18n.test.tsx auth-page-i18n.test.tsx booking-disabled-runtime.test.tsx performance-detail-translation-label.test.tsx`
- `pnpm typecheck`
- Post-fix checks: `pnpm --filter @grabit/shared test -- launch-copy-keys.test.ts`, `pnpm --filter @grabit/web test -- signup-step1-i18n.test.tsx visible-copy.test.ts`, `pnpm --filter @grabit/web typecheck`
- Post-review checks: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --reporter=line`

Notes:

- Web Vitest still emits pre-existing jsdom/React `act` and `window.scrollTo` warnings in unrelated suites; all selected tests passed.
- Local API seed and dev server were used for the Playwright smoke. The API process was stopped after verification and port 8080 was confirmed free.

## Files Created/Modified

- `packages/shared/src/i18n/launch-copy-keys.ts` - Expanded launch copy manifest for canary-visible namespaces and auth signup step copy.
- `apps/web/messages/{ko,en,th,zh-CN,zh-TW}.json` - Added localized copy for nav, home, search, performance, booking, and auth launch surfaces.
- `apps/web/lib/i18n/visible-copy.ts` - Added supported-locale copy resolver with Korean fallback.
- `apps/web/components/i18n/locale-switcher.tsx` - Added prefix-preserving localized pathname helper.
- `apps/web/components/layout/gnb.tsx`, `apps/web/components/layout/mobile-menu.tsx` - Localized shell copy and search/navigation behavior.
- `apps/web/app/page.tsx`, `apps/web/app/search/page.tsx`, `apps/web/app/performance/[id]/page.tsx`, `apps/web/components/booking/booking-page.tsx` - Localized public route surfaces.
- `apps/web/components/auth/login-form.tsx`, `apps/web/components/auth/signup-form.tsx`, `apps/web/components/auth/signup-step1.tsx`, `apps/web/components/auth/signup-step2.tsx` - Localized planned auth-visible copy and related status messaging.
- `packages/shared/src/schemas/performance.schema.ts`, `packages/shared/src/types/performance.types.ts` - Added locale query and translation metadata typing.
- `apps/api/src/modules/performance/performance.controller.ts`, `apps/api/src/modules/performance/performance.service.ts`, `apps/api/src/modules/search/search.service.ts` - Added UUID validation, locale propagation, and published translation overlay.
- `apps/api/src/modules/translation/performance-translation-overlay.ts` - Shared overlay helper for performance fields and card titles.
- `apps/api/src/database/seed.mjs` - Added stable smoke fixture and published performance translation drafts.
- `apps/web/e2e/i18n-smoke.spec.ts` - Added five-locale public canary smoke.
- `.planning/phases/23-launch-foundation/23-UAT.md` - Recorded passing i18n smoke evidence and reclassified admin/SMS issues as outside this i18n smoke.

## Decisions Made

- The i18n smoke fixture uses a stable UUID instead of route-only slugs so API validation, database seed, and Playwright smoke share one deterministic contract.
- Performance translation overlay is intentionally narrow: only `performance` entity fields `title`, `description`, and `salesInfo` are read from published drafts; legal/manual content is not queried or seeded.
- Public translated responses carry translation metadata only when an actual published draft overlays at least one field.
- The Playwright smoke isolates public i18n behavior from auth refresh noise by returning `204` for `/api/v1/auth/refresh` in the test, while still failing on other browser console errors and hydration mismatch messages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed SearchService mock shape for translation overlay tests**
- **Found during:** Task 3 GREEN
- **Issue:** The new search overlay path needed `innerJoin` behavior from the query-chain test double.
- **Fix:** Updated the test double to model the query chain used by the implementation.
- **Files modified:** `apps/api/src/modules/search/search.service.spec.ts`
- **Verification:** `pnpm --filter @grabit/api test -- performance.service.spec.ts search.service.spec.ts`
- **Committed in:** `6f03e9f`

**2. [Rule 1 - Bug] Kept translation-label metadata tests type-safe after narrowing `translatedBy`**
- **Found during:** Task 4 verification
- **Issue:** Web typecheck failed because a negative-path test intentionally supplied legacy `translatedBy` metadata after the shared type was narrowed to `'machine_reviewed'`.
- **Fix:** Widened the test override helper input while keeping production types strict.
- **Files modified:** `apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx`
- **Verification:** `pnpm --filter @grabit/web typecheck`
- **Committed in:** `1970f9b`

**3. [Rule 3 - Blocking] Restarted local API with seeded fixture for smoke verification**
- **Found during:** Task 4 Playwright verification
- **Issue:** The existing API process on port 8080 did not include the new seeded fixture/translation code.
- **Fix:** Seeded the local database, restarted the API dev process, verified the translated fixture response, ran the smoke, then stopped the API process.
- **Files modified:** None
- **Verification:** `pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --reporter=line`
- **Committed in:** N/A

**4. [Rule 2 - Missing Critical] Localized signup password confirmation step copy**
- **Found during:** Post-task stub/visible-copy scan
- **Issue:** `signup-step1.tsx`, one of the Task 2 target files, still had Korean-only password confirmation copy outside the locale message contract.
- **Fix:** Added `passwordDescription`, `passwordConfirm`, `passwordConfirmPlaceholder`, and `nextButton` to `auth.form` for all launch locales and wired `SignupStep1` to use them.
- **Files modified:** `packages/shared/src/i18n/launch-copy-keys.ts`, `packages/shared/src/i18n/launch-copy-keys.test.ts`, `apps/web/messages/{ko,en,th,zh-CN,zh-TW}.json`, `apps/web/components/auth/signup-step1.tsx`, `apps/web/components/auth/__tests__/signup-step1-i18n.test.tsx`
- **Verification:** `pnpm --filter @grabit/shared test -- launch-copy-keys.test.ts`, `pnpm --filter @grabit/web test -- signup-step1-i18n.test.tsx visible-copy.test.ts`, `pnpm --filter @grabit/web typecheck`
- **Committed in:** `290afb3`

**5. [Code Review] Closed Phase 23 i18n review blockers**
- **Found during:** Phase 23 post-execution code review
- **Issue:** The review identified gaps in social signup consent submission, consent step localization, locale switch query preservation, translated search matching, authenticated mobile navigation, booking-disabled rendering, signup verification email locale propagation, and inline SVG safety.
- **Fix:** Added localized consent copy, propagated consent payloads and signup locale, preserved query strings in locale navigation, matched reviewed translated titles in search, localized the mobile My Page link, short-circuited disabled booking UI, and sanitized/rejected unsafe SVG payloads.
- **Files modified:** `apps/web/app/auth/callback/page.tsx`, `apps/web/components/auth/signup-step2.tsx`, `apps/web/components/auth/signup-form.tsx`, `apps/web/components/i18n/locale-switcher.tsx`, `apps/web/components/i18n/locale-suggestion.tsx`, `apps/web/components/layout/mobile-menu.tsx`, `apps/web/components/booking/booking-page.tsx`, `apps/web/components/booking/seat-map-viewer.tsx`, `apps/web/components/admin/svg-preview.tsx`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/dto/register.dto.ts`, `apps/api/src/modules/search/search.service.ts`, `apps/web/messages/{ko,en,th,zh-CN,zh-TW}.json`, `packages/shared/src/i18n/launch-copy-keys.ts`
- **Verification:** `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --reporter=line`
- **Committed in:** pending post-review remediation commit

---

**Total deviations:** 5 auto-fixed (1 post-review remediation bundle, 1 missing critical, 1 bug, 2 blocking)
**Impact on plan:** All fixes were directly required for the planned i18n surface, type correctness, or local smoke verification. No architecture changes or new external dependencies were introduced.

## Issues Encountered

- `pnpm --filter @grabit/web exec prettier --write ...` could not be used because the project does not expose a `prettier` binary in the workspace command path. Formatting-sensitive files were kept in the existing style manually and validated with tests/typecheck.
- The API seed command emitted an existing `pg` warning about concurrent query usage in seed flow. The seed completed successfully and the i18n fixture was verified by API response before Playwright smoke.
- Broader auth components still contain Korean literals in tests and non-canary flows. The plan-targeted auth login/signup-completion/under-14/temp fallback plus signup step one copy are localized; remaining account recovery/profile/legal-auth surfaces are outside this Phase 23 i18n canary smoke.

## Auth Gates

None.

## Known Stubs

None. Stub scan found only benign test helper empty arrays, DOM `placeholder` prop names, and CSS `placeholder:` classes.

## Threat Flags

None. New public locale query and translation overlay surfaces match the plan threat model mitigations: supported-locale validation, performance-only published draft overlay, no legal content reads, and translation label tests for Korean/no-label vs foreign/labeled responses.

## TDD Gate Compliance

- RED gate present for Task 1: `a9980ed`
- GREEN gate present for Task 1: `d13c990`
- RED gate present for Task 3: `98322cc`
- GREEN gate present for Task 3: `6f03e9f`

## User Setup Required

None. No external service configuration was added.

## Next Phase Readiness

Phase 26 canary now has a stable public i18n smoke gate covering five locales, real translated performance content, locale-preserving navigation, and booking-disabled behavior. Remaining admin login and live SMS E2E issues are tracked separately from the i18n smoke and should not block Phase 23 i18n verification.

## Self-Check: PASSED

- Found summary and created artifact files: `23-19-SUMMARY.md`, `apps/web/e2e/i18n-smoke.spec.ts`, `apps/web/lib/i18n/visible-copy.ts`, `apps/api/src/modules/translation/performance-translation-overlay.ts`, `apps/web/components/auth/__tests__/signup-step1-i18n.test.tsx`.
- Found all task/deviation commits: `a9980ed`, `d13c990`, `bdd6256`, `98322cc`, `6f03e9f`, `1970f9b`, `6ecc558`, `290afb3`.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-07*
