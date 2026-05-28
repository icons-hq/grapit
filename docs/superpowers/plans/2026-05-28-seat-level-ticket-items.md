# Seat-Level Ticket Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace reservation-level QR/ticket lifecycle with seat-level `Ticket Item` truth, including seat-level QR, field entry, item cancellation, NOL-style fees, controlled reopen, admin views, and settlement exports.

**Architecture:** `ticket_items` becomes the source of truth for each seat-level entitlement. `Reservation` keeps the original payment record and coarse status; `Ticket Item Status`, `Admission State`, `QR Credential Status`, cancellation history, and reopen state live at the item level. Production booking stays closed until the integrated acceptance gates in `docs/adr/0003-use-ticket-items-as-seat-level-ticket-records.md` pass.

**Tech Stack:** Next.js 16, React 19, NestJS 11, Drizzle ORM, PostgreSQL, pnpm, Vitest, Playwright, `packages/shared` Zod contracts.

---

## Source Documents

- `CONTEXT.md`
- `docs/adr/0001-seat-level-qr-credentials.md`
- `docs/adr/0002-use-nol-ticket-cancellation-fee-policy.md`
- `docs/adr/0003-use-ticket-items-as-seat-level-ticket-records.md`

## File Structure

- Create `apps/api/src/database/schema/ticket-items.ts`: Drizzle source of truth for seat-level ticket lifecycle.
- Modify `apps/api/src/database/schema/index.ts`: export `ticketItems` and enums.
- Modify `apps/api/src/database/schema/tickets.ts`: move QR credential ownership from reservation-only to ticket item, while preserving `reservationId`, `paymentId`, and `showtimeId` until ADR 0003 migration cleanup removes legacy reservation-level QR compatibility.
- Modify `apps/api/src/database/schema/ticket-scan-events.ts`: add `ticketItemId` and make duplicate checks item-scoped.
- Create `apps/api/src/database/migrations/0024_ticket_items.sql`: create ticket item schema, backfill from `reservation_seats`, update QR/scan tables.
- Create `packages/shared/src/schemas/ticket-item.schema.ts`: shared ticket item, cancellation, fee, and QR list contracts.
- Modify `packages/shared/src/schemas/booking.schema.ts`: replace single `qrTicket` with `ticketItems`, preserve compatibility only during migration tests.
- Modify `packages/shared/src/index.ts`: export new contracts.
- Create `apps/api/src/modules/ticket/ticket-item-fee-policy.ts`: deterministic NOL-style fee calculation.
- Modify `apps/api/src/modules/reservation/reservation.service.ts`: include per-ticket 2,000 KRW fee in prepare amount and create ticket items.
- Modify `apps/api/src/modules/reservation/reservation-finalization.service.ts`: issue one QR credential per ticket item after payment.
- Modify `apps/api/src/modules/ticket/qr-ticket.service.ts`: issue, verify, rotate, and read QR credentials per ticket item.
- Modify `apps/api/src/modules/field-operations/field-check-in.service.ts`: verify/consume by ticket item.
- Modify `apps/api/src/modules/field-operations/offline-sync.service.ts`: sync pending attempts by ticket item.
- Modify `apps/api/src/modules/refund/refund.service.ts`: add single ticket item cancellation, fee calculation, cancellation history, and controlled reopen.
- Modify `apps/api/src/modules/admin/admin-booking.service.ts`: expose admin ticket item rows.
- Modify `apps/api/src/modules/admin/settlement-export.service.ts`: export item-level rows.
- Modify `apps/web/components/booking/booking-complete.tsx`: render Ticket Item QR cards.
- Modify `apps/web/components/reservation/reservation-detail.tsx`: render Ticket Item QR cards, cancellation history, and item cancellation entry points.
- Modify `apps/web/components/field/scanner-check-in.tsx`: show Seat Identity first and item-scoped status.
- Modify `apps/web/hooks/use-field-operations.ts`: normalize item-level scanner contracts.
- Modify targeted tests under `packages/shared/src`, `apps/api/src/modules`, and `apps/web/components`.

## Task 1: Shared Ticket Item Contracts

**Files:**
- Create: `packages/shared/src/schemas/ticket-item.schema.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schemas/ticket-item.schema.test.ts`

- [ ] **Step 1: Write failing shared contract tests**

Create `packages/shared/src/schemas/ticket-item.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  TICKET_SERVICE_FEE_KRW,
  ticketItemSchema,
  ticketItemCancellationPreviewSchema,
  ticketItemQrCredentialSchema,
} from './ticket-item.schema';

describe('ticket item shared contracts', () => {
  it('defines fixed per-ticket service fee', () => {
    expect(TICKET_SERVICE_FEE_KRW).toBe(2000);
  });

  it('validates a seat-level ticket item with its own QR credential', () => {
    const parsed = ticketItemSchema.parse({
      id: '00000000-0000-4000-8000-000000000101',
      reservationId: '00000000-0000-4000-8000-000000000001',
      paymentId: '00000000-0000-4000-8000-000000000002',
      showtimeId: '00000000-0000-4000-8000-000000000003',
      seatId: '1F:A-1',
      seatKey: '1F:A-1',
      floorKey: '1F',
      floorLabel: '1층',
      row: 'A',
      number: '1',
      tierName: 'VIP',
      price: 100000,
      serviceFee: 2000,
      status: 'ACTIVE',
      admissionState: 'NOT_ENTERED',
      enteredAt: null,
      qrCredential: {
        id: '00000000-0000-4000-8000-000000000201',
        token: 'signed-token',
        jti: 'qr-jti-seat-a1',
        status: 'ACTIVE',
        issuedAt: '2026-07-01T00:00:00.000Z',
        rotatedAt: null,
        revokedAt: null,
      },
      cancellation: null,
    });

    expect(parsed.seatKey).toBe('1F:A-1');
    expect(parsed.qrCredential?.jti).toBe('qr-jti-seat-a1');
  });

  it('validates per-ticket cancellation preview with NOL-style fees', () => {
    const parsed = ticketItemCancellationPreviewSchema.parse({
      ticketItemId: '00000000-0000-4000-8000-000000000101',
      ticketPrice: 100000,
      serviceFee: 2000,
      cancellationFee: 4000,
      serviceFeeRefund: 0,
      refundableAmount: 96000,
      policyCode: 'BOOKING_DAY_8_TO_SHOW_DAY_10',
    });

    expect(parsed.refundableAmount).toBe(96000);
  });

  it('rejects QR credentials without a token', () => {
    expect(() =>
      ticketItemQrCredentialSchema.parse({
        id: '00000000-0000-4000-8000-000000000201',
        token: '',
        jti: 'qr-jti-seat-a1',
        status: 'ACTIVE',
        issuedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run shared test and confirm it fails**

Run:

```bash
pnpm --filter @grabit/shared test -- ticket-item.schema.test.ts
```

Expected: FAIL because `ticket-item.schema.ts` does not exist.

- [ ] **Step 3: Add shared schema**

Create `packages/shared/src/schemas/ticket-item.schema.ts`:

```ts
import { z } from 'zod';

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

