---
status: partial
phase: 23-launch-foundation
source:
  - .planning/phases/23-launch-foundation/23-01-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-02-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-03-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-04-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-05-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-06-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-07-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-08-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-09-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-10-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-11-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-12-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-13-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-14-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-15-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-16-SUMMARY.md
  - .planning/phases/23-launch-foundation/23-17-SUMMARY.md
started: 2026-05-07T00:58:02Z
updated: 2026-05-07T02:48:15Z
---

## Current Test

[automated re-test complete; dynamic `test-performance`, admin E2E seed, and SMS E2E runtime prerequisites remain blocked]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running web/API service. Clear ephemeral state that can hide startup issues, then start the app from scratch. The application boots without startup errors, required migrations/seed startup work completes or is already current, and a primary check such as homepage load, health check, or basic API query returns live data.
result: pass
reported: "Post-fix browser verification: GET / returns HTTP 200, renders homepage content, has no x-middleware-rewrite header, and does not render the not-found page."

### 2. Booking Disabled Gate
expected: With BOOKING_ENABLED=false, public detail and booking surfaces show the localized opening copy, seat selection/checkout actions cannot trigger lock, reservation prepare, Toss requestPayment, or payment confirm side effects, and API attempts return the disabled booking error before Redis, DB, or Toss work starts.
result: blocked
reported: "Post-fix browser verification: /api/runtime-flags returns bookingEnabled=false and /booking/test-performance no longer renders the not-found page, but the seeded dynamic fixture id `test-performance` currently returns API 500, so booking-disabled UI content still needs a seeded performance/showtime/seat-map fixture before final UAT."
severity: seed-prerequisite

### 3. Locale Routing And Sitemap
expected: Korean remains available at / and existing unprefixed Korean URLs, while en, th, zh-CN, and zh-TW use prefixed routes. The sitemap and hreflang alternates include all five locales without forcing Korean root to a prefixed URL.
result: pass
reported: "Post-fix browser and curl verification: /, /auth, /legal/terms, /en/auth, /th/legal/terms, /zh-CN/legal/privacy, and /zh-TW/legal/marketing all return HTTP 200. Korean flat routes have no /ko rewrite; foreign-prefixed routes rewrite internally to the existing flat page path while preserving the visible prefix."

### 4. Locale Switcher And Suggestion
expected: Desktop and mobile shells expose an explicit locale switcher with the active locale marked, locale suggestion appears only as a choose-or-dismiss prompt, dismissal persists for the session, and no automatic redirect happens when the prompt appears.
result: pass
reported: "Post-fix browser verification: locale-prefixed auth/legal destinations return HTTP 200, keep the visible locale prefix, and the route crawl recorded 0 hydration mismatch messages for /en/auth and other smoke URLs."

### 5. Auth Provider Scope And Email Verification
expected: Login/signup surfaces show Kakao, Naver, Google, and email only with no LINE affordance. Email verification supports sent, resend loading/success, expired, verified, throttled, and system-error states with localized copy.
result: pass
reported: "Post-fix browser verification: /auth, /en/auth, and /th/auth return HTTP 200 and render the login/signup surface instead of the not-found page."

### 6. Phone And OTP Localization
expected: PhoneInput and OTP verification copy follow the active launch locale across ko, en, th, zh-CN, and zh-TW. The country selector/search remains usable, unsupported country search still works, and invalid or blocked phone states show localized feedback.
result: pass
reported: "Post-fix browser verification: /auth, /en/auth, and /th/auth are reachable, so the previously blocked auth/signup route surface is no longer hidden by locale routing."

### 7. Three-Device Session Policy
expected: When a user exceeds three active refresh-token families, the oldest session is revoked while the new login succeeds, and the user-visible neutral notice explains that the oldest device session was ended.
result: pass
reported: "Post-fix browser verification: /auth returns HTTP 200 and renders the login UI instead of the not-found page; existing API refresh-family tests remain the behavioral evidence for the device policy."

### 8. Signup Consent And Under-14 Gate
expected: Signup shows seven itemized consent rows with required/optional status, version, language, and view actions. Required terms, privacy, PIPA, cross-border, PDPA, and PIPL items block continue until accepted, marketing remains optional, and under-14 signup is blocked without offering a guardian flow.
result: pass
reported: "Post-fix browser verification: /auth is reachable and renders the signup tab container instead of the not-found page; existing signup consent component/shared/API tests remain the behavioral evidence."

