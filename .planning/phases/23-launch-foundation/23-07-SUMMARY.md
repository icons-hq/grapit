---
phase: 23-launch-foundation
plan: "07"
subsystem: api
tags: [consent, audit, compliance, auth, booking, launch-foundation]
requirements_completed: [COMP-01, COMP-02, AUTH-01, FLAG-02]
dependency_graph:
  requires: [23-01, 23-02, 23-04, 23-05, 23-06]
  provides:
    - itemized immutable consent audit capture
    - masked admin consent audit query endpoint
    - signup and fanmeet booking consent gates
  affects:
    - apps/api/src/modules/consent
    - apps/api/src/modules/auth
    - apps/api/src/modules/reservation
    - packages/shared/src/schemas
tech_stack:
  added: []
  patterns:
    - Vitest TDD red/green task commits
    - ConsentService as the single API enforcement point for required consent
    - Masked-by-default admin audit rows
key_files:
  created:
    - apps/api/src/modules/consent/consent.module.ts
    - apps/api/src/modules/consent/consent.controller.ts
    - apps/api/src/modules/consent/consent.service.ts
    - apps/api/src/modules/consent/consent.service.spec.ts
    - apps/api/src/modules/consent/consent-audit.controller.ts
    - apps/api/src/modules/consent/consent-audit.controller.spec.ts
    - apps/api/src/database/migrations/0008_consent_audit_source_flow.sql
    - apps/api/src/database/migrations/meta/0008_snapshot.json
  modified:
    - apps/api/src/app.module.ts
    - apps/api/src/database/schema/consent-audit-logs.ts
    - apps/api/src/database/schema/launch-foundation.schema.spec.ts
    - apps/api/src/database/migrations/meta/_journal.json
    - apps/api/src/modules/auth/auth.module.ts
    - apps/api/src/modules/auth/auth.service.ts
    - apps/api/src/modules/auth/auth.service.spec.ts
    - apps/api/src/modules/auth/dto/register.dto.ts
    - apps/api/src/modules/auth/dto/social-register.dto.ts
    - apps/api/src/modules/reservation/reservation.module.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/api/src/modules/reservation/reservation.service.spec.ts
    - packages/shared/src/schemas/auth.schema.ts
    - packages/shared/src/schemas/booking.schema.ts
    - packages/shared/src/schemas/consent.schema.ts
decisions:
  - Consent audit rows persist sourceFlow on the append-only row because compliance evidence needs to distinguish signup from booking capture.
  - Admin consent audit output is masked by default for email, phone, and IP with no raw PII response path added.
  - Booking consent validation runs after BOOKING_ENABLED and before reservation/payment side effects.
metrics:
  duration: 15m09s
  completed_at: 2026-05-06T06:34:29Z
  tasks_completed: 3
  files_changed: 23
---

# Phase 23 Plan 07: Consent Audit Foundation Summary

Itemized consent capture, masked admin consent audit query, and signup/fanmeet booking consent gates now preserve required launch compliance evidence server-side.

## Completed Tasks

| Task | Name | Commit | Result |
| ---- | ---- | ------ | ------ |
| 1 | Itemized consent capture service | 893a024, 0a7a27d | Added consent module/service/controller, shared capture schema, required consent validation, under-14 block copy, and append-only audit rows per item/version/language. |
| 2 | Masked consent audit query endpoint | b459179, ab02771 | Added guarded `/api/v1/admin/consent-audit` query surface with item/version/language/time/IP/user filters and masked email/phone/IP output. |
| 3 | Signup and booking consent gates | a4d01e3, 5cab4ca | Required consent is now enforced during register/social completion and booking prepare, while booking disabled still blocks before consent or transaction side effects. |

## Verification

- `pnpm --filter @grabit/shared build`
- `pnpm --filter @grabit/shared typecheck`
- `pnpm --filter @grabit/api test -- consent.service.spec.ts consent-audit.controller.spec.ts auth.service.spec.ts reservation.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`
- `grep -R "만 14세 미만은 가입할 수 없습니다" apps/api/src/modules/consent`
- `grep -R "maskedIp" apps/api/src/modules/consent`
- `grep -R "국외이전 동의가 필요합니다" apps/api/src/modules`

All verification commands passed. The API test command ran 39 spec files and 473 tests successfully.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `source_flow` persistence for audit evidence**
- **Found during:** Task 1 (Itemized consent capture service)
- **Issue:** The plan required signup/booking source flow in immutable audit evidence, but the existing `consent_audit_logs` schema had no `source_flow` column.
- **Fix:** Added `sourceFlow` to the Drizzle schema, generated migration metadata, wrote the SQL migration, and persisted source flow from `ConsentService.captureConsent`.
- **Files modified:** `apps/api/src/database/schema/consent-audit-logs.ts`, `apps/api/src/database/schema/launch-foundation.schema.spec.ts`, `apps/api/src/database/migrations/0008_consent_audit_source_flow.sql`, `apps/api/src/database/migrations/meta/0008_snapshot.json`, `apps/api/src/database/migrations/meta/_journal.json`, `apps/api/src/modules/consent/consent.service.ts`
- **Verification:** `consent.service.spec.ts`, `launch-foundation.schema.spec.ts`, shared/API typecheck, and migration file inspection.
- **Commit:** 0a7a27d

---

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** Required for correctness and compliance evidence completeness; no scope expansion beyond the plan threat model.

## Issues Encountered

- API typecheck consumes built `@grabit/shared` exports, so shared schema changes were verified by running `pnpm --filter @grabit/shared build` before API typecheck.

## Auth Gates

None.

## Known Stubs

None. Stub scan only found intentional test empty arrays/null handling and existing dev/mock null branches; no placeholder data flow blocks this plan.

## Threat Flags

None. New consent capture, admin audit query, and booking/auth enforcement surfaces were already covered by the plan threat model.

## TDD Gate Compliance

- RED commits present: 893a024, b459179, a4d01e3
- GREEN commits present after each RED commit: 0a7a27d, ab02771, 5cab4ca
- Refactor commits: none needed

## Self-Check: PASSED

- Verified key created files exist.
- Verified all task commit hashes exist in git history.
