---
phase: 23-launch-foundation
plan: 04
subsystem: i18n
tags: [next-intl, sitemap, hreflang, seo, routing]

requires:
  - phase: 23-launch-foundation
    provides: Shared launch locale constants from 23-01
  - phase: 23-launch-foundation
    provides: Korean root URL preservation requirement from 23-03 canary runbook
provides:
  - next-intl routing contract for five launch locales
  - Suggest-never-redirect proxy behavior with Accept-Language suggestion cookie
  - Minimal booking-disabled and locale suggestion messages for ko/en/th/zh-CN/zh-TW
  - Localized sitemap hreflang alternates with prefixless Korean canonicals
affects: [phase-23, web-i18n, seo, locale-switch, launch-canary]

tech-stack:
  added: [next-intl]
  patterns:
    - next-intl routing uses shared locale constants with `localePrefix: as-needed`
    - Accept-Language can set suggestion state but cannot redirect Korean root URLs
    - Sitemap alternates are generated from one localized URL helper

key-files:
  created:
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
  modified:
    - apps/web/package.json
    - apps/web/proxy.ts
    - apps/web/app/layout.tsx
    - apps/web/next.config.ts
    - pnpm-lock.yaml

key-decisions:
  - "Locale routing uses next-intl with `localeDetection: false`; URL prefix is authoritative and Accept-Language only creates suggestion state."
  - "Korean sitemap URLs remain prefixless while foreign hreflang alternates use `/en`, `/th`, `/zh-CN`, and `/zh-TW`."
  - "next-intl plugin setup is wired through `next.config.ts` so request config and provider integration work in the App Router."

patterns-established:
  - "Routing helpers expose `resolveLocaleFromPathname` and `getSuggestedLocaleFromAcceptLanguage` for testable suggest-never-redirect behavior."
  - "Sitemap helpers expose `getLocalizedUrl` and `buildLocalizedAlternates` for future public event routes."

requirements-completed:
  - FLAG-01
  - I18N-01
  - I18N-02

duration: 8 min
completed: 2026-05-06
---

# Phase 23 Plan 04: Locale Routing and Sitemap Summary

**Five-locale next-intl routing and localized sitemap alternates now preserve Korean prefixless SEO URLs while exposing prefixed foreign URLs.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-06T04:53:19Z
- **Completed:** 2026-05-06T05:01:09Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments

- Added `next-intl` and App Router request/provider wiring for `ko`, `en`, `th`, `zh-CN`, and `zh-TW`.
- Preserved `/` and existing unprefixed Korean paths as Korean while resolving foreign prefixes explicitly.
- Added Accept-Language parsing that creates `locale-suggestion` cookie state without automatic redirects.
- Added minimal launch messages for booking-disabled and locale suggestion copy across all five locales.
- Added sitemap/hreflang helpers and entries for root plus public legal surfaces, with Korean canonical URLs prefixless.

## Task Commits

1. **Task 1 RED: Implement prefixless Korean and prefixed foreign routing** - `cceadb0` (test)
2. **Task 1 GREEN: Implement prefixless Korean and prefixed foreign routing** - `56a1f76` (feat)
3. **Task 2 RED: Add sitemap and hreflang alternates** - `dec4156` (test)
4. **Task 2 GREEN: Add sitemap and hreflang alternates** - `30b38ad` (feat)

## Files Created/Modified

- `apps/web/i18n/routing.ts` - next-intl routing config, pathname locale resolution, and Accept-Language suggestion helper.
- `apps/web/i18n/request.ts` - request-scoped next-intl locale and message loading config.
- `apps/web/i18n/routing.test.ts` - TDD contract for prefix policy, suggestion-only detection, message files, and proxy redirect guard.
- `apps/web/messages/*.json` - Minimal booking-disabled and locale suggestion copy for five launch locales.
- `apps/web/proxy.ts` - Preserves admin pass-through while adding next-intl middleware and suggestion cookie behavior.
- `apps/web/app/layout.tsx` - Wraps existing providers, layout shell, and toaster with `NextIntlClientProvider`.
- `apps/web/next.config.ts` - Registers the next-intl plugin with the existing Sentry-wrapped Next config.
- `apps/web/app/sitemap.ts` - Localized sitemap entries and hreflang helper functions.
- `apps/web/app/__tests__/sitemap.test.ts` - TDD contract for five-locale alternates and prefixless Korean canonical URLs.
- `apps/web/package.json`, `pnpm-lock.yaml` - Adds `next-intl`.

