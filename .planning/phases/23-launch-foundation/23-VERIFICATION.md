---
phase: "23-launch-foundation"
verified: "2026-05-07T04:50:43Z"
status: "passed"
score: "17/17 must-haves verified"
overrides_applied: 0
requirements:
  - id: "FLAG-01"
    status: "verified"
  - id: "FLAG-02"
    status: "verified"
  - id: "I18N-01"
    status: "verified"
  - id: "I18N-02"
    status: "verified"
  - id: "TRANS-01"
    status: "verified"
  - id: "TRANS-02"
    status: "verified"
  - id: "AUTH-01"
    status: "verified"
  - id: "AUTH-02"
    status: "verified"
  - id: "COMP-01"
    status: "verified"
  - id: "COMP-02"
    status: "verified"
deferred:
  - truth: "Actual M1 integrated canary deployment and traffic-shift decision"
    addressed_in: "Phase 26"
    evidence: "REQUIREMENTS.md maps M1-01 to Phase 26, and ROADMAP Phase 26 covers M1 Canary + Cutover Gates including canary traffic steps."
  - truth: "Full environment-dependent admin/live-SMS Playwright suite"
    addressed_in: "Phase 26"
    evidence: "23-UAT.md records the current full E2E blockers as local DB admin 401 and live SMS rate-limit state, while Phase 23 i18n smoke and source-level launch foundation checks pass."
review:
  path: ".planning/phases/23-launch-foundation/23-REVIEW.md"
  status: "clean"
  reviewed: "2026-05-07T04:38:53Z"
  findings_total: 0
  evidence: "Latest review on current HEAD 896dee19 reports no critical, warning, or info findings after remediation."
residual_risks:
  - "Actual Cloud Run canary traffic shift and live external provider sign-off remain Phase 26 or launch gates, not Phase 23 source-code gaps."
  - "AGENTS.md was already dirty in the worktree and was not modified by this verification."
---

# Phase 23: Launch Foundation Verification Report

**Phase Goal:** Existing prod compatibility, feature flags, five locales, translation/legal lock, auth/SMS (LINE excluded by D-13), and consent/audit foundation.
**Verified:** 2026-05-07T04:50:43Z
**Status:** passed
**Re-verification:** No. A previous verification artifact existed, but it had no `gaps:` section, so this was treated as a full initial verification pass.

## Goal Achievement

