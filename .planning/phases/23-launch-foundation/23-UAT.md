---
status: diagnosed
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
updated: 2026-05-07T01:32:54Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running web/API service. Clear ephemeral state that can hide startup issues, then start the app from scratch. The application boots without startup errors, required migrations/seed startup work completes or is already current, and a primary check such as homepage load, health check, or basic API query returns live data.
result: issue
reported: "Automated browser verification: localhost:3000 boots, but GET / returns HTTP 404 and renders the not-found page instead of the homepage."
severity: blocker

### 2. Booking Disabled Gate
expected: With BOOKING_ENABLED=false, public detail and booking surfaces show the localized opening copy, seat selection/checkout actions cannot trigger lock, reservation prepare, Toss requestPayment, or payment confirm side effects, and API attempts return the disabled booking error before Redis, DB, or Toss work starts.
result: issue
reported: "Automated verification: /api/runtime-flags returns bookingEnabled=false and API/web guard tests pass, but /booking/test-performance and /booking/test-performance/confirm render 404, so the user-facing disabled booking state cannot be reached."
severity: major

### 3. Locale Routing And Sitemap
expected: Korean remains available at / and existing unprefixed Korean URLs, while en, th, zh-CN, and zh-TW use prefixed routes. The sitemap and hreflang alternates include all five locales without forcing Korean root to a prefixed URL.
result: issue
reported: "Automated browser and curl verification: /, /auth, /legal/terms, /en/auth, /th/legal/terms, /zh-CN/legal/privacy, and /zh-TW/legal/marketing all render 404. Headers show middleware rewrites such as x-middleware-rewrite: /ko and /ko/auth."
severity: blocker

### 4. Locale Switcher And Suggestion
expected: Desktop and mobile shells expose an explicit locale switcher with the active locale marked, locale suggestion appears only as a choose-or-dismiss prompt, dismissal persists for the session, and no automatic redirect happens when the prompt appears.
result: issue
reported: "Automated browser verification: locale switcher and suggestion prompt render on the 404 shell, but locale-prefixed destinations still render not-found pages. Playwright also captured a hydration mismatch involving LocaleSuggestion on /en/auth."
severity: major

### 5. Auth Provider Scope And Email Verification
expected: Login/signup surfaces show Kakao, Naver, Google, and email only with no LINE affordance. Email verification supports sent, resend loading/success, expired, verified, throttled, and system-error states with localized copy.
result: issue
reported: "Automated verification: API/auth component tests pass, but /auth, /en/auth, and /th/auth render 404 in the browser, so login/signup and email verification UI are not reachable."
severity: blocker

### 6. Phone And OTP Localization
expected: PhoneInput and OTP verification copy follow the active launch locale across ko, en, th, zh-CN, and zh-TW. The country selector/search remains usable, unsupported country search still works, and invalid or blocked phone states show localized feedback.
result: issue
reported: "Automated verification: PhoneInput and OTP localization tests pass, but the auth/signup route that exposes the phone UI renders 404 in the running app."
severity: major

### 7. Three-Device Session Policy
expected: When a user exceeds three active refresh-token families, the oldest session is revoked while the new login succeeds, and the user-visible neutral notice explains that the oldest device session was ended.
result: issue
reported: "Automated verification: API refresh-family tests pass, but the login UI that should surface the neutral device-limit notice is unreachable because /auth renders 404."
severity: major

### 8. Signup Consent And Under-14 Gate
expected: Signup shows seven itemized consent rows with required/optional status, version, language, and view actions. Required terms, privacy, PIPA, cross-border, PDPA, and PIPL items block continue until accepted, marketing remains optional, and under-14 signup is blocked without offering a guardian flow.
result: issue
reported: "Automated verification: signup consent component/shared/API tests pass, but the running /auth page renders 404, so the signup consent and under-14 flow cannot be used."
severity: major

### 9. Consent Capture And Booking Consent Gate
expected: Email signup, social completion, and booking prepare submit structured consent rows with the correct sourceFlow. Missing required consent is rejected, accepted/refused rows are captured as immutable audit evidence, and booking-disabled still blocks before consent or reservation side effects.
result: issue
reported: "Automated verification: consent capture and booking consent API tests pass, but /auth and /booking/test-performance are unreachable in the browser due 404 routing."
severity: major

