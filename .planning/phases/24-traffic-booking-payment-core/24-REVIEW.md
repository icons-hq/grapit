---
phase: 24-traffic-booking-payment-core
reviewed: 2026-05-08T09:32:11Z
depth: standard
files_reviewed: 106
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/app.module.ts
  - apps/api/src/database/migrations/0012_phase24_booking_core.sql
  - apps/api/src/database/migrations/meta/0012_snapshot.json
  - apps/api/src/database/migrations/meta/_journal.json
  - apps/api/src/database/schema/booking-operation-audit-logs.ts
  - apps/api/src/database/schema/booking-policies.ts
  - apps/api/src/database/schema/index.ts
  - apps/api/src/database/schema/payment-webhook-events.ts
  - apps/api/src/database/schema/payments.ts
  - apps/api/src/database/schema/phase24-booking-core.schema.spec.ts
  - apps/api/src/database/schema/refunds.ts
  - apps/api/src/database/schema/reservations.ts
  - apps/api/src/database/schema/seat-inventories.ts
  - apps/api/src/database/schema/seat-maps.ts
  - apps/api/src/database/schema/tickets.ts
  - apps/api/src/modules/admin/admin-booking.controller.ts
  - apps/api/src/modules/admin/admin-booking.service.spec.ts
  - apps/api/src/modules/admin/admin-booking.service.ts
  - apps/api/src/modules/admin/admin-performance.controller.ts
  - apps/api/src/modules/admin/admin.service.spec.ts
  - apps/api/src/modules/admin/admin.service.ts
  - apps/api/src/modules/auth/email/email.service.ts
  - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
  - apps/api/src/modules/booking/booking.controller.ts
  - apps/api/src/modules/booking/booking.service.ts
  - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
  - apps/api/src/modules/booking/providers/redis.provider.ts
  - apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts
  - apps/api/src/modules/jobs/cancelled-seat-release.worker.ts
  - apps/api/src/modules/jobs/jobs.module.ts
  - apps/api/src/modules/jobs/pgboss.provider.ts
  - apps/api/src/modules/jobs/refund-cancel-retry.worker.spec.ts
  - apps/api/src/modules/jobs/refund-cancel-retry.worker.ts
  - apps/api/src/modules/ops/prewarm.controller.ts
  - apps/api/src/modules/ops/prewarm.module.ts
  - apps/api/src/modules/ops/prewarm.service.spec.ts
  - apps/api/src/modules/ops/prewarm.service.ts
  - apps/api/src/modules/payment/payment-webhook.controller.ts
  - apps/api/src/modules/payment/payment.controller.ts
  - apps/api/src/modules/payment/payment.module.ts
  - apps/api/src/modules/payment/payment.service.spec.ts
  - apps/api/src/modules/payment/payment.service.ts
  - apps/api/src/modules/payment/toss-webhook.controller.spec.ts
  - apps/api/src/modules/performance/performance.service.spec.ts
  - apps/api/src/modules/performance/performance.service.ts
  - apps/api/src/modules/queue/guards/admission.guard.ts
  - apps/api/src/modules/queue/queue.controller.ts
  - apps/api/src/modules/queue/queue.gateway.ts
  - apps/api/src/modules/queue/queue.guard.spec.ts
  - apps/api/src/modules/queue/queue.module.ts
  - apps/api/src/modules/queue/queue.service.spec.ts
  - apps/api/src/modules/queue/queue.service.ts
  - apps/api/src/modules/refund/refund.controller.ts
  - apps/api/src/modules/refund/refund.module.ts
  - apps/api/src/modules/refund/refund.service.spec.ts
  - apps/api/src/modules/refund/refund.service.ts
  - apps/api/src/modules/reservation/reservation.controller.ts
  - apps/api/src/modules/reservation/reservation.module.ts
  - apps/api/src/modules/reservation/reservation.service.spec.ts
  - apps/api/src/modules/reservation/reservation.service.ts
  - apps/api/src/modules/ticket/qr-ticket.service.spec.ts
  - apps/api/src/modules/ticket/qr-ticket.service.ts
  - apps/api/src/modules/ticket/ticket.controller.ts
  - apps/api/src/modules/ticket/ticket.module.ts
  - apps/api/src/modules/traffic/traffic-defense.service.spec.ts
  - apps/api/src/modules/traffic/traffic-defense.service.ts
  - apps/api/src/modules/traffic/traffic.module.ts
  - apps/web/app/booking/[performanceId]/complete/page.tsx
  - apps/web/app/booking/[performanceId]/confirm/page.tsx
  - apps/web/app/booking/[performanceId]/page.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx
  - apps/web/components/admin/__tests__/floor-seat-map-editor.test.tsx
  - apps/web/components/admin/floor-seat-map-editor.tsx
  - apps/web/components/admin/performance-form.tsx
  - apps/web/components/admin/svg-preview.tsx
  - apps/web/components/booking/__tests__/floor-selector.test.tsx
  - apps/web/components/booking/booking-complete.tsx
  - apps/web/components/booking/booking-page.tsx
  - apps/web/components/booking/floor-selector.tsx
  - apps/web/components/booking/payment-deadline-banner.tsx
  - apps/web/components/booking/queue-waiting.tsx
  - apps/web/components/booking/toss-payment-widget.tsx
  - apps/web/components/reservation/__tests__/refund-timeline.test.tsx
  - apps/web/components/reservation/cancel-confirm-modal.tsx
  - apps/web/components/reservation/refund-timeline.tsx
  - apps/web/components/reservation/reservation-detail.tsx
  - apps/web/e2e/booking-complete-qr.spec.ts
  - apps/web/e2e/booking-queue.spec.ts
  - apps/web/e2e/toss-payment-phase24.spec.ts
  - apps/web/hooks/__tests__/use-booking.test.tsx
  - apps/web/hooks/__tests__/use-queue.test.tsx
  - apps/web/hooks/use-admin.ts
  - apps/web/hooks/use-booking.ts
  - apps/web/hooks/use-queue.ts
  - apps/web/messages/en.json
  - apps/web/messages/ko.json
  - apps/web/messages/th.json
  - apps/web/messages/zh-CN.json
  - apps/web/messages/zh-TW.json
  - apps/web/stores/use-booking-store.ts
  - docs/runbooks/phase24-queue-waf-prewarm.md
  - packages/shared/src/schemas/performance.schema.test.ts
  - packages/shared/src/schemas/performance.schema.ts
  - packages/shared/src/types/performance.types.ts
