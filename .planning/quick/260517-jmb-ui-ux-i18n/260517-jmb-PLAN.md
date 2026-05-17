---
phase: quick-260517-jmb-ui-ux-i18n
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements:
  - QUICK-260517-JMB
user_setup: []
files_modified:
  - .planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-I18N-AUDIT.md
  - packages/shared/src/constants/locales.ts
  - packages/shared/src/constants/locales.test.ts
  - packages/shared/src/i18n/launch-copy-keys.ts
  - packages/shared/src/i18n/launch-copy-keys.test.ts
  - apps/web/messages/ko.json
  - apps/web/messages/en.json
  - apps/web/messages/th.json
  - apps/web/messages/zh-CN.json
  - apps/web/messages/zh-TW.json
  - apps/web/i18n/routing.ts
  - apps/web/i18n/routing.test.ts
  - apps/web/lib/i18n/visible-copy.ts
  - apps/web/lib/i18n/visible-copy.test.ts
  - apps/web/lib/i18n/format.ts
  - apps/web/lib/i18n/format.test.ts
  - apps/web/components/i18n/locale-switcher.tsx
  - apps/web/components/i18n/locale-suggestion.tsx
  - apps/web/components/i18n/automatic-translation-label.tsx
  - apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx
  - apps/web/components/auth/auth-launch-copy.ts
  - apps/web/components/auth/signup-step1.tsx
  - apps/web/components/auth/__tests__/signup-step1-i18n.test.tsx
  - apps/web/components/auth/__tests__/signup-step1-email-availability.test.tsx
  - apps/web/components/auth/__tests__/auth-email-verification.test.tsx
  - apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx
  - apps/web/components/auth/__tests__/signup-step3-i18n.test.tsx
  - apps/web/components/auth/phone-verification.tsx
  - apps/web/components/legal/legal-fallback-label.tsx
  - apps/web/app/legal/terms/page.tsx
  - apps/web/app/legal/privacy/page.tsx
  - apps/web/app/legal/marketing/page.tsx
  - apps/web/app/legal/__tests__/legal-fallback.test.tsx
  - apps/web/content/legal/__tests__/legal-content.test.ts
  - apps/web/app/sitemap.ts
  - apps/web/app/__tests__/sitemap.test.ts
  - apps/web/e2e/i18n-smoke.spec.ts
  - apps/web/lib/runtime-flags.ts
  - apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx
  - apps/web/components/booking/toss-payment-widget.tsx
  - apps/web/components/performance/status-badge.tsx
  - apps/web/components/performance/__tests__/status-badge.test.tsx
  - apps/web/components/ui/phone-input.tsx
  - apps/web/components/ui/__tests__/phone-input-i18n.test.tsx
  - apps/web/app/admin/translations/page.tsx
  - apps/web/components/admin/translation-review-table.tsx
  - apps/web/components/admin/translation-source-form.tsx
  - apps/web/components/admin/support-content-manager.tsx
  - apps/web/components/admin/consent-audit-table.tsx
  - apps/web/components/admin/event-publish-confirmation-dialog.tsx
  - apps/web/components/admin/performance-form.tsx
  - apps/web/components/admin/__tests__/translation-review.test.tsx
  - apps/web/components/admin/__tests__/consent-audit-table.test.tsx
  - apps/web/components/admin/__tests__/event-publish-confirmation.test.tsx
  - apps/web/hooks/use-admin.ts
  - apps/web/hooks/use-admin-support-content.ts
  - apps/api/src/database/seed.mjs
  - apps/api/src/modules/auth/auth.controller.ts
  - apps/api/src/modules/auth/email/templates/email-verification.copy.ts
  - apps/api/src/modules/auth/email/templates/email-verification.copy.spec.ts
  - apps/api/src/modules/auth/email/email.service.spec.ts
  - apps/api/src/modules/sms/sms-copy.ts
  - apps/api/src/modules/sms/sms-copy.spec.ts
  - apps/api/src/modules/consent/consent.service.ts
  - apps/api/src/modules/admin/admin-support-content.service.ts
  - apps/api/src/modules/translation/deepl.client.ts
  - apps/api/src/modules/translation/deepl.client.spec.ts
  - apps/api/src/modules/translation/translation.service.ts
  - apps/api/src/modules/translation/translation.service.spec.ts
  - apps/api/src/modules/user/user.service.ts
  - apps/api/src/modules/user/user.service.spec.ts
  - apps/api/src/modules/user/user.controller.spec.ts