Phase 23 meets the launch-foundation goal in the codebase. The verification did not rely on SUMMARY claims: every requirement was checked against plans, REQUIREMENTS.md, implementation files, tests, key links, data flow, UAT evidence, and the latest clean code review.

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Existing prod compatibility is preserved by expand-only migrations, Korean root URL behavior, shared flags, and canary rollback policy. | VERIFIED | `apps/api/drizzle/0007_phase23_launch_foundation.sql` and `0008_consent_audit_source_flow.sql` contain no destructive SQL; `apps/web/proxy.ts` keeps default Korean routes prefixless; `packages/shared/src/flags.ts` centralizes flag parsing; `docs/runbooks/phase23-canary-rollback.md` defines rollback gates. |
| 2 | Korean routes are prefixless and foreign routes use `/en`, `/th`, `/zh-CN`, `/zh-TW`, with hreflang, locale preference, time/currency formatting, and localized PhoneInput. | VERIFIED | `packages/shared/src/constants/locales.ts`, `apps/web/i18n/routing.ts`, `apps/web/proxy.ts`, `apps/web/app/sitemap.ts`, `apps/web/components/i18n/locale-switcher.tsx`, `apps/web/lib/i18n/format.ts`, and `apps/web/components/ui/phone-input.tsx` implement this path. |
| 3 | Korean source content can generate reviewed translations, while legal notices remain manual Korean/English and auto-translation is blocked. | VERIFIED | `translation.service.ts` generates drafts for four foreign locales, review/publish is explicit, `assertTranslatableContentType()` blocks legal-like content types, legal content schema stores manual ko/en fields, and legal content tests lock canonical locales to ko/en only. |
| 4 | Kakao, Naver, Google, email verification, five-country SMS OTP, and three-device refresh-family policy are implemented and LINE is excluded. | VERIFIED | Auth controller and UI expose Kakao/Naver/Google/email only; `auth.controller.spec.ts` asserts no LINE route/tokens/env; email verification uses 30-minute tokens; SMS copy exists for five locales; refresh-token family enforcement revokes only excess device families. |
| 5 | PIPA, cross-border transfer, PDPA/PIPL English notice, under-14, marketing consent, audit log, and footer legal surfaces exist. | VERIFIED | `packages/shared/src/schemas/consent.schema.ts`, `ConsentService`, `ConsentAuditController`, signup/social-completion consent payloads, admin audit UI, legal markdown, legal API routes, and footer legal links are wired. |
| 6 | `BOOKING_ENABLED=false` blocks API seat locks and payment attempts, not only UI. | VERIFIED | `FeatureFlagsService.assertBookingEnabled()` is called before seat locks, reservation preparation, and reservation confirmation/Toss payment; web hooks and confirm page block client-side side effects; tests assert no prepare/payment side effects when disabled. |
| 7 | Phase 26 canary entry has stable five-locale i18n smoke coverage across GNB locale switcher, public/auth/home/search/performance/booking-disabled copy, translated performance content, and locale-prefixed routing. | VERIFIED | `apps/web/e2e/i18n-smoke.spec.ts` uses stable UUID `00000000-0000-4000-8000-000000000023`; seed data includes translated content, showtime, price tiers, and seat map; the latest targeted Playwright smoke passed per gate evidence. |
| 8 | FLAG-01: Feature-flag and canary foundation preserves existing users, sessions, reservations, and Korean root URLs. | VERIFIED | Shared flag helper, runtime flag API, API feature flag service, prefixless Korean proxy behavior, and canary rollback runbook are present and wired. |
| 9 | FLAG-02: Booking-disabled mode prevents API booking mutations and payment attempts. | VERIFIED | Seat-lock, reservation prepare, and reservation confirm paths all call `assertBookingEnabled()` before mutation/payment work; web booking hooks and confirm page also gate side effects. |
| 10 | I18N-01: Five-locale route structure and locale preference behavior are implemented without forced redirects. | VERIFIED | `SUPPORTED_LOCALES` includes ko/en/th/zh-CN/zh-TW; proxy rewrites foreign prefixes to flat app routes without `NextResponse.redirect`; locale suggestion requires explicit user action; user preferred locale persists through API. |
| 11 | I18N-02: Visible launch copy, auth/SMS copy, KST/KRW formatting, sitemap/hreflang, and localized PhoneInput are available in five locales. | VERIFIED | Message files contain required launch copy namespaces; `launch-copy-keys.ts` locks key coverage; KST/KRW components are used on performance detail; sitemap alternates all locales; PhoneInput receives active locale labels. |
| 12 | TRANS-01: Translation source, draft, review, publish, stale handling, and admin review workflow exist. | VERIFIED | Translation DB schema, service, DeepL client wrapper, admin translation hooks/table/detail panel, and public automatic-translation label are implemented and wired. |
| 13 | TRANS-02: Legal and other locked content cannot be machine translated and ko/en canonical legal content is manual. | VERIFIED | Legal content types are blocked before provider calls; legal markdown tests reject th/zh legal files and automatic/machine wording in English legal copy; footer/legal routes use ko/en canonical fallback. |
| 14 | AUTH-01: Supported auth methods are Kakao, Naver, Google, email verification, and SMS OTP, with LINE excluded by D-13. | VERIFIED | Controller routes, login UI, signup tests, and auth specs all include only Kakao/Naver/Google/email/SMS and explicitly assert LINE absence. |
| 15 | AUTH-02: Auth verification policies are enforced, including latest-token-wins email verification, 30-minute expiry, localized copy, and three-device refresh-family limit. | VERIFIED | Auth service token issuance/verification logic, email/SMS copy modules, refresh-token family revocation, and tests cover these policies. |
| 16 | COMP-01: Required consent items and age/marketing rules are captured for signup, social completion, and booking flows. | VERIFIED | Shared consent schema, signup UI, social callback completion, API DTOs, and reservation consent capture use itemized consent rows with source flow and locale. |
| 17 | COMP-02: Consent audit foundation supports immutable capture and admin querying by user, item, version, language, date, and IP. | VERIFIED | `ConsentService.captureConsent()` inserts immutable audit rows; `queryConsentAudit()` filters and masks output; admin controller and UI expose the query surface. |

**Score:** 17/17 truths verified

### Deferred Items

Items below are not Phase 23 source-code gaps. They are explicitly scheduled for later launch/canary phases.

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | Actual M1 integrated canary deployment and traffic-shift decision | Phase 26 | REQUIREMENTS.md maps `M1-01` to Phase 26; ROADMAP Phase 26 is "M1 Canary + Cutover Gates". |
| 2 | Full environment-dependent admin/live-SMS Playwright suite | Phase 26 | `23-UAT.md` records local DB admin 401 and live SMS rate-limit state as full-suite blockers; the Phase 23 i18n smoke and source gates passed. |

### Required Artifacts