findings:
  critical: 5
  warning: 2
  info: 0
  total: 7
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-05-08T09:32:11Z
**Depth:** standard
**Files Reviewed:** 106
**Status:** issues_found

## Summary

Phase 24의 booking, payment, refund, queue, ticket, seat-map 관련 source/test/migration/docs 범위를 표준 깊이로 검토했다. `pnpm-lock.yaml`은 lock file이므로 리뷰 범위에서 제외했다. 빌드와 단위 테스트가 통과했다는 사실과 별개로, 실제 결제 webhook, 비동기 결제 완료, 환불 후 좌석 상태, 관리자 환불 경로에서 사용자 결제/좌석 데이터 정합성을 깨는 blocker가 발견됐다.

## Critical Issues

### CR-01: Toss webhook endpoint is blocked by global JWT auth and has no provider authentication

**Classification:** BLOCKER
**File:** `apps/api/src/modules/payment/payment-webhook.controller.ts:50`
**Issue:** `POST /payments/toss/webhook`에는 `@Public()`이나 provider 전용 guard가 없다. 전역 `JwtAuthGuard`는 `apps/api/src/app.module.ts:87`에서 모든 route에 적용되고, `apps/api/src/modules/auth/guards/jwt-auth.guard.ts:12`는 `@Public()` metadata가 없으면 JWT를 요구한다. 따라서 Toss가 보내는 webhook은 controller에 도달하지 못한다. 반대로 단순히 `@Public()`만 추가하면 현재 controller에는 Toss signature/shared secret 검증도 없어 spoofed webhook을 받을 수 있다.
**Fix:**
```ts
@Public()
@UseGuards(TossWebhookGuard)
@Post('webhook')
async handleTossWebhook(...) {
  ...
}
```
`TossWebhookGuard` 또는 equivalent verifier에서 Toss가 제공하는 webhook signature/shared secret/header를 검증하고, 전역 JWT guard를 우회한 정상 webhook은 2xx로 처리되고 잘못된 provider auth는 거부되는 integration test를 추가한다.

