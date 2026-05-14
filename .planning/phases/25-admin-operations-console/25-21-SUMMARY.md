---
phase: 25-admin-operations-console
plan: "21"
subsystem: database
tags: [admin, operations, support, faq, notices, drizzle, tdd]

requires:
  - phase: 25-04
    provides: Admin content schema regression pattern and schema barrel exports
  - phase: 25 planning artifacts
    provides: D-04 through D-07 support operations and translation review decisions
provides:
  - Durable support thread/message schema with SLA, escalation, locale, assignee, and refund/signup linkage contracts
  - FAQ and notice schema with review state and assisted translation-use indication
  - Schema regression coverage for ADMIN-02 support, FAQ, and notice contracts
affects: [25-06, ADMIN-02, admin-operations-console]

tech-stack:
  added: []
  patterns:
    - Drizzle schema-first support operations contracts
    - Shared review and translation-use enums for support messages, FAQ, and notices

key-files:
  created:
    - apps/api/src/database/schema/support-threads.ts
    - apps/api/src/database/schema/support-messages.ts
    - apps/api/src/database/schema/support-faqs.ts
    - apps/api/src/database/schema/support-notices.ts
  modified:
    - apps/api/src/database/schema/index.ts
    - apps/api/src/database/schema/phase25-admin-content.schema.spec.ts

key-decisions:
  - "Support thread linkage stores refund/reservation IDs and signup failure hashes, avoiding raw signup PII in the operations thread contract."
  - "Support messages, FAQ, and notices share explicit review state and translation-use enums so assisted content is distinguishable before publication."
  - "High-risk support categories include payment_error, refund_unprocessed, abuse_fraud, and signup_failure for automatic escalation routing."

patterns-established:
  - "ADMIN-02 support content starts with schema contracts and Vitest regression coverage before migration generation."
  - "Support operations tables index SLA/status, priority/escalation, category, assignee, refund, reservation, and signup lookup fields."

requirements-completed: [ADMIN-02]

duration: 6 min
completed: 2026-05-14
---

# Phase 25 Plan 21: Support Content Schema Contracts Summary

**Support thread, message, FAQ, and notice Drizzle contracts now persist SLA, escalation, review, locale, translation-use, and refund/signup linkage state for ADMIN-02.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-14T01:07:13Z
- **Completed:** 2026-05-14T01:13:23Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- Added `support_threads` with category, status, priority, escalation state, 24-hour SLA due timestamp, locale, assignee, refund/reservation linkage, and signup failure lookup hashes.
- Added `support_messages` with author, locale, internal/public visibility, review state, translation-use indication, and reviewer metadata.
- Added `support_faqs` and `support_notices` with locale, review state, assisted translation-use indication, reviewer metadata, and publish timestamps.
- Extended the Phase 25 schema regression test to lock support, FAQ, and notice contracts through `schema/index.ts`.

## Task Commits

1. **Task 1 RED:** `f9ad225` (test) - failing support thread/message, FAQ, and notice schema contract tests
2. **Task 1 GREEN:** `775f631` (feat) - Drizzle schema files and barrel exports for support content contracts

**Plan metadata:** committed separately after this summary.

## Files Created/Modified

- `apps/api/src/database/schema/support-threads.ts` - support thread enums/table with SLA, escalation, locale, assignee, refund/reservation, and signup lookup fields.
- `apps/api/src/database/schema/support-messages.ts` - support message table with author, visibility, locale, review, and translation-use state.
- `apps/api/src/database/schema/support-faqs.ts` - FAQ authoring/review table with locale, reviewer, translation-use, and publish fields.
- `apps/api/src/database/schema/support-notices.ts` - notice authoring/review table with status, priority, scheduling, reviewer, translation-use, and publish fields.
- `apps/api/src/database/schema/index.ts` - exports the new support/FAQ/notice tables and enums.
- `apps/api/src/database/schema/phase25-admin-content.schema.spec.ts` - adds regression coverage for the ADMIN-02 schema contract.

## Decisions Made

- Signup failure linkage uses hashed email/phone lookup fields rather than raw signup identifiers in the support thread table.
- FAQ, notice, and support message assisted translation state is modeled explicitly through `support_translation_use` and `support_content_review_state`.
- Notice publication state is separated into `support_notice_status` so review/schedule/publish flow is not inferred from timestamps alone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Prepared missing worktree dependencies for verification**
- **Found during:** Task 1 RED verification
- **Issue:** Fresh worktree had no `node_modules`, so Vitest could not start.
- **Fix:** Ran `pnpm install --frozen-lockfile`; generated dependency artifacts are ignored and not committed.
- **Files modified:** None tracked
- **Verification:** RED test failed for the intended missing schema exports, then GREEN verification passed.
- **Committed in:** N/A

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required only to run the planned tests in this isolated worktree. No scope expansion.

## Issues Encountered

- The plan's `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-content.schema.spec.ts` command runs the full API suite because the API Vitest root is `apps/api/src`. I also ran `pnpm --filter @grabit/api exec vitest run database/schema/phase25-admin-content.schema.spec.ts` to target the schema file directly.
- An initial patch was accidentally applied to the parent checkout path. It was immediately reverted before any commit, and the parent checkout status for the touched file was verified clean.

## TDD Gate Compliance

- RED gate commit exists: `f9ad225`
- GREEN gate commit exists after RED: `775f631`
- Refactor gate was not needed.

## Known Stubs

None.

## Threat Flags

None. The new database trust boundary is the planned `admin/support inputs -> database schema` surface and is covered by `T-25-21-01` and `T-25-21-02` in the plan threat model.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/api exec vitest run database/schema/phase25-admin-content.schema.spec.ts` - PASS (4 tests)
- `pnpm --filter @grabit/shared build` - PASS
- `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-content.schema.spec.ts && pnpm --filter @grabit/api typecheck` - PASS (API suite 57 files / 590 tests, then typecheck)
- `sed -n '1,80p' .planning/phases/25-admin-operations-console/25-06-PLAN.md` - PASS, `depends_on` includes `25-21`

## Next Phase Readiness

Phase 25 migration plan `25-06` can now generate SQL for the support, FAQ, and notice schema split. Follow-on ADMIN-02 feature plans can consume durable schema instead of frontend-only fixtures.

## Self-Check: PASSED

- Summary exists at `.planning/phases/25-admin-operations-console/25-21-SUMMARY.md`.
- Created schema files exist: `support-threads.ts`, `support-messages.ts`, `support-faqs.ts`, and `support-notices.ts`.
- Modified schema barrel and regression test exist.
- Task commits found: `f9ad225`, `775f631`.
- `STATE.md`, `ROADMAP.md`, and `REQUIREMENTS.md` were not modified.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
