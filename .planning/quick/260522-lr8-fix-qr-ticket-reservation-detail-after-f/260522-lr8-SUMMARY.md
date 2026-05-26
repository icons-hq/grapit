---
status: complete
quick_id: 260522-lr8
slug: fix-qr-ticket-reservation-detail-after-f
completed: 2026-05-22
commit: d2ddd1de
---

# Quick Task 260522-lr8 Summary

## Result

Fixed the QR ticket read path so customer reservation detail remains readable after field staff consume the QR ticket.

## Changes

- Added `QrTicketService.getOrIssueTicketForReservation()` for reservation detail reads. It self-heals missing tickets, but returns existing `USED`, `REVOKED`, or `EXPIRED` ticket snapshots without throwing an active-only 409.
- Changed `ReservationService.getReservationDetail()` to use the read-safe QR path.
- Split scanner token parsing from active-ticket validation so valid re-scans can report persisted `USED` state instead of being collapsed into `tampered`.
- Stopped exposing reusable QR token/JTI values in customer QR payloads once the ticket is no longer active.
- Added regression coverage for used QR detail reads and used scanner contract state.

## Verification

- `pnpm --filter @grabit/api test -- qr-ticket.service.spec.ts` passed. Current script executed the API unit suite: 77 files, 773 tests.
- `pnpm --filter @grabit/api test -- reservation.service.spec.ts` passed. Current script executed the API unit suite: 77 files, 773 tests.
- `pnpm --filter @grabit/api typecheck` passed.
- `pnpm --filter @grabit/api lint` passed with existing warnings only.
