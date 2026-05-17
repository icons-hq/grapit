---
phase: quick-260517-jmb-ui-ux-i18n
plan: "01"
subsystem: ui-i18n
tags: [next-intl, locale-routing, auth, booking, admin, vitest]
requires:
  - phase: quick-260517-jmb-ui-ux-i18n
    provides: "Locked discussion decisions in 260517-jmb-CONTEXT.md"
provides:
  - "Active public/user-facing locale contract with ko, en, th, zh-CN only"
  - "Signup duplicate-email availability error localized through auth.form.emailUnavailable"
  - "Browser-verified public footer/social/locale-suggestion/upcoming-card/performance-detail i18n cleanup outside admin"
  - "Hardcoded Korean UI/client error scan audit with fixed, excluded, and remaining categories"
affects: [public-locale-routing, auth-signup, booking-i18n, admin-i18n, api-locale-validation]
tech-stack:
  added: []
  patterns:
    - "Use shared active locale constants as source of truth for public/user-facing locale choices"
    - "Normalize legacy stored zh-TW user preference to zh-CN at service boundaries"
    - "Keep migration history intact; reject unsupported new locale writes through active validation"
key-files:
  created:
    - ".planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-I18N-AUDIT.md"
  modified:
    - "packages/shared/src/constants/locales.ts"
    - "packages/shared/src/i18n/launch-copy-keys.ts"
    - "apps/web/i18n/routing.ts"
    - "apps/web/messages/ko.json"
    - "apps/web/messages/en.json"
    - "apps/web/messages/th.json"
    - "apps/web/messages/zh-CN.json"
    - "apps/web/components/auth/signup-step1.tsx"
    - "apps/web/components/auth/login-form.tsx"
    - "apps/web/components/auth/social-login-button.tsx"
    - "apps/web/components/layout/footer.tsx"
    - "apps/web/components/layout/gnb.tsx"
    - "apps/web/components/i18n/locale-suggestion.tsx"
    - "apps/web/components/performance/performance-card.tsx"
    - "apps/web/app/performance/[id]/page.tsx"
    - "apps/api/src/modules/user/user.service.ts"
    - "apps/api/src/modules/auth/auth.service.ts"
key-decisions:
  - "Removed zh-TW from active public/user-facing locale surfaces while preserving historical migration/schema history."
  - "Mapped legacy stored zh-TW preferred locale reads to zh-CN instead of editing old migrations."
  - "Converted the Browser-confirmed public Korean literals for signup duplicate-email, footer, social login, locale suggestion, logout toast, upcoming-card labels, and performance-detail labels; broader booking/auth/admin Korean copy is documented for a separate i18n architecture pass."
patterns-established:
  - "Canary-visible auth copy keys must be listed in LAUNCH_COPY_KEYS and present in all active message files."
  - "No active public/user-facing code should generate or select /zh-TW after this quick task."
requirements-completed: [QUICK-260517-JMB]
duration: "15m55s"
completed: "2026-05-17T05:34:28Z"
---

# Quick 260517-jmb: UI/UX I18N Summary

**Active locale cleanup removed `zh-TW` from public/user-facing contracts while keeping `zh-CN`, and signup duplicate-email errors now render from locale messages.**

## Performance

- **Duration:** 15m55s
- **Started:** 2026-05-17T05:18:33Z
- **Completed:** 2026-05-17T05:34:28Z
- **Tasks:** 2/2
- **Files modified:** 67 tracked files across code/tests

## Accomplishments

- Removed `zh-TW` from shared active locale constants, web routing, locale suggestions/switchers, launch copy manifests, sitemap/smoke cases, API locale validation/copy creation, translation targets, and seed active locale data.
- Deleted `apps/web/messages/zh-TW.json` as an intentional active message-file removal.
- Preserved `zh-CN` as the only Chinese active locale and normalized stale stored `zh-TW` preferences to `zh-CN` at the API user service boundary.
- Added `auth.form.emailUnavailable` to all active web message files and wired `SignupStep1` duplicate email availability errors to `authCopy.form.emailUnavailable`.
- Browser QA exposed stale `packages/shared/dist` during filtered dev startup; rebuilding shared and using root `pnpm dev` confirmed runtime locale surfaces no longer include Traditional Chinese.
- Localized public footer labels, login social buttons/social callback errors, logout toast, and public performance-card upcoming date labels after Browser QA found Korean copy on non-Korean routes.
- Localized public performance-detail labels and locale suggestion dismiss copy after Browser QA found additional Korean UI copy outside admin.
- Created `.planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-I18N-AUDIT.md` with scan commands, fixed findings, exclusions, and remaining broader i18n follow-up surfaces.

## Task Commits

1. **Task 1 RED:** `8e78c64` `test(quick-260517-jmb): add failing zh-TW locale contract tests`
2. **Task 1 GREEN:** `0cd6bde` `feat(quick-260517-jmb): remove zh-TW from active locale surfaces`
3. **Task 2 RED:** `bad9e47` `test(quick-260517-jmb): add failing duplicate email i18n tests`
4. **Task 2 GREEN:** `604ba56` `feat(quick-260517-jmb): localize duplicate email availability error`
5. **Browser QA follow-up:** `53ee412` `feat(quick-260517-jmb): harden public i18n surfaces`

## Verification

