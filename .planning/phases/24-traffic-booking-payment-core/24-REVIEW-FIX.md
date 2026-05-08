---
phase: 24
fixed_at: 2026-05-08T10:01:24Z
review_path: .planning/phases/24-traffic-booking-payment-core/24-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 24: Code Review Fix Report

**Fixed at:** 2026-05-08T10:01:24Z
**Source review:** .planning/phases/24-traffic-booking-payment-core/24-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: Toss webhook route is blocked by global JWT and lacks provider authentication

**Files modified:** `apps/api/src/modules/payment/payment-webhook.controller.ts`, `apps/api/src/modules/payment/payment.module.ts`, `apps/api/src/modules/payment/toss-webhook.guard.ts`, `apps/api/src/modules/payment/toss-webhook.guard.spec.ts`, `apps/api/src/modules/payment/toss-webhook.controller.spec.ts`, `.env.example`
**Commit:** 899868a
**Applied fix:** Added a public webhook route guarded by `TossWebhookGuard`, fail-closed secret validation, module wiring, env documentation, and focused webhook auth tests.

### CR-02: async DONE webhook does not finalize reservation/seat/ticket state

**Files modified:** `apps/api/src/modules/payment/payment.service.ts`, `apps/api/src/modules/payment/payment.module.ts`, `apps/api/src/modules/payment/payment.service.spec.ts`, `apps/api/src/modules/payment/payment-webhook.controller.ts`, `apps/api/src/modules/payment/toss-webhook.controller.spec.ts`
**Commits:** 04a018b, 3236427
**Applied fix:** `DONE` webhooks now finalize the reservation, payment, sold seat state, websocket broadcast, and QR ticket issuance. A follow-up commit fixed the non-DONE webhook `paidAt` narrowing caught by build.
**Status:** fixed: requires human verification

### CR-03: webhook-created DONE payments can bypass amount consistency checks

**Files modified:** `apps/api/src/modules/reservation/reservation.service.ts`, `apps/api/src/modules/reservation/reservation.service.spec.ts`, `apps/api/src/modules/payment/payment.service.spec.ts`
**Commit:** 01806fa
**Applied fix:** Existing `DONE` payment rows are revalidated against reservation id, payment key, Toss order id, and amount before reservation confirmation can reuse them.
**Status:** fixed: requires human verification

### CR-04: held_cancelled seats are lockable/displayed available

**Files modified:** `apps/api/src/modules/booking/booking.service.ts`, `apps/api/src/modules/booking/__tests__/booking.service.spec.ts`, `apps/api/src/modules/booking/__tests__/dto.spec.ts`
**Commit:** 3c5fabd
**Applied fix:** `held_cancelled` seats are blocked in lock acquisition and surfaced as held instead of available in seat status responses.
**Status:** fixed: requires human verification

### CR-05: admin refund bypasses refund ledger and delayed seat release

**Files modified:** `apps/api/src/modules/admin/admin-booking.service.ts`, `apps/api/src/modules/admin/admin-booking.controller.ts`, `apps/api/src/modules/admin/admin.module.ts`, `apps/api/src/modules/admin/admin-booking.service.spec.ts`, `apps/api/src/modules/refund/refund.service.ts`, `apps/api/src/modules/refund/refund.service.spec.ts`, `apps/api/src/database/schema/booking-operation-audit-logs.ts`, `apps/api/src/database/schema/phase24-booking-core.schema.spec.ts`, `apps/api/src/database/migrations/0012_phase24_booking_core.sql`, `apps/api/src/database/migrations/meta/0012_snapshot.json`
**Commit:** 057ca09
**Applied fix:** Admin refunds now delegate to `RefundService.requestAdminRefund`, preserve refund ledger orchestration, hold cancelled seats for delayed release, and write immutable `admin_refund` audit rows.
**Status:** fixed: requires human verification

### WR-01: QR verify ignores ticket DB status/expiry/usedAt

**Files modified:** `apps/api/src/modules/ticket/qr-ticket.service.ts`, `apps/api/src/modules/ticket/qr-ticket.service.spec.ts`
**Commit:** 9ed9e11
**Applied fix:** QR token verification now rechecks persisted ticket identity, active status, `usedAt`, `revokedAt`, and `expiresAt` after JWT verification.
**Status:** fixed: requires human verification

### WR-02: seat_key nullable weakens uniqueness

**Files modified:** `apps/api/src/database/schema/seat-inventories.ts`, `apps/api/src/database/schema/phase24-booking-core.schema.spec.ts`, `apps/api/src/database/migrations/0012_phase24_booking_core.sql`, `apps/api/src/database/migrations/meta/0012_snapshot.json`
**Commit:** ad1479e
**Applied fix:** `seat_key` is now non-null in Drizzle schema and migration metadata, with migration backfill before `ALTER COLUMN ... SET NOT NULL`.
**Status:** fixed: requires human verification

## Skipped Issues

None.

## Verification

- `pnpm --filter @grabit/api test -- toss-webhook` - passed
- `pnpm --filter @grabit/api test -- modules/payment` - passed
- `pnpm --filter @grabit/api test -- modules/payment/payment.service.spec.ts modules/reservation/reservation.service.spec.ts` - passed
- `pnpm --filter @grabit/api test -- modules/booking/__tests__/booking.service.spec.ts modules/booking/__tests__/dto.spec.ts` - passed
- `pnpm --filter @grabit/api test -- modules/admin/admin-booking.service.spec.ts modules/refund/refund.service.spec.ts database/schema/phase24-booking-core.schema.spec.ts` - passed
- `pnpm --filter @grabit/api test -- modules/ticket/qr-ticket.service.spec.ts` - passed
- `pnpm --filter @grabit/api test -- database/schema/phase24-booking-core.schema.spec.ts modules/booking/__tests__/booking.service.spec.ts modules/reservation/reservation.service.spec.ts` - passed
- `pnpm --filter @grabit/api test` - passed, 53 files / 578 tests
- `pnpm build` - passed, 3 packages

---

_Fixed: 2026-05-08T10:01:24Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
