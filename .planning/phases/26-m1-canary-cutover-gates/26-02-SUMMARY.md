---
phase: 26-m1-canary-cutover-gates
plan: 02
subsystem: api
tags: [nestjs, qr-ticket, reservation, jwt, smoke, cutover]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: confirmed-payment QR issuance, reservation detail QR self-healing, and secretVersion keyring pattern
  - phase: 26-m1-canary-cutover-gates
    provides: Gate Ledger schema and validator from Plan 26-01
provides:
  - DONE-payment-only QR issuance and reservation detail hydration
  - redacted Phase 27 field-scan contract metadata verification
  - field-scan contract smoke script and schema-stable evidence fragment
affects: [PAY-01, OPS-02, QR_VISIBILITY, Phase 27 scanner contract]
tech-stack:
  added: []
  patterns:
    - QR readiness requires confirmed reservation plus DONE payment linkage
    - scanner evidence records masked JTI/status/linkage only
key-files:
  created:
    - scripts/phase26/field-scan-contract-smoke.mjs
    - .planning/phases/26-m1-canary-cutover-gates/evidence/26-02-qr-contract.json
  modified:
    - apps/api/src/modules/ticket/qr-ticket.service.ts
    - apps/api/src/modules/ticket/qr-ticket.service.spec.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/api/src/modules/reservation/reservation.service.spec.ts
key-decisions:
  - "QR issuance now requires payments.status === 'DONE' for the reservation/payment pair before exposing active ticket metadata."
  - "Reservation detail no longer returns placeholder ACTIVE QR data when payment or QR runtime wiring is missing; it returns a blocking non-active QR state."
  - "Field-scan smoke decodes scanner contract inputs from existing authenticated reservation/ticket API paths and persists only redacted evidence."
patterns-established:
  - "verifyTicketForScannerContract returns Phase 27-ready metadata with tokenVersion, status, reservation/payment/showtime context, event context, and masked JTI."
  - "Phase 26 smoke scripts validate required envs before network calls and reject raw JWT/auth/paymentKey patterns before writing evidence."
requirements-completed: [PAY-01, OPS-02]
duration: 8 min
completed: 2026-05-20
---

# Phase 26 Plan 02: QR Cutover Contract Summary

**DONE-payment-gated QR issuance with redacted scanner-contract smoke for Phase 27 readiness**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-20T05:42:28Z
- **Completed:** 2026-05-20T05:50:33Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added regression tests proving QR readiness cannot be green without a confirmed reservation, DONE payment linkage, active QR ticket, and redacted scanner metadata.
- Repaired `QrTicketService` and `ReservationService` so confirmed reservation details self-heal active QR only for DONE payments, while inconsistent/missing linkage stays non-active or fails closed.
- Added `scripts/phase26/field-scan-contract-smoke.mjs` with help mode, required-env preflight, authenticated reservation/ticket API checks, JWT payload shape checks, and redacted evidence output.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add backend QR contract regression tests** - `a176f23` (`test`)
2. **Task 2: Repair backend QR issuance and scanner contract** - `6094184` (`feat`)
3. **Task 3: Add redacted field-scan contract smoke** - `f5c001f` (`feat`)

## Files Created/Modified

- `apps/api/src/modules/ticket/qr-ticket.service.ts` - Enforces DONE payment linkage before issuance and adds `verifyTicketForScannerContract`.
- `apps/api/src/modules/ticket/qr-ticket.service.spec.ts` - Covers DONE-payment-only issuance and redacted scanner metadata.
- `apps/api/src/modules/reservation/reservation.service.ts` - Stops placeholder ACTIVE QR on missing/non-DONE payment state.
- `apps/api/src/modules/reservation/reservation.service.spec.ts` - Covers read-path QR self-healing and non-active blocking fallback.
- `scripts/phase26/field-scan-contract-smoke.mjs` - Authenticated smoke for reservation/ticket QR readiness with redacted evidence.
- `.planning/phases/26-m1-canary-cutover-gates/evidence/26-02-qr-contract.json` - Schema-stable initial evidence fragment.

## Decisions Made

- Kept the scanner contract inside `QrTicketService` instead of adding a new scanner subsystem, matching D-28.
- Used the existing authenticated reservation and ticket API paths for the smoke script, then decoded only the JWT payload shape needed for linkage checks.
- Preserved the Phase 24 `secretVersion`/keyring verification path; the smoke script does not need signing secrets and never records raw QR tokens.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Existing QR test fixtures needed `paymentStatus: 'DONE'` after issuance was tightened to reject non-DONE payments.
- Live/API smoke was not executed because this plan's automated verification only requires help mode and ledger validation. The committed evidence file is a redacted BLOCKED seed that the script overwrites when operator-approved auth and test reservation/payment IDs are provided.

## User Setup Required

To produce PASS runtime evidence, run the smoke with:

- `GRABIT_API_URL`
- `GRABIT_SMOKE_AUTH_HEADER_FILE`
- `PHASE26_TEST_RESERVATION_ID`
- `PHASE26_TEST_PAYMENT_ID`

The auth header file must stay local and uncommitted.

## Next Phase Readiness

- Backend QR readiness is now safe for web QR visibility verification in Plan 26-03.
- Phase 27 scanner work can consume the verified contract shape without adding scanner UI in Phase 26.
- Gate Ledger `QR_VISIBILITY` remains non-PASS until the operator smoke records real authenticated evidence.

## Known Stubs

| File | Line | Reason |
|------|------|--------|
| `.planning/phases/26-m1-canary-cutover-gates/evidence/26-02-qr-contract.json` | 3 | Intentional `BLOCKED` seed until an operator-approved authenticated fixture is available. |
| `.planning/phases/26-m1-canary-cutover-gates/evidence/26-02-qr-contract.json` | 7 | Intentional `not-run` marker; the smoke script overwrites it with masked live values. |

## Verification

- PASS: `pnpm --filter @grabit/api exec vitest run src/modules/ticket/qr-ticket.service.spec.ts src/modules/reservation/reservation.service.spec.ts` (72 tests)
- PASS: `pnpm --filter @grabit/api typecheck`
- PASS: `node scripts/phase26/field-scan-contract-smoke.mjs --help`
- PASS: missing-env preflight fails before network calls with `Missing required environment variable: GRABIT_API_URL`
- PASS: redacted evidence scan found no JWT, Authorization, Cookie, paymentKey, or QR token pattern
- PASS: `node scripts/phase26/validate-gate-ledger.mjs --ledger .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json --strict`

## Threat Flags

None - the QR evidence and Phase 26 to Phase 27 scanner boundary were already covered in the plan threat model.

## Self-Check: PASSED

- Verified summary exists at `.planning/phases/26-m1-canary-cutover-gates/26-02-SUMMARY.md`.
- Verified created files exist: `scripts/phase26/field-scan-contract-smoke.mjs` and `.planning/phases/26-m1-canary-cutover-gates/evidence/26-02-qr-contract.json`.
- Verified task commits exist in git history: `a176f23`, `6094184`, and `f5c001f`.
