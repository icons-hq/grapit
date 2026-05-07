---
phase: 23-launch-foundation
verified: 2026-05-07T02:24:35Z
status: passed
score: "10/10 must-haves verified"
requirements:
  - FLAG-01
  - FLAG-02
  - I18N-01
  - I18N-02
  - TRANS-01
  - TRANS-02
  - AUTH-01
  - AUTH-02
  - COMP-01
  - COMP-02
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: "10/10 must-haves verified"
  gaps_closed:
    - "Locale-routing UAT blocker: default Korean routes no longer rewrite to nonexistent /ko paths, and foreign-prefixed auth/legal routes serve real flat App Router pages."
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "Seeded dynamic performance/booking fixture UAT for /performance/test-performance and /booking/test-performance"
    addressed_in: "Phase 26"
    evidence: "ROADMAP Phase 26 success criterion 1 requires full event detail in five locales with payment disabled and booking-disabled E2E. Phase 23 UAT now records the route shells as reachable and the remaining failure as test-performance API fixture 500, not locale routing."
  - truth: "Actual M1 integrated smoke/canary deploy execution"
    addressed_in: "Phase 26"
    evidence: "REQUIREMENTS maps M1-01 to Phase 26; ROADMAP Phase 26 covers M1 Canary + Cutover Gates."
residual_risks:
  - "apps/web/next-env.d.ts is dirty from Next build-generated type reference churn and was not treated as a Phase 23 deliverable."
  - "Web tests still emit existing act/jsdom warnings in unrelated test files, but all tested files passed and no Phase 23 blocker behavior failed."
---

# Phase 23: Launch Foundation Verification Report

**Phase Goal:** 이후 fanmeet 기능이 의존하는 prod compatibility, flags, localization, auth, translation, legal lock, consent/audit 기반을 한 실행 단위로 구축한다.  
**Verified:** 2026-05-07T02:24:35Z  
**Status:** passed  
**Re-verification:** Yes - after Plan 23-18 locale-routing UAT gap closure and post-review hardening.

## Goal Achievement

Phase 23 goal is achieved at the codebase/foundation level. I verified the actual source, tests, plan frontmatter artifacts/key links, UAT record, ROADMAP, and REQUIREMENTS rather than relying on SUMMARY claims.

The previous locale-routing UAT blocker is closed: `apps/web/proxy.ts` no longer uses `createMiddleware`, prefixless Korean routes are served without `/ko` rewrites, foreign prefixes rewrite internally to flat routes, reserved prefixed namespaces are not stripped into protected paths, and `LocaleSuggestion` hydrates from a stable null initial render.

The remaining `test-performance` UAT items are seed-only dynamic fixture prerequisites: the route shells are reachable, but the API fixture returns 500 and lacks showtime/price/seat-map/reviewed-translation data. This is deferred to Phase 26 integrated smoke/canary criteria, not a Phase 23 implementation gap.

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | FLAG-01: Existing production users, reservations, sessions, and Korean SEO URLs remain valid through expand-only migrations, canary policy, and Korean root URL preservation. | VERIFIED | Phase 23 schema artifacts pass; previous expand-only migration evidence still stands; `apps/web/proxy.ts` serves `/` and `/auth` as Korean without `/ko` rewrite; canary execution remains Phase 26. |
| 2 | FLAG-02: `BOOKING_ENABLED=false` shows localized disabled copy and blocks API seat locks/payment attempts. | VERIFIED | `FeatureFlagsService.assertBookingEnabled()` is called in `booking.service.ts` and `reservation.service.ts`; web runtime flag hooks feed booking/detail disabled UI; shared/API/web tests passed. |
| 3 | I18N-01: Public pages support `ko`, `en`, `th`, `zh-CN`, `zh-TW`; Korean remains prefixless and foreign locales are prefixed. | VERIFIED | `SUPPORTED_LOCALES`, `routing.localePrefix='as-needed'`, custom proxy, sitemap alternates, and focused routing/layout tests all pass. |
| 4 | I18N-02: Locale-sensitive flows include PhoneInput, auth/OTP/email/SMS copy, time/currency, hreflang, sitemap, and visible locale surfaces. | VERIFIED | PhoneInput locale tests, SMS/email copy tests, sitemap tests, KST/KRW component tests, and layout locale tests passed; `PerformanceDetailPage` renders `KstTime` and `CurrencyDisplay`. |
| 5 | TRANS-01: Operator can create Korean source content, generate four drafts, review/publish, and show automatic-translation labels. | VERIFIED | `TranslationService.generateDrafts()` creates drafts for target locales; admin translation hooks/page call `/api/v1/admin/translations`; public performance detail renders `AutomaticTranslationLabel` from translation metadata. |
| 6 | TRANS-02: Legal notices stay Korean/English manual and auto-translation is blocked. | VERIFIED | `LEGAL_BLOCKED_CONTENT_TYPES` blocks legal/notice/refund/booking_guide before provider calls; legal fallback/metadata tests passed. |
| 7 | AUTH-01: Kakao/Naver/Google/email auth, 30-minute email verification, immediate resend, LINE excluded. | VERIFIED | `AuthController` exposes Kakao/Naver/Google routes and no LINE route; email verification expiry/resend paths are covered by passing API/web tests. |
| 8 | AUTH-02: Three-device refresh family policy is enforced. | VERIFIED | `AuthService` refresh-family cap/reuse tests passed in the API suite. |
| 9 | COMP-01: PIPA, cross-border, PDPA/PIPL, under-14, marketing consent, and legal/footer surfaces are captured. | VERIFIED | Shared consent schema defines required/optional rows; signup UI emits item/version/language/sourceFlow; auth service captures consent transactionally; signup/legal/footer tests passed. |
| 10 | COMP-02: Operator can query masked consent audit logs by item/version/language/timestamp/IP/user. | VERIFIED | `ConsentService.queryConsentAudit()` filters required fields and masks user/IP; admin consent audit table submits all COMP-02 filters; API/web tests passed. |

