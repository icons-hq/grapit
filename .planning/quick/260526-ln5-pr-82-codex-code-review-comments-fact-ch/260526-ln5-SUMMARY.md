---
status: complete
quick_id: 260526-ln5
task: PR #82 Codex code-review fact-check and fix
completed_at: 2026-05-26T06:43:53Z
code_commit: 8acfec1b
---

# Quick Task 260526-ln5 Summary

## Outcome

Fetched current PR #82 review data from GitHub and fact-checked all Codex review findings against the current branch.

Review corpus:
- Pull review comments: 2
- Reviews: 1
- Issue comments: 0

Classification:
- `confirmed_fixed`: 2
- `false_positive`: 0
- `duplicate`: 0
- `outdated_comment`: 0
- `pending`: 0

## Fixes

1. Offline sync verifiable token preservation
   - Added `FieldOfflineSyncAttempt.token` in shared schema.
   - Persisted and sent the verifiable QR token from the web pending scan queue.
   - Changed API offline sync consume path to use `attempt.token`, not masked `redactedTokenRef`.
   - Kept result/audit surfaces redacted.

2. Field monitor scan log ordering
   - Added deterministic `scannedAt DESC, id DESC` ordering before `limit(100)`.
   - Added service test coverage that `orderBy` is applied before `limit`.

Code commit: `8acfec1b`

## Files Changed

Source/test files:
- `packages/shared/src/schemas/field-operations.schema.ts`
- `packages/shared/src/schemas/field-operations.schema.test.ts`
- `apps/web/lib/field/offline-scan-store.ts`
- `apps/web/app/field/check-in/page.tsx`
- `apps/web/components/field/__tests__/scanner-check-in.test.tsx`
- `apps/api/src/modules/field-operations/offline-sync.service.ts`
- `apps/api/src/modules/field-operations/offline-sync.service.spec.ts`
- `apps/api/src/modules/field-operations/field-monitor.service.ts`
- `apps/api/src/modules/field-operations/field-monitor.service.spec.ts`

Artifacts:
- `pr82-pr.json`
- `pr82-pull-review-comments.json`
- `pr82-reviews.json`
- `pr82-issue-comments.json`
- `pr82-findings.json`
- `PR82-FACT-CHECK.md`

## Verification

Passed:
- `pnpm --filter @grabit/shared test -- field-operations.schema.test.ts`
  - Passed: 10 test files, 61 tests.
- `pnpm --filter @grabit/api test -- offline-sync.service.spec.ts field-monitor.service.spec.ts`
  - Passed: 77 test files, 773 tests.
- `pnpm --filter @grabit/web test -- scanner-check-in.test.tsx`
  - Passed: 82 test files, 483 tests.
- `pnpm --filter @grabit/shared typecheck`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/web typecheck`
- `git diff --check`

Notes:
- The package test commands expanded beyond the named files under the repo's Vitest config, so the verification covered broader package suites than the focused file names suggest.
- Web tests emitted existing React `act(...)` and jsdom navigation warnings, but the test run exited successfully.

## Residual Risk

Existing pre-fix browser IndexedDB pending scan records may only contain `redactedTokenRef` and cannot be reconstructed into verifiable server sync attempts. Because this is pre-merge Phase 27 PR work, no production data migration was added.
