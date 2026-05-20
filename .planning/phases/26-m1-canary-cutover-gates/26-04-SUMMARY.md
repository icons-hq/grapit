---
phase: 26-m1-canary-cutover-gates
plan: 04
subsystem: payments
tags: [toss, webhook, idempotency, accepted-risk, secret-rotation]
requires:
  - phase: 26-m1-canary-cutover-gates
    provides: Gate Ledger foundation from 26-01
provides:
  - Toss confirm/cancel Idempotency-Key support
  - Toss webhook provider re-query authority
  - D-24 Toss test-secret rotation accepted-risk evidence
affects: [phase-26, phase-26-05, phase-26-10, payments, booking-cutover]
tech-stack:
  added: []
  patterns: [provider re-query before local finalization, redacted accepted-risk evidence]
key-files:
  created:
    - .planning/phases/26-m1-canary-cutover-gates/evidence/26-04-toss-hardening.json
  modified:
    - apps/api/src/modules/payment/toss-payments.client.ts
    - apps/api/src/modules/payment/toss-payments.client.spec.ts
    - apps/api/src/modules/payment/payment-webhook.controller.ts
    - apps/api/src/modules/payment/toss-webhook.controller.spec.ts
    - apps/api/src/modules/payment/payment.service.ts
    - apps/api/src/modules/payment/payment.service.spec.ts
    - .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json
    - .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md
key-decisions:
  - "Webhook finalization uses Toss queryPayment(paymentKey) as provider authority before applying local state."
  - "Confirm/cancel POST calls support idempotency keys without logging raw key material."
  - "TOSS_TEST_SECRET_ROTATION is recorded as owner-approved ACCEPTED_RISK, not PASS, because rotation was not completed."
patterns-established:
  - "Provider webhook payloads are not trusted as final payment truth without re-query."
  - "Secret-related evidence stores only class, short redacted prefix, binding names, and version metadata."
requirements-completed: [PAY-01]
duration: 25min
completed: 2026-05-20
---

# Phase 26 Plan 04: Toss Hardening Summary

**Toss retry and webhook authority hardening with D-24 secret-rotation accepted-risk tracking**

## Performance

- **Duration:** 25 min
- **Started:** 2026-05-20T05:43:00Z
- **Completed:** 2026-05-20T06:10:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added failing and passing coverage for Toss confirm/cancel idempotency headers.
- Added `queryPayment(paymentKey)` and changed webhook finalization to re-query provider state before local finalization.
- Recorded D-24 Toss test-secret rotation as `ACCEPTED_RISK` with owner approval, CLI binding metadata, and no raw secret values in repo artifacts.

## Task Commits

1. **Task 1: Add Toss idempotency and webhook re-query tests** - `c1b27c6` (`test(26-04): add failing Toss hardening tests`)
2. **Task 2: Implement Toss query and idempotency hardening** - `faed455` (`feat(26-04): harden Toss retry and webhook authority`)
3. **Task 3: Rotate exposed Toss test secret and record redacted evidence** - pending commit for this summary/evidence update

## Files Created/Modified

- `apps/api/src/modules/payment/toss-payments.client.ts` - Adds query/idempotency support for Toss API calls.
- `apps/api/src/modules/payment/payment-webhook.controller.ts` - Uses provider query as authority before local finalization.
- `apps/api/src/modules/payment/payment.service.ts` - Preserves webhook/payment state safety around queried provider data.
- `apps/api/src/modules/payment/*.spec.ts` - Adds regression coverage for idempotency and webhook mismatch handling.
- `.planning/phases/26-m1-canary-cutover-gates/evidence/26-04-toss-hardening.json` - Redacted D-24 evidence and accepted-risk approval record.
- `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json` - Marks `TOSS_TEST_SECRET_ROTATION` as approved `ACCEPTED_RISK`.
- `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md` - Adds accepted-risk entry.

## Decisions Made

- The user-approved “continue anyway” instruction was treated as explicit owner approval for D-24 non-PASS accepted risk.
- Raw Toss client, secret, and security keys were not written to repo artifacts.
- `TOSS_TEST_SECRET_ROTATION` remains non-PASS and must not be used as final live readiness evidence in Plan 26-10.

## Deviations from Plan

### Owner-Approved Accepted Risk

- **Found during:** Task 3 (Toss test secret rotation)
- **Issue:** Rotation/reissue was not completed in this execution window.
- **Resolution:** Recorded `TOSS_TEST_SECRET_ROTATION` as `ACCEPTED_RISK` with owner approval, Secret Manager/GitHub/Cloud Run binding metadata, compensating monitoring, and rollback/close-booking trigger.
- **Impact:** PAY-01 can continue to rehearsal work, but final live enablement remains blocked unless Plan 26-10 accepts the non-PASS row according to the Gate Ledger policy.

## Issues Encountered

External Toss Dashboard rotation was not performed. This was resolved as owner-approved accepted risk, not as PASS.

## User Setup Required

Toss test secret rotation is still recommended before treating final test-key rehearsal evidence as trusted. No raw key should be pasted into repo artifacts.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/payment/toss-payments.client.spec.ts src/modules/payment/toss-webhook.controller.spec.ts src/modules/payment/payment.service.spec.ts` - passed, 29 tests.
- `pnpm --filter @grabit/api typecheck` - passed.
- `node scripts/phase26/validate-gate-ledger.mjs --ledger .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json --strict` - passed.
- Redaction scan over Gate Ledger and 26-04 evidence - passed.

## Next Phase Readiness

Plan 26-05 can run the dedicated test-event rehearsal using the hardened Toss client/webhook contract. Plan 26-10 must preserve the accepted-risk distinction and cannot treat D-24 as PASS.

## Self-Check: PASSED

---
*Phase: 26-m1-canary-cutover-gates*
*Completed: 2026-05-20*