## Decisions Made

- Disabled automatic next-intl locale detection with `localeDetection: false` so `Accept-Language` cannot rewrite Korean root URLs.
- Kept locale suggestion state as a non-httpOnly cookie because Plan 23-16 owns the user-facing switch/suggestion UI.
- Added deterministic sitemap `lastModified` for stable unit tests and launch foundation traceability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Registered the next-intl plugin in Next config**
- **Found during:** Task 1 (Implement prefixless Korean and prefixed foreign routing)
- **Issue:** The plan listed `package.json`, routing, request config, proxy, and layout, but next-intl App Router integration also requires the Next plugin to load the request config reliably.
- **Fix:** Wrapped the existing Sentry config with `createNextIntlPlugin('./i18n/request.ts')`.
- **Files modified:** `apps/web/next.config.ts`
- **Verification:** `pnpm --filter @grabit/web test -- i18n-routing.test.ts sitemap.test.ts` and `pnpm --filter @grabit/web typecheck` passed.
- **Committed in:** `56a1f76`

**2. [Rule 1 - Test Bug] Fixed Vitest file path reads in routing contract**
- **Found during:** Task 1 GREEN verification
- **Issue:** The RED test used `new URL(..., import.meta.url)` for source-file reads, but the web Vitest/jsdom transform did not provide a file-scheme URL for those reads.
- **Fix:** Switched the test to `process.cwd()` plus `node:path` resolution and kept the same behavioral assertions.
- **Files modified:** `apps/web/i18n/routing.test.ts`
- **Verification:** `pnpm --filter @grabit/web test -- i18n-routing.test.ts` passed with the implemented routing.
- **Committed in:** `56a1f76`

---

**Total deviations:** 2 auto-fixed (Rule 3: 1, Rule 1: 1)  
**Impact on plan:** Both deviations were required to make the planned i18n integration executable and verifiable. Product scope stayed within routing, messages, proxy suggestion state, and sitemap/hreflang support.

## Issues Encountered

- The web package test script runs the full Vitest suite even when filenames are passed after `--`; targeted commands still passed, with existing jsdom warnings from unrelated tests.

## Known Stubs

None.

## Threat Flags

None - the modified request-header routing and sitemap surfaces were already covered by `T-23-02` in the plan threat model.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/web test -- i18n-routing.test.ts` - PASS, 195 tests.
- `pnpm --filter @grabit/web test -- sitemap.test.ts` - PASS, 198 tests.
- `pnpm --filter @grabit/web test -- i18n-routing.test.ts sitemap.test.ts` - PASS, 198 tests.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `grep -R "localePrefix" apps/web/i18n/routing.ts` - PASS.
- `! grep -R "NextResponse.redirect" apps/web/proxy.ts` - PASS.
- `grep -R "ko" apps/web/app/sitemap.ts && grep -R "zh-CN" apps/web/app/sitemap.ts` - PASS.
- Message file existence check for `ko`, `en`, `th`, `zh-CN`, `zh-TW` - PASS.

## TDD Gate Compliance

- Task 1 RED commit exists: `cceadb0`
- Task 1 GREEN commit exists after RED: `56a1f76`
- Task 2 RED commit exists: `dec4156`
- Task 2 GREEN commit exists after RED: `30b38ad`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for Plan 23-14, 23-15, and 23-16. Downstream work can reuse the routing and sitemap helpers while adding KST/KRW formatting, PhoneInput/copy manifest coverage, and visible locale switch/suggestion UI.

## Self-Check: PASSED

- Summary and key i18n/sitemap files exist on disk.
- Task commits `cceadb0`, `56a1f76`, `dec4156`, and `30b38ad` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