| Artifact Group | Expected | Status | Details |
|---|---|---|---|
| All PLAN-declared artifacts | Phase 23 plans 23-01 through 23-19 declare concrete artifacts. | VERIFIED | `gsd-sdk query verify.artifacts` passed for all 19 plans: 65/65 artifacts exist and satisfy declared patterns. |
| Shared flags/locales/consent schema | Single shared contract for flags, locales, and consent rows. | VERIFIED | `packages/shared/src/flags.ts`, `constants/locales.ts`, and `schemas/consent.schema.ts` are exported and consumed by API/web. |
| Database migrations/schema | Expand-only launch-foundation schema. | VERIFIED | New legal, translation, email verification, consent audit, and locale fields exist; destructive SQL scan found no `DROP`, `RENAME`, `TRUNCATE`, or data deletion in Phase 23 migrations. |
| API launch foundation | Feature flags, auth/email/SMS, translation, legal, consent audit, and booking gates. | VERIFIED | Controllers/services/modules are imported into app modules and used by runtime routes. |
| Web launch foundation | Locale routing, copy, legal fallback, auth/consent UI, admin translation/audit UI, booking-disabled UX. | VERIFIED | Components/hooks/pages are reachable from app routes and covered by tests/UAT. |
| Canary i18n smoke | Stable five-locale canary-entry smoke. | VERIFIED | `apps/web/e2e/i18n-smoke.spec.ts` and seed UUID fixture exist; targeted Playwright smoke passed on current HEAD per latest gate evidence. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| All PLAN key links | Declared imports, route calls, hooks, guards, and test links | `gsd-sdk verify.key-links` plus manual false-negative review | VERIFIED | All real links verified. Two scanner false negatives were manually checked: `packages/shared/src/index.ts` does export `./flags`, and performance translation overlay imports/query `translationDrafts` through `performance-translation-overlay.ts`. |
| Web runtime flags | API booking/payment side effects | `/api/runtime-flags`, `useRuntimeFlags`, `useLockSeat`, `usePrepareReservation`, confirm page guard | VERIFIED | UI disables booking and hooks throw before API side effects when disabled. |
| API booking gates | Seat lock/reservation/payment paths | `FeatureFlagsService.assertBookingEnabled()` | VERIFIED | Seat lock, reservation prepare, and reservation confirmation call the API hard gate before mutation/payment work. |
| Locale routing | Public app routes and next-intl | proxy header/rewrite + routing helpers | VERIFIED | Foreign prefixes are preserved in visible URL and rewritten internally; Korean root remains flat. |
| Translation review | Public performance detail/search | published draft overlay | VERIFIED | Reviewed published translation drafts flow through API cards/detail responses and display automatic translation labels. |
| Consent audit | Signup/social/booking to admin audit UI | shared consent rows + API query + admin hooks | VERIFIED | Source flows are captured and queryable with masking in admin UI. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `apps/web/app/api/runtime-flags/route.ts` and `use-runtime-flags.ts` | `bookingEnabled` | Environment-backed `readRuntimeFlagsFromEnv(process.env)` | Yes | VERIFIED |
| `FeatureFlagsService` | `BOOKING_ENABLED` | Shared parser plus injected runtime env provider | Yes | VERIFIED |
| `apps/web/proxy.ts` | request locale | URL prefix, cookie, Accept-Language suggestion | Yes | VERIFIED |
| `locale-switcher.tsx` and `locale-suggestion.tsx` | selected/suggested locale | supported-locale helpers, cookies, explicit user action, user preference API | Yes | VERIFIED |
| `performance-translation-overlay.ts` | translated title/description/sales info | `translationSources` + reviewed/published `translationDrafts` DB queries | Yes | VERIFIED |
| `performance/[id]/page.tsx` | localized performance detail | API locale parameter, KST/KRW formatters, automatic label metadata | Yes | VERIFIED |
| `translation.service.ts` | translation drafts | Korean source rows plus DeepL/manual-review client output | Yes | VERIFIED |
| `AuthService` | email verification and refresh-device policy | DB email token rows and refresh-token families | Yes | VERIFIED |
| `ConsentService` and admin audit UI | consent audit rows | DB insert/query with filters and masking | Yes | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command or Evidence | Result | Status |
|---|---|---|---|
| Artifact contract | `gsd-sdk query verify.artifacts` for plans 23-01 through 23-19 | 65/65 passed | PASS |
| Key link contract | `gsd-sdk query verify.key-links` for plans 23-01 through 23-19 plus manual false-negative checks | All real links wired | PASS |
| Schema drift | `gsd-sdk query verify.schema-drift "23" --raw` | `drift_detected=false`, `blocking=false` | PASS |
| Codebase drift | `gsd-sdk query verify.codebase-drift "23" --raw` | skipped with `no-structure-md`, `action_required=false` | PASS |
| Five-locale visible/auth copy keys | Node message-file key check | Required launch/auth/SMS copy keys present for ko/en/th/zh-CN/zh-TW | PASS |
| Build | Latest gate evidence from current HEAD | `pnpm build` passed | PASS |
| Tests | Latest gate evidence from current HEAD | `pnpm test` passed | PASS |
| Typecheck | Latest gate evidence from current HEAD | `pnpm typecheck` passed | PASS |
| Seed | Latest gate evidence from current HEAD | `set -a; source .env; set +a; pnpm --filter @grabit/api seed` passed | PASS |
| Canary i18n smoke | Latest gate evidence from current HEAD | `pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --reporter=line` passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| FLAG-01 | 23-01, 23-02, 23-03, 23-08 | Feature flags/prod compatibility/canary foundation | SATISFIED | Shared flag helper, expand-only migrations, canary runbook, Korean root-route preservation, runtime flags. |
| FLAG-02 | 23-03, 23-08, 23-19 | Booking-disabled hard gate | SATISFIED | API hard gates before lock/reservation/payment and web side-effect guards; i18n smoke checks disabled booking copy and no booking side effects. |
| I18N-01 | 23-04, 23-16, 23-18, 23-19 | Five-locale route and preference model | SATISFIED | Locale constants/routing/proxy/switcher/suggestion/user preference and flat-route proxy tests. |
| I18N-02 | 23-09, 23-14, 23-15, 23-19 | Five-locale visible copy and localized formatting/input | SATISFIED | Message files, launch copy keys, auth/SMS copy, KST/KRW components, sitemap/hreflang, localized PhoneInput. |
| TRANS-01 | 23-05, 23-11, 23-19 | Translation draft/review/publish workflow | SATISFIED | Translation schema/service/DeepL client, admin review UI, published performance translation overlay. |
| TRANS-02 | 23-05, 23-13, 23-17 | Legal/manual translation lock | SATISFIED | Legal-like content type auto-translation block, ko/en legal markdown lock, legal fallback and footer links. |
| AUTH-01 | 23-06, 23-09, 23-10, 23-15 | Kakao/Naver/Google/email/SMS auth and LINE exclusion | SATISFIED | Auth routes/UI/tests include supported providers and assert no LINE; SMS/email copy localized. |
| AUTH-02 | 23-06, 23-09, 23-15 | Verification and device-limit policy | SATISFIED | 30-minute/latest-token-wins email verification, purpose-bound SMS, localized copy, three-device refresh-family limit. |
| COMP-01 | 23-01, 23-07, 23-10, 23-12, 23-13 | Required consent and legal compliance foundation | SATISFIED | Consent schema/service/UI, under-14/marketing rules, PIPA/cross-border/PDPA/PIPL consent items, footer legal surfaces. |
| COMP-02 | 23-02, 23-07, 23-12 | Consent audit foundation | SATISFIED | Immutable audit inserts, admin query filters, masking, admin audit UI. |

