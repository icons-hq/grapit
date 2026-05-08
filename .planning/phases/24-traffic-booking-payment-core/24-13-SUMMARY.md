---
phase: 24-traffic-booking-payment-core
plan: 13
subsystem: api
tags: [nestjs, nextjs, jwt, qr, pg-boss, playwright]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: plan 24-09 shared booking/reservation QR contracts and schema
  - phase: 24-traffic-booking-payment-core
    provides: plan 24-11 pg-boss background job infrastructure
provides:
  - confirmed-payment QR ticket issuance with secret-version-aware HS256 signing
  - D-1 QR reminder email scheduling through durable pg-boss work
  - immediate QR visibility on booking complete and My Page reservation detail
affects: [payment complete flow, mypage reservation detail, ticket lookup surfaces]
tech-stack:
  added: []
  patterns:
    - QR token verification keyed by persisted secretVersion + keyring lookup
    - reservation detail self-heals missing confirmed QR tickets before rendering
key-files:
  created:
    - apps/api/src/modules/ticket/ticket.module.ts
    - apps/api/src/modules/ticket/ticket.controller.ts
    - apps/api/src/modules/ticket/qr-ticket.service.ts
    - apps/api/src/modules/ticket/qr-ticket.service.spec.ts
    - apps/web/e2e/booking-complete-qr.spec.ts
  modified:
    - apps/api/src/modules/auth/email/email.service.ts
    - apps/api/src/modules/reservation/reservation.module.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/web/components/booking/booking-complete.tsx
    - apps/web/components/reservation/reservation-detail.tsx
key-decisions:
  - "New QR tickets sign only with QR_TICKET_SECRET + QR_TICKET_SECRET_VERSION, while verification accepts older tickets through QR_TICKET_SECRET_KEYRING_JSON."
  - "Confirmed reservations issue QR tickets through ReservationService integration, and reservation detail re-ensures issuance if a confirmed record is missing a ticket row."
  - "D-1 QR reminders are queued through pg-boss from QrTicketService instead of adding a separate mail scheduler module."
patterns-established:
  - "Ticket lookup stays authenticated at ticket.controller.ts while BookingComplete and reservation detail consume server read models."
  - "Email reminder scheduling uses showtime - 24h, but clamps to immediate scheduling when the purchase happens inside the last 24 hours."
requirements-completed: [QR-01]
duration: 13 min
completed: 2026-05-08
---

# Phase 24 Plan 13: QR Ticket Issuance Summary

**Confirmed-payment QR issuance with secret-rotation-safe HS256 tokens, D-1 email reminder scheduling, and immediate QR visibility from booking complete and My Page**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-08T17:48:57+09:00
- **Completed:** 2026-05-08T18:02:01+09:00
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added a new `ticket` module with authenticated QR ticket lookup, HS256 token issuance, keyring-based verification, and pg-boss-backed D-1 reminder scheduling.
- Wired confirmed payment and reservation detail flows so QR tickets are issued immediately after success and remain readable from server-side reservation data.
- Promoted `QR 티켓 보기` as the primary booking-complete follow-up and exposed the issued QR artifact directly on My Page reservation detail with D-1 email notice copy.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add QR ticket issuance, status lookup, and D-1 email scheduling**
   - `189a4ef` (`test`)
   - `077c7e6` (`feat`)
2. **Task 2: Surface QR visibility on booking complete and reservation detail**
   - `3c2c407` (`test`)
   - `bb2269c` (`feat`)

## Files Created/Modified

- `apps/api/src/modules/ticket/qr-ticket.service.ts` - QR issuance, secretVersion/keyring verification, pg-boss reminder registration, and authenticated lookup helpers.
- `apps/api/src/modules/ticket/ticket.controller.ts` / `ticket.module.ts` - Authenticated reservation QR lookup endpoint and runtime module wiring.
- `apps/api/src/modules/auth/email/email.service.ts` - Added QR reminder email delivery using the existing Resend retry/error-reporting pattern.
- `apps/api/src/modules/reservation/reservation.service.ts` / `reservation.module.ts` - Minimal runtime integration so confirmed payments issue QR tickets immediately and reservation detail returns live QR data.
- `apps/web/components/booking/booking-complete.tsx` - Booking success reassurance card, D-1 reminder copy, and `QR 티켓 보기` primary CTA.
- `apps/web/components/reservation/reservation-detail.tsx` - Immediate QR ticket section with status, JTI, token payload, and reminder notice.
- `apps/web/e2e/booking-complete-qr.spec.ts` - Browser coverage for booking-complete QR CTA and reservation-detail QR visibility.

## Decisions Made

- Reused `@nestjs/jwt` with per-ticket secret lookup instead of introducing a separate JOSE stack, because Phase 24 only needs HS256 signing/verification plus secret rotation awareness.
- Kept QR reminder worker logic inside `QrTicketService` so Plan 24-11's pg-boss runtime is reused without broadening the jobs surface with another dedicated module.
- Used the existing reservation detail response as the UI read model, but backed it with QR self-healing issuance so the frontend never relies on client-only assumptions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added minimal reservation wiring outside the listed ownership files**
- **Found during:** Task 1
- **Issue:** QR issuance could not occur after confirmed payment, and My Page could not return live QR data, without integrating the new ticket service into the existing reservation confirm/detail flow.
- **Fix:** Added minimal `ReservationModule` import wiring and `ReservationService` integration only for confirmed-payment issuance and reservation-detail QR hydration.
- **Files modified:** `apps/api/src/modules/reservation/reservation.module.ts`, `apps/api/src/modules/reservation/reservation.service.ts`
- **Verification:** `pnpm --filter @grabit/api test -- src/modules/ticket/qr-ticket.service.spec.ts`, `pnpm --filter @grabit/api typecheck`
- **Committed in:** `077c7e6`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation was required for runtime correctness. Scope stayed limited to the minimum reservation integration needed to make QR issuance real.

## Issues Encountered

- The repository-local Playwright default command `pnpm --filter @grabit/web test:e2e --grep "booking complete"` reused an unrelated `localhost:3000` Next server from another project (`workspace/fso/notes-app`), producing false `404` results.
- Verification was completed against the same `apps/web` application on the existing `localhost:3100` dev server via an equivalent temporary Playwright config. The QR scenarios passed there.

## User Setup Required

Cloud Run / Secret Manager must provide the QR signing env vars already declared in the plan:

- `QR_TICKET_SECRET`
- `QR_TICKET_SECRET_VERSION`
- `QR_TICKET_SECRET_KEYRING_JSON`

No additional dashboard setup beyond those env bindings was introduced by this plan.

## Next Phase Readiness

- Payment-complete and My Page surfaces can now rely on server-issued `qrTicket` data instead of placeholder values.
- Field scanning and offline validation remain Phase 27 work; this plan stops at issuance, visibility, and D-1 reminder delivery.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: endpoint | `apps/api/src/modules/ticket/ticket.controller.ts` | Adds an authenticated QR ticket lookup endpoint that exposes signed admission artifacts to user surfaces. |

## Self-Check: PASSED

- Verified `.planning/phases/24-traffic-booking-payment-core/24-13-SUMMARY.md` exists.
- Verified task commits `189a4ef`, `077c7e6`, `3c2c407`, and `bb2269c` exist in git history.