export const TICKET_SERVICE_FEE_KRW = 2000;

export const ticketItemStatusSchema = z.enum(['ACTIVE', 'CANCELLED', 'EXPIRED']);
export const admissionStateSchema = z.enum(['NOT_ENTERED', 'ENTERED']);
export const qrCredentialStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED', 'ROTATED']);

export const ticketItemQrCredentialSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(1, 'QR token이 필요합니다'),
  jti: z.string().min(1, 'QR token JTI가 필요합니다'),
  status: qrCredentialStatusSchema,
  issuedAt: isoDatetime('QR 발급 시각'),
  rotatedAt: isoDatetime('QR 교체 시각').nullable().optional(),
  revokedAt: isoDatetime('QR 해지 시각').nullable().optional(),
});

export const ticketItemCancellationSchema = z.object({
  cancelledAt: isoDatetime('티켓 취소 시각'),
  cancelReason: z.string().min(1).max(200),
  cancellationFee: z.number().int().min(0),
  serviceFeeRefund: z.number().int().min(0),
  refundableAmount: z.number().int().min(0),
  refundStatus: z.enum(['REQUESTED', 'SENT_TO_PG', 'PROCESSING_AT_PG', 'COMPLETED', 'FAILED']),
  reopenState: z.enum(['HELD_CANCELLED', 'AVAILABLE', 'MANUAL_OPENED']),
  reopenAt: isoDatetime('좌석 재오픈 시각').nullable().optional(),
});

export const ticketItemSchema = z.object({
  id: z.string().uuid(),
  reservationId: z.string().uuid(),
  paymentId: z.string().uuid(),
  showtimeId: z.string().uuid(),
  seatId: z.string().min(1),
  seatKey: z.string().min(1),
  floorKey: z.string().min(1),
  floorLabel: z.string().min(1),
  row: z.string().min(1),
  number: z.string().min(1),
  tierName: z.string().min(1),
  price: z.number().int().min(0),
  serviceFee: z.literal(TICKET_SERVICE_FEE_KRW),
  status: ticketItemStatusSchema,
  admissionState: admissionStateSchema,
  enteredAt: isoDatetime('입장 처리 시각').nullable().optional(),
  qrCredential: ticketItemQrCredentialSchema.nullable(),
  cancellation: ticketItemCancellationSchema.nullable(),
});

export const ticketItemCancellationPolicyCodeSchema = z.enum([
  'SAME_DAY_BEFORE_MIDNIGHT',
  'WITHIN_7_DAYS_AFTER_BOOKING',
  'BOOKING_DAY_8_TO_SHOW_DAY_10',
  'SHOW_DAY_9_TO_7',
  'SHOW_DAY_6_TO_3',
  'SHOW_DAY_2_TO_1',
]);

export const ticketItemCancellationPreviewSchema = z.object({
  ticketItemId: z.string().uuid(),
  ticketPrice: z.number().int().min(0),
  serviceFee: z.literal(TICKET_SERVICE_FEE_KRW),
  cancellationFee: z.number().int().min(0),
  serviceFeeRefund: z.number().int().min(0),
  refundableAmount: z.number().int().min(0),
  policyCode: ticketItemCancellationPolicyCodeSchema,
});

export type TicketItem = z.infer<typeof ticketItemSchema>;
export type TicketItemCancellationPreview = z.infer<
  typeof ticketItemCancellationPreviewSchema
>;
export type TicketItemStatus = z.infer<typeof ticketItemStatusSchema>;
export type AdmissionState = z.infer<typeof admissionStateSchema>;
export type QrCredentialStatus = z.infer<typeof qrCredentialStatusSchema>;
```

- [ ] **Step 4: Export shared schema**

Modify `packages/shared/src/index.ts` to export the new schema:

```ts
export * from './schemas/ticket-item.schema';
```

- [ ] **Step 5: Run shared test and typecheck**

Run:

```bash
pnpm --filter @grabit/shared test -- ticket-item.schema.test.ts
pnpm --filter @grabit/shared typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/ticket-item.schema.ts packages/shared/src/schemas/ticket-item.schema.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add ticket item contracts"
```

## Task 2: Database Schema And Migration

**Files:**
- Create: `apps/api/src/database/schema/ticket-items.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Modify: `apps/api/src/database/schema/tickets.ts`
- Modify: `apps/api/src/database/schema/ticket-scan-events.ts`
- Create: `apps/api/src/database/migrations/0024_ticket_items.sql`
- Test: `apps/api/src/database/schema/ticket-items.schema.spec.ts`

- [ ] **Step 1: Write failing schema test**

Create `apps/api/src/database/schema/ticket-items.schema.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { ticketItems, ticketItemStatusEnum, ticketItemAdmissionStateEnum } from './ticket-items';

describe('ticket_items schema', () => {
  it('defines validity and admission state as separate enums', () => {
    expect(ticketItemStatusEnum.enumValues).toEqual(['active', 'cancelled', 'expired']);
    expect(ticketItemAdmissionStateEnum.enumValues).toEqual(['not_entered', 'entered']);
  });

  it('stores seat identity, service fee, cancellation, and controlled reopen fields', () => {
    const columns = getTableColumns(ticketItems);
    expect(columns.reservationId).toBeDefined();
    expect(columns.paymentId).toBeDefined();
    expect(columns.showtimeId).toBeDefined();
    expect(columns.seatKey).toBeDefined();
    expect(columns.floorKey).toBeDefined();
    expect(columns.price).toBeDefined();
    expect(columns.serviceFee).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.admissionState).toBeDefined();
    expect(columns.cancellationFee).toBeDefined();
    expect(columns.serviceFeeRefund).toBeDefined();
    expect(columns.refundableAmount).toBeDefined();
    expect(columns.reopenState).toBeDefined();
  });
});
```

- [ ] **Step 2: Run schema test and confirm it fails**

Run:

```bash
pnpm --filter @grabit/api test -- ticket-items.schema.spec.ts
```

Expected: FAIL because `ticket-items.ts` does not exist.

- [ ] **Step 3: Add `ticket_items` Drizzle schema**

Create `apps/api/src/database/schema/ticket-items.ts`:

