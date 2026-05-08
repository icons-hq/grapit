# Phase 24: Traffic + Booking + Payment Core - Pattern Map

**Mapped:** 2026-05-08
**Files analyzed:** 24
**Analogs found:** 22 / 24

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/src/modules/queue/queue.module.ts` | module | request-response | `apps/api/src/modules/booking/booking.module.ts` | role-match |
| `apps/api/src/modules/queue/queue.controller.ts` | controller | request-response | `apps/api/src/modules/booking/booking.controller.ts` | role-match |
| `apps/api/src/modules/queue/queue.service.ts` | service | event-driven | `apps/api/src/modules/booking/booking.service.ts` | partial |
| `apps/api/src/modules/queue/queue.gateway.ts` | gateway | streaming | `apps/api/src/modules/booking/booking.gateway.ts` | exact |
| `apps/api/src/modules/queue/guards/admission.guard.ts` | guard | request-response | `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` | role-match |
| `apps/api/src/modules/booking/booking.controller.ts` | controller | request-response | `apps/api/src/modules/booking/booking.controller.ts` | exact |
| `apps/api/src/modules/booking/booking.service.ts` | service | CRUD | `apps/api/src/modules/booking/booking.service.ts` | exact |
| `apps/api/src/modules/reservation/reservation.service.ts` | service | request-response | `apps/api/src/modules/reservation/reservation.service.ts` | exact |
| `apps/api/src/modules/payment/toss-payments.client.ts` | service | request-response | `apps/api/src/modules/payment/toss-payments.client.ts` | exact |
| `apps/api/src/modules/payment/payment.service.ts` | service | CRUD | `apps/api/src/modules/payment/payment.service.ts` | exact |
| `apps/api/src/modules/payment/payment-webhook.controller.ts` | controller | event-driven | `apps/api/src/modules/reservation/reservation.controller.ts` | partial |
| `apps/api/src/modules/refund/refund.service.ts` | service | state-machine | `apps/api/src/modules/reservation/reservation.service.ts` | partial |
| `apps/api/src/modules/jobs/jobs.module.ts` | module | batch | `apps/api/src/modules/reservation/reservation.module.ts` | role-match |
| `apps/api/src/database/schema/seat-maps.ts` | model | CRUD | `apps/api/src/database/schema/seat-maps.ts` | exact |
| `apps/api/src/database/schema/seat-inventories.ts` | model | CRUD | `apps/api/src/database/schema/seat-inventories.ts` | exact |
| `apps/api/src/database/schema/reservations.ts` | model | CRUD | `apps/api/src/database/schema/reservations.ts` | exact |
| `apps/api/src/database/schema/payments.ts` | model | CRUD | `apps/api/src/database/schema/payments.ts` | exact |
| `apps/api/src/database/schema/refunds.ts` | model | state-machine | `apps/api/src/database/schema/payments.ts` | role-match |
| `apps/api/src/database/migrations/00xx_phase24_*.sql` | migration | batch | `apps/api/src/database/migrations/0007_phase23_launch_foundation.sql` | role-match |
| `apps/web/stores/use-booking-store.ts` | store | event-driven | `apps/web/stores/use-booking-store.ts` | exact |
| `apps/web/components/booking/seat-map-viewer.tsx` | component | transform | `apps/web/components/booking/seat-map-viewer.tsx` | exact |
| `apps/web/components/booking/booking-page.tsx` | component | request-response | `apps/web/components/booking/booking-page.tsx` | exact |
| `apps/web/components/booking/toss-payment-widget.tsx` | component | request-response | `apps/web/components/booking/toss-payment-widget.tsx` | exact |
| `apps/web/app/booking/[performanceId]/confirm/page.tsx` | route | request-response | `apps/web/app/booking/[performanceId]/confirm/page.tsx` | exact |
| `apps/web/app/booking/[performanceId]/complete/page.tsx` | route | request-response | `apps/web/app/booking/[performanceId]/complete/page.tsx` | exact |
| `apps/web/components/reservation/reservation-detail.tsx` | component | state-machine | `apps/web/components/reservation/reservation-detail.tsx` | exact |
| `apps/web/components/reservation/cancel-confirm-modal.tsx` | component | request-response | `apps/web/components/reservation/cancel-confirm-modal.tsx` | exact |
| `apps/api/src/modules/admin/admin.service.ts` | service | CRUD | `apps/api/src/modules/admin/admin.service.ts` | exact |
| `apps/api/src/modules/admin/upload.service.ts` | service | file-I/O | `apps/api/src/modules/admin/upload.service.ts` | exact |
| `apps/api/src/modules/auth/email/email.service.ts` | service | batch | `apps/api/src/modules/auth/email/email.service.ts` | exact |
| `apps/api/src/modules/booking/__tests__/booking.service.spec.ts` | test | transform | `apps/api/src/modules/booking/__tests__/booking.service.spec.ts` | exact |
| `apps/api/src/modules/reservation/reservation.service.spec.ts` | test | request-response | `apps/api/src/modules/reservation/reservation.service.spec.ts` | exact |

## Pattern Assignments

### `apps/api/src/modules/queue/queue.service.ts` (service, event-driven)

**Analog:** `apps/api/src/modules/booking/booking.service.ts`

**Imports pattern** (lines 1-10):
```ts
import { Injectable, Inject, ConflictException } from '@nestjs/common';
import type IORedis from 'ioredis';
import { eq, and } from 'drizzle-orm';
import { REDIS_CLIENT } from './providers/redis.provider.js';
import { DRIZZLE } from '../../database/drizzle.provider.js';
```

**Valkey/Lua core pattern** (lines 40-65, 118-132, 145-165):
```ts
const LOCK_SEAT_LUA = `...`;
export const ASSERT_OWNED_SEAT_LOCKS_LUA = `...`;
export const CONSUME_OWNED_SEAT_LOCKS_LUA = `...`;
```

**Service eval call pattern** (lines 255-271):
```ts
const result = (await this.redis.eval(
  LOCK_SEAT_LUA,
  3,
  userSeatsKey,
  lockKey,
  lockedSeatsKey,
  userId,
  String(LOCK_TTL),
  String(MAX_SEATS),
  seatId,
  keyPrefix,
)) as [number, string, string?];
```

### `apps/api/src/modules/queue/queue.gateway.ts` (gateway, streaming)

**Analog:** `apps/api/src/modules/booking/booking.gateway.ts`

**Gateway/CORS/namespace pattern** (lines 14-35):
```ts
@WebSocketGateway({
  namespace: '/booking',
  cors: { origin: (origin, callback) => { ... }, credentials: true },
})
```

**Room join + validation pattern** (lines 51-66):
```ts
@SubscribeMessage('join-showtime')
handleJoinShowtime(@ConnectedSocket() client: Socket, @MessageBody() showtimeId: string) { ... }
```

**Broadcast pattern** (lines 80-86):
```ts
this.server.to(`showtime:${showtimeId}`).emit('seat-update', { seatId, status, userId });
```

### `apps/api/src/modules/queue/queue.controller.ts` + `guards/admission.guard.ts`

**Analog:** `apps/api/src/modules/booking/booking.controller.ts`, `apps/api/src/modules/auth/guards/jwt-auth.guard.ts`

**Controller + ZodValidationPipe pattern** (booking.controller lines 26-35):
```ts
@Post('seats/lock')
async lockSeat(@Body(new ZodValidationPipe(lockSeatSchema)) body: LockSeatBody, @Req() req: Request) {
  const user = req.user as { id: string };
  return this.bookingService.lockSeat(user.id, body.showtimeId, body.seatId);
}
```

**Public endpoint marker pattern** (booking.controller lines 83-87):
```ts
@Public()
@Get('schedules/:showtimeId/seats')
```

**Guard bypass pattern** (`jwt-auth.guard.ts` lines 12-23):
```ts
const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [...]);
if (isPublic) return true;
return super.canActivate(context);
```

### `apps/api/src/modules/reservation/reservation.service.ts` (service, request-response)

**Analog:** `apps/api/src/modules/reservation/reservation.service.ts`

**Dependency injection pattern** (lines 47-54):
```ts
constructor(
  @Inject(DRIZZLE) private readonly db: DrizzleDB,
  private readonly tossClient: TossPaymentsClient,
  private readonly bookingService: BookingService,
  private readonly bookingGateway: BookingGateway,
  private readonly featureFlags: FeatureFlagsService,
  private readonly consentService: ConsentService,
) {}
```

**Feature-flag + validation + idempotency pattern** (lines 223-250):
```ts
this.featureFlags.assertBookingEnabled();
await this.assertBookingConsent(...);
const [existing] = await this.db.select(...).from(reservations).where(...);
if (existing && existing.status !== 'PENDING_PAYMENT') { throw new ConflictException(...); }
```

**Transaction pattern** (lines 314-353):
```ts
const result = await this.db.transaction(async (tx) => {
  const [reservation] = await tx.insert(reservations).values(...).returning();
  await tx.insert(reservationSeats).values(...);
  await this.consentService.captureConsent(..., tx);
  return reservation!;
});
```

### `apps/api/src/modules/payment/*` (service/client/controller family)

**Analog:** `toss-payments.client.ts`, `payment.service.ts`, `reservation.controller.ts`

**External API client pattern** (`toss-payments.client.ts` lines 46-67):
```ts
const response = await fetch(`${this.baseUrl}/payments/confirm`, { method: 'POST', headers: {...}, body: JSON.stringify(...) });
const data: unknown = await response.json();
if (!response.ok) throw new TossPaymentError(...);
```

**Read model service pattern** (`payment.service.ts` lines 13-30):
```ts
const [payment] = await this.db.select().from(payments).where(eq(payments.reservationId, reservationId));
if (!payment) return null;
return { paymentKey: payment.paymentKey, method: payment.method, ... };
```

**Webhook controller recommendation pattern:** `reservation.controller.ts`와 동일한 `Controller + schema validation + service delegation` 형태 유지.

### `apps/api/src/database/schema/*` + migration

**Analog:** `seat-maps.ts`, `seat-inventories.ts`, `reservations.ts`, `payments.ts`, `0007_phase23_launch_foundation.sql`

**Drizzle schema pattern** (`seat-maps.ts` lines 4-13):
```ts
export const seatMaps = pgTable('seat_maps', { ... }, (table) => [
  uniqueIndex('idx_seat_maps_performance_id').on(table.performanceId),
]);
```

**Enum + index pattern** (`reservations.ts` lines 5-28):
```ts
export const reservationStatusEnum = pgEnum('reservation_status', [...]);
...
index('idx_reservations_status').on(table.status),
```

**SQL migration style pattern** (`0007_phase23_launch_foundation.sql` lines 1-108):
```sql
CREATE TYPE ...;--> statement-breakpoint
CREATE TABLE ...;--> statement-breakpoint
ALTER TABLE ...;--> statement-breakpoint
CREATE INDEX ...;--> statement-breakpoint
```

### `apps/web/stores/use-booking-store.ts` (store, event-driven)

**Analog:** `apps/web/stores/use-booking-store.ts`

**Zustand state/action pattern** (lines 6-42, 59-108):
```ts
interface BookingState { ...; addSeat: (seat: SeatSelection) => void; ... }
export const useBookingStore = create<BookingState>((set) => ({ ...initialState, addSeat: (seat) => set(...)}));
```

### `apps/web/components/booking/seat-map-viewer.tsx` (component, transform)

**Analog:** `apps/web/components/booking/seat-map-viewer.tsx`

**SVG fetch + sanitize + parse pattern** (lines 122-157):
```ts
fetch(svgUrl).then((res) => res.text())...
const parser = new DOMParser();
const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
sanitizeParsedSvg(doc);
```

**Seat state painting pattern** (lines 173-229):
```ts
if (state === 'locked' || state === 'sold') { ... }
else if (showCheckmark && tierInfo) { ... }
else if (tierInfo) { ... }
```

### `apps/web/components/booking/booking-page.tsx` (component, request-response)

**Analog:** `apps/web/components/booking/booking-page.tsx`

**Hook composition pattern** (lines 9-20, 69-75):
```ts
usePerformanceDetail(...)
useSeatStatus(...)
useMyLocks(...)
useRuntimeFlags()
```

**Optimistic lock mutation pattern** (lines 243-270):
```ts
addSeat(seatSelection);
lockSeat.mutate(..., { onSuccess: ..., onError: (...) => { removeSeat(seatId); ... } });
```

### `apps/web/components/booking/toss-payment-widget.tsx` + confirm/complete page

**Analog:** `toss-payment-widget.tsx`, `confirm/page.tsx`, `complete/page.tsx`

**Widget init/render/request pattern** (`toss-payment-widget.tsx` lines 73-107, 48-56):
```ts
const tossPayments = await loadTossPayments(clientKey);
const w = tossPayments.widgets({ customerKey });
await w.renderPaymentMethods(...); await w.renderAgreement(...);
await widgets.requestPayment({ orderId, orderName, successUrl, failUrl, ... });
```

**Prepare-before-payment pattern** (`confirm/page.tsx` lines 154-172):
```ts
const result = await prepareMutation.mutateAsync({ orderId, showtimeId, seats, amount, consentItems: [...] });
await paymentWidgetRef.current.requestPayment();
```

**Complete-page recovery/idempotent UX pattern** (`complete/page.tsx` lines 57-78, 80-117):
```ts
const { data: recoveredReservation } = useReservationByOrderId(...);
const result = await confirmMutation.mutateAsync({ paymentKey, orderId, amount });
```

### `apps/api/src/modules/admin/*` (admin upload/service patterns)

**Analog:** `admin.service.ts`, `upload.service.ts`

**Admin transaction/upsert pattern** (`admin.service.ts` lines 52-65, 297-313):
```ts
await tx.insert(venues)...onConflictDoUpdate(...).returning();
await this.db.insert(seatMaps).values(...).onConflictDoUpdate({ target: seatMaps.performanceId, set: {...} }).returning();
```

**Upload service dual-mode file I/O pattern** (`upload.service.ts` lines 22-39, 51-88, 113-119):
```ts
this.isLocalMode = !accountId;
new S3Client({ endpoint: `https://${accountId}.r2.cloudflarestorage.com`, ... });
validateLocalPath(...) // path traversal guard
```

### `apps/api/src/modules/auth/email/email.service.ts` (email, batch)

**Analog:** `apps/api/src/modules/auth/email/email.service.ts`

**Retry/error monitoring pattern** (lines 23-27, 85-129, 151-193):
```ts
const MAX_SEND_ATTEMPTS = 3;
for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) { ... }
Sentry.captureException(new Error(...));
```

### Test layout

**Analog:** `apps/api/src/modules/booking/__tests__/booking.service.spec.ts`, `apps/api/src/modules/reservation/reservation.service.spec.ts`

**Vitest mock-factory pattern** (booking spec lines 18-47, reservation spec lines 19-26):
```ts
function createMockRedis() { return { set: vi.fn(), ... }; }
function createMockDb() { return { select: vi.fn(), transaction: vi.fn(), ... }; }
```

**Domain scenario grouping pattern** (booking spec lines 95+, reservation spec lines 106+):
```ts
describe('lockSeat', () => { ... })
describe('ReservationService', () => { ... })
```

## Shared Patterns

### Authentication / Guard Chain
**Source:** `apps/api/src/app.module.ts:66`, `apps/api/src/modules/auth/guards/jwt-auth.guard.ts:12`  
**Apply to:** queue admission guard + booking/payment mutation endpoints
```ts
providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
]
```

### Validation (Zod end-to-end)
**Source:** `apps/api/src/modules/reservation/reservation.controller.ts:33`, `packages/shared/src/schemas/booking.schema.ts:12`  
**Apply to:** queue DTO, payment webhook DTO, refund DTO
```ts
@Body(new ZodValidationPipe(prepareReservationSchema)) body: PrepareReservationInput
```

### Feature Flag Gate
**Source:** `apps/api/src/modules/booking/booking.service.ts:237`, `apps/api/src/modules/reservation/reservation.service.ts:223`  
**Apply to:** queue admission-protected booking core methods
```ts
this.featureFlags.assertBookingEnabled();
```

### Real-time seat/queue updates
**Source:** `apps/api/src/modules/booking/booking.gateway.ts:80`, `apps/web/hooks/use-booking.ts:28`  
**Apply to:** queue position stream, seat status stream
```ts
this.server.to(`showtime:${showtimeId}`).emit('seat-update', payload);
```

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/api/src/modules/queue/queue.service.ts` (batch admission with ZSET ETA) | service | streaming | 현재 코드베이스에는 Sorted Set 기반 대기열/ETA 계산 구현이 없음 |
| `apps/api/src/modules/jobs/pgboss.provider.ts` | provider | batch | 현재 코드베이스에 `pg-boss` provider/worker 패턴이 아직 없음 |

## Metadata

**Analog search scope:** `apps/api/src/modules`, `apps/api/src/database/schema`, `apps/api/src/database/migrations`, `apps/web/components`, `apps/web/app/booking`, `apps/web/hooks`, `apps/web/stores`, `packages/shared/src`  
**Files scanned:** 35+  
**Pattern extraction date:** 2026-05-08
