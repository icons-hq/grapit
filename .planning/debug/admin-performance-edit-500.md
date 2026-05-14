---
status: resolved
trigger: "Production admin performance edit page returns Internal server error when saving https://heygrabit.com/admin/performances/18a3bcc6-5e75-463d-abfd-634601328754/edit"
created: 2026-05-14
updated: 2026-05-14
---

# Debug Session: admin-performance-edit-500

## Symptoms

- expected_behavior: Admin saves edits to performance `18a3bcc6-5e75-463d-abfd-634601328754` successfully in production.
- actual_behavior: Save action shows `Internal server error`.
- error_messages: User-reported production UI error; production logs pending.
- timeline: Reported on 2026-05-14.
- reproduction: Open production admin edit URL, modify/save the form.

## Current Focus

- hypothesis: unknown
- test: production Cloud Run logs plus targeted AdminService/schema/form tests.
- expecting: admin edit saves preserve booked showtime rows instead of deleting them.
- next_action: ship and verify production revision no longer emits FK 23503 for admin performance save.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-14T06:05:59Z
  source: Cloud Run `grabit-api` stderr/request logs
  found: `PUT /api/v1/admin/performances/18a3bcc6-5e75-463d-abfd-634601328754` returned 500. Stack trace: `DrizzleQueryError: Failed query: delete from "showtimes" where "showtimes"."performance_id" = $1`; PostgreSQL code `23503`, constraint `reservations_showtime_id_showtimes_id_fk`, detail `Key (id)=(3d66b3d3-61f3-427c-9fda-1a5eece511c5) is still referenced from table "reservations".`
- timestamp: 2026-05-14T06:06:33Z
  source: Cloud Run `grabit-api` stderr/request logs
  found: Same failing PUT repeated on active revision `grabit-api-00067-55l`, commit `07ccb5eadfde5bbe5560e5eeebb76ef779a9aba9`.
- timestamp: 2026-05-14T06:20:00Z
  source: targeted local verification
  found: `pnpm --filter @grabit/shared test -- performance.schema.test.ts`, `pnpm --filter @grabit/api test -- admin.service.spec.ts`, `pnpm --filter @grabit/shared build`, `pnpm --filter @grabit/web typecheck`, and `pnpm --filter @grabit/api typecheck` passed after installing workspace dependencies.

## Eliminated

- hypothesis: generic validation/date parsing failure
  evidence: production logs show a concrete FK failure while deleting `showtimes`, not a Zod validation or date parsing error.
- hypothesis: seat map or booking policy save failure
  evidence: stack trace points to `delete from "showtimes"` inside `AdminService.updatePerformance`.

## Resolution

- root_cause: Admin performance edit always sent `showtimes`, and the API update path deleted all existing showtime rows before reinserting. Booked production showtime rows are referenced by `reservations.showtime_id` with `ON DELETE NO ACTION`, so the blind delete raised PostgreSQL FK error `23503` and surfaced as 500.
- fix: Preserve existing showtime identity through the admin form as `showtimeId`; replace blind delete/reinsert with `syncShowtimes()` that updates retained rows in place, inserts new rows, and rejects deletion of booked rows with controlled 422. Legacy payloads without `showtimeId` are matched by date/order to avoid the same production 500 during rollout.
- verification: Shared schema tests, API tests, shared build, web typecheck, and API typecheck passed locally.
- files_changed: `packages/shared/src/schemas/performance.schema.ts`, `packages/shared/src/schemas/performance.schema.test.ts`, `apps/web/components/admin/performance-form.tsx`, `apps/web/components/admin/showtime-manager.tsx`, `apps/api/src/modules/admin/admin.service.ts`, `apps/api/src/modules/admin/admin.service.spec.ts`