### 10. Admin Consent Audit Query
expected: /admin/consent-audit provides dense filters for user/email, item, version, language, timestamp range, and IP. Results show item, version, language, source flow, timestamp, masked user contact, and masked IP; row activation works by click, Enter, and Space; loading, empty, and error states are visible.
result: pass

### 11. Admin Translation Workflow
expected: /admin/translations lets an admin create Korean source content, generate en/th/zh-CN/zh-TW drafts, review or edit draft text, publish reviewed drafts, and see stale status after source edits. Legal, notice, refund, and booking-guide content is blocked from machine translation before any provider call.
result: pass

### 12. Public Automatic Translation Label
expected: Public event/performance content backed by reviewed machine translation shows the automatic-translation label even after review/publish, without implying that AI-assisted copy is native manual legal copy.
result: issue
reported: "Automated verification: translation-label component/page tests pass, but /performance/test-performance renders 404 in the running app, so the public label is not observable through the actual route."
severity: major

### 13. Legal Fallback And Footer Compliance
expected: Terms, privacy, and marketing legal pages render Korean or English canonical markdown only. Thai and Chinese legal routes show English canonical copy with a visible fallback label, no Thai/Chinese legal markdown exists, and the footer exposes required business/support/privacy contact details without LINE or social links.
result: issue
reported: "Automated verification: legal/footer tests pass and footer renders on the 404 shell, but /legal/terms, /en/legal/terms, /th/legal/terms, /zh-CN/legal/privacy, and /zh-TW/legal/marketing all render 404 instead of legal content."
severity: blocker

### 14. Event Detail KST And KRW Formatting
expected: Public performance detail pages show event-critical times with an explicit KST anchor plus locale-aware secondary local time where applicable, and prices show canonical KRW source amount with an estimated local amount and exchange-rate disclaimer.
result: issue
reported: "Automated verification: KST/KRW formatter and page tests pass, but /performance/test-performance renders 404 in the running app."
severity: major

### 15. Canary Rollback Runbook And Launch Gates
expected: The Phase 23 canary rollback runbook is present and operator-readable, covering auth/session, booking-disabled API, Korean root URL, locale routing, rollback triggers, and the rule that actual integrated M1 canary execution is deferred to Phase 26 rather than counted as Phase 23 runtime evidence.
result: pass

## Automated Verification Evidence