### CR-02: Async DONE webhook never confirms reservations or issues tickets

**Classification:** BLOCKER
**File:** `apps/api/src/modules/payment/payment.service.ts:233`
**Issue:** `PAYMENT_STATUS_CHANGED` webhook은 `apps/api/src/modules/payment/payment-webhook.controller.ts:127`에서 `upsertAsyncPaymentProgress()`만 호출한다. 이 service는 `payments` row를 upsert하고 실패 계열 상태일 때만 reservation을 `FAILED`로 바꾸며(`apps/api/src/modules/payment/payment.service.ts:297`), `DONE` 상태에서는 reservation을 `CONFIRMED`로 변경하지 않고 seat inventory를 `sold`로 만들지도 않으며 QR ticket도 발급하지 않는다. Web return path도 `pending=true`이면 confirm mutation을 건너뛰기 때문에(`apps/web/app/booking/[performanceId]/complete/page.tsx:185`), `apps/web/hooks/use-booking.ts:337`의 polling은 계속 `PENDING_PAYMENT`를 보다가 만료 처리될 수 있다.
**Fix:** 동기 confirm 경로와 webhook `DONE` 경로가 공유하는 finalization method를 만든다. Provider-authenticated `DONE` webhook 처리 시 transaction 안에서 payment/order/amount를 검증하고, reservation을 `CONFIRMED`로 전환하며, 관련 seat inventory를 `sold`로 업데이트하고, QR ticket 발급과 websocket broadcast까지 수행하도록 한다. 비동기 결제 완료 e2e 또는 service integration test도 추가한다.

### CR-03: Webhook-created DONE payments can bypass amount consistency checks

**Classification:** BLOCKER
**File:** `apps/api/src/modules/payment/payment.service.ts:265`
**Issue:** webhook 처리에서 `payload.data.totalAmount ?? reservation.totalAmount`를 그대로 payment amount로 저장하고, reservation 금액과 같은지 검증하지 않는다. 이후 redirect confirm 경로는 URL의 `dto.amount`만 reservation 금액과 비교한다(`apps/api/src/modules/reservation/reservation.service.ts:748`). 이미 webhook이 만든 `existingPayment.status === 'DONE'`이면 `existingPayment.amount`를 승인 금액으로 신뢰하고(`apps/api/src/modules/reservation/reservation.service.ts:764`), reservation 금액과 기존 payment amount를 다시 비교하지 않는다. 결과적으로 underpaid/mismatched `DONE` payment row가 존재하면 사용자는 정상 금액 query로 confirm을 호출해 reservation을 확정할 수 있고 payment record에는 다른 금액이 남는다.
**Fix:** webhook `DONE` 처리 전에 `payload.data.totalAmount === reservation.totalAmount`를 강제하고, 불일치 시 payment를 `DONE`으로 저장하지 말고 실패/수동검토 상태로 남긴다. confirm 경로에서도 `existingPayment.status === 'DONE'`일 때 `existingPayment.amount`, `paymentKey`, `orderId`가 reservation 및 요청값과 모두 일치하는지 재검증한 뒤 finalization을 진행한다.

### CR-04: held_cancelled seats are lockable and displayed as available

**Classification:** BLOCKER
**File:** `apps/api/src/modules/booking/booking.service.ts:289`
**Issue:** refund 성공 경로는 좌석을 `held_cancelled`로 전환하고 지연 release job을 예약한다(`apps/api/src/modules/refund/refund.service.ts:581`). 하지만 `lockSeat()`의 DB 방어 로직은 `status = 'sold'`만 차단한다(`apps/api/src/modules/booking/booking.service.ts:303`). 또한 `getSeatStatus()`도 `sold` 좌석만 조회한다(`apps/api/src/modules/booking/booking.service.ts:562`). 따라서 환불 직후 reopen hold window 안의 좌석이 UI에는 available처럼 보이고, Redis lock도 새로 잡힐 수 있어 delayed reopen/fairness 정책이 무효화된다.
**Fix:** lock 전 DB check에서 `sold`와 `held_cancelled`를 모두 unavailable로 취급한다. seat status API도 `held_cancelled`를 shared `SeatState`의 `held` 같은 unavailable 상태로 반환한다. `held_cancelled` 좌석 lock 시도와 seat map 표시를 검증하는 booking service test를 추가한다.

