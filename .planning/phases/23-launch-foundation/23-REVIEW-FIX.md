---
phase: 23-launch-foundation
fixed_at: 2026-05-07T06:45:46Z
review_path: .planning/phases/23-launch-foundation/23-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-05-07T06:45:46Z
**Source review:** .planning/phases/23-launch-foundation/23-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6
- Fixed: 6
- Skipped: 0
- Setup note: initial focused tests could not run until `pnpm install --frozen-lockfile` prepared worktree dependencies.

## Fixed Issues

### CR-01: Fresh launch databases cannot capture signup consent

**Status:** fixed
**Files modified:** `apps/api/src/database/migrations/0009_seed_launch_consent_items.sql`, `apps/api/src/database/migrations/meta/_journal.json`, `apps/api/src/database/schema/launch-foundation.schema.spec.ts`
**Commit:** 63aea35
**Applied fix:** Added a data migration that upserts active `2026-04-28` consent items for all launch locales and all required/optional consent keys. Avoided editing `apps/api/src/database/seed.mjs` because that file had unrelated pre-existing main-worktree changes.
**Verification:** `node -e "JSON.parse(..._journal.json...)"` passed; `pnpm --filter @grabit/api test -- src/database/schema/launch-foundation.schema.spec.ts` passed (41 files, 499 tests).

### CR-02: Booking consent is validated but never persisted to the audit log

**Status:** fixed: requires human verification
**Files modified:** `apps/api/src/modules/reservation/reservation.controller.ts`, `apps/api/src/modules/reservation/reservation.service.ts`, `apps/api/src/modules/reservation/reservation.service.spec.ts`
**Commit:** 7c96796
**Applied fix:** Threaded request metadata into reservation prepare, loaded the trusted user birth date server-side, and called `ConsentService.captureConsent()` with `sourceFlow: 'booking'` inside the pending reservation transaction.
**Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation.service.spec.ts` passed (44 tests); `pnpm --filter @grabit/shared build` then `pnpm --filter @grabit/api typecheck` passed.

### CR-03: Consent audit timestamps are client-controlled

**Status:** fixed
**Files modified:** `packages/shared/src/schemas/consent.schema.ts`, `packages/shared/src/schemas/consent.schema.test.ts`, `apps/api/src/modules/consent/consent.service.ts`, `apps/api/src/modules/consent/consent.service.spec.ts`
**Commit:** 5dc02b3
**Applied fix:** Removed `capturedAt` from public consent capture requests and made `ConsentService.captureConsent()` always use server time for age gate and persisted `agreedAt`.
**Verification:** `pnpm --filter @grabit/shared exec vitest run src/schemas/consent.schema.test.ts` passed (1 test); `pnpm --filter @grabit/api exec vitest run src/modules/consent/consent.service.spec.ts` passed (5 tests); shared typecheck/build and API typecheck passed.

### CR-04: Consent audit IP addresses can be spoofed through x-forwarded-for

**Status:** fixed
**Files modified:** `apps/api/src/common/request-ip.ts`, `apps/api/src/common/request-ip.spec.ts`, `apps/api/src/main.ts`, `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.controller.spec.ts`, `apps/api/src/modules/consent/consent.controller.ts`, `apps/api/src/modules/reservation/reservation.controller.ts`
**Commit:** 6a2d69e
**Applied fix:** Configured Express `trust proxy`, stopped reading raw `x-forwarded-for`, and centralized consent IP resolution on validated `req.ip` with socket fallback.
**Verification:** `pnpm --filter @grabit/api exec vitest run src/common/request-ip.spec.ts src/modules/auth/auth.controller.spec.ts` passed (24 tests); `pnpm --filter @grabit/api typecheck` passed.

### WR-01: ended=false query parameters are parsed as true

**Status:** fixed: requires human verification
**Files modified:** `packages/shared/src/schemas/performance.schema.ts`, `packages/shared/src/schemas/performance.schema.test.ts`
**Commit:** 660ccec
**Applied fix:** Replaced `z.coerce.boolean()` with an explicit query-string boolean parser for `ended`, covering `false`, `true`, omitted, empty, and invalid values.
**Verification:** `pnpm --filter @grabit/shared exec vitest run src/schemas/performance.schema.test.ts` passed (2 tests); `pnpm --filter @grabit/shared typecheck` and build passed.

### WR-02: Published translations can be moved back to review state

**Status:** fixed: requires human verification
**Files modified:** `apps/api/src/modules/translation/translation.service.ts`, `apps/api/src/modules/translation/translation.service.spec.ts`, `apps/web/components/admin/translation-review-detail-panel.tsx`, `apps/web/components/admin/__tests__/translation-review.test.tsx`
**Commit:** 5192ec7
**Applied fix:** `markReviewed()` now rejects published drafts, and the admin review button is enabled only for `draft` rows with source text and translated text.
**Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/translation/translation.service.spec.ts` passed (10 tests); `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/translation-review.test.tsx` passed (7 tests); API and web typechecks passed.

## Skipped Issues

None.

---

_Fixed: 2026-05-07T06:45:46Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