**Score:** 10/10 truths verified

## Roadmap Success Criteria

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Expand-only migrations, canary policy, shared feature flag helper preserve production users/reservations/sessions/Korean root URLs. | VERIFIED | Artifact checks pass; shared flag helper is exported; prefixless Korean route preservation is covered by proxy tests. Actual canary execution is deferred to Phase 26. |
| 2 | Korean routes prefixless; foreign routes use `/en`, `/th`, `/zh-CN`, `/zh-TW` with hreflang, sitemap, locale preference, time/currency formatting, PhoneInput localization. | VERIFIED | `proxy.ts`, `routing.ts`, sitemap, KST/KRW, PhoneInput, layout locale tests all pass. |
| 3 | Korean source content can generate reviewed translations; legal notices remain Korean/English manual and auto-translation blocked. | VERIFIED | Translation service/admin/public label and legal block tests pass. |
| 4 | Kakao, Naver, Google, email verification, 5-country SMS OTP, three-device policy tested; LINE excluded. | VERIFIED | API auth/SMS suites pass; LINE absence is asserted in auth tests and UI tests. |
| 5 | PIPA, cross-border, PDPA/PIPL, under-14, marketing consent, audit log, footer legal surfaces are captured. | VERIFIED | Consent schema, signup UI, API capture, audit query UI, and footer/legal tests pass. |
| 6 | `BOOKING_ENABLED=false` blocks API seat locks and payment attempts, not only UI buttons. | VERIFIED | API booking/reservation tests pass; `assertBookingEnabled()` is called before lock/prepare/confirm paths. |

## Deferred Items

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | Seeded dynamic `test-performance` booking/detail UAT | Phase 26 | `23-UAT.md` records `/booking/test-performance` and `/performance/test-performance` as route-shell reachable but blocked by API fixture 500. Phase 26 criterion 1 covers full detail, payment-disabled, booking-disabled E2E. |
| 2 | Actual M1 integrated smoke/canary deploy execution | Phase 26 | REQUIREMENTS maps `M1-01` to Phase 26; ROADMAP Phase 26 is M1 Canary + Cutover Gates. |

## Required Artifacts