### CR-05: Admin refund path bypasses the Phase 24 refund ledger and delayed seat release flow

**Classification:** BLOCKER
**File:** `apps/api/src/modules/admin/admin-booking.service.ts:282`
**Issue:** 관리자 환불 endpoint는 `adminBookingService.refundBooking()`으로 직접 Toss cancel을 호출한다(`apps/api/src/modules/admin/admin-booking.controller.ts:43`). 이 경로는 `refunds` ledger를 만들지 않고, retry worker 대상도 아니며, 성공 후 좌석을 즉시 `available`로 되돌린다(`apps/api/src/modules/admin/admin-booking.service.ts:329`). 반면 Phase 24의 `RefundService`는 refund row를 완료 처리하고 seat inventory를 `held_cancelled`로 바꾸며 release job을 예약한다(`apps/api/src/modules/refund/refund.service.ts:520`). 관리자 환불은 같은 도메인 동작인데 새 정합성/감사/재시도 모델을 우회한다.
**Fix:** 관리자 환불도 `RefundService`의 orchestration을 호출하도록 통합하고, operator context만 추가로 audit log에 남긴다. 기존 direct `available` restore 로직은 제거하거나 명시적인 manual-open workflow로만 제한한다. admin refund spec에는 refund ledger 생성, PG cancel retry 대상 여부, `held_cancelled` 전환, release job scheduling을 검증하는 케이스를 추가한다.

## Warnings

### WR-01: QR ticket verification ignores ticket status and expiry stored in the database

**Classification:** WARNING
**File:** `apps/api/src/modules/ticket/qr-ticket.service.ts:190`
**Issue:** `verifyTicketToken()`은 JWT signature와 payload field만 검증하고, `tickets` table의 `status`, `expiresAt`, `usedAt` 같은 server-side state를 조회하지 않는다. 티켓이 취소, 사용, 만료, 폐기되어도 token secret이 유효하면 검증 성공할 수 있다. 현재 공개 scan endpoint가 없더라도 이 method가 입장 검증에 연결되면 취소된 예약의 QR이 계속 유효해지는 correctness/security 문제가 된다.
**Fix:** JWT 검증 후 `jti`, `reservationId`, `paymentId`, `showtimeId`로 ticket row를 조회하고 `status = 'active'`, `expiresAt > now`, `usedAt IS NULL` 같은 server-side 조건을 통과한 경우에만 payload를 반환한다. 취소/만료/사용 완료 ticket token이 거부되는 unit test를 추가한다.

### WR-02: seat_key remains nullable after migration, weakening floor-aware uniqueness for existing rows

**Classification:** WARNING
**File:** `apps/api/src/database/migrations/0012_phase24_booking_core.sql:107`
**Issue:** migration은 `seat_inventories.seat_key`를 nullable로 추가하고(`apps/api/src/database/migrations/0012_phase24_booking_core.sql:107`), 새 unique index를 `(showtime_id, floor_key, seat_key)`에 만든다(`apps/api/src/database/migrations/0012_phase24_booking_core.sql:143`). PostgreSQL unique index는 `NULL`을 서로 다른 값으로 취급하므로 legacy/imported rows가 `seat_key IS NULL`인 상태로 남으면 같은 showtime/floor/seat에 중복 inventory row가 들어갈 수 있다. schema도 nullable로 남아 있다(`apps/api/src/database/schema/seat-inventories.ts:16`). 이후 booking/refund update가 fallback 조건으로 `seat_id`를 사용하면 중복 row가 함께 갱신될 위험이 있다.
**Fix:** migration에서 기존 row를 `seat_key = floor_key || ':' || seat_id`로 backfill한 뒤 `seat_key SET NOT NULL`을 적용하고 unique index를 만든다. legacy fallback이 꼭 필요하다면 partial unique index를 별도로 두어 `seat_key IS NULL` row도 `(showtime_id, floor_key, seat_id)` 기준으로 중복되지 않게 막는다. schema와 snapshot도 non-null invariant에 맞춘다.

---

_Reviewed: 2026-05-08T09:32:11Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