```ts
import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { reservations } from './reservations.js';
import { payments } from './payments.js';
import { showtimes } from './showtimes.js';

export const ticketItemStatusEnum = pgEnum('ticket_item_status', [
  'active',
  'cancelled',
  'expired',
]);

export const ticketItemAdmissionStateEnum = pgEnum('ticket_item_admission_state', [
  'not_entered',
  'entered',
]);

export const ticketItemReopenStateEnum = pgEnum('ticket_item_reopen_state', [
  'not_required',
  'held_cancelled',
  'available',
  'manual_opened',
]);

export const ticketItems = pgTable('ticket_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id, { onDelete: 'cascade' }),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  showtimeId: uuid('showtime_id').notNull().references(() => showtimes.id, { onDelete: 'cascade' }),
  seatId: varchar('seat_id', { length: 120 }).notNull(),
  seatKey: varchar('seat_key', { length: 120 }).notNull(),
  floorKey: varchar('floor_key', { length: 50 }).notNull(),
  floorLabel: varchar('floor_label', { length: 100 }).notNull(),
  tierName: varchar('tier_name', { length: 50 }).notNull(),
  row: varchar('row', { length: 50 }).notNull(),
  number: varchar('number', { length: 50 }).notNull(),
  price: integer('price').notNull(),
  serviceFee: integer('service_fee').notNull().default(2000),
  status: ticketItemStatusEnum('status').notNull().default('active'),
  admissionState: ticketItemAdmissionStateEnum('admission_state').notNull().default('not_entered'),
  enteredAt: timestamp('entered_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: varchar('cancel_reason', { length: 200 }),
  cancellationFee: integer('cancellation_fee').notNull().default(0),
  serviceFeeRefund: integer('service_fee_refund').notNull().default(0),
  refundableAmount: integer('refundable_amount').notNull().default(0),
  reopenState: ticketItemReopenStateEnum('reopen_state').notNull().default('not_required'),
  reopenHoldUntil: timestamp('reopen_hold_until', { withTimezone: true }),
  reopenJobId: varchar('reopen_job_id', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_ticket_items_reservation_seat').on(table.reservationId, table.seatKey),
  index('idx_ticket_items_reservation_id').on(table.reservationId),
  index('idx_ticket_items_payment_id').on(table.paymentId),
  index('idx_ticket_items_showtime_id').on(table.showtimeId),
  index('idx_ticket_items_status').on(table.status),
  index('idx_ticket_items_admission_state').on(table.admissionState),
]);
```

- [ ] **Step 4: Export schema**

Modify `apps/api/src/database/schema/index.ts`:

```ts
export {
  ticketItems,
  ticketItemStatusEnum,
  ticketItemAdmissionStateEnum,
  ticketItemReopenStateEnum,
} from './ticket-items.js';
```

- [ ] **Step 5: Update `tickets` ownership**

Modify `apps/api/src/database/schema/tickets.ts` so each QR credential can belong to a ticket item:

```ts
import { ticketItems } from './ticket-items.js';

// inside table columns
ticketItemId: uuid('ticket_item_id')
  .references(() => ticketItems.id, { onDelete: 'cascade' }),

// inside indexes
uniqueIndex('idx_tickets_ticket_item_active').on(table.ticketItemId, table.status),
index('idx_tickets_ticket_item_id').on(table.ticketItemId),
```

Keep `reservationId`, `paymentId`, and `showtimeId` during transition, but stop using `idx_tickets_reservation_id` as the long-term uniqueness rule in service code.

- [ ] **Step 6: Update scan events**

Modify `apps/api/src/database/schema/ticket-scan-events.ts`:

```ts
import { ticketItems } from './ticket-items.js';

// inside columns
ticketItemId: uuid('ticket_item_id')
  .references(() => ticketItems.id, { onDelete: 'restrict' }),

// inside indexes
index('idx_ticket_scan_events_ticket_item_id').on(table.ticketItemId),
```

- [ ] **Step 7: Add SQL migration**

Create `apps/api/src/database/migrations/0024_ticket_items.sql` with matching SQL:

```sql
CREATE TYPE "ticket_item_status" AS ENUM ('active', 'cancelled', 'expired');
CREATE TYPE "ticket_item_admission_state" AS ENUM ('not_entered', 'entered');
CREATE TYPE "ticket_item_reopen_state" AS ENUM ('not_required', 'held_cancelled', 'available', 'manual_opened');

CREATE TABLE "ticket_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reservation_id" uuid NOT NULL REFERENCES "reservations"("id") ON DELETE cascade,
  "payment_id" uuid NOT NULL REFERENCES "payments"("id") ON DELETE cascade,
  "showtime_id" uuid NOT NULL REFERENCES "showtimes"("id") ON DELETE cascade,
  "seat_id" varchar(120) NOT NULL,
  "seat_key" varchar(120) NOT NULL,
  "floor_key" varchar(50) NOT NULL,
  "floor_label" varchar(100) NOT NULL,
  "tier_name" varchar(50) NOT NULL,
  "row" varchar(50) NOT NULL,
  "number" varchar(50) NOT NULL,
  "price" integer NOT NULL,
  "service_fee" integer DEFAULT 2000 NOT NULL,
  "status" "ticket_item_status" DEFAULT 'active' NOT NULL,
  "admission_state" "ticket_item_admission_state" DEFAULT 'not_entered' NOT NULL,
  "entered_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancel_reason" varchar(200),
  "cancellation_fee" integer DEFAULT 0 NOT NULL,
  "service_fee_refund" integer DEFAULT 0 NOT NULL,
  "refundable_amount" integer DEFAULT 0 NOT NULL,
  "reopen_state" "ticket_item_reopen_state" DEFAULT 'not_required' NOT NULL,
  "reopen_hold_until" timestamp with time zone,
  "reopen_job_id" varchar(200),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "idx_ticket_items_reservation_seat" ON "ticket_items" ("reservation_id","seat_key");
CREATE INDEX "idx_ticket_items_reservation_id" ON "ticket_items" ("reservation_id");
CREATE INDEX "idx_ticket_items_payment_id" ON "ticket_items" ("payment_id");
CREATE INDEX "idx_ticket_items_showtime_id" ON "ticket_items" ("showtime_id");
CREATE INDEX "idx_ticket_items_status" ON "ticket_items" ("status");
CREATE INDEX "idx_ticket_items_admission_state" ON "ticket_items" ("admission_state");

INSERT INTO "ticket_items" (
  "reservation_id",
  "payment_id",
  "showtime_id",
  "seat_id",
  "seat_key",
  "floor_key",
  "floor_label",
  "tier_name",
  "row",
  "number",
  "price",
  "service_fee",
  "status",
  "admission_state",
  "created_at",
  "updated_at"
)
SELECT
  rs."reservation_id",
  p."id",
  r."showtime_id",
  rs."seat_id",
  rs."seat_id",
  split_part(rs."seat_id", ':', 1),
  split_part(rs."seat_id", ':', 1),
  rs."tier_name",
  rs."row",
  rs."number",
  rs."price",
  2000,
  CASE WHEN r."status" = 'CANCELLED' THEN 'cancelled'::"ticket_item_status" ELSE 'active'::"ticket_item_status" END,
  'not_entered'::"ticket_item_admission_state",
  now(),
  now()
FROM "reservation_seats" rs
JOIN "reservations" r ON r."id" = rs."reservation_id"
JOIN "payments" p ON p."reservation_id" = r."id";

ALTER TABLE "tickets" ADD COLUMN "ticket_item_id" uuid REFERENCES "ticket_items"("id") ON DELETE cascade;
CREATE INDEX "idx_tickets_ticket_item_id" ON "tickets" ("ticket_item_id");

ALTER TABLE "ticket_scan_events" ADD COLUMN "ticket_item_id" uuid REFERENCES "ticket_items"("id") ON DELETE restrict;
CREATE INDEX "idx_ticket_scan_events_ticket_item_id" ON "ticket_scan_events" ("ticket_item_id");
```