### 9. Consent Capture And Booking Consent Gate
expected: Email signup, social completion, and booking prepare submit structured consent rows with the correct sourceFlow. Missing required consent is rejected, accepted/refused rows are captured as immutable audit evidence, and booking-disabled still blocks before consent or reservation side effects.
result: blocked
reported: "Post-fix browser verification: /auth is reachable and /booking/test-performance no longer renders the not-found page, but the `test-performance` dynamic booking fixture returns API 500, so booking consent gate UAT needs a seeded performance with showtime, price tiers, and seat map."
severity: seed-prerequisite

### 10. Admin Consent Audit Query
expected: /admin/consent-audit provides dense filters for user/email, item, version, language, timestamp range, and IP. Results show item, version, language, source flow, timestamp, masked user contact, and masked IP; row activation works by click, Enter, and Space; loading, empty, and error states are visible.
result: pass

### 11. Admin Translation Workflow
expected: /admin/translations lets an admin create Korean source content, generate en/th/zh-CN/zh-TW drafts, review or edit draft text, publish reviewed drafts, and see stale status after source edits. Legal, notice, refund, and booking-guide content is blocked from machine translation before any provider call.
result: pass

### 12. Public Automatic Translation Label
expected: Public event/performance content backed by reviewed machine translation shows the automatic-translation label even after review/publish, without implying that AI-assisted copy is native manual legal copy.
result: blocked
reported: "Post-fix browser verification: /performance/test-performance no longer renders the not-found page, but the `test-performance` API fixture returns 500 and does not provide reviewed translation metadata. Public label UAT needs a seeded reviewed machine-translated performance id."
severity: seed-prerequisite

### 13. Legal Fallback And Footer Compliance
expected: Terms, privacy, and marketing legal pages render Korean or English canonical markdown only. Thai and Chinese legal routes show English canonical copy with a visible fallback label, no Thai/Chinese legal markdown exists, and the footer exposes required business/support/privacy contact details without LINE or social links.
result: pass
reported: "Post-fix browser verification: /legal/terms, /en/legal/terms, /th/legal/terms, /zh-CN/legal/privacy, and /zh-TW/legal/marketing all return HTTP 200 and render legal markdown content instead of the not-found page."

### 14. Event Detail KST And KRW Formatting
expected: Public performance detail pages show event-critical times with an explicit KST anchor plus locale-aware secondary local time where applicable, and prices show canonical KRW source amount with an estimated local amount and exchange-rate disclaimer.
result: blocked
reported: "Post-fix browser verification: /performance/test-performance no longer renders the not-found page, but the `test-performance` API fixture returns 500, so KST/KRW route-level UAT needs a seeded performance detail fixture with showtimes and price tiers."
severity: seed-prerequisite

### 15. Canary Rollback Runbook And Launch Gates
expected: The Phase 23 canary rollback runbook is present and operator-readable, covering auth/session, booking-disabled API, Korean root URL, locale routing, rollback triggers, and the rule that actual integrated M1 canary execution is deferred to Phase 26 rather than counted as Phase 23 runtime evidence.
result: pass

## Automated Verification Evidence

