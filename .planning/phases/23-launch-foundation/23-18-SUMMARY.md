---
phase: 23-launch-foundation
plan: "18"
subsystem: web-routing
tags: [nextjs, next-intl, i18n, proxy, uat]

requires:
  - phase: 23-launch-foundation
    provides: "Phase 23 flat App Router pages, next-intl locale contract, launch UAT gap record"
provides:
  - "Flat-route locale proxy that preserves Korean root URLs and strips foreign prefixes only for internal routing"
  - "Regression tests for default and foreign locale route rewrites"
  - "LocaleSuggestion hydration-safe initial render"
  - "Updated Phase 23 UAT gap record narrowing remaining checks to seeded dynamic fixture prerequisites"
affects: [phase-23-uat, launch-foundation, i18n-routing, public-auth, legal-pages]

tech-stack:
  added: []
  patterns:
    - "Custom Next.js proxy sets X-NEXT-INTL-LOCALE directly for a flat App Router tree"
    - "Foreign locale URLs keep visible prefixes while rewriting internally to existing unprefixed pages"

key-files:
  created:
    - .planning/phases/23-launch-foundation/23-18-SUMMARY.md
  modified:
    - apps/web/proxy.ts
    - apps/web/i18n/routing.test.ts
    - apps/web/components/i18n/locale-suggestion.tsx
    - apps/web/components/layout/__tests__/layout-shell-locale.test.tsx
    - .planning/phases/23-launch-foundation/23-UAT.md

key-decisions:
  - "Kept the existing flat App Router tree and replaced next-intl createMiddleware with a narrow custom proxy instead of migrating to app/[locale]."
  - "Classified remaining /booking/test-performance and /performance/test-performance checks as seed/API fixture prerequisites because route shells no longer render not-found."

patterns-established:
  - "Locale proxy: URL prefix > NEXT_LOCALE cookie > ko for active locale, with X-NEXT-INTL-LOCALE forwarded to next-intl request config."
  - "Hydration pattern: LocaleSuggestion renders null initially and reads client cookies only after mount."

requirements-completed: [FLAG-02, I18N-01, I18N-02, TRANS-01, TRANS-02, AUTH-01, AUTH-02, COMP-01]

duration: 13 min
completed: 2026-05-07
---

# Phase 23 Plan 18: Locale Routing UAT Gap Closure Summary

**Flat-route locale proxy for Korean root URLs and foreign-prefixed auth/legal pages, with UAT evidence narrowed to seeded dynamic fixture prerequisites.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-07T01:40:10Z
- **Completed:** 2026-05-07T01:53:22Z
- **Tasks:** 4 completed
- **Files modified:** 5

## Accomplishments

- Added RED regression coverage proving the previous middleware rewrote `/` and `/auth` to nonexistent `/ko` paths and failed foreign-prefixed flat routes.
- Replaced `next-intl` `createMiddleware(routing)` with a custom proxy that forwards `X-NEXT-INTL-LOCALE`, avoids `/ko` rewrites, and rewrites `/en/*`, `/th/*`, `/zh-CN/*`, `/zh-TW/*` internally to existing flat pages.
- Stabilized `LocaleSuggestion` by deferring cookie/sessionStorage reads until after mount.
- Updated `23-UAT.md`: static route blockers are resolved; only `test-performance` dynamic checks remain blocked by seed/API fixture prerequisites.

## Task Commits

1. **Task 1: Add locale proxy regression tests** - `b7d17dd` (test)
2. **Task 2: Replace next-intl middleware with flat proxy** - `70c956c` (fix)
3. **Task 3: Stabilize LocaleSuggestion hydration** - `87da1fb` (fix)
4. **Task 4: Re-run Phase 23 browser UAT and close gap record** - `4118347` (docs)

## Post-Review Hardening

- `bb6d919` - `fix(23-18): keep prefixless routes Korean`
  - Prefixless Korean URLs now ignore stale foreign `NEXT_LOCALE` cookies and normalize the response cookie back to `ko`.
- `536862b` - `fix(23-18): harden locale proxy inputs`
  - Bypassed admin requests strip spoofed internal locale headers, and malformed `locale-suggestion` cookies are ignored.
- `f42f82d` - `fix(23-18): block prefixed reserved rewrites`
  - Locale-prefixed reserved namespaces such as `/en/admin`, `/en/api`, and `/en/_next` no longer rewrite into protected internal paths.
- `5bd4016` - `docs(23): add code review report`
  - Final code review status is clean with zero findings.

## Verification