must_haves:
  truths:
    - "Public locale choices expose ko, en, th, and zh-CN only; zh-TW is not selectable or routable."
    - "zh-CN remains the only Chinese locale and Chinese browser language hints resolve to zh-CN."
    - "Signup step 1 duplicate-email error renders from locale messages, not a hardcoded Korean constant."
    - "A scan artifact records hardcoded Korean user-visible UI/client error findings and fixes."
    - "Focused tests, typecheck, and lint pass for the changed i18n/auth surfaces."
  artifacts:
    - path: "packages/shared/src/constants/locales.ts"
      provides: "Canonical active locale list without zh-TW"
      contains: "SUPPORTED_LOCALES"
    - path: "apps/web/i18n/routing.ts"
      provides: "Public locale routing without /zh-TW"
      contains: "PUBLIC_SUPPORTED_LOCALES"
    - path: "apps/web/messages/zh-TW.json"
      provides: "Deleted Traditional Chinese web messages"
      state: "absent"
    - path: "apps/web/components/auth/signup-step1.tsx"
      provides: "Localized duplicate email availability error"
      contains: "authCopy.form"
    - path: ".planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-I18N-AUDIT.md"
      provides: "Scan evidence and fix/exception ledger for user-visible hardcoded Korean strings"
  key_links:
    - from: "packages/shared/src/constants/locales.ts"
      to: "apps/web/components/i18n/locale-switcher.tsx"
      via: "SUPPORTED_LOCALES drives visible locale options"
      pattern: "SUPPORTED_LOCALES\\.map"
    - from: "apps/web/i18n/routing.ts"
      to: "apps/web/e2e/i18n-smoke.spec.ts"
      via: "Public locale route prefixes match smoke cases"
      pattern: "PUBLIC_SUPPORTED_LOCALES"
    - from: "apps/web/messages/*.json"
      to: "apps/web/components/auth/signup-step1.tsx"
      via: "getAuthLaunchCopy supplies duplicate email error copy"
      pattern: "emailUnavailable"
    - from: "packages/shared/src/constants/locales.ts"
      to: "apps/api/src/modules/auth/auth.controller.ts"
      via: "API request locale validation rejects zh-TW for new user-visible flows"
      pattern: "SUPPORTED_LOCALES|launchLocaleSchema"
---

<objective>
Create one focused implementation plan for quick task 260517-jmb.

Purpose: Remove Traditional Chinese (`zh-TW`) from active user-facing locale surfaces while preserving Simplified Chinese (`zh-CN`), then convert high-confidence hardcoded Korean user-visible UI/client error text into the existing i18n copy system.

Output: Updated locale contracts, message files, UI/API locale consumers, focused tests, and an i18n audit artifact.
</objective>

<execution_context>
@/Users/sangwopark19/.codex/get-shit-done/workflows/execute-plan.md
@/Users/sangwopark19/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-CONTEXT.md
@AGENTS.md
@packages/shared/src/constants/locales.ts
@packages/shared/src/i18n/launch-copy-keys.ts
@apps/web/i18n/routing.ts
@apps/web/components/i18n/locale-switcher.tsx
@apps/web/components/auth/signup-step1.tsx
@apps/web/components/auth/auth-launch-copy.ts
@apps/web/messages/ko.json
@apps/web/messages/en.json
@apps/web/messages/th.json
@apps/web/messages/zh-CN.json
@apps/web/messages/zh-TW.json