- `curl -I http://localhost:3000/` - FAIL, HTTP 404 with `x-middleware-rewrite: /ko`.
- `curl -I http://localhost:3000/auth` - FAIL, HTTP 404 with `x-middleware-rewrite: /ko/auth`.
- `curl -I http://localhost:3000/legal/terms` - FAIL, HTTP 404 with `x-middleware-rewrite: /ko/legal/terms`.
- Playwright route crawl - FAIL for `/`, `/auth`, `/en/auth`, `/th/auth`, `/legal/terms`, `/en/legal/terms`, `/th/legal/terms`, `/zh-CN/legal/privacy`, `/zh-TW/legal/marketing`, `/booking/test-performance`, `/booking/test-performance/confirm`, and `/performance/test-performance`; each rendered the not-found page.
- Playwright route crawl - PASS for `/api/runtime-flags`, response body `{"bookingEnabled":false}`.
- `pnpm --filter @grabit/shared test -- flags.test.ts constants/locales.test.ts launch-copy-keys.test.ts auth.schema.test.ts` - PASS, 30 tests.
- `pnpm --filter @grabit/web test -- i18n-routing.test.ts sitemap.test.ts gnb-locale.test.tsx layout-shell-locale.test.tsx signup-consent.test.tsx signup-submit-consent.test.tsx legal-fallback.test.tsx footer.test.tsx format.test.ts format-components.test.tsx performance-detail-formatting.test.tsx phone-input-i18n.test.tsx phone-verification-i18n.test.tsx translation-admin.test.tsx consent-audit.test.tsx automatic-translation-label.test.tsx` - PASS, 310 tests.
- `pnpm --filter @grabit/api test -- feature-flags.service.spec.ts booking.service.spec.ts reservation.service.spec.ts translation.service.spec.ts deepl.client.spec.ts auth.service.spec.ts auth.controller.spec.ts email.service.spec.ts email-verification.copy.spec.ts sms.service.spec.ts sms-copy.spec.ts consent.service.spec.ts consent-audit.controller.spec.ts auth-consent.dto.spec.ts user.service.spec.ts user.controller.spec.ts` - PASS, 493 tests.
- `pnpm --filter @grabit/shared typecheck` - PASS.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/api typecheck` - PASS.

## Summary

total: 15
passed: 3
issues: 12
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Kill any running web/API service. Clear ephemeral state that can hide startup issues, then start the app from scratch. The application boots without startup errors, required migrations/seed startup work completes or is already current, and a primary check such as homepage load, health check, or basic API query returns live data."
  status: failed
  reason: "Automated browser verification: localhost:3000 boots, but GET / returns HTTP 404 and renders the not-found page instead of the homepage."
  severity: blocker
  test: 1
  root_cause: "The web app uses next-intl createMiddleware(routing), which internally rewrites default-locale requests such as / and /auth to /ko and /ko/auth. The App Router tree is flat under apps/web/app and does not contain an apps/web/app/[locale]/... route segment, so rewritten locale paths miss all public pages and hit not-found."
  artifacts:
    - path: "apps/web/proxy.ts"
      issue: "createMiddleware(routing) rewrites public requests to locale-prefixed internal paths."
    - path: "apps/web/i18n/routing.ts"
      issue: "localePrefix: as-needed is configured for next-intl routing."
    - path: "apps/web/app"
      issue: "No [locale] route segment exists for middleware-rewritten locale paths."
  missing:
    - "Either add a [locale] route segment covering public/auth/legal/performance/booking routes, or replace next-intl middleware rewriting with a flat-route locale resolution strategy that does not rewrite to nonexistent /ko paths."
    - "Add browser/integration coverage asserting /, /auth, /legal/terms, and a foreign locale route return non-404 content."
  debug_session: "inline-uat-2026-05-07"
- truth: "With BOOKING_ENABLED=false, public detail and booking surfaces show the localized opening copy, seat selection/checkout actions cannot trigger lock, reservation prepare, Toss requestPayment, or payment confirm side effects, and API attempts return the disabled booking error before Redis, DB, or Toss work starts."
  status: failed
  reason: "Automated verification: /api/runtime-flags returns bookingEnabled=false and API/web guard tests pass, but /booking/test-performance and /booking/test-performance/confirm render 404, so the user-facing disabled booking state cannot be reached."
  severity: major
  test: 2
  root_cause: "Same locale routing architecture mismatch: locale middleware and/or route navigation reaches paths that are not backed by the current flat App Router tree."
  artifacts:
    - path: "apps/web/proxy.ts"
      issue: "Public route middleware affects booking routes."
    - path: "apps/web/app/booking/[performanceId]/page.tsx"
      issue: "Flat booking route exists, but locale-routed runtime paths are not mapped to it."
  missing:
    - "Make booking pages reachable under the chosen locale routing architecture."
    - "Add a browser smoke test for booking-disabled UI on a seeded or mocked performance route."
  debug_session: "inline-uat-2026-05-07"
- truth: "Korean remains available at / and existing unprefixed Korean URLs, while en, th, zh-CN, and zh-TW use prefixed routes. The sitemap and hreflang alternates include all five locales without forcing Korean root to a prefixed URL."
  status: failed
  reason: "Automated browser and curl verification: /, /auth, /legal/terms, /en/auth, /th/legal/terms, /zh-CN/legal/privacy, and /zh-TW/legal/marketing all render 404. Headers show middleware rewrites such as x-middleware-rewrite: /ko and /ko/auth."
  severity: blocker
  test: 3
  root_cause: "next-intl middleware routing is configured, but the route tree was not migrated to the [locale] segment shape that next-intl middleware expects."
  artifacts:
    - path: "apps/web/i18n/routing.ts"
      issue: "Defines locale routing for ko/en/th/zh-CN/zh-TW."
    - path: "apps/web/proxy.ts"
      issue: "Applies locale middleware to all non-api, non-static public paths."
    - path: "apps/web/app"
      issue: "No [locale] directory exists."
  missing:
    - "Align route tree and middleware behavior."
    - "Add real HTTP/browser assertions for default and prefixed locale routes."
  debug_session: "inline-uat-2026-05-07"
- truth: "Desktop and mobile shells expose an explicit locale switcher with the active locale marked, locale suggestion appears only as a choose-or-dismiss prompt, dismissal persists for the session, and no automatic redirect happens when the prompt appears."
  status: failed
  reason: "Automated browser verification: locale switcher and suggestion prompt render on the 404 shell, but locale-prefixed destinations still render not-found pages. Playwright also captured a hydration mismatch involving LocaleSuggestion on /en/auth."
  severity: major
  test: 4
  root_cause: "The shell UI exists, but locale choices route into the same missing locale-path problem. LocaleSuggestion can also render different server/client markup when suggestion cookie state changes across navigation."
  artifacts:
    - path: "apps/web/components/i18n/locale-switcher.tsx"
      issue: "Switch destinations depend on the locale route policy."
    - path: "apps/web/components/i18n/locale-suggestion.tsx"
      issue: "Hydration mismatch observed during browser crawl."
  missing:
    - "Verify locale switch URLs against the fixed route architecture."
    - "Stabilize LocaleSuggestion server/client initial render when suggestion cookie state is present."
  debug_session: "inline-uat-2026-05-07"
- truth: "Login/signup surfaces show Kakao, Naver, Google, and email only with no LINE affordance. Email verification supports sent, resend loading/success, expired, verified, throttled, and system-error states with localized copy."
  status: failed
  reason: "Automated verification: API/auth component tests pass, but /auth, /en/auth, and /th/auth render 404 in the browser, so login/signup and email verification UI are not reachable."
  severity: blocker
  test: 5
  root_cause: "Auth route exists at apps/web/app/auth/page.tsx, but runtime locale routing requests /ko/auth or /en/auth, which the flat route tree does not serve."
  artifacts:
    - path: "apps/web/app/auth/page.tsx"
      issue: "Flat auth page exists."
    - path: "apps/web/proxy.ts"
      issue: "Middleware rewrites public auth path to locale-prefixed path."
  missing:
    - "Make auth routes reachable for default and foreign locales."
    - "Add browser smoke coverage for /auth showing social buttons and email form."
  debug_session: "inline-uat-2026-05-07"
- truth: "PhoneInput and OTP verification copy follow the active launch locale across ko, en, th, zh-CN, and zh-TW. The country selector/search remains usable, unsupported country search still works, and invalid or blocked phone states show localized feedback."
  status: failed
  reason: "Automated verification: PhoneInput and OTP localization tests pass, but the auth/signup route that exposes the phone UI renders 404 in the running app."
  severity: major
  test: 6
  root_cause: "Phone and OTP components pass isolated tests, but their containing auth/signup page is unreachable due the locale route mismatch."
  artifacts:
    - path: "apps/web/components/ui/phone-input.tsx"
      issue: "Component passes tests but is unreachable through /auth."
    - path: "apps/web/app/auth/page.tsx"
      issue: "Containing route is not served under middleware locale paths."
  missing:
    - "Restore reachable auth/signup route and add browser coverage for localized phone UI."
  debug_session: "inline-uat-2026-05-07"
- truth: "When a user exceeds three active refresh-token families, the oldest session is revoked while the new login succeeds, and the user-visible neutral notice explains that the oldest device session was ended."
  status: failed
  reason: "Automated verification: API refresh-family tests pass, but the login UI that should surface the neutral device-limit notice is unreachable because /auth renders 404."
  severity: major
  test: 7
  root_cause: "Backend policy is covered, but the user-facing login surface is blocked by the auth route 404."
  artifacts:
    - path: "apps/api/src/modules/auth/auth.service.ts"
      issue: "Policy tests pass."
    - path: "apps/web/components/auth/login-form.tsx"
      issue: "Notice UI exists but is unreachable through /auth."
  missing:
    - "Restore auth route reachability and cover device-limit notice in a browser or integration test."
  debug_session: "inline-uat-2026-05-07"
- truth: "Signup shows seven itemized consent rows with required/optional status, version, language, and view actions. Required terms, privacy, PIPA, cross-border, PDPA, and PIPL items block continue until accepted, marketing remains optional, and under-14 signup is blocked without offering a guardian flow."
  status: failed
  reason: "Automated verification: signup consent component/shared/API tests pass, but the running /auth page renders 404, so the signup consent and under-14 flow cannot be used."
  severity: major
  test: 8
  root_cause: "Signup consent implementation passes isolated tests but its user-facing route is unreachable due the locale routing mismatch."
  artifacts:
    - path: "apps/web/components/auth/signup-step2.tsx"
      issue: "Component passes tests but is unreachable through /auth."
    - path: "apps/web/app/auth/page.tsx"
      issue: "Auth route 404 at runtime."
  missing:
    - "Restore auth route reachability and add browser smoke coverage for signup consent rows."
  debug_session: "inline-uat-2026-05-07"
- truth: "Email signup, social completion, and booking prepare submit structured consent rows with the correct sourceFlow. Missing required consent is rejected, accepted/refused rows are captured as immutable audit evidence, and booking-disabled still blocks before consent or reservation side effects."
  status: failed
  reason: "Automated verification: consent capture and booking consent API tests pass, but /auth and /booking/test-performance are unreachable in the browser due 404 routing."
  severity: major
  test: 9
  root_cause: "Server-side consent behavior is covered, but the browser entry points for signup and booking are not reachable under current route middleware behavior."
  artifacts:
    - path: "apps/api/src/modules/consent/consent.service.ts"
      issue: "API tests pass."
    - path: "apps/web/app/auth/page.tsx"
      issue: "Signup route unreachable."
    - path: "apps/web/app/booking/[performanceId]/page.tsx"
      issue: "Booking route unreachable for tested runtime path."
  missing:
    - "Restore public route reachability and add browser smoke coverage for signup and booking consent gates."
  debug_session: "inline-uat-2026-05-07"
- truth: "Public event/performance content backed by reviewed machine translation shows the automatic-translation label even after review/publish, without implying that AI-assisted copy is native manual legal copy."
  status: failed
  reason: "Automated verification: translation-label component/page tests pass, but /performance/test-performance renders 404 in the running app, so the public label is not observable through the actual route."
  severity: major
  test: 12
  root_cause: "Public performance route exists as a flat dynamic route, but locale-routed runtime paths are not mapped to it."
  artifacts:
    - path: "apps/web/app/performance/[id]/page.tsx"
      issue: "Public detail route is not reachable in browser verification."
  missing:
    - "Restore performance detail route reachability and add browser smoke coverage for automatic translation label."
  debug_session: "inline-uat-2026-05-07"
- truth: "Terms, privacy, and marketing legal pages render Korean or English canonical markdown only. Thai and Chinese legal routes show English canonical copy with a visible fallback label, no Thai/Chinese legal markdown exists, and the footer exposes required business/support/privacy contact details without LINE or social links."
  status: failed
  reason: "Automated verification: legal/footer tests pass and footer renders on the 404 shell, but /legal/terms, /en/legal/terms, /th/legal/terms, /zh-CN/legal/privacy, and /zh-TW/legal/marketing all render 404 instead of legal content."
  severity: blocker
  test: 13
  root_cause: "Legal pages exist as flat routes, but next-intl middleware routes users to locale-prefixed paths that are not backed by App Router pages."
  artifacts:
    - path: "apps/web/app/legal/terms/page.tsx"
      issue: "Legal page exists but is unreachable under middleware locale paths."
    - path: "apps/web/app/legal/privacy/page.tsx"
      issue: "Legal page exists but is unreachable under middleware locale paths."
    - path: "apps/web/app/legal/marketing/page.tsx"
      issue: "Legal page exists but is unreachable under middleware locale paths."
  missing:
    - "Restore legal route reachability for ko/en/th/zh-CN/zh-TW and add browser coverage for fallback labels."
  debug_session: "inline-uat-2026-05-07"
- truth: "Public performance detail pages show event-critical times with an explicit KST anchor plus locale-aware secondary local time where applicable, and prices show canonical KRW source amount with an estimated local amount and exchange-rate disclaimer."
  status: failed
  reason: "Automated verification: KST/KRW formatter and page tests pass, but /performance/test-performance renders 404 in the running app."
  severity: major
  test: 14
  root_cause: "Public performance detail route is unreachable under the current locale routing architecture."
  artifacts:
    - path: "apps/web/app/performance/[id]/page.tsx"
      issue: "KST/KRW UI exists but route-level browser verification hits not-found."
  missing:
    - "Restore performance detail route reachability and add browser smoke coverage for KST/KRW output."
  debug_session: "inline-uat-2026-05-07"