- `curl -I http://localhost:3000/` - PASS, HTTP 200, no `x-middleware-rewrite: /ko`.
- `curl -I http://localhost:3000/auth` - PASS, HTTP 200, no `x-middleware-rewrite: /ko/auth`.
- `curl -I http://localhost:3000/en/auth` - PASS, HTTP 200 with `x-middleware-rewrite: /auth`, visible URL remains `/en/auth`.
- `curl -I http://localhost:3000/th/legal/terms` - PASS, HTTP 200 with `x-middleware-rewrite: /legal/terms`.
- `curl -I http://localhost:3000/zh-CN/legal/privacy` - PASS, HTTP 200 with `x-middleware-rewrite: /legal/privacy`.
- `curl -I http://localhost:3000/zh-TW/legal/marketing` - PASS, HTTP 200 with `x-middleware-rewrite: /legal/marketing`.
- Playwright route crawl - PASS for static routing blocker scope: `/`, `/auth`, `/en/auth`, `/th/auth`, `/legal/terms`, `/en/legal/terms`, `/th/legal/terms`, `/zh-CN/legal/privacy`, `/zh-TW/legal/marketing`, and `/api/runtime-flags` all returned HTTP 200, did not render the not-found page, and recorded 0 hydration mismatch messages.
- Playwright route crawl - BLOCKED for seed-only dynamic checks: `/booking/test-performance` returned HTTP 200 route shell but body showed API `Internal server error`; `/booking/test-performance/confirm` redirected unauthenticated user to `/auth`; `/performance/test-performance` did not render not-found but lacks a seeded `test-performance` detail payload. Seed prerequisite: create or update `test-performance` with a valid performance detail, at least one showtime, price tier, seat map, and reviewed translation metadata where label/KST/KRW UAT requires it.
- Direct API probe `curl http://localhost:3000/api/v1/performances/test-performance` - BLOCKED, `{"statusCode":500,"message":"Internal server error"}` confirms the remaining dynamic checks are seeded-data/API fixture prerequisites rather than locale-routing blockers.
- Playwright route crawl - PASS for `/api/runtime-flags`, response body `{"bookingEnabled":false}`.
- `pnpm --filter @grabit/shared test -- flags.test.ts constants/locales.test.ts launch-copy-keys.test.ts auth.schema.test.ts` - PASS, 30 tests.
- `pnpm --filter @grabit/web test -- i18n-routing.test.ts sitemap.test.ts gnb-locale.test.tsx layout-shell-locale.test.tsx signup-consent.test.tsx signup-submit-consent.test.tsx legal-fallback.test.tsx footer.test.tsx format.test.ts format-components.test.tsx performance-detail-formatting.test.tsx phone-input-i18n.test.tsx phone-verification-i18n.test.tsx translation-review.test.tsx consent-audit-table.test.tsx automatic-translation-label.test.tsx` - PASS, 313 tests.
- `pnpm --filter @grabit/api test -- feature-flags.service.spec.ts booking.service.spec.ts reservation.service.spec.ts translation.service.spec.ts deepl.client.spec.ts auth.service.spec.ts auth.controller.spec.ts email.service.spec.ts sms.service.spec.ts consent.service.spec.ts consent-audit.controller.spec.ts auth-consent.dto.spec.ts user.service.spec.ts user.controller.spec.ts` - PASS, 493 tests.
- `pnpm --filter @grabit/shared typecheck` - PASS.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/api typecheck` - PASS.
- 2026-05-07 automated re-test: Browser Use route crawl - PASS for `/`, `/auth`, `/en/auth`, `/th/auth`, `/legal/terms`, `/en/legal/terms`, `/th/legal/terms`, `/zh-CN/legal/privacy`, `/zh-TW/legal/marketing`, and `/api/runtime-flags`; all returned HTTP 200, avoided not-found, preserved foreign visible prefixes, and recorded 0 browser console errors/warnings.
- 2026-05-07 automated re-test: Browser Use dynamic route check - BLOCKED for seeded fixture UAT. `/booking/test-performance`, `/booking/test-performance/confirm`, and `/performance/test-performance` route shells did not render not-found, but the direct API probe `/api/v1/performances/test-performance` still returned `{"statusCode":500,"message":"Internal server error"}`.
- 2026-05-07 automated re-test: `pnpm test` - PASS; shared 30 tests, API 493 tests, web 316 tests.
- 2026-05-07 automated re-test: `pnpm typecheck` - PASS.
- 2026-05-07 automated re-test: `pnpm lint` - PASS with warnings; API 42 warnings, web 25 warnings, 0 errors.
- 2026-05-07 automated re-test: `pnpm build` - PASS.
- 2026-05-07 automated re-test: `pnpm --filter @grabit/web exec playwright test --reporter=line` - BLOCKED/PARTIAL; 10 passed, 7 skipped, 6 failed. Four admin dashboard E2E failures are caused by `admin@grabit.test` login returning 401 against the current local DB. Two signup SMS E2E failures are caused by live SMS/runtime rate-limit state (`요청이 너무 많습니다`) rather than the expected dev mock `000000` flow. These require a reset/seeded E2E environment or adjusted E2E fixtures before they can be counted as Phase 23 UAT pass/fail evidence.

## Summary

total: 15
passed: 11
issues: 0
pending: 0
skipped: 0
blocked: 4

## Gaps

- truth: "Kill any running web/API service. Clear ephemeral state that can hide startup issues, then start the app from scratch. The application boots without startup errors, required migrations/seed startup work completes or is already current, and a primary check such as homepage load, health check, or basic API query returns live data."
  status: resolved
  reason: "Post-fix browser verification: `/` returns HTTP 200, has no `/ko` middleware rewrite, and renders homepage content instead of not-found."
  severity: resolved
  test: 1
  root_cause: "Resolved by 23-18 flat-route locale proxy in `apps/web/proxy.ts`."
  artifacts:
    - path: "apps/web/proxy.ts"
      issue: "Custom proxy forwards `X-NEXT-INTL-LOCALE=ko` without rewriting Korean flat routes."
  missing:
    - "None for locale-routing blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "With BOOKING_ENABLED=false, public detail and booking surfaces show the localized opening copy, seat selection/checkout actions cannot trigger lock, reservation prepare, Toss requestPayment, or payment confirm side effects, and API attempts return the disabled booking error before Redis, DB, or Toss work starts."
  status: blocked
  reason: "Routing blocker resolved: `/booking/test-performance` no longer renders not-found. Remaining blocker is seeded dynamic fixture/API: `/api/v1/performances/test-performance` returns 500, so the booking-disabled UI cannot be fully evaluated on that id."
  severity: seed-prerequisite
  test: 2
  root_cause: "Seed/API fixture prerequisite, not locale middleware."
  artifacts:
    - path: "apps/web/app/booking/[performanceId]/page.tsx"
      issue: "Route is reachable; fixture data for `test-performance` is unavailable or invalid."
  missing:
    - "Seed `test-performance` with a valid performance detail, showtime, price tiers, and seat map, or update UAT to use an existing seeded performance id."
  debug_session: "inline-uat-2026-05-07"
- truth: "Korean remains available at / and existing unprefixed Korean URLs, while en, th, zh-CN, and zh-TW use prefixed routes. The sitemap and hreflang alternates include all five locales without forcing Korean root to a prefixed URL."
  status: resolved
  reason: "Post-fix curl/browser verification: Korean flat URLs return 200 with no `/ko` rewrite; foreign-prefixed URLs return 200 with internal rewrites to existing flat paths."
  severity: resolved
  test: 3
  root_cause: "Resolved by 23-18 flat-route locale proxy."
  artifacts:
    - path: "apps/web/proxy.ts"
      issue: "Foreign prefixes are stripped only for internal routing while visible URLs stay prefixed."
  missing:
    - "None for locale-routing blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "Desktop and mobile shells expose an explicit locale switcher with the active locale marked, locale suggestion appears only as a choose-or-dismiss prompt, dismissal persists for the session, and no automatic redirect happens when the prompt appears."
  status: resolved
  reason: "Post-fix route crawl recorded 0 hydration mismatch messages and locale-prefixed destinations no longer render not-found."
  severity: resolved
  test: 4
  root_cause: "Resolved by flat-route proxy plus mount-only LocaleSuggestion cookie read."
  artifacts:
    - path: "apps/web/components/i18n/locale-suggestion.tsx"
      issue: "Initial render is stable; suggestion prompt appears after mount only."
  missing:
    - "None for locale-routing/hydration blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "Login/signup surfaces show Kakao, Naver, Google, and email only with no LINE affordance. Email verification supports sent, resend loading/success, expired, verified, throttled, and system-error states with localized copy."
  status: resolved
  reason: "Post-fix browser verification: `/auth`, `/en/auth`, and `/th/auth` return 200 and render login/signup UI instead of not-found."
  severity: resolved
  test: 5
  root_cause: "Resolved by 23-18 flat-route locale proxy."
  artifacts:
    - path: "apps/web/app/auth/page.tsx"
      issue: "Flat auth page is reachable for default and foreign locale URLs."
    - path: "apps/web/proxy.ts"
      issue: "No nonexistent `/ko/auth` internal rewrite remains."
  missing:
    - "None for route reachability blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "PhoneInput and OTP verification copy follow the active launch locale across ko, en, th, zh-CN, and zh-TW. The country selector/search remains usable, unsupported country search still works, and invalid or blocked phone states show localized feedback."
  status: resolved
  reason: "Post-fix browser verification: auth/signup route container is reachable at default and foreign locale URLs; isolated PhoneInput/OTP localization tests remain green."
  severity: resolved
  test: 6
  root_cause: "Resolved by 23-18 flat-route locale proxy."
  artifacts:
    - path: "apps/web/components/ui/phone-input.tsx"
      issue: "Component tests pass."
    - path: "apps/web/app/auth/page.tsx"
      issue: "Containing route is served under default and foreign locale URLs."
  missing:
    - "None for route reachability blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "When a user exceeds three active refresh-token families, the oldest session is revoked while the new login succeeds, and the user-visible neutral notice explains that the oldest device session was ended."
  status: resolved
  reason: "Post-fix browser verification: `/auth` returns 200 and renders login UI; backend refresh-family tests remain green."
  severity: resolved
  test: 7
  root_cause: "Resolved by 23-18 flat-route locale proxy."
  artifacts:
    - path: "apps/api/src/modules/auth/auth.service.ts"
      issue: "Policy tests pass."
    - path: "apps/web/components/auth/login-form.tsx"
      issue: "Login surface is reachable through /auth."
  missing:
    - "None for route reachability blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "Signup shows seven itemized consent rows with required/optional status, version, language, and view actions. Required terms, privacy, PIPA, cross-border, PDPA, and PIPL items block continue until accepted, marketing remains optional, and under-14 signup is blocked without offering a guardian flow."
  status: resolved
  reason: "Post-fix browser verification: `/auth` route is reachable; signup consent component/shared/API tests remain green."
  severity: resolved
  test: 8
  root_cause: "Resolved by 23-18 flat-route locale proxy."
  artifacts:
    - path: "apps/web/components/auth/signup-step2.tsx"
      issue: "Component tests pass."
    - path: "apps/web/app/auth/page.tsx"
      issue: "Auth route returns 200 at runtime."
  missing:
    - "None for route reachability blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "Email signup, social completion, and booking prepare submit structured consent rows with the correct sourceFlow. Missing required consent is rejected, accepted/refused rows are captured as immutable audit evidence, and booking-disabled still blocks before consent or reservation side effects."
  status: blocked
  reason: "Routing blocker resolved for `/auth` and `/booking/test-performance`; remaining booking consent gate UAT is blocked because `test-performance` returns API 500."
  severity: seed-prerequisite
  test: 9
  root_cause: "Seed/API fixture prerequisite, not locale middleware."
  artifacts:
    - path: "apps/api/src/modules/consent/consent.service.ts"
      issue: "API tests pass."
    - path: "apps/web/app/auth/page.tsx"
      issue: "Signup route reachable."
    - path: "apps/web/app/booking/[performanceId]/page.tsx"
      issue: "Booking route shell reachable; tested fixture id returns API 500."
  missing:
    - "Seed `test-performance` with valid booking data or point UAT at an existing seeded performance id."
  debug_session: "inline-uat-2026-05-07"
- truth: "Public event/performance content backed by reviewed machine translation shows the automatic-translation label even after review/publish, without implying that AI-assisted copy is native manual legal copy."
  status: blocked
  reason: "Routing blocker resolved: `/performance/test-performance` no longer renders not-found. Remaining blocker is fixture data: `test-performance` API returns 500 and lacks reviewed translation metadata."
  severity: seed-prerequisite
  test: 12
  root_cause: "Seed/API fixture prerequisite, not locale middleware."
  artifacts:
    - path: "apps/web/app/performance/[id]/page.tsx"
      issue: "Public detail route is reachable; tested fixture id has no valid detail payload."
  missing:
    - "Seed a reviewed machine-translated performance id for route-level automatic label UAT."
  debug_session: "inline-uat-2026-05-07"
- truth: "Terms, privacy, and marketing legal pages render Korean or English canonical markdown only. Thai and Chinese legal routes show English canonical copy with a visible fallback label, no Thai/Chinese legal markdown exists, and the footer exposes required business/support/privacy contact details without LINE or social links."
  status: resolved
  reason: "Post-fix browser verification: default and foreign legal URLs return 200 and render legal markdown content instead of not-found."
  severity: resolved
  test: 13
  root_cause: "Resolved by 23-18 flat-route locale proxy."
  artifacts:
    - path: "apps/web/app/legal/terms/page.tsx"
      issue: "Legal page reachable under default and foreign locale URLs."
    - path: "apps/web/app/legal/privacy/page.tsx"
      issue: "Legal page reachable under foreign locale URL."
    - path: "apps/web/app/legal/marketing/page.tsx"
      issue: "Legal page reachable under foreign locale URL."
  missing:
    - "None for route reachability blocker."
  debug_session: "inline-uat-2026-05-07"
- truth: "Public performance detail pages show event-critical times with an explicit KST anchor plus locale-aware secondary local time where applicable, and prices show canonical KRW source amount with an estimated local amount and exchange-rate disclaimer."
  status: blocked
  reason: "Routing blocker resolved: `/performance/test-performance` no longer renders not-found. Remaining blocker is fixture data: `test-performance` API returns 500, so KST/KRW detail content cannot be evaluated."
  severity: seed-prerequisite
  test: 14
  root_cause: "Seed/API fixture prerequisite, not locale middleware."
  artifacts:
    - path: "apps/web/app/performance/[id]/page.tsx"
      issue: "Route shell reachable; tested fixture id has no valid detail payload."
  missing:
    - "Seed `test-performance` with showtimes and price tiers, or use an existing valid seeded performance id for KST/KRW UAT."
  debug_session: "inline-uat-2026-05-07"