| Command | Result |
| --- | --- |
| `pnpm --filter @grabit/shared test -- src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts` | Passed: 8 files, 46 tests |
| `pnpm --filter @grabit/web test -- lib/i18n/visible-copy.test.ts components/layout/__tests__/layout-shell-locale.test.tsx components/performance/__tests__/performance-card.test.tsx app/performance/[id]/__tests__/performance-detail-formatting.test.tsx app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx components/layout/__tests__/footer.test.tsx components/auth/__tests__/signup-consent.test.tsx components/auth/__tests__/signup-step1-i18n.test.tsx components/auth/__tests__/signup-step1-email-availability.test.tsx components/layout/__tests__/gnb-locale.test.tsx i18n/routing.test.ts` | Passed: 72 files, 437 tests; existing jsdom/React warning output remains |
| `pnpm --filter @grabit/api test -- src/modules/auth/email/templates/email-verification.copy.spec.ts src/modules/sms/sms-copy.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts src/modules/translation/deepl.client.spec.ts src/modules/translation/translation.service.spec.ts` | Passed: 65 files, 689 tests; existing Nest test log noise remains |
| `pnpm --filter @grabit/shared typecheck` | Passed |
| `pnpm --filter @grabit/web typecheck` | Passed |
| `pnpm --filter @grabit/api typecheck` | Passed |
| Browser local QA via `pnpm dev` on `http://localhost:3000` / `http://localhost:8080` | Passed: desktop/mobile locale menus expose only ko/en/th/zh-CN; `/zh-TW` renders 404; `/en`, `/th`, `/zh-CN` home/auth show localized footer/social/upcoming/duplicate-email copy and no `繁體中文` |
| Deterministic Browser QA with locale-specific `Accept-Language` | Passed: locale suggestion renders `View this page in English?` + `Later`; `/en`, `/th`, `/zh-CN` performance detail labels render localized venue/schedule/price copy with no Korean UI label leakage or Traditional Chinese leakage |
| `pnpm --filter @grabit/web lint` | Passed with 0 errors, 32 existing warnings |
| `pnpm --filter @grabit/api lint` | Passed with 0 errors, 48 existing warnings |
| `rg -n "zh-TW|繁體中文|Traditional Chinese|ZH-HANT|zhTW|zhTWMessages|/zh-TW" packages/shared/src apps/web apps/api/src/modules apps/api/src/database/seed.mjs -g '!**/*.md' -g '!**/node_modules/**'` | No active-code matches (`rg_exit=1`) |
| `rg -n "이미 사용 중인 이메일입니다" apps/web/components/auth apps/web/app/auth -g '!**/*.test.*'` | No production matches (`rg_exit=1`) |
| `rg -n "[가-힣]" apps/web/components/auth apps/web/app/auth apps/web/components/booking apps/web/app/booking apps/web/hooks apps/web/lib apps/web/app/error.tsx apps/web/app/global-error.tsx -g '*.tsx' -g '*.ts' -g '!**/*.test.*'` | Expected audit findings: 418 lines across 46 files |
| `rg -n "[가-힣]" apps/web/app/admin apps/web/components/admin apps/web/hooks/use-admin.ts apps/web/hooks/use-admin-support-content.ts -g '*.tsx' -g '*.ts' -g '!**/*.test.*'` | Additional admin audit findings: 823 lines across 45 files |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated active schema guard test for removed `zh-TW`**
- **Found during:** Task 1 API verification
- **Issue:** `apps/api/src/database/schema/launch-foundation.schema.spec.ts` still asserted the old active API/seed locale contract and caused the focused API command to fail.
- **Fix:** Updated the test expectation to the new active four-locale contract without touching historical migrations or migration meta.
- **Files modified:** `apps/api/src/database/schema/launch-foundation.schema.spec.ts`
- **Verification:** API focused test suite passed after the change.
- **Committed in:** `0cd6bde`

### Process Deviations

- The top-level orchestrator used Codex native planner and executor subagents. The executor did not spawn nested task agents because the quick plan's locale changes were tightly coupled across shared, web, and API contracts.
- The top-level `gsd-sdk query init.quick` quick id was `260517-jmb`; the existing requested plan `260517-jmb` remained the source of truth throughout execution.
- The hardcoded Korean scan found broad auth, booking, admin, and client error surfaces. Browser-confirmed public footer/social/locale-suggestion/upcoming-card/performance-detail issues were converted in this task; the remaining user-visible Korean copy is documented in the audit because it needs a broader message namespace/admin shell decision.

**Total deviations:** 1 auto-fixed issue, 3 process/scope notes.

## Known Stubs

None blocking this task. A stub-pattern scan over changed tracked files found legitimate empty arrays/objects, placeholders, refs set to `null`, and existing placeholder attributes/comments; none are new UI stubs that prevent the quick task goal.

## Threat Flags

None. The changed files update locale validation/routing/copy surfaces already covered by the plan threat model; no new network endpoints, file access paths, auth paths, or schema trust boundaries were introduced.

## Self-Check: PASSED

- Created audit artifact: `.planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-I18N-AUDIT.md`
- Created summary artifact: `.planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-SUMMARY.md`
- Verified commits exist: `8e78c64`, `0cd6bde`, `bad9e47`, `604ba56`, `53ee412`
- Docs artifacts are included in the final quick-task documentation commit.

## Next Phase Readiness

Ready for orchestrator docs commit and any follow-up broader i18n phase. The audit file is the handoff for auth/booking/admin Korean copy that remains outside this quick task.