<interfaces>
Current active locale contract:
- `SUPPORTED_LOCALES` currently includes `['ko', 'en', 'th', 'zh-CN', 'zh-TW']`; this plan changes active user-facing support to `['ko', 'en', 'th', 'zh-CN']`.
- `PUBLIC_SUPPORTED_LOCALES` in `apps/web/i18n/routing.ts` currently mirrors the five-locale public route list; this plan removes `/zh-TW` and maps Traditional Chinese browser hints to `zh-CN`.
- `getLocalizedPathname(pathname, locale)` is the shared web helper for public localized links and must never generate `/zh-TW` after this plan.
- `getAuthLaunchCopy(locale)` imports `apps/web/messages/*.json` and returns `auth` copy plus the resolved locale.
- `SignupStep1` currently has `EMAIL_AVAILABILITY_ERROR = '이미 사용 중인 이메일입니다'`; this plan replaces that constant with a locale message key.
</interfaces>

<source_audit>
SOURCE | ID | Feature/Requirement | Plan | Status | Notes
GOAL | QUICK-260517-JMB | Remove Traditional Chinese while keeping Simplified Chinese; audit and fix hardcoded Korean user-visible UI/client error text | 01 | COVERED | From quick description
REQ | QUICK-260517-JMB-01 | Remove `zh-TW` from public/user-facing locale choices, routing, message loading, locale-aware tests | 01 Task 1 | COVERED | Keep `zh-CN`
REQ | QUICK-260517-JMB-02 | Scan/fix hardcoded Korean user-visible UI/client error text, including signup duplicate email error | 01 Task 2 | COVERED | Audit artifact required
REQ | QUICK-260517-JMB-03 | Focused tests/typecheck/lint | 01 Tasks 1-2 + verification | COVERED | Commands listed below
CONTEXT | D-01 | Scope includes public/auth/booking/admin React UI text and client errors; API/internal/seed text only if directly user-visible | 01 Task 2 | COVERED | Task 2 scan paths match this boundary
CONTEXT | D-02 | Remove `zh-TW` from locale choices/routing/message loading/tests; keep `zh-CN`; keep migration history/backfill intact | 01 Task 1 | COVERED | Existing migration/meta files explicitly excluded
CONTEXT | D-03 | Use `next-intl` message keys or existing shared copy manifest; preserve locale file/test style; prioritize high-exposure surfaces if scope expands | 01 Task 2 | COVERED | Adds audit ledger for scan evidence and any non-converted exceptions
CONTEXT | S-01 | Signup first-step duplicate email red error is not localized | 01 Task 2 | COVERED | Adds `auth.form.emailUnavailable`
</source_audit>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Remove zh-TW from active locale contracts and user-facing surfaces</name>
  <files>packages/shared/src/constants/locales.ts, packages/shared/src/constants/locales.test.ts, packages/shared/src/i18n/launch-copy-keys.ts, packages/shared/src/i18n/launch-copy-keys.test.ts, apps/web/messages/zh-TW.json, apps/web/i18n/routing.ts, apps/web/i18n/routing.test.ts, apps/web/lib/i18n/visible-copy.ts, apps/web/lib/i18n/visible-copy.test.ts, apps/web/components/auth/auth-launch-copy.ts, apps/web/components/auth/__tests__/auth-email-verification.test.tsx, apps/web/components/auth/phone-verification.tsx, apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx, apps/web/components/auth/__tests__/signup-step3-i18n.test.tsx, apps/web/components/i18n/locale-suggestion.tsx, apps/web/components/i18n/automatic-translation-label.tsx, apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx, apps/web/components/legal/legal-fallback-label.tsx, apps/web/app/legal/terms/page.tsx, apps/web/app/legal/privacy/page.tsx, apps/web/app/legal/marketing/page.tsx, apps/web/app/legal/__tests__/legal-fallback.test.tsx, apps/web/content/legal/__tests__/legal-content.test.ts, apps/web/app/sitemap.ts, apps/web/app/__tests__/sitemap.test.ts, apps/web/e2e/i18n-smoke.spec.ts, apps/web/lib/i18n/format.ts, apps/web/lib/i18n/format.test.ts, apps/web/lib/runtime-flags.ts, apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx, apps/web/components/booking/toss-payment-widget.tsx, apps/web/components/performance/status-badge.tsx, apps/web/components/performance/__tests__/status-badge.test.tsx, apps/web/components/ui/phone-input.tsx, apps/web/components/ui/__tests__/phone-input-i18n.test.tsx, apps/web/app/admin/translations/page.tsx, apps/web/components/admin/translation-review-table.tsx, apps/web/components/admin/translation-source-form.tsx, apps/web/components/admin/support-content-manager.tsx, apps/web/components/admin/consent-audit-table.tsx, apps/web/components/admin/event-publish-confirmation-dialog.tsx, apps/web/components/admin/performance-form.tsx, apps/web/components/admin/__tests__/translation-review.test.tsx, apps/web/components/admin/__tests__/consent-audit-table.test.tsx, apps/web/components/admin/__tests__/event-publish-confirmation.test.tsx, apps/web/hooks/use-admin.ts, apps/web/hooks/use-admin-support-content.ts, apps/api/src/database/seed.mjs, apps/api/src/modules/auth/auth.controller.ts, apps/api/src/modules/auth/email/templates/email-verification.copy.ts, apps/api/src/modules/auth/email/templates/email-verification.copy.spec.ts, apps/api/src/modules/auth/email/email.service.spec.ts, apps/api/src/modules/sms/sms-copy.ts, apps/api/src/modules/sms/sms-copy.spec.ts, apps/api/src/modules/consent/consent.service.ts, apps/api/src/modules/admin/admin-support-content.service.ts, apps/api/src/modules/translation/deepl.client.ts, apps/api/src/modules/translation/deepl.client.spec.ts, apps/api/src/modules/translation/translation.service.ts, apps/api/src/modules/translation/translation.service.spec.ts, apps/api/src/modules/user/user.service.ts, apps/api/src/modules/user/user.service.spec.ts, apps/api/src/modules/user/user.controller.spec.ts</files>
  <behavior>
    - Test 1: `SUPPORTED_LOCALES`, `PUBLIC_SUPPORTED_LOCALES`, launch copy locales, sitemap hreflang, auth copy, SMS/email copy, and locale-aware UI tests expect exactly `ko`, `en`, `th`, `zh-CN`.
    - Test 2: `/zh-TW` is not generated by `getLocalizedPathname`, not accepted as a public route prefix, and not shown in desktop or mobile locale switchers.
    - Test 3: Accept-Language tags `zh`, `zh-CN`, `zh-SG`, `zh-Hans`, `zh-TW`, `zh-HK`, `zh-MO`, and `zh-Hant` resolve to `zh-CN` or no suggestion without exposing a `zh-TW` route.
    - Test 4: Existing DB migration and migration meta files remain untouched; new user-visible locale requests cannot newly choose `zh-TW`.
  </behavior>
  <action>Update active locale contracts from five locales to four locales per D-02. Remove `zh-TW` entries from shared constants, launch copy manifests, web message imports, public routing, locale switchers, locale suggestions, sitemap alternates, e2e smoke cases, legal fallback paths, formatting/runtime flag maps, phone/auth UI locale tests, admin locale option lists, API request validation, SMS/email verification copy, translation target creation, and active seed data. Delete `apps/web/messages/zh-TW.json`. Keep historical `apps/api/src/database/migrations/**` and `apps/api/src/database/migrations/meta/**` files intact. If active Drizzle schema typing forces a decision around existing `users.preferred_locale` rows, prefer compatibility normalization at service boundaries (`zh-TW` read as `zh-CN`, new writes rejected) over editing past migrations; add a new forward migration only if codegen/schema tooling requires it.</action>
  <verify>
    <automated>pnpm --filter @grabit/shared test -- src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts</automated>
    <automated>pnpm --filter @grabit/web test -- i18n/routing.test.ts app/__tests__/sitemap.test.ts components/auth/__tests__/auth-email-verification.test.tsx lib/i18n/visible-copy.test.ts lib/i18n/format.test.ts hooks/__tests__/booking-disabled-runtime.test.tsx</automated>
    <automated>pnpm --filter @grabit/api test -- src/modules/auth/email/templates/email-verification.copy.spec.ts src/modules/sms/sms-copy.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts src/modules/translation/deepl.client.spec.ts src/modules/translation/translation.service.spec.ts</automated>
    <automated>rg -n "zh-TW|繁體中文|Traditional Chinese|ZH-HANT|zhTW|zhTWMessages|/zh-TW" packages/shared/src apps/web apps/api/src/modules apps/api/src/database/seed.mjs -g '!**/*.md' -g '!**/node_modules/**'</automated>
  </verify>
  <done>`zh-TW` is absent from active public/user-facing locale contracts, selectors, routes, message loading, API validation/copy creation, and locale-aware tests; `zh-CN` remains supported everywhere Chinese is supported; migration history/backfill files are not edited.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Convert hardcoded Korean UI/client error text and record scan evidence</name>
  <files>.planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-I18N-AUDIT.md, apps/web/messages/ko.json, apps/web/messages/en.json, apps/web/messages/th.json, apps/web/messages/zh-CN.json, packages/shared/src/i18n/launch-copy-keys.ts, packages/shared/src/i18n/launch-copy-keys.test.ts, apps/web/components/auth/signup-step1.tsx, apps/web/components/auth/__tests__/signup-step1-i18n.test.tsx, apps/web/components/auth/__tests__/signup-step1-email-availability.test.tsx, plus every public/auth/booking/admin UI or client hook file from the scan that contains direct user-visible Korean strings</files>
  <behavior>
    - Test 1: Signup step 1 duplicate email availability error uses `auth.form.emailUnavailable` from the active locale; English and zh-CN tests do not render Korean for this error.
    - Test 2: Every new message key added to `ko`, `en`, `th`, and `zh-CN` exists in the same namespace and is covered by the launch copy manifest when the namespace is canary-visible.
    - Test 3: The scan artifact lists fixed strings, intentionally excluded non-user-visible strings, and any remaining user-visible strings that require a broader admin i18n shell or API contract change.
  </behavior>
  <action>Run a fresh scan for hardcoded Korean in public/auth/booking/admin UI and client error surfaces per D-01 and D-03. First fix the known bug by adding `auth.form.emailUnavailable` to `apps/web/messages/ko.json`, `en.json`, `th.json`, and `zh-CN.json`, adding the key to `LAUNCH_COPY_KEYS`, and replacing `EMAIL_AVAILABILITY_ERROR` in `SignupStep1` with `authCopy.form.emailUnavailable` for both cached and fresh duplicate-email checks. Then convert high-confidence user-visible hardcoded Korean strings from auth, public error pages, booking flow, client toasts/hooks, and admin locale controls into existing `next-intl` messages or existing shared copy manifests. Do not convert comments, test fixture prose, migration/history text, or API internal exception strings unless the client directly displays them. Create `260517-jmb-I18N-AUDIT.md` with scan commands, fixed file/key list, excluded findings with reason, and any remaining user-visible strings that need a broader i18n shell rather than ad hoc local maps.</action>
  <verify>
    <automated>pnpm --filter @grabit/web test -- components/auth/__tests__/signup-step1-i18n.test.tsx components/auth/__tests__/signup-step1-email-availability.test.tsx</automated>
    <automated>pnpm --filter @grabit/shared test -- src/i18n/launch-copy-keys.test.ts</automated>
    <automated>rg -n "이미 사용 중인 이메일입니다" apps/web/components/auth apps/web/app/auth -g '!**/*.test.*'</automated>
    <automated>rg -n "[가-힣]" apps/web/components/auth apps/web/app/auth apps/web/components/booking apps/web/app/booking apps/web/hooks apps/web/lib apps/web/app/error.tsx apps/web/app/global-error.tsx -g '*.tsx' -g '*.ts' -g '!**/*.test.*'</automated>
  </verify>
  <done>Signup duplicate email error is localized across all remaining locales; the i18n audit exists and explains every hardcoded Korean finding in the target surfaces as fixed, excluded, or requiring a separate architecture-level admin/client i18n follow-up.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser path/cookie/Accept-Language -> Next locale routing | Untrusted path prefixes, cookies, and browser headers influence visible locale state. |