- [ ] **Step 8: Run schema test and migration checks**

Run:

```bash
pnpm --filter @grabit/api test -- ticket-items.schema.spec.ts
DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit check
pnpm --filter @grabit/api typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/database/schema apps/api/src/database/migrations/0024_ticket_items.sql
git commit -m "feat(api): add ticket items schema"
```

## Task 3: Booking Amount And Ticket Item Creation

**Files:**
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Modify: `apps/api/src/modules/reservation/reservation.service.spec.ts`
- Modify: `apps/web/components/booking/seat-selection-panel.tsx`
- Modify: `apps/web/components/booking/seat-selection-sheet.tsx`
- Modify: `apps/web/components/booking/order-summary.tsx`
- Test: existing reservation service specs and booking component specs

- [ ] **Step 1: Add failing API test for 2,000 KRW per ticket fee**

In `apps/api/src/modules/reservation/reservation.service.spec.ts`, add:

```ts
it('includes 2000 KRW service fee per selected seat in prepare amount', async () => {
  const dto = makePrepareDto({
    seats: [
      { seatId: '1F:A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
      { seatId: '1F:A-2', seatKey: '1F:A-2', floorKey: '1F', floorLabel: '1층', tierName: 'VIP', price: 100000, row: 'A', number: '2' },
    ],
    amount: 204000,
  });

  await expect(service.prepareReservation(dto, userId, requestMeta)).resolves.toMatchObject({
    orderId: dto.orderId,
  });
});

it('rejects prepare amount when per-ticket service fee is missing', async () => {
  const dto = makePrepareDto({
    seats: [
      { seatId: '1F:A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', tierName: 'VIP', price: 100000, row: 'A', number: '1' },
      { seatId: '1F:A-2', seatKey: '1F:A-2', floorKey: '1F', floorLabel: '1층', tierName: 'VIP', price: 100000, row: 'A', number: '2' },
    ],
    amount: 200000,
  });

  await expect(service.prepareReservation(dto, userId, requestMeta))
    .rejects.toThrow('금액이 일치하지 않습니다');
});
```

- [ ] **Step 2: Run API test and confirm it fails**

Run:

```bash
pnpm --filter @grabit/api test -- reservation.service.spec.ts -t "service fee"
```

Expected: FAIL because expected amount is still seat price only.

- [ ] **Step 3: Implement amount calculation**

In `apps/api/src/modules/reservation/reservation.service.ts`, add constant and update calculation:

```ts
const TICKET_SERVICE_FEE_KRW = 2000;

private calculateTicketItemTotal(seats: FloorAwareSeatSelection[]): number {
  return seats.reduce(
    (total, seat) => total + seat.price + TICKET_SERVICE_FEE_KRW,
    0,
  );
}
```

Replace prepare amount check:

```ts
const expectedAmount = this.calculateTicketItemTotal(canonicalSeats);
```

Keep `reservationSeats.price` as seat price only. Store service fee on `ticket_items` in the next step, not in `reservation_seats`.

- [ ] **Step 4: Create ticket items on prepare/finalization path**

In the transaction that currently inserts `reservationSeats`, also insert `ticketItems` after payment id is available. If `paymentId` is not available at prepare time, create ticket items after payment confirmation in `reservation-finalization.service.ts`. Use this mapping:

```ts
await tx.insert(ticketItems).values(
  confirmedSeats.map((seat) => ({
    reservationId: reservation.id,
    paymentId: committedPaymentId,
    showtimeId: reservation.showtimeId,
    seatId: seat.seatKey,
    seatKey: seat.seatKey,
    floorKey: seat.floorKey,
    floorLabel: seat.floorLabel,
    tierName: seat.tierName,
    row: seat.row,
    number: seat.number,
    price: seat.price,
    serviceFee: TICKET_SERVICE_FEE_KRW,
    status: 'active',
    admissionState: 'not_entered',
  })),
);
```

- [ ] **Step 5: Update frontend totals**

In `apps/web/components/booking/seat-selection-panel.tsx`, `seat-selection-sheet.tsx`, and `order-summary.tsx`, calculate:

```ts
const serviceFeeTotal = selectedSeats.length * 2000;
const seatTotal = selectedSeats.reduce((sum, seat) => sum + seat.price, 0);
const totalPrice = seatTotal + serviceFeeTotal;
```

Show a separate row:

```tsx
<div className="flex items-center justify-between text-sm text-gray-600">
  <span>예매 수수료</span>
  <span>{serviceFeeTotal.toLocaleString('ko-KR')}원</span>
</div>
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @grabit/api test -- reservation.service.spec.ts -t "service fee"
pnpm --filter @grabit/web test -- seat-selection-panel.test.tsx
pnpm --filter @grabit/web typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/reservation apps/web/components/booking
git commit -m "feat(booking): charge per-ticket service fee"
```

## Task 4: Seat-Level QR Issuance And Verification

**Files:**
- Modify: `apps/api/src/modules/ticket/qr-ticket.service.ts`
- Modify: `apps/api/src/modules/ticket/qr-ticket.service.spec.ts`
- Modify: `apps/api/src/modules/ticket/ticket.controller.ts`
- Modify: `packages/shared/src/field-check-in-ingress.ts`

- [ ] **Step 1: Write failing QR service tests**

In `apps/api/src/modules/ticket/qr-ticket.service.spec.ts`, add:

```ts
it('issues one active QR credential per ticket item', async () => {
  const issued = await service.ensureIssuedTicketsForReservation({
    reservationId: '00000000-0000-4000-8000-000000000001',
    paymentId: '00000000-0000-4000-8000-000000000002',
  });

  expect(issued).toHaveLength(4);
  expect(new Set(issued.map((ticket) => ticket.ticketItemId)).size).toBe(4);
  expect(issued.every((ticket) => ticket.status === 'ACTIVE')).toBe(true);
});

it('verifies scanner contract by ticketItemId and jti', async () => {
  const contract = await service.verifyTicketForScannerContract(rawSeatLevelToken);
  expect(contract.ticketItemId).toBe('00000000-0000-4000-8000-000000000101');
  expect(contract.seatIdentity.seatKey).toBe('1F:A-1');
  expect(contract.reservationId).toBe('00000000-0000-4000-8000-000000000001');
});
```

- [ ] **Step 2: Run QR tests and confirm failure**

Run:

```bash
pnpm --filter @grabit/api test -- qr-ticket.service.spec.ts -t "ticket item"
```

Expected: FAIL because QR service has reservation-level methods only.

- [ ] **Step 3: Extend token payload**

In `qr-ticket.service.ts`, update payload type:

```ts
interface QrTicketTokenPayload {
  type: 'qr-ticket';
  ticketItemId: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  seatIdentity: {
    seatId: string;
    seatKey: string;
    floorKey: string;
    floorLabel: string;
    row: string;
    number: string;
    tierName: string;
  };
  jti: string;
  secretVersion: string;
}
```

- [ ] **Step 4: Implement issuance per ticket item**

Add method:

```ts
async ensureIssuedTicketsForReservation(input: {
  reservationId: string;
  paymentId: string;
}): Promise<QrTicket[]> {
  const items = await this.getActiveTicketItems(input);
  const issued: QrTicket[] = [];

  for (const item of items) {
    const ticket = await this.ensureIssuedTicketForTicketItem(item);
    issued.push(ticket);
  }

  return issued;
}
```

`ensureIssuedTicketForTicketItem` must:

- find active `tickets.ticketItemId`
- rotate/revoke older active credentials for the same `ticketItemId` before replacement
- issue signed token with `ticketItemId`, `seatIdentity`, `jti`, `secretVersion`

- [ ] **Step 5: Reject legacy reservation-level QR in scanner contract**

In `verifyTicketForScannerContract`, after verifying payload:

```ts
if (!payload.ticketItemId) {
  throw new UnauthorizedException('좌석별 QR 티켓을 다시 열어주세요');
}
```

- [ ] **Step 6: Run QR tests**

Run:

```bash
pnpm --filter @grabit/api test -- qr-ticket.service.spec.ts
pnpm --filter @grabit/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/ticket packages/shared/src/field-check-in-ingress.ts
git commit -m "feat(ticket): issue qr credentials per ticket item"
```

## Task 5: Field Check-In By Ticket Item

**Files:**
- Modify: `packages/shared/src/schemas/field-operations.schema.ts`
- Modify: `apps/api/src/modules/field-operations/field-check-in.service.ts`
- Modify: `apps/api/src/modules/field-operations/offline-sync.service.ts`
- Modify: `apps/web/hooks/use-field-operations.ts`
- Modify: `apps/web/components/field/scanner-check-in.tsx`
- Test: field operation service and component tests

- [ ] **Step 1: Write failing duplicate behavior test**

In `apps/api/src/modules/field-operations/field-check-in.service.spec.ts`, add:

```ts
it('treats duplicate scans per ticket item, not per reservation', async () => {
  seedSuccessfulScan({ ticketItemId: 'ticket-item-a1', reservationId: 'reservation-1' });
  mockQrContract({
    ticketItemId: 'ticket-item-a2',
    reservationId: 'reservation-1',
    ticketStatus: 'ACTIVE',
    admissionState: 'NOT_ENTERED',
    seatIdentity: { seatKey: '1F:A-2', floorKey: '1F', floorLabel: '1층', row: 'A', number: '2', tierName: 'VIP' },
  });

  const result = await service.consume(
    {
      token: 'token-a2',
      showtimeId: '00000000-0000-4000-8000-000000000003',
      deviceAttemptId: 'device-a2',
      confirmed: true,
    },
    { scannerUserId: '00000000-0000-4000-8000-000000000090' },
  );

  expect(result.outcome).toBe('entered');
});
```

- [ ] **Step 2: Run field test and confirm failure**

Run:

```bash
pnpm --filter @grabit/api test -- field-check-in.service.spec.ts -t "per ticket item"
```

Expected: FAIL because prior scan lookup is reservation-level.

- [ ] **Step 3: Update shared scanner contract**

In `packages/shared/src/schemas/field-operations.schema.ts`, extend ticket context:

```ts
ticketItemId: z.string().min(1, 'ticket item ID가 필요합니다'),
seatIdentity: z.object({
  seatKey: z.string().min(1),
  floorKey: z.string().min(1),
  floorLabel: z.string().min(1),
  row: z.string().min(1),
  number: z.string().min(1),
  tierName: z.string().min(1),
}).strict(),
admissionState: z.enum(['NOT_ENTERED', 'ENTERED']),
```

- [ ] **Step 4: Update consume logic**

In `field-check-in.service.ts`:

- classify processability from `Ticket Item Status`, `Admission State`, and `QR Credential Status`
- find prior successful scan by `ticketItemId`
- update `ticket_items.admission_state = 'entered'`
- record `ticket_scan_events.ticketItemId`

Critical query shape:

```ts
const priorScan = await db
  .select({
    scannedAt: ticketScanEvents.scannedAt,
    scannerUserId: ticketScanEvents.scannerUserId,
    deviceAttemptId: ticketScanEvents.deviceAttemptId,
  })
  .from(ticketScanEvents)
  .where(
    and(
      eq(ticketScanEvents.ticketItemId, contract.ticketItemId),
      eq(ticketScanEvents.result, 'success'),
    ),
  )
  .orderBy(desc(ticketScanEvents.scannedAt))
  .limit(1);
```

- [ ] **Step 5: Update scanner UI primary identity**

In `apps/web/components/field/scanner-check-in.tsx`, make `Seat Identity` the title:

```tsx
<h2 className="mt-1 text-heading font-semibold text-gray-900">
  {verification.seatIdentityLabel ?? '좌석 확인 중'}
</h2>
<MetadataRow label="예매" value={verification.reservationNumber} />
```

- [ ] **Step 6: Run field tests**

Run:

```bash
pnpm --filter @grabit/api test -- field-check-in.service.spec.ts offline-sync.service.spec.ts
pnpm --filter @grabit/web test -- scanner-check-in.test.tsx
pnpm --filter @grabit/api typecheck
pnpm --filter @grabit/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/field-operations.schema.ts apps/api/src/modules/field-operations apps/web/hooks/use-field-operations.ts apps/web/components/field/scanner-check-in.tsx
git commit -m "feat(field): process entry per ticket item"
```

## Task 6: Buyer Seat-Level QR Lists

**Files:**
- Modify: `packages/shared/src/schemas/booking.schema.ts`
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Modify: `apps/web/components/booking/booking-complete.tsx`
- Modify: `apps/web/components/reservation/reservation-detail.tsx`
- Test: reservation detail and booking complete tests

- [ ] **Step 1: Write failing web tests for four QR cards**

In `apps/web/components/booking/__tests__/booking-complete-qr.test.tsx`, add:

```ts
it('renders one QR card per ticket item with seat identity first', () => {
  render(<BookingComplete booking={makeBookingWithFourTicketItems()} />);

  expect(screen.getByRole('heading', { name: /VIP A열 1번/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /VIP A열 2번/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /R B열 1번/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /R B열 2번/ })).toBeInTheDocument();
  expect(screen.getAllByLabelText(/QR 티켓/)).toHaveLength(4);
});
```

- [ ] **Step 2: Run web test and confirm failure**

Run:

```bash
pnpm --filter @grabit/web test -- booking-complete-qr.test.tsx
```

Expected: FAIL because component renders one QR.

- [ ] **Step 3: Update booking shared schema**

In `packages/shared/src/schemas/booking.schema.ts`:

```ts
import { ticketItemSchema } from './ticket-item.schema';

export const reservationDetailSchema = reservationListItemSchema.extend({
  // existing fields
  ticketItems: z.array(ticketItemSchema).default([]),
  qrTicket: qrTicketSchema.optional(),
});
```

- [ ] **Step 4: Update API reservation detail mapping**

In `reservation.service.ts`, load `ticket_items` and latest active QR credential per item. Return:

```ts
ticketItems: ticketItemsForReservation.map((item) => ({
  id: item.id,
  reservationId: item.reservationId,
  paymentId: item.paymentId,
  showtimeId: item.showtimeId,
  seatId: item.seatId,
  seatKey: item.seatKey,
  floorKey: item.floorKey,
  floorLabel: item.floorLabel,
  row: item.row,
  number: item.number,
  tierName: item.tierName,
  price: item.price,
  serviceFee: item.serviceFee,
  status: toSharedTicketItemStatus(item.status),
  admissionState: toSharedAdmissionState(item.admissionState),
  enteredAt: item.enteredAt?.toISOString() ?? null,
  qrCredential: qrByTicketItemId.get(item.id) ?? null,
  cancellation: cancellationForItem(item),
})),
```

- [ ] **Step 5: Render buyer QR cards**

In `booking-complete.tsx` and `reservation-detail.tsx`, replace the single QR panel with:

```tsx
{booking.ticketItems.map((item) => (
  <Card key={item.id} className="w-full border-[#E9DFFF] bg-[#F8F5FF]">
    <CardContent className="space-y-4 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {item.tierName} {item.row}열 {item.number}번
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            예매번호 {booking.reservationNumber}
          </p>
        </div>
        <Badge>{item.admissionState === 'ENTERED' ? '입장 완료' : '입장 전'}</Badge>
      </div>
      {item.qrCredential?.status === 'ACTIVE' ? (
        <QrTicketImage value={buildQrCheckInUrl(item.qrCredential.token)} />
      ) : (
        <p className="text-sm font-semibold text-[#8B6306]">QR을 확인하는 중입니다.</p>
      )}
    </CardContent>
  </Card>
))}
```

- [ ] **Step 6: Run buyer tests**

Run:

```bash
pnpm --filter @grabit/web test -- booking-complete-qr.test.tsx reservation-detail-qr.test.tsx
pnpm --filter @grabit/web typecheck
pnpm --filter @grabit/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/booking.schema.ts apps/api/src/modules/reservation/reservation.service.ts apps/web/components/booking/booking-complete.tsx apps/web/components/reservation/reservation-detail.tsx
git commit -m "feat(web): show qr credentials per ticket item"
```

## Task 7: Ticket Item Cancellation And Fee Policy

**Files:**
- Create: `apps/api/src/modules/ticket/ticket-item-fee-policy.ts`
- Modify: `apps/api/src/modules/refund/refund.service.ts`
- Modify: `apps/api/src/modules/refund/refund.controller.ts`
- Modify: `packages/shared/src/schemas/booking.schema.ts`
- Test: `apps/api/src/modules/ticket/ticket-item-fee-policy.spec.ts`, refund service tests

- [ ] **Step 1: Write fee policy tests**

Create `apps/api/src/modules/ticket/ticket-item-fee-policy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateTicketItemCancellationFee } from './ticket-item-fee-policy';

const kst = (value: string) => new Date(value);

describe('calculateTicketItemCancellationFee', () => {
  it('refunds ticket price and service fee for booking-day cancellation before 24:00 KST', () => {
    expect(calculateTicketItemCancellationFee({
      ticketPrice: 100000,
      serviceFee: 2000,
      bookedAt: kst('2026-07-01T02:00:00.000Z'),
      showtimeAt: kst('2026-07-20T10:00:00.000Z'),
      cancelledAt: kst('2026-07-01T14:30:00.000Z'),
    })).toEqual({
      policyCode: 'SAME_DAY_BEFORE_MIDNIGHT',
      cancellationFee: 0,
      serviceFeeRefund: 2000,
      refundableAmount: 102000,
    });
  });

  it('uses show-date rule before booking-date rule', () => {
    expect(calculateTicketItemCancellationFee({
      ticketPrice: 100000,
      serviceFee: 2000,
      bookedAt: kst('2026-07-10T00:00:00.000Z'),
      showtimeAt: kst('2026-07-15T10:00:00.000Z'),
      cancelledAt: kst('2026-07-12T00:00:00.000Z'),
    }).cancellationFee).toBe(20000);
  });

  it('caps 4000 KRW fee at 10 percent of ticket price', () => {
    expect(calculateTicketItemCancellationFee({
      ticketPrice: 30000,
      serviceFee: 2000,
      bookedAt: kst('2026-07-01T00:00:00.000Z'),
      showtimeAt: kst('2026-07-30T10:00:00.000Z'),
      cancelledAt: kst('2026-07-09T00:00:00.000Z'),
    }).cancellationFee).toBe(3000);
  });

  it('floors percentage fees to integer KRW', () => {
    expect(calculateTicketItemCancellationFee({
      ticketPrice: 33333,
      serviceFee: 2000,
      bookedAt: kst('2026-07-01T00:00:00.000Z'),
      showtimeAt: kst('2026-07-10T10:00:00.000Z'),
      cancelledAt: kst('2026-07-03T00:00:00.000Z'),
    }).cancellationFee).toBe(3333);
  });

  it('rejects show-date cancellation', () => {
    expect(() => calculateTicketItemCancellationFee({
      ticketPrice: 100000,
      serviceFee: 2000,
      bookedAt: kst('2026-07-01T00:00:00.000Z'),
      showtimeAt: kst('2026-07-10T10:00:00.000Z'),
      cancelledAt: kst('2026-07-10T00:01:00.000Z'),
    })).toThrow('관람일에는 취소할 수 없습니다');
  });
});
```