| Artifact Group | Expected | Status | Details |
|---|---|---|---|
| Plan frontmatter artifacts | All Phase 23 plan artifacts exist and are substantive | VERIFIED | `gsd-sdk query verify.artifacts` passed for all 18 plans: 62/62 artifacts. |
| Locale routing gap closure | Flat-route proxy, routing tests, hydration-safe LocaleSuggestion, UAT update | VERIFIED | Plan 23-18 artifacts passed 4/4; source inspection confirms implementation. |
| Shared contracts | Feature flags, locale constants, launch copy, auth/booking/consent schemas | VERIFIED | Shared tests passed 5 files / 30 tests. |
| API foundations | Feature flags, booking/reservation gates, translation, auth/email/SMS, consent audit | VERIFIED | API suite passed 41 files / 493 tests. |
| Web foundations | Routing/sitemap/layout locale, booking-disabled UI, performance formatting/label, consent/admin/legal surfaces | VERIFIED | Web suite passed 46 files / 316 tests. |

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Phase 23 plan key links | Actual source wiring | `gsd-sdk query verify.key-links` plus manual false-negative check | VERIFIED | SDK verified 37/38 links. The only SDK false negative is `packages/shared/src/index.ts` -> `packages/shared/src/flags.ts`; manual check confirms `export * from './flags';` at line 24. |
| Plan 23-18 proxy | `apps/web/i18n/routing.ts` | `resolveLocaleFromPathname`, locale header, flat rewrite | VERIFIED | `proxy.ts` imports routing helpers, sets `x-next-intl-locale`, serves Korean via `NextResponse.next`, rewrites foreign prefixes to flat paths. |
| Plan 23-18 LocaleSuggestion | `LayoutShell` | rendered shell component and mount-only cookie read | VERIFIED | `layout-shell-locale.test.tsx` verifies suggestion copy, admin/booking hiding, malformed cookie handling, and no redirect APIs. |
| Booking API | Feature flag service | DI + `assertBookingEnabled()` before side effects | VERIFIED | `booking.service.ts` and `reservation.service.ts` call `assertBookingEnabled()`; tests cover disabled errors and no side effects. |
| Translation API/admin/public | Translation service, hooks, public label | API controller/service + admin hooks + performance detail label | VERIFIED | Admin translation tests cover source/draft/review/publish; public detail tests cover automatic label metadata. |
| Consent signup/admin | Consent service, auth service, admin audit table | itemized payload + DB audit rows + masked query UI | VERIFIED | `AuthService` captures signup/social consent transactionally; `ConsentService` returns masked audit rows; admin UI filter test passes. |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `apps/web/proxy.ts` | active locale | URL prefix resolved by `resolveLocaleFromPathname`; prefixless routes default to `ko` | Yes | FLOWING |
| `apps/web/components/i18n/locale-suggestion.tsx` | `suggestedLocale` | client-readable `locale-suggestion` cookie after mount, validated by `isSupportedLocale` | Yes | FLOWING |
| `apps/web/lib/runtime-flags.ts` / `apps/web/hooks/use-runtime-flags.ts` | `bookingEnabled` | runtime API/env parser using shared `readFeatureFlags()` | Yes | FLOWING |
| `apps/api/src/modules/feature-flags/feature-flags.service.ts` | `bookingEnabled` | process runtime env provider -> shared parser -> API gate | Yes | FLOWING |
| `apps/web/app/performance/[id]/page.tsx` | performance detail, translation label, KST/KRW | `usePerformanceDetail(id)` result -> `KstTime`, `CurrencyDisplay`, `AutomaticTranslationLabel` | Yes for code path; UAT fixture data remains deferred | FLOWING |
| `apps/api/src/modules/translation/translation.service.ts` | translation source/drafts | Drizzle translation source/draft tables + DeepL adapter/fallback | Yes | FLOWING |
| `apps/api/src/modules/auth/auth.service.ts` | email tokens and refresh families | Drizzle token tables, 30-minute expiry, active family queries | Yes | FLOWING |
| `apps/api/src/modules/consent/consent.service.ts` | audit rows/filter state | `consent_audit_logs` joined with `users`, masked before return | Yes | FLOWING |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Plan 23-18 artifacts exist/substantive | `gsd-sdk query verify.artifacts .planning/phases/23-launch-foundation/23-18-PLAN.md --raw` | 4/4 passed | PASS |
| All Phase 23 artifacts exist/substantive | `gsd-sdk query verify.artifacts` across all 18 plans | 62/62 passed | PASS |
| Plan key links wired | `gsd-sdk query verify.key-links` across all plans + manual barrel export check | 38/38 verified after manual false-negative check | PASS |
| Routing/layout hardening tests | `pnpm --filter @grabit/web exec vitest run i18n/routing.test.ts components/layout/__tests__/layout-shell-locale.test.tsx` | 2 files, 15 tests passed | PASS |
| Shared contracts | `pnpm --filter @grabit/shared test -- flags.test.ts constants/locales.test.ts launch-copy-keys.test.ts auth.schema.test.ts` | 5 files, 30 tests passed | PASS |
| API foundations | `pnpm --filter @grabit/api test -- feature-flags.service.spec.ts booking.service.spec.ts reservation.service.spec.ts translation.service.spec.ts auth.service.spec.ts auth.controller.spec.ts consent.service.spec.ts consent-audit.controller.spec.ts auth-consent.dto.spec.ts` | 41 files, 493 tests passed | PASS |
| Web foundations | `pnpm --filter @grabit/web test -- i18n-routing.test.ts sitemap.test.ts layout-shell-locale.test.tsx performance-detail-formatting.test.tsx performance-detail-translation-label.test.tsx booking-disabled-runtime.test.tsx signup-consent.test.tsx signup-submit-consent.test.tsx consent-audit-table.test.tsx translation-review.test.tsx phone-input-i18n.test.tsx phone-verification-i18n.test.tsx legal-fallback.test.tsx footer.test.tsx` | 46 files, 316 tests passed | PASS |
| Production build | `pnpm build` | Turbo build passed for shared/api/web | PASS |
| Full test command | `pnpm test` | Turbo test passed: shared 30, API 493, web 316 tests | PASS |

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| FLAG-01 | 23-01, 23-02, 23-03, 23-04 | Existing production users, reservations, sessions, and Korean SEO URLs remain valid through expand-only migrations and canary deploys. | SATISFIED | Expand-only/schema artifacts pass; shared feature flag export exists; Korean flat routes are preserved; actual canary deploy is deferred to Phase 26. |
| FLAG-02 | 23-01, 23-03, 23-07, 23-08, 23-18 | User sees booking disabled localized copy, and booking APIs do not create seat locks/payment attempts while disabled. | SATISFIED | Runtime disabled copy and API hard gates are wired/tested; Plan 23-18 fixed route reachability for UAT surfaces. |
| I18N-01 | 23-01, 23-02, 23-04, 23-13, 23-16, 23-17, 23-18 | Public pages in five locales; Korean `/`, foreign prefixes. | SATISFIED | Locale constants, proxy, sitemap/legal fallback/layout tests passed; UAT routing blocker resolved. |
| I18N-02 | 23-01, 23-02, 23-04, 23-05, 23-08, 23-09, 23-11, 23-14, 23-15, 23-16, 23-18 | Locale-sensitive PhoneInput/auth/OTP/email/SMS/time/currency/hreflang/sitemap. | SATISFIED | PhoneInput, SMS/email copy, KST/KRW, sitemap, routing, and layout tests passed. |
| TRANS-01 | 23-01, 23-02, 23-05, 23-11, 23-18 | Korean source -> four translated drafts -> review/publish -> automatic-translation label. | SATISFIED | Translation service/admin/public label tests pass; dynamic label route UAT fixture is deferred, not code-missing. |
| TRANS-02 | 23-01, 23-02, 23-05, 23-11, 23-13, 23-17, 23-18 | Legal notices schema-locked Korean/English manual; automatic translation blocked for legal copy. | SATISFIED | Legal content guard and legal fallback tests pass; Thai/Chinese legal fallback routes are reachable. |
| AUTH-01 | 23-01, 23-02, 23-06, 23-07, 23-09, 23-10, 23-18 | Kakao/Naver/Google/email auth, 30-minute email verification, immediate resend, LINE excluded. | SATISFIED | Auth controller/service/UI tests pass; no LINE route/provider is exposed. |
| AUTH-02 | 23-01, 23-02, 23-06, 23-18 | Three-device refresh token family tracking. | SATISFIED | Auth service refresh-family policy tests pass. |
| COMP-01 | 23-01, 23-02, 23-07, 23-10, 23-13, 23-17, 23-18 | PIPA, cross-border, PDPA/PIPL, under-14, marketing consent, legal/footer surfaces. | SATISFIED | Consent schema/signup/auth/legal/footer tests pass. |
| COMP-02 | 23-02, 23-07, 23-12 | Consent audit query by item/version/language/timestamp/IP/user. | SATISFIED | Consent service/controller/admin audit table tests pass; no orphaned Phase 23 requirement found. |