| client locale preference -> API profile update | User-controlled locale values cross into API validation and persistence. |
| API/client error copy -> rendered UI | Server/client error states may become user-visible text. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260517-JMB-01 | Spoofing | `apps/web/i18n/routing.ts` | mitigate | Reject `/zh-TW` as active public locale and normalize Chinese language hints to `zh-CN` so stale Traditional Chinese URLs cannot masquerade as supported routes. |
| T-260517-JMB-02 | Tampering | `apps/api/src/modules/auth/auth.controller.ts`, `packages/shared/src/constants/locales.ts` | mitigate | Remove `zh-TW` from request validation and shared supported locale constants so new profile/auth/verification requests cannot persist unsupported locale choices. |
| T-260517-JMB-03 | Information Disclosure | `apps/web/components/auth/signup-step1.tsx`, client error UI | mitigate | Move user-visible error copy into locale messages; avoid surfacing untranslated Korean operational/internal strings in non-Korean sessions. |
| T-260517-JMB-04 | Repudiation | `.planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-I18N-AUDIT.md` | mitigate | Record scan commands, fixed strings, and exclusions so remaining copy decisions are auditable instead of implicit. |
</threat_model>

<verification>
Overall commands after both tasks:
- `pnpm --filter @grabit/shared test -- src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts`
- `pnpm --filter @grabit/web test -- i18n/routing.test.ts app/__tests__/sitemap.test.ts components/auth/__tests__/signup-step1-i18n.test.tsx components/auth/__tests__/signup-step1-email-availability.test.tsx components/auth/__tests__/auth-email-verification.test.tsx lib/i18n/visible-copy.test.ts lib/i18n/format.test.ts hooks/__tests__/booking-disabled-runtime.test.tsx`
- `pnpm --filter @grabit/api test -- src/modules/auth/email/templates/email-verification.copy.spec.ts src/modules/sms/sms-copy.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts src/modules/translation/deepl.client.spec.ts src/modules/translation/translation.service.spec.ts`
- `pnpm --filter @grabit/shared typecheck`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/web lint`
- `pnpm --filter @grabit/api lint`
- `rg -n "zh-TW|繁體中文|Traditional Chinese|ZH-HANT|zhTW|zhTWMessages|/zh-TW" packages/shared/src apps/web apps/api/src/modules apps/api/src/database/seed.mjs -g '!**/*.md' -g '!**/node_modules/**'` returns no active-code matches.
- `rg -n "이미 사용 중인 이메일입니다" apps/web/components/auth apps/web/app/auth -g '!**/*.test.*'` returns no production matches.
</verification>

<success_criteria>
- `zh-TW` is removed from public/user-facing active locale surfaces while `zh-CN` remains functional.
- Desktop and mobile locale switchers show Korean, English, Thai, Simplified Chinese only.
- Public routing, sitemap, and smoke tests no longer include `/zh-TW`.
- Signup first-step duplicate email error is localized through message files.
- Hardcoded Korean scan evidence is captured with fixed/excluded/remaining classifications.
- Focused tests, typecheck, and lint commands above pass or the summary records exact blockers with command output.
</success_criteria>

<output>
After completion, create `.planning/quick/260517-jmb-ui-ux-i18n/260517-jmb-SUMMARY.md`.
</output>