- RED: `pnpm --filter @grabit/web test -- i18n/routing.test.ts components/layout/__tests__/layout-shell-locale.test.tsx` failed as expected before implementation: `/` rewrote to `/ko`, `/en/auth` rewrote to `/ko/en/auth`, and `proxy.ts` still used `createMiddleware`.
- `pnpm --filter @grabit/shared test -- flags.test.ts constants/locales.test.ts launch-copy-keys.test.ts auth.schema.test.ts` - PASS, 30 tests.
- `pnpm --filter @grabit/web test -- i18n-routing.test.ts sitemap.test.ts gnb-locale.test.tsx layout-shell-locale.test.tsx signup-consent.test.tsx signup-submit-consent.test.tsx legal-fallback.test.tsx footer.test.tsx format.test.ts format-components.test.tsx performance-detail-formatting.test.tsx phone-input-i18n.test.tsx phone-verification-i18n.test.tsx translation-review.test.tsx consent-audit-table.test.tsx automatic-translation-label.test.tsx` - PASS, 313 tests.
- `pnpm --filter @grabit/api test -- feature-flags.service.spec.ts booking.service.spec.ts reservation.service.spec.ts translation.service.spec.ts deepl.client.spec.ts auth.service.spec.ts auth.controller.spec.ts email.service.spec.ts sms.service.spec.ts consent.service.spec.ts consent-audit.controller.spec.ts auth-consent.dto.spec.ts user.service.spec.ts user.controller.spec.ts` - PASS, 493 tests.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/api typecheck` - PASS.
- Post-review focused suite: `pnpm --filter @grabit/web exec vitest run i18n/routing.test.ts components/layout/__tests__/layout-shell-locale.test.tsx` - PASS, 15 tests.
- Post-review integration gates: `pnpm build` - PASS; `pnpm test` - PASS, 5 shared files / 41 api files / 46 web files.

## Browser Route Crawl

Static route blocker scope passed on `localhost:3000` with HTTP 200, no not-found page, and 0 hydration mismatch messages:

- `/` - no `x-middleware-rewrite`
- `/auth` - no `x-middleware-rewrite`
- `/en/auth` - `x-middleware-rewrite: /auth`
- `/th/auth` - `x-middleware-rewrite: /auth`
- `/legal/terms` - no `x-middleware-rewrite`
- `/en/legal/terms` - `x-middleware-rewrite: /legal/terms`
- `/th/legal/terms` - `x-middleware-rewrite: /legal/terms`
- `/zh-CN/legal/privacy` - `x-middleware-rewrite: /legal/privacy`
- `/zh-TW/legal/marketing` - `x-middleware-rewrite: /legal/marketing`
- `/api/runtime-flags` - `{"bookingEnabled":false}`

Remaining seed-only blocked checks:

- `/booking/test-performance` reaches the route shell but the body shows API `Internal server error`.
- `/booking/test-performance/confirm` redirects unauthenticated users to `/auth`.
- `/performance/test-performance` does not render not-found, but `curl http://localhost:3000/api/v1/performances/test-performance` returns `{"statusCode":500,"message":"Internal server error"}`.
- Prerequisite: seed `test-performance` with valid performance detail, at least one showtime, price tier, seat map, and reviewed translation metadata, or update UAT to use an existing seeded performance id.

## Files Created/Modified

- `apps/web/proxy.ts` - custom flat-route locale proxy and locale cookie/header handling.
- `apps/web/i18n/routing.test.ts` - proxy regression tests for Korean flat routes, foreign prefixes, and public route exclusions.
- `apps/web/components/i18n/locale-suggestion.tsx` - mount-only suggestion cookie read to avoid hydration mismatch.
- `apps/web/components/layout/__tests__/layout-shell-locale.test.tsx` - hydration-safe source guard for LocaleSuggestion.
- `.planning/phases/23-launch-foundation/23-UAT.md` - resolved routing blocker evidence and seed-only remaining blockers.

## Decisions Made

- Kept flat App Router pages and implemented a narrow proxy because migrating to `app/[locale]` would have touched public, booking, legal, and admin routing with a larger blast radius.
- Left `test-performance` dynamic checks blocked rather than inventing fixture evidence; route shells are reachable, but the API fixture returns 500.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Vitest cannot load `next-intl/middleware` directly in the proxy regression test because the package imports `next/server` in a way Node ESM rejects outside Next. The RED test mocked `next-intl/middleware` to reproduce the previous `/ko` rewrite behavior, then the implementation removed that dependency from `proxy.ts`.
- The Playwright MCP browser instance was already in use, so browser smoke was run with a one-off `@playwright/test` Chromium script from `apps/web`.

## Known Stubs

None found in files created or modified by this plan.

## Authentication Gates

None.

## User Setup Required

None for the routing fix. Follow-up seed work is required only if UAT must exercise the dynamic `test-performance` booking/detail fixture.

## Next Phase Readiness

Phase 23's locale middleware UAT blocker is closed. Remaining Phase 23 UAT blocks are explicit seeded-data prerequisites for `test-performance`, not global routing failures.

## Self-Check: PASSED

- Found `.planning/phases/23-launch-foundation/23-18-SUMMARY.md`.
- Found modified routing file `apps/web/proxy.ts`.
- Found task commits: `b7d17dd`, `70c956c`, `87da1fb`, `4118347`.
- Stub scan found no TODO/FIXME/placeholder or hardcoded empty UI data patterns in files created or modified by this plan.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-07*