No orphan Phase 23 requirements were found in `.planning/REQUIREMENTS.md`: all Phase 23 IDs are accounted for by the plans and implementation.

### Anti-Patterns Found

| File | Line/Pattern | Severity | Impact |
|---|---|---|---|
| `apps/api/src/modules/payment/toss-payments.client.ts` | TODO comments for future Zod runtime validation | Info | Not a Phase 23 blocker. Booking/payment attempts are guarded before Toss payment work, and the TODO concerns future runtime validation hardening. |
| `apps/api/src/database/seed.mjs` | `console.log` seed output | Info | CLI seed logging only; not a user-facing stub. |
| Multiple React/API files | conditional `return null`, initial `[]`, placeholder attributes | Info | Checked as non-stub patterns. Values are either conditional rendering, form placeholders, tests, or state initialized before real fetch/data flow. No hollow user-visible implementation found. |

No blocker or warning anti-pattern was found.

### Code Review

Latest clean code review report included: `.planning/phases/23-launch-foundation/23-REVIEW.md`.

| Review Field | Value |
|---|---|
| Status | clean |
| Reviewed | 2026-05-07T04:38:53Z |
| Current HEAD | `896dee19` |
| Findings | 0 critical, 0 warning, 0 info |
| Remediation Evidence | Prior CR-01 through CR-06 and WR-01/WR-02 are marked fixed. SVG safety remediation was verified with focused tests and web typecheck. |

### Human Verification Required

None for the Phase 23 completion decision.

The remaining live launch concerns are deferred gates, not Phase 23 codebase gaps: Cloud Run canary traffic shift, external provider delivery sign-off, and environment-dependent full-suite Playwright checks are covered by Phase 26 or launch UAT.

### Gaps Summary

No blocking gaps were found. Phase 23 achieves the launch-foundation goal: existing production compatibility is protected, feature flags are shared and enforced, five-locale routing/copy is wired, translation/legal lock is implemented, LINE is excluded from auth, email/SMS/device policies are covered, and consent/audit foundations are present and connected.

---

_Verified: 2026-05-07T04:50:43Z_
_Verifier: the agent (gsd-verifier)_