- [ ] **Step 2: Implement fee policy**

Create `apps/api/src/modules/ticket/ticket-item-fee-policy.ts`:

```ts
export interface TicketItemCancellationFeeInput {
  ticketPrice: number;
  serviceFee: number;
  bookedAt: Date;
  showtimeAt: Date;
  cancelledAt: Date;
}

export interface TicketItemCancellationFeeResult {
  policyCode:
    | 'SAME_DAY_BEFORE_MIDNIGHT'
    | 'WITHIN_7_DAYS_AFTER_BOOKING'
    | 'BOOKING_DAY_8_TO_SHOW_DAY_10'
    | 'SHOW_DAY_9_TO_7'
    | 'SHOW_DAY_6_TO_3'
    | 'SHOW_DAY_2_TO_1';
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function calculateTicketItemCancellationFee(
  input: TicketItemCancellationFeeInput,
): TicketItemCancellationFeeResult {
  const showDay = kstDay(input.showtimeAt);
  const cancelDay = kstDay(input.cancelledAt);
  if (cancelDay >= showDay) {
    throw new Error('관람일에는 취소할 수 없습니다');
  }

  if (isSameKstDay(input.bookedAt, input.cancelledAt)) {
    return result('SAME_DAY_BEFORE_MIDNIGHT', input, 0, input.serviceFee);
  }

  const daysBeforeShow = Math.floor((showDay - cancelDay) / 86_400_000);
  if (daysBeforeShow <= 2) {
    return result('SHOW_DAY_2_TO_1', input, percent(input.ticketPrice, 30), 0);
  }
  if (daysBeforeShow <= 6) {
    return result('SHOW_DAY_6_TO_3', input, percent(input.ticketPrice, 20), 0);
  }
  if (daysBeforeShow <= 9) {
    return result('SHOW_DAY_9_TO_7', input, percent(input.ticketPrice, 10), 0);
  }

  const daysAfterBooking = Math.floor((cancelDay - kstDay(input.bookedAt)) / 86_400_000) + 1;
  if (daysAfterBooking <= 7) {
    return result('WITHIN_7_DAYS_AFTER_BOOKING', input, 0, 0);
  }

  return result(
    'BOOKING_DAY_8_TO_SHOW_DAY_10',
    input,
    Math.min(4000, percent(input.ticketPrice, 10)),
    0,
  );
}

function result(
  policyCode: TicketItemCancellationFeeResult['policyCode'],
  input: TicketItemCancellationFeeInput,
  cancellationFee: number,
  serviceFeeRefund: number,
): TicketItemCancellationFeeResult {
  return {
    policyCode,
    cancellationFee,
    serviceFeeRefund,
    refundableAmount: input.ticketPrice - cancellationFee + serviceFeeRefund,
  };
}

function percent(amount: number, rate: number): number {
  return Math.floor((amount * rate) / 100);
}

function kstDay(value: Date): number {
  const shifted = new Date(value.getTime() + KST_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

function isSameKstDay(left: Date, right: Date): boolean {
  return kstDay(left) === kstDay(right);
}
```

- [ ] **Step 3: Add single item cancellation endpoint**

In `packages/shared/src/schemas/booking.schema.ts`, add:

```ts
export const cancelTicketItemSchema = z.object({
  reason: z.string().min(1, '취소 사유를 입력해주세요').max(200),
});
```

In `refund.controller.ts`, add route:

```ts
@Post('reservations/:reservationId/ticket-items/:ticketItemId/refund')
async refundTicketItem(
  @Param('reservationId') reservationId: string,
  @Param('ticketItemId') ticketItemId: string,
  @Req() req: { user: { id: string } },
  @Body(new ZodValidationPipe(cancelTicketItemSchema)) body: CancelTicketItemInput,
) {
  return this.refundService.requestTicketItemRefund({
    reservationId,
    ticketItemId,
    userId: req.user.id,
    reason: body.reason,
  });
}
```

- [ ] **Step 4: Implement refund service behavior**

In `refund.service.ts`, implement `requestTicketItemRefund` to:

- lock `ticket_items` row
- require owner reservation
- require `status = active`
- require `admission_state = not_entered`
- require cancellation window before show date
- compute fee with `calculateTicketItemCancellationFee`
- call Toss partial cancel for `refundableAmount`
- set ticket item `status = cancelled`
- revoke active QR credentials for that ticket item
- set seat inventory `held_cancelled`
- update reservation to `CANCELLED` only if no active ticket items remain

Core update shape:

```ts
await tx.update(ticketItems)
  .set({
    status: 'cancelled',
    cancelledAt: now,
    cancelReason: input.reason,
    cancellationFee: fee.cancellationFee,
    serviceFeeRefund: fee.serviceFeeRefund,
    refundableAmount: fee.refundableAmount,
    reopenState: 'held_cancelled',
    reopenHoldUntil: releaseAt,
    reopenJobId: releaseJobId,
    updatedAt: now,
  })
  .where(eq(ticketItems.id, input.ticketItemId));
```

- [ ] **Step 5: Run fee and refund tests**

Run:

```bash
pnpm --filter @grabit/api test -- ticket-item-fee-policy.spec.ts refund.service.spec.ts
pnpm --filter @grabit/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ticket/ticket-item-fee-policy.ts apps/api/src/modules/ticket/ticket-item-fee-policy.spec.ts apps/api/src/modules/refund packages/shared/src/schemas/booking.schema.ts
git commit -m "feat(refund): cancel ticket items with nol fee policy"
```

## Task 8: Admin And Settlement Item-Level Views

**Files:**
- Modify: `apps/api/src/modules/admin/admin-booking.service.ts`
- Modify: `apps/api/src/modules/admin/settlement-export.service.ts`
- Modify: `apps/web/components/admin/admin-booking-detail-modal.tsx`
- Modify: `apps/web/components/admin/settlement-dashboard.tsx`
- Test: admin booking and settlement tests