All ten Phase 23 requirement IDs listed in PLAN frontmatter are present in `.planning/REQUIREMENTS.md` and have supporting code/test evidence. No additional Phase 23 requirement IDs are orphaned.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `apps/web/components/i18n/locale-suggestion.tsx` | 42, 95, 99, 108, 113 | `return null` | INFO | Valid conditional render and parse fallback; not a stub. Component is wired into layout tests and route shell. |
| `apps/web/i18n/routing.ts` | 46, 54, 100 | `return null` | INFO | Valid no-suggestion/unsupported-language return; not user-visible fake data. |
| `apps/web/i18n/routing.test.ts` | 183 | `return null` | INFO | Test helper for absent rewrite header. |

No blocker stub, missing implementation, hollow hardcoded data path, or console-only handler was found in the Plan 23-18 modified source files. Existing `placeholder` UI text in unrelated admin inputs is not a Phase 23 stub.

## Human Verification Required

None for the Phase 23 completion decision.

The remaining route-level checks for `/performance/test-performance` and `/booking/test-performance` require seeded event data before they can be rerun, but they are explicitly classified as Phase 26 integrated smoke/canary prerequisites. They do not indicate a missing Phase 23 foundation artifact.

## Gaps Summary

No Phase 23 implementation gaps remain. Plan 23-18 closed the locale-routing UAT blocker and post-review hardening closed stale-cookie, spoofed-header, malformed-cookie, and prefixed reserved namespace regressions. The phase can proceed with the seed-only dynamic fixture prerequisite tracked as deferred Phase 26 evidence.

---

_Verified: 2026-05-07T02:24:35Z_  
_Verifier: the agent (gsd-verifier)_