- [ ] **Step 1: Add failing settlement test**

In `apps/api/src/modules/admin/settlement-export.service.spec.ts`, add:

```ts
it('exports one row per ticket item with item-level cancellation and entry state', async () => {
  const result = await service.exportDataset({
    eventId: 'event-girl-rules-20260704',
    showtimeId: '00000000-0000-4000-8000-000000000001',
    dataset: 'entry_status',
    reason: 'post-event settlement reconciliation',
  }, financeActor);

  expect(result.csv).toContain('ticketItemId');
  expect(result.csv).toContain('1F:A-1');
  expect(result.csv).toContain('ENTERED');
  expect(result.csv).toContain('CANCELLED');
});
```

- [ ] **Step 2: Update admin booking detail contract**

In `admin-booking.service.ts`, include `ticketItems` rows with:

```ts
{
  id: ticketItems.id,
  seatKey: ticketItems.seatKey,
  tierName: ticketItems.tierName,
  row: ticketItems.row,
  number: ticketItems.number,
  price: ticketItems.price,
  serviceFee: ticketItems.serviceFee,
  status: ticketItems.status,
  admissionState: ticketItems.admissionState,
  enteredAt: ticketItems.enteredAt,
  cancellationFee: ticketItems.cancellationFee,
  serviceFeeRefund: ticketItems.serviceFeeRefund,
  refundableAmount: ticketItems.refundableAmount,
  reopenState: ticketItems.reopenState,
}
```

- [ ] **Step 3: Update settlement export rows**

In `settlement-export.service.ts`, make all datasets item-level. Add CSV headers:

```ts
[
  'ticketItemId',
  'reservationNumber',
  'seatKey',
  'ticketItemStatus',
  'admissionState',
  'ticketPrice',
  'serviceFee',
  'cancellationFee',
  'serviceFeeRefund',
  'refundableAmount',
]
```

- [ ] **Step 4: Update admin UI**

In `admin-booking-detail-modal.tsx`, add a Ticket Item table:

```tsx
<Table aria-label="ticket item status">
  <TableHeader>
    <TableRow>
      <TableHead>좌석</TableHead>
      <TableHead>티켓 상태</TableHead>
      <TableHead>입장 상태</TableHead>
      <TableHead>취소/환불</TableHead>
      <TableHead>재오픈</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {booking.ticketItems.map((item) => (
      <TableRow key={item.id}>
        <TableCell>{item.tierName} {item.row}열 {item.number}번</TableCell>
        <TableCell>{item.status}</TableCell>
        <TableCell>{item.admissionState}</TableCell>
        <TableCell>{item.refundableAmount.toLocaleString('ko-KR')}원</TableCell>
        <TableCell>{item.reopenState}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

- [ ] **Step 5: Run admin and settlement tests**

Run:

```bash
pnpm --filter @grabit/api test -- settlement-export.service.spec.ts admin-booking.service.spec.ts
pnpm --filter @grabit/web test -- settlement-dashboard.test.tsx
pnpm --filter @grabit/api typecheck
pnpm --filter @grabit/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin apps/web/components/admin
git commit -m "feat(admin): reconcile ticket items in operations"
```

## Task 9: End-To-End Acceptance Gates

**Files:**
- Create: `apps/web/e2e/seat-level-ticket-items.spec.ts`
- Modify: `apps/web/e2e/phase27-qr-check-in.spec.ts`, `apps/web/e2e/phase27-offline-sync.spec.ts`, and `apps/web/e2e/booking-complete-qr.spec.ts` fixtures to use ticket-item-level QR payloads.

- [ ] **Step 1: Add Playwright acceptance spec**

Create `apps/web/e2e/seat-level-ticket-items.spec.ts` with these test titles:

```ts
import { expect, test } from '@playwright/test';

test.describe('seat-level ticket item rollout', () => {
  test('booking four seats creates four buyer-visible QR credentials grouped by seat identity', async ({ page }) => {
    await page.goto('/booking/performance-phase27/complete?orderId=seat-level-four');
    await expect(page.getByRole('heading', { name: /VIP A열 1번/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /VIP A열 2번/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /R B열 1번/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /R B열 2번/ })).toBeVisible();
    await expect(page.getByLabel(/QR 티켓/)).toHaveCount(4);
  });

  test('scanner consumes one ticket item without blocking another item in the same reservation', async ({ page }) => {
    await page.goto('/field/check-in?ticket=token-a1');
    await page.getByRole('button', { name: '입장 처리' }).click();
    await expect(page.getByText('입장 처리가 완료되었습니다')).toBeVisible();

    await page.goto('/field/check-in?ticket=token-a2');
    await expect(page.getByText('입장 가능 티켓입니다')).toBeVisible();

    await page.goto('/field/check-in?ticket=token-a1');
    await expect(page.getByText('이미 입장 처리된 티켓입니다')).toBeVisible();
  });

  test('single ticket item cancellation reopens only the cancelled seat after controlled hold', async ({ page }) => {
    await page.goto('/mypage/reservations/seat-level-four');
    await page.getByRole('button', { name: /R B열 1번 취소/ }).click();
    await page.getByRole('button', { name: '취소 요청' }).click();
    await expect(page.getByText('일부 취소')).toBeVisible();
    await expect(page.getByText('R B열 1번')).toBeVisible();
    await expect(page.getByText('재오픈 대기')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E spec and API acceptance tests**

Run:

```bash
pnpm --filter @grabit/web test:e2e -- seat-level-ticket-items.spec.ts
pnpm --filter @grabit/api test -- qr-ticket.service.spec.ts field-check-in.service.spec.ts refund.service.spec.ts settlement-export.service.spec.ts
pnpm --filter @grabit/shared test -- ticket-item.schema.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification before booking enablement**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e
git commit -m "test: cover seat-level ticket item rollout"
```

## Self-Review

- Spec coverage: The plan covers seat-level QR, `ticket_items`, NOL-style fees, individual cancellation, controlled reopen, buyer QR cards, field scanner duplicate rules, admin detail, settlement export, migration, legacy QR rejection, and booking-closed rollout gates.
- Red-flag scan: No unfinished marker words or open-ended implementation gaps are used.
- Type consistency: `Ticket Item`, `Ticket Item Status`, `Admission State`, `QR Credential Status`, `Ticket Service Fee`, `Cancellation History`, and `Cancelled Ticket Item Reopen` match `CONTEXT.md` and ADR language.

## Execution Choice

Plan complete. Use one of these approaches:

1. **Subagent-Driven (recommended)**: dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution**: execute tasks in this session using checkpoints between tasks.
