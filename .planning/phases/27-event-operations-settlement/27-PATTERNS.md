# Phase 27: Event Operations + Settlement - Pattern Map

**Mapped:** 2026-05-22  
**Files analyzed:** 47 new/modified files  
**Analogs found:** 42 / 47

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/package.json` | config | build/config | `apps/web/package.json` existing dependency pattern | role-match |
| `packages/shared/src/schemas/field-operations.schema.ts` | model | request-response | `packages/shared/src/schemas/admin-operations.schema.ts` | role-match |
| `packages/shared/src/schemas/field-operations.schema.test.ts` | test | request-response | `packages/shared/src/schemas/admin-operations.schema.test.ts` | role-match |
| `packages/shared/src/index.ts` | config | transform | `packages/shared/src/index.ts` | exact |
| `packages/shared/src/schemas/admin-operations.schema.ts` | model | request-response | existing capability arrays in same file | exact |
| `packages/shared/src/types/admin-operations.types.ts` | utility | transform | existing `resolveAdminCapabilitySnapshot()` | exact |
| `apps/api/src/database/schema/ticket-scan-events.ts` | model | event-driven | `apps/api/src/database/schema/admin-audit-logs.ts` + `booking-operation-audit-logs.ts` | role-match |
| `apps/api/src/database/schema/index.ts` | config | transform | existing schema export block | exact |
| `apps/api/src/database/migrations/0023_phase27_ticket_scan_events.sql` | migration | batch | `0012_phase24_booking_core.sql` + `0015_phase25_admin_operations_console.sql` | role-match |
| `apps/api/src/modules/field-operations/field-operations.module.ts` | provider | request-response | `apps/api/src/modules/admin/admin.module.ts` | role-match |
| `apps/api/src/modules/field-operations/field-check-in.controller.ts` | controller | request-response | `apps/api/src/modules/admin/admin-booking.controller.ts` | role-match |
| `apps/api/src/modules/field-operations/field-check-in.service.ts` | service | CRUD/event-driven | `apps/api/src/modules/ticket/qr-ticket.service.ts` + `admin-booking.service.ts` | role-match |
| `apps/api/src/modules/field-operations/offline-sync.service.ts` | service | batch/event-driven | `apps/api/src/modules/admin/admin-booking.service.ts` transaction/audit pattern | partial |
| `apps/api/src/modules/field-operations/field-monitor.controller.ts` | controller | request-response | `apps/api/src/modules/admin/admin-dashboard.controller.ts` / `admin-booking.controller.ts` | role-match |
| `apps/api/src/modules/field-operations/field-monitor.service.ts` | service | aggregate/read | `apps/api/src/modules/admin/admin-dashboard.service.ts` / `admin-booking.service.ts` | role-match |
| `apps/api/src/modules/admin/admin-settlement.controller.ts` | controller | file-I/O/request-response | `apps/api/src/modules/admin/admin-booking.controller.ts` | exact |
| `apps/api/src/modules/admin/settlement-export.service.ts` | service | batch/file-I/O | `apps/api/src/modules/admin/admin-booking.service.ts` | exact |
| `apps/api/src/modules/admin/admin-audit.service.ts` | service | event-driven | existing audit action/write/query pattern | exact |
| `apps/api/src/database/schema/admin-audit-logs.ts` | model | event-driven | existing enum/table pattern in same file | exact |
| `apps/api/src/modules/admin/admin.module.ts` | provider | config | existing controllers/providers arrays | exact |
| `apps/api/src/app.module.ts` | provider | config | existing module imports list | exact |
| `apps/web/components/field/qr-ticket-image.tsx` | component | transform | `BookingComplete` / `ReservationDetail` QR cards | role-match |
| `apps/web/components/booking/booking-complete.tsx` | component | request-response | existing QR metadata card in same file | exact |
| `apps/web/components/reservation/reservation-detail.tsx` | component | request-response | existing QR metadata card in same file | exact |
| `apps/web/app/field/check-in/page.tsx` | route | request-response | `apps/web/app/admin/layout.tsx` denied/loading shell, but minimal shell required | partial |
| `apps/web/components/field/scanner-check-in.tsx` | component | request-response/event-driven | `ReservationExportPanel` confirmation gating + `AdminBookingTable` status UI | role-match |
| `apps/web/components/field/offline-sync-status.tsx` | component | event-driven | `ReservationExportPanel` mutation state + admin table status badges | partial |
| `apps/web/components/field/field-monitor.tsx` | component | request-response | `AdminBookingDashboard` + `AdminStatCard` + `AdminBookingTable` | exact |
| `apps/web/hooks/use-field-operations.ts` | hook | request-response/event-driven | `apps/web/hooks/use-reservations.ts` | role-match |
| `apps/web/app/admin/settlement/page.tsx` | route | request-response | `apps/web/app/admin/page.tsx` and admin shell | role-match |
| `apps/web/components/admin/settlement-dashboard.tsx` | component | file-I/O/request-response | `AdminBookingDashboard` + `ReservationExportPanel` | exact |
| `apps/web/hooks/use-admin-settlement.ts` | hook | request-response/file-I/O | `use-reservations.ts` export hook + `use-admin-dashboard.ts` | exact |
| `apps/web/components/admin/admin-sidebar.tsx` | component | request-response | existing `NAV_GROUPS` in same file | exact |
| `apps/web/components/admin/admin-user-management.tsx` | component | request-response | existing capability bundle editor in same file | exact |
| `docs/runbooks/phase27-event-day-playbooks.md` | utility/docs | batch | `docs/runbooks/phase26-cutover-ops.md` | role-match |
| `.planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md` | utility/docs | batch | `26-GATE-LEDGER.md` evidence language + Phase 26 runbook rules | partial |
| `apps/api/src/modules/field-operations/field-check-in.service.spec.ts` | test | request-response/event-driven | `qr-ticket.service.spec.ts` | exact |
| `apps/api/src/modules/field-operations/offline-sync.service.spec.ts` | test | batch/event-driven | `admin-booking.service.spec.ts` transaction/audit tests | role-match |
| `apps/api/src/modules/field-operations/field-monitor.service.spec.ts` | test | aggregate/read | `admin-dashboard.service.spec.ts` / `admin-booking.service.spec.ts` | role-match |
| `apps/api/src/modules/admin/settlement-export.service.spec.ts` | test | file-I/O | `csv-export.util.spec.ts` + `admin-booking.service.spec.ts` | exact |
| `apps/web/components/field/__tests__/qr-ticket-image.test.tsx` | test | transform | `phase26-qr-visibility.spec.ts` raw-token assertions + RTL component tests | role-match |
| `apps/web/components/field/__tests__/scanner-check-in.test.tsx` | test | request-response/event-driven | `reservation-export-panel.test.tsx` | role-match |
| `apps/web/components/field/__tests__/field-monitor.test.tsx` | test | request-response | admin component tests + `AdminBookingDashboard` pattern | role-match |
| `apps/web/components/admin/__tests__/settlement-dashboard.test.tsx` | test | file-I/O/request-response | `reservation-export-panel.test.tsx` | exact |
| `apps/web/e2e/phase27-qr-check-in.spec.ts` | test | request-response/event-driven | `phase26-qr-visibility.spec.ts` | exact |
| `apps/web/e2e/phase27-offline-sync.spec.ts` | test | event-driven | `admin-export-and-seat-ops.spec.ts` route/mutation E2E pattern | role-match |

## Pattern Assignments

### `packages/shared/src/schemas/field-operations.schema.ts` and admin capability updates

**Analog:** `packages/shared/src/schemas/admin-operations.schema.ts`

**Imports/schema pattern** (lines 1-3, 60-68):
```ts
import { z } from 'zod';

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

export const adminCapabilitySchema = z.enum(ADMIN_CAPABILITIES);
```

**Capability/bundle pattern** (lines 3-23, 28-58):
```ts
export const ADMIN_CAPABILITIES = [
  'event.write',
  'event.publish',
  'support.manage',
  'support.escalate',
  'reservations.export_raw',
  'seat.disable',
  'seat.reactivate',
  'seat.manual_open',
  'banner.manage',
  'audit.read',
  'security.manage',
] as const;

export const ADMIN_CAPABILITY_BUNDLE_CAPABILITIES = {
  operator: ['event.write', 'support.manage', 'support.escalate', 'seat.disable', 'seat.reactivate', 'seat.manual_open', 'banner.manage'],
  finance: ['reservations.export_raw', 'audit.read'],
  admin: ADMIN_CAPABILITIES,
} as const;
```

**Apply:** Add scanner-only capabilities here, for example `field.scan.verify`, `field.scan.consume`, `field.scan.sync`, and a `scanner` bundle containing only those scan capabilities. Do not add settlement/export/refund/security capabilities to `scanner`.

**Permission update validation pattern** (lines 373-406):
```ts
export const adminUserPermissionUpdateSchema = z
  .object({
    role: adminUserRoleSchema,
    adminCapabilityBundle: adminCapabilityBundleSchema.nullable().optional(),
    adminCapabilities: z.array(adminCapabilitySchema).default([]),
    reason: z.string({ required_error: '권한 변경 사유를 입력해주세요' }).trim().min(1).max(500),
    confirmed: z.literal(true, {
      errorMap: () => ({ message: '권한 변경 확인이 필요합니다' }),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'admin' && !value.adminCapabilityBundle) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adminCapabilityBundle'], message: '관리자 권한 묶음이 필요합니다' });
    }
  });
```

**Test pattern:** `packages/shared/src/schemas/admin-operations.schema.test.ts` lines 19-42 asserts the exact capability list and bundle exclusions. Add scanner bundle tests proving `scanner` contains field scan capabilities and does not contain `reservations.export_raw`, `security.manage`, refund, content, or user-management capabilities.

---

### `packages/shared/src/types/admin-operations.types.ts`

**Analog:** same file, `resolveAdminCapabilitySnapshot()`

**Resolver pattern** (lines 89-155):
```ts
export function resolveAdminCapabilitySnapshot(
  user: AdminCapabilityUser | null | undefined,
): AdminCapabilitySnapshot {
  if (!user) {
    return { bundle: null, capabilities: [], superuser: false };
  }

  if (user.adminCapabilityBundle === 'admin') {
    return { bundle: 'admin', capabilities: ADMIN_CAPABILITIES, superuser: true };
  }

  if (user.adminCapabilityBundle) {
    const explicitCapabilities = user.adminCapabilities?.length
      ? normalizeAdminCapabilities(user.adminCapabilities)
      : ADMIN_CAPABILITY_BUNDLE_CAPABILITIES[user.adminCapabilityBundle];

    return { bundle: user.adminCapabilityBundle, capabilities: explicitCapabilities, superuser: false };
  }

  return { bundle: null, capabilities: [], superuser: false };
}
```

**Apply:** `scanner` should be a non-superuser bundle. Keep full `role === 'admin'` fallback behavior unless planner intentionally tightens legacy behavior; scanner-only access is enforced by capabilities, not by a new role.

---

### `apps/api/src/database/schema/ticket-scan-events.ts`

**Analog:** `apps/api/src/database/schema/admin-audit-logs.ts`, `booking-operation-audit-logs.ts`, `tickets.ts`

**Drizzle table pattern** (`admin-audit-logs.ts` lines 36-80):
```ts
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    action: adminAuditActionEnum('action').notNull(),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    resourceId: varchar('resource_id', { length: 160 }).notNull(),
    status: adminAuditStatusEnum('status').notNull(),
    reason: text('reason'),
    changedFields: jsonb('changed_fields').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_admin_audit_logs_actor_user_id').on(table.actorUserId),
    index('idx_admin_audit_logs_action').on(table.action),
    index('idx_admin_audit_logs_resource').on(table.resourceType, table.resourceId),
  ],
);
```

**Ticket reference pattern** (`tickets.ts` lines 21-55):
```ts
export const tickets = pgTable('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id, { onDelete: 'cascade' }),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  showtimeId: uuid('showtime_id').notNull().references(() => showtimes.id, { onDelete: 'cascade' }),
  qrTokenJti: varchar('qr_token_jti', { length: 200 }).notNull().unique(),
  status: ticketStatusEnum('status').notNull().default('active'),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('idx_tickets_reservation_id').on(table.reservationId),
  index('idx_tickets_showtime_id').on(table.showtimeId),
  index('idx_tickets_status').on(table.status),
]);
```

**Apply:** Model scan events as append-only evidence. Include `ticketId`, `reservationId`, `showtimeId`, `scannerUserId`, `result`, `source` (`online`/`offline_sync`), `deviceAttemptId`, `maskedJti` or redacted token reference, `rejectionReason`, `priorScanEventId`, `scannedAt`, `syncedAt`, and metadata JSON with no raw token/PII. Index showtime/result/scanner/deviceAttemptId/createdAt. Add export in `schema/index.ts` using the existing export style at lines 46-56.

---

### `apps/api/src/database/migrations/0023_phase27_ticket_scan_events.sql`

**Analog:** `0012_phase24_booking_core.sql`, `0015_phase25_admin_operations_console.sql`

**Create table + constraints pattern** (`0012_phase24_booking_core.sql` lines 68-86, 123-142):
```sql
CREATE TABLE "tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reservation_id" uuid NOT NULL,
  "payment_id" uuid NOT NULL,
  "showtime_id" uuid NOT NULL,
  "qr_token_jti" varchar(200) NOT NULL,
  "status" "ticket_status" DEFAULT 'active' NOT NULL,
  CONSTRAINT "tickets_qr_token_jti_unique" UNIQUE("qr_token_jti")
);

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_tickets_showtime_id" ON "tickets" USING btree ("showtime_id");
```

**Admin audit migration pattern** (`0015_phase25_admin_operations_console.sql` lines 37-52):
```sql
"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
"masked_before_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
"masked_after_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
"ip_address" varchar(45),
"user_agent" varchar(500),
"request_id" varchar(120),
"created_at" timestamp with time zone DEFAULT now() NOT NULL
```

**Apply:** Use Drizzle-generated SQL style if possible. If hand-written, keep `--> statement-breakpoint` convention and update `meta/_journal.json` only through drizzle-kit, not manually.

---

### `apps/api/src/modules/field-operations/field-check-in.controller.ts`

**Analog:** `apps/api/src/modules/admin/admin-booking.controller.ts`

**Guard + validation + capability pattern** (lines 15-28, 39-42, 65-92):
```ts
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBookingController {
  @Post('bookings/export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('reservations.export_raw')
  async exportBookings(
    @CurrentUser('id') operatorUserId: string,
    @Body(new ZodValidationPipe(adminReservationExportFilterSchema)) body: AdminReservationExportFilter,
  ) { /* service call */ }
}
```

**Apply:** Use a controller path such as `@Controller('field/check-in')` or `@Controller('admin/field/check-in')`, but keep `@UseGuards(RolesGuard, AdminCapabilitiesGuard)` and scanner capabilities on every verify/consume/sync endpoint. `verify` must not update ticket state; `consume` does. For logged-out users, the API remains protected by the global `JwtAuthGuard` in `AppModule` lines 82-90.

---

### `apps/api/src/modules/field-operations/field-check-in.service.ts`

**Analog:** `apps/api/src/modules/ticket/qr-ticket.service.ts` and `apps/api/src/modules/admin/admin-booking.service.ts`

**QR token verification pattern** (`qr-ticket.service.ts` lines 232-262):
```ts
async verifyTicketToken(token: string): Promise<QrTicketTokenPayload> {
  const decoded = this.jwtService.decode<Record<string, unknown> | null>(token);
  const secretVersion = decoded && typeof decoded === 'object' && typeof decoded['secretVersion'] === 'string'
    ? decoded['secretVersion']
    : null;

  if (!secretVersion) {
    throw new UnauthorizedException('유효하지 않은 QR 티켓입니다');
  }

  const verified = await this.jwtService.verifyAsync<QrTicketTokenPayload>(token, {
    secret: this.getVerificationSecret(secretVersion),
    algorithms: ['HS256'],
  });

  await this.requireValidTicketState(verified);
  return verified;
}
```

**Scanner redaction pattern** (`qr-ticket.service.ts` lines 264-311):
```ts
async verifyTicketForScannerContract(token: string): Promise<QrTicketScannerContract> {
  const payload = await this.verifyTicketToken(token);
  const [row] = await this.db
    .select({
      ticketStatus: tickets.status,
      reservationId: reservations.id,
      paymentId: payments.id,
      showtimeId: showtimes.id,
      performanceTitle: performances.title,
      showtimeAt: showtimes.dateTime,
      venueName: venues.name,
    })
    .from(tickets)
    .innerJoin(reservations, eq(tickets.reservationId, reservations.id))
    .innerJoin(payments, eq(tickets.paymentId, payments.id))
    .where(and(eq(tickets.qrTokenJti, payload.jti), eq(reservations.status, 'CONFIRMED'), eq(payments.status, 'DONE'), eq(tickets.status, 'active')));

  if (!row) throw new UnauthorizedException('사용할 수 없는 QR 티켓입니다');

  return { maskedJti: this.maskJti(payload.jti), verifiedAt: new Date().toISOString(), ... };
}
```

**Transactional audit pattern** (`admin-booking.service.ts` lines 603-626):
```ts
await this.db.transaction(async (tx) => {
  await tx.insert(bookingOperationAuditLogs).values(
    seatIdentities.map((seatIdentity) => ({
      operatorUserId,
      action: 'manual_open' as const,
      seatKey: seatIdentity.seatKey,
      reservationId,
      createdAt: now,
    })),
  );

  await this.auditService.write({
    actorUserId: operatorUserId,
    action: 'seat.manual_open',
    resourceType: 'reservation',
    resourceId: reservationId,
    status: 'success',
    reason: auditReason,
    changedFields: ['seatStatus'],
  }, tx);
});
```

**Apply:** `consume` should use one DB transaction with a conditional update against `tickets.status='active'` and `usedAt IS NULL`, insert a scan event for both success and duplicate/rejected outcomes, and write admin audit evidence if it changes ticket state. Do not call `verifyTicketForScannerContract()` from a GET/page load in a way that marks `usedAt`.

---

### `apps/api/src/modules/field-operations/offline-sync.service.ts`

**Analog:** `admin-booking.service.ts` transaction/audit and `qr-ticket.service.ts` server re-verification

**Core pattern:** Treat each offline attempt as untrusted input. Re-run the same server verification path, resolve to `synced` or `rejected`, and insert scan events with `source='offline_sync'`. Use `deviceAttemptId` uniqueness for idempotency.

**Error handling pattern:** Follow local services: throw `BadRequestException` for malformed business inputs, `UnauthorizedException` for unusable/tampered QR tokens, `ConflictException` for duplicate/already-used where the client needs an explicit outcome, and log only redacted token/JTI.

**No exact analog:** There is no existing IndexedDB/offline sync service in the repo; use `RESEARCH.md` `idb` pattern for browser persistence and server-side final authority.

---

### `apps/api/src/modules/field-operations/field-monitor.service.ts`

**Analog:** admin aggregate services and dashboard hooks

**Frontend query analog:** `apps/web/hooks/use-admin-dashboard.ts` lines 14-24:
```ts
const STALE_TIME = 30_000;
const FOCUS_REFETCH = false;

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['admin', 'dashboard', 'summary'],
    queryFn: () => apiClient.get<DashboardSummaryDto>('/api/v1/admin/dashboard/summary'),
    staleTime: STALE_TIME,
    refetchOnWindowFocus: FOCUS_REFETCH,
  });
}
```

**Apply:** Backend should return a summary object first: entered, not-entered, entry rate, duplicate, rejected, offline pending/synced, alerts, `lastUpdatedAt`. Logs are secondary and filtered. Use scan event table plus ticket/reservation/payment state; do not dump raw token/JTI/PII.

---

### `apps/api/src/modules/admin/admin-settlement.controller.ts` and `settlement-export.service.ts`

**Analog:** `admin-booking.controller.ts`, `admin-booking.service.ts`, `csv-export.util.ts`

**CSV controller pattern** (`admin-booking.controller.ts` lines 65-92):
```ts
@Post('bookings/export')
@UseGuards(AdminCapabilitiesGuard)
@AdminCapabilities('reservations.export_raw')
async exportBookings(
  @CurrentUser('id') operatorUserId: string,
  @Req() request: Request,
  @Res({ passthrough: true }) response: Response,
  @Body(new ZodValidationPipe(adminReservationExportFilterSchema)) body: AdminReservationExportFilter,
) {
  const result = await this.adminBookingService.exportReservations({ actorUserId: operatorUserId, filters: { ...body, exportType: 'raw_pii' } });
  response.set({
    'Content-Type': result.contentType,
    'Content-Disposition': `attachment; filename="${result.filename}"`,
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(Readable.from([result.csv]));
}
```

**CSV service pattern** (`admin-booking.service.ts` lines 411-462):
```ts
const reason = request.filters.reason?.trim();
if (!reason) {
  throw new BadRequestException('원본 CSV 내보내기 사유를 입력해주세요');
}

const rows = await this.selectReservationExportRows(filters);
const csv = safeCsvRows([
  RESERVATION_EXPORT_HEADERS,
  ...rows.map((row) => reservationExportRowToCsvValues(row)),
]);

await this.auditService.write({
  actorUserId: request.actorUserId,
  action: 'reservations.export_raw',
  resourceType: 'reservation_export',
  resourceId: RAW_EXPORT_TYPE,
  status: 'success',
  reason,
  changedFields: ['exportType', 'filters', 'rowCount'],
  after: { rowCount: rows.length },
});
```

**CSV escaping pattern** (`csv-export.util.ts` lines 1-15):
```ts
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

export function safeCsvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  const neutralized = FORMULA_PREFIX_PATTERN.test(text) ? `'${text}` : text;
  return `"${neutralized.replace(/"/g, '""')}"`;
}
```

**Apply:** Settlement exports must use `safeCsvRows` for entry status, no-show, reservation/payment/refund summary, and accounting input CSVs. Protect with finance/full-admin capability, not scanner capability. Require reason, filters, audit, `Cache-Control: no-store`, and non-PII filename.

---

### `apps/api/src/modules/admin/admin-audit.service.ts` and `admin-audit-logs.ts`

**Analog:** same files

**Audit action/write pattern** (`admin-audit.service.ts` lines 7-23, 81-105):
```ts
export const ADMIN_AUDIT_ACTIONS = [
  'event.publish',
  'refund.admin_refund',
  'seat.manual_open',
  'reservations.export_raw',
  'security.permission.update',
] as const;

async write(input: AdminAuditWriteInput, db: AdminAuditDb = this.db): Promise<{ id: string }> {
  const changedFields = resolveChangedFields(input);
  const [row] = await db
    .insert(adminAuditLogs)
    .values({
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      status: input.status,
      reason: input.reason ?? null,
      changedFields,
      maskedBeforeSnapshot: maskSnapshot(input.before, changedFields),
      maskedAfterSnapshot: maskSnapshot(input.after, changedFields),
    })
    .returning({ id: adminAuditLogs.id });
  return { id: row?.id ?? '' };
}
```

**Redaction pattern** (`admin-audit.service.ts` lines 236-259):
```ts
if (isIpKey(key) && typeof value === 'string') return maskIp(value);
if (isSensitiveScalarKey(key)) return '[redacted]';
if (normalized === 'rows' || normalized.includes('rawexportrows') || normalized.includes('csvrows')) ...
```

**Apply:** Extend enum/action list for `field.scan.verify`, `field.scan.consume`, `field.scan.offline_sync`, and `settlement.export`. Ensure scan audit snapshots contain masked ticket references only.

---

### `apps/api/src/modules/field-operations/field-operations.module.ts`, `apps/api/src/modules/admin/admin.module.ts`, `apps/api/src/app.module.ts`

**Analog:** `apps/api/src/modules/admin/admin.module.ts`, `apps/api/src/app.module.ts`

**Module registration pattern** (`admin.module.ts` lines 1-34, 35-69):
```ts
@Module({
  imports: [PerformanceModule, PaymentModule, BookingModule, RefundModule],
  controllers: [
    AdminPerformanceController,
    AdminBookingController,
    AdminOperationsController,
    AdminDashboardController,
  ],
  providers: [
    AdminService,
    AdminAuditService,
    AdminCapabilitiesGuard,
    AdminBookingService,
    AdminDashboardService,
  ],
})
export class AdminModule {}
```

**App imports pattern** (`app.module.ts` lines 63-80):
```ts
DrizzleModule,
HealthModule,
AuthModule,
UserModule,
AdminModule,
BookingModule,
PaymentModule,
ReservationModule,
QueueModule,
RefundModule,
```

**Apply:** Add `FieldOperationsModule` to `AppModule` imports. If settlement service lives inside `AdminModule`, register its controller/provider in the existing arrays. Reuse `AdminAuditService` via DI.

---

### `apps/web/components/field/qr-ticket-image.tsx`, `BookingComplete`, `ReservationDetail`

**Analog:** existing buyer QR cards in `BookingComplete` and `ReservationDetail`

**Buyer QR card pattern** (`booking-complete.tsx` lines 138-199):
```tsx
<Card className="w-full border-[#E9DFFF] bg-[#F8F5FF]">
  <CardContent className="space-y-4 py-5">
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-[#6C3CE0]" />
          <h2 className="text-base font-semibold text-gray-900">QR 티켓</h2>
        </div>
        <p className="text-sm text-gray-700">
          {isQrActive ? '결제가 완료되었습니다. QR 티켓을 바로 확인할 수 있습니다.' : '결제는 완료되었지만 QR 티켓을 확인하는 중입니다...'}
        </p>
      </div>
      <Badge className={isQrActive ? 'bg-[#F0FDF4] text-[#15803D] border-transparent' : 'bg-[#FFFBEB] text-[#8B6306] border-transparent'}>
        {isQrActive ? 'QR 활성' : '확인 중'}
      </Badge>
    </div>
  </CardContent>
</Card>
```

**Current anti-pattern to replace** (`booking-complete.tsx` lines 171-175; `reservation-detail.tsx` lines 232-235):
```tsx
<span className="block text-gray-500">티켓 ID</span>
<span className="font-semibold text-gray-900">
  {isQrActive ? maskIdentifier(booking.qrTicket?.jti) : '발급 대기'}
</span>
```

**Apply:** Replace visible masked JTI/Ticket ID metadata with a real QR element and minimal metadata: reservation number, title, showtime, seat(s), ticket status, final scanner-source-of-truth copy. Do not render raw token, raw JTI, JWT payload, or full URL as visible text. Use `qrcode.react` `QRCodeSVG` per `RESEARCH.md`; no local QR image analog exists.

---

### `apps/web/app/field/check-in/page.tsx` and `apps/web/components/field/scanner-check-in.tsx`

**Analog:** `apps/web/app/admin/layout.tsx`, `ReservationExportPanel`, `AdminBookingTable`

**Access denied/loading shell** (`admin/layout.tsx` lines 26-72):
```tsx
if (!isInitialized) {
  return <div className="flex min-h-screen items-center justify-center bg-[#F5F5F7] px-6">관리자 권한을 확인하고 있습니다.</div>;
}

if (!user || user.role !== 'admin') {
  return (
    <section role="alert" aria-labelledby="admin-access-denied-title" className="w-full max-w-lg rounded-lg border border-[#F3C7C7] bg-white p-6 shadow-sm">
      <h1 id="admin-access-denied-title">관리자 접근 권한이 없습니다</h1>
      <Button asChild><Link href="/auth">관리자 계정으로 로그인</Link></Button>
    </section>
  );
}
```

**Manual action gating pattern** (`reservation-export-panel.tsx` lines 75-101, 270-281):
```tsx
const canConfirm = reason.trim().length > 0 && !exportMutation.isPending;

function handleConfirmExport() {
  if (!canConfirm) return;
  exportMutation.mutate(payload);
}

<Button disabled={!canConfirm} onClick={handleConfirmExport} className="bg-[#C62828] hover:bg-[#A81F1F]">
  CSV 내보내기
</Button>
```

**Status table/badge pattern** (`admin-booking-table.tsx` lines 15-35, 121-160):
```tsx
const STATUS_CONFIG = {
  CONFIRMED: { label: '예매완료', className: 'bg-[#F0FDF4] text-[#15803D] border-transparent' },
  CANCELLED: { label: '취소완료', className: 'bg-[#FEF2F2] text-[#C62828] border-transparent' },
};

<Badge className={statusConfig.className}>{statusConfig.label}</Badge>
```

**Apply:** The scanner page should be a separate mobile-first shell, not the full admin sidebar. It should show verification result first, ticket identity second, then sticky `입장 처리` only for processable server result. Opening the page must call verify only. Normal members see `이 티켓을 검표할 권한이 없습니다`.

---

### `apps/web/components/field/offline-sync-status.tsx` and browser pending queue

**Analog:** no exact local offline queue analog; use UI state patterns above plus `RESEARCH.md` `idb` example.

**Local UI pattern:** Use the same badge colors and mutation gating from `AdminBookingTable` and `ReservationExportPanel`. Offline pending is amber and never green until sync succeeds.

**Apply:** If planner adds `apps/web/lib/field/offline-scan-store.ts`, use `idb` from research. Store `deviceAttemptId`, `showtimeId`, redacted QR reference/token reference, scanner account id, attemptedAt, and `syncState`; avoid buyer PII and never display raw token/JTI.

---

### `apps/web/components/field/field-monitor.tsx`

**Analog:** `AdminBookingDashboard`, `AdminStatCard`, `AdminBookingTable`

**KPI grid pattern** (`admin-booking-dashboard.tsx` lines 73-101 and `admin-stat-card.tsx` lines 26-38):
```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
  <AdminStatCard icon={Ticket} label="총 예매수" value={stats?.totalBookings ?? 0} format="count" />
  <AdminStatCard icon={Banknote} label="총 매출액" value={stats?.totalRevenue ?? 0} format="currency" />
  <AdminStatCard icon={RotateCcw} label="취소율" value={stats?.cancelRate ?? 0} format="percent" />
</div>

export function AdminStatCard({ label, value, icon: Icon, format }: AdminStatCardProps) {
  return (
    <div className="flex h-[100px] flex-col justify-between rounded-lg border bg-white p-4 shadow-sm">
      <Icon className="h-6 w-6 text-gray-400" />
      <p className="text-xl font-semibold text-gray-900">{formatValue(value, format)}</p>
    </div>
  );
}
```

**Filter/table pattern** (`admin-booking-dashboard.tsx` lines 103-133):
```tsx
<Input type="search" placeholder="예매번호 또는 예매자명 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
<Select value={filter} onValueChange={(v) => { setFilter(v); setPage(1); }}>
  <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
</Select>
<AdminBookingTable bookings={bookings} isLoading={isLoading} onRowClick={(id) => setSelectedBookingId(id)} />
```

**Apply:** First screen must be KPI-first, not raw logs. Add auto-refresh via React Query `refetchInterval: 10_000` for monitor hooks. Logs table should be secondary drill-down with search/filter by event, showtime, scan result, offline state, scanner account, time range.

---

### `apps/web/hooks/use-field-operations.ts` and `use-admin-settlement.ts`

**Analog:** `apps/web/hooks/use-reservations.ts`, `use-admin-dashboard.ts`

**Query/mutation pattern** (`use-reservations.ts` lines 31-51, 110-145):
```ts
export function useReservationDetail(id: string) {
  return useQuery({
    queryKey: ['reservations', id],
    queryFn: () => apiClient.get<ReservationDetail>(`/api/v1/reservations/${id}`),
    enabled: !!id,
  });
}

export function useReservationExport() {
  return useMutation({
    mutationFn: async (filters: ReservationExportPayload): Promise<ReservationExportDownload> => {
      const { accessToken } = useAuthStore.getState();
      const response = await fetch(apiUrl('/api/v1/admin/bookings/export'), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(filters),
      });
      if (!response.ok) throw new Error(await resolveExportErrorMessage(response));
      const blob = await response.blob();
      const filename = resolveExportFilename(response.headers.get('content-disposition'));
      downloadBlob(blob, filename);
      return { blob, filename };
    },
  });
}
```

**Apply:** Use stable query keys: `['field', 'check-in', tokenRef]`, `['field', 'monitor', filters]`, `['admin', 'settlement', filters]`. Use `fetch()` only for blob CSV downloads; use `apiClient` for JSON.

---

### `apps/web/app/admin/settlement/page.tsx` and `components/admin/settlement-dashboard.tsx`

**Analog:** `AdminBookingDashboard` and `ReservationExportPanel`

**Dashboard composition pattern** (`admin-booking-dashboard.tsx` lines 73-148):
```tsx
<h1 className="mb-6 text-xl font-semibold text-gray-900">예매 관리</h1>
<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">...</div>
<div className="mt-6"><ReservationExportPanel /></div>
<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">...</div>
<AdminBookingTable bookings={bookings} isLoading={isLoading} onRowClick={(id) => setSelectedBookingId(id)} />
```

**Sensitive export confirmation pattern** (`reservation-export-panel.tsx` lines 103-115, 250-281):
```tsx
<section className="space-y-4 rounded-lg bg-white p-4 shadow-sm" aria-labelledby="reservation-export-title">
  <h2 id="reservation-export-title" className="text-xl font-semibold leading-tight text-gray-900">
    예약자 CSV 내보내기
  </h2>
  <Button type="button" className="h-12 w-full sm:w-auto" onClick={() => setConfirmOpen(true)}>
    <Download className="h-4 w-4" />
  </Button>
</section>

<Textarea value={reason} onChange={(event) => setReason(event.target.value)} aria-label="내보내기 사유" />
<Button disabled={!canConfirm} onClick={handleConfirmExport}>CSV 내보내기</Button>
```

**Apply:** Settlement dashboard should use tabs max `요약`, `입장/노쇼`, `결제/환불`, `내보내기`; filters before exports; export buttons disabled until required event/showtime/date filters and reason exist. Scanner-only must be denied.

---

### `apps/web/components/admin/admin-sidebar.tsx`

**Analog:** same file

**Navigation group pattern** (lines 22-108, 129-160):
```tsx
const NAV_GROUPS = [
  { label: '개요', items: [{ label: '대시보드', href: '/admin', icon: LayoutDashboard }] },
  {
    label: '운영',
    items: [
      { label: '운영 인박스', href: '/admin/operations', icon: Inbox },
      { label: '예매 관리', href: '/admin/bookings', icon: Ticket },
      { label: '회원 관리', href: '/admin/users', icon: UsersRound },
    ],
  },
] as const;

{group.items.map((item) => {
  const isActive = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
  return <Link key={item.href} href={item.href} className={cn('flex min-h-11 items-center gap-3...', isActive ? 'border-l-[3px] border-primary...' : 'text-gray-600...')} />;
})}
```

**Apply:** Add full-admin/finance navigation for `현장 모니터` and `정산·내보내기` under 운영 only if the admin sidebar is capability-filtered. Scanner-only users should not render this sidebar; they use `/field/check-in` minimal shell.

---

### `apps/web/components/admin/admin-user-management.tsx` and tests

**Analog:** existing capability bundle editor

**Capability UI pattern** (`admin-user-management.tsx` lines 771-802):
```tsx
{ADMIN_CAPABILITY_BUNDLES.map((item) => (
  <SelectItem key={item} value={item}>{BUNDLE_LABELS[item]}</SelectItem>
))}

{ADMIN_CAPABILITIES.map((capability) => (
  <Checkbox
    key={capability}
    checked={capabilities.includes(capability)}
    onCheckedChange={(checked) => handleCapabilityChange(capability, checked)}
    aria-label={CAPABILITY_LABELS[capability]}
  />
))}
```

**Test pattern** (`admin-user-management.test.tsx` lines 308-370):
```ts
await user.click(securityCapability);
expect(submitButton).toBeDisabled();
await user.type(screen.getByLabelText('권한 변경 사유'), '보안 담당자 교체로 권한을 회수합니다.');
await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
expect(submitButton).toBeEnabled();
await user.click(submitButton);
await user.click(await screen.findByRole('button', { name: '변경 확정' }));
expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/admin/users/user-fan-1/permissions', expect.objectContaining({ confirmed: true }));
```

**Apply:** Add scanner bundle label and capability labels. Tests must assert scanner bundle can be selected and that reason + explicit confirmation remain required.

---

### `docs/runbooks/phase27-event-day-playbooks.md`

**Analog:** `docs/runbooks/phase26-cutover-ops.md`

**Runbook frontmatter/purpose pattern** (lines 1-19):
```md
---
phase: 26-m1-canary-cutover-gates
status: active_runbook
last_updated: 2026-05-20
scope: OPS-01 one-person cutover operations, monitoring evidence, WAF smoke, and incident handling
---

# Phase 26 Cutover Operations Runbook

## Purpose

이 runbook은 Phase 26 `OPS-01`의 one-person on-call 절차입니다.
```

**Operator rules pattern** (lines 33-45):
```md
## Operator Rules

1. Raw provider secrets, Toss keys, payment keys, QR tokens, cookies, bearer
   tokens, OTP values, full IPs, e-mail addresses, phone numbers, and PII must
   never be pasted into docs, commits, screenshots, or evidence artifacts.
```

**Procedure pattern** (lines 88-130):
```md
## Procedures

Each incident class below includes at least one dry-run command or read-only
query shape, plus an evidence path or evidence fields to record.

### PG / DB incident
...
Evidence path:
- `.planning/phases/.../evidence/...json`
Close-booking trigger:
- DB errors cause payment confirm, seat lock, reservation prepare, or QR issuance to become unsafe.
```

**Apply:** Create scenario cards/sections for forced refund, weather, facility, cast issue, on-site refund, and exchange. Include severity, affected scope, external contact placeholders with owner/date, console action links, evidence fields, and escalation/close-entry triggers.

---

### `.planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md`

**Analog:** `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md`

**Evidence truth pattern** (lines 1-15, 69-76):
```md
This ledger is the cutover source of truth...

Empty, missing, failed, blocked, unreviewed, or malformed rows are no-go.
`ACCEPTED_RISK` and `CONFIG_READY_NOT_DRILLED` are never `PASS`.

Evidence must be redacted. Do not store raw Toss keys, payment keys, QR tokens,
cookies, OTP values, raw customer rows, or unmasked PII in this ledger.

## Operator Rules
- `PASS` requires direct evidence.
- `FAIL` and `BLOCKED` are no-go.
- Empty evidence is no-go.
```

**Apply:** Retrospective must include incidents, non-incidents, improvements, next-event carry-forward, field scan/offline/settlement evidence, and v2.0 completion evidence. It is a planning artifact, not an admin UI.

## Shared Patterns

### Authentication And Scanner-Only Authorization

**Source:** `apps/api/src/common/guards/admin-capabilities.guard.ts` lines 14-39 and `admin-booking.controller.ts` lines 39-42, 65-68  
**Apply to:** all field check-in, offline sync, monitor, settlement export endpoints

```ts
@UseGuards(RolesGuard)
@Roles('admin')
@UseGuards(AdminCapabilitiesGuard)
@AdminCapabilities('reservations.export_raw')
```

Scanner-only should be implemented as a capability bundle on existing admin accounts, not a new auth system. Full admin remains superuser; scanner bundle is non-superuser and minimal.

### QR Verification And Redaction

**Source:** `apps/api/src/modules/ticket/qr-ticket.service.ts` lines 232-311 and spec lines 444-524  
**Apply to:** field verify/consume/sync services, QR E2E tests

```ts
const verified = await this.jwtService.verifyAsync<QrTicketTokenPayload>(token, {
  secret: this.getVerificationSecret(secretVersion),
  algorithms: ['HS256'],
});
await this.requireValidTicketState(verified);
...
maskedJti: this.maskJti(payload.jti),
```

Tests should assert serialized scanner result does not contain raw token or full JTI.

### Audit And Redaction

**Source:** `apps/api/src/modules/admin/admin-audit.service.ts` lines 81-105, 236-259  
**Apply to:** scan consume, offline sync, settlement export, scanner permission changes

```ts
maskedBeforeSnapshot: maskSnapshot(input.before, changedFields),
maskedAfterSnapshot: maskSnapshot(input.after, changedFields),
```

Do not put raw QR token, raw JTI, full user-agent, raw CSV rows, email, phone, payment key, or unmasked IP in audit snapshots.

### CSV Export Safety

**Source:** `apps/api/src/modules/admin/csv-export.util.ts` lines 1-15 and `csv-export.util.spec.ts` lines 13-30  
**Apply to:** every Phase 27 settlement CSV

```ts
const neutralized = FORMULA_PREFIX_PATTERN.test(text) ? `'${text}` : text;
return `"${neutralized.replace(/"/g, '""')}"`;
```

Never build CSV with manual `.join(',')`.

### Admin UI Density

**Source:** `AdminBookingDashboard`, `AdminStatCard`, `AdminBookingTable`, `ReservationExportPanel`  
**Apply to:** field monitor and settlement dashboard

Use white cards/tables on `#F5F5F7`, `rounded-lg`, compact KPI cards, shadcn `Input`/`Select`/`Table`/`Badge`/`Dialog`, and lucide icons. Keep scanner mobile shell separate from admin sidebar.

### Test Patterns

**API Vitest:** `qr-ticket.service.spec.ts` uses fake timers, helper row factories, chainable DB mocks, and explicit rejection tests.  
**Web component tests:** `reservation-export-panel.test.tsx` mocks hooks, uses `@testing-library/react`, `userEvent`, and asserts disabled states before confirmation.  
**Playwright E2E:** `phase26-qr-visibility.spec.ts` uses `page.route()` to mock API responses and `expectNoRawSecrets()` to assert raw secrets are absent.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/web/components/field/qr-ticket-image.tsx` | component | transform | No existing QR image renderer; use `qrcode.react` from `RESEARCH.md`. |
| `apps/web/lib/field/offline-scan-store.ts` or equivalent | utility | event-driven/file-I/O | No IndexedDB/idb store exists; use `idb` research pattern and local UI/test conventions. |
| `apps/api/src/modules/field-operations/offline-sync.service.ts` | service | batch/event-driven | No existing offline conflict resolver; reuse QR verification, transaction, and audit patterns. |
| `apps/api/src/database/schema/ticket-scan-events.ts` | model | event-driven | No scan-event table exists; closest are admin/booking audit logs. |
| `.planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md` | docs | batch | No exact retrospective product artifact; use gate ledger evidence rules and runbook redaction rules. |

## Metadata

**Analog search scope:** `apps/api/src/modules`, `apps/api/src/common`, `apps/api/src/database`, `apps/web/components`, `apps/web/app`, `apps/web/hooks`, `apps/web/e2e`, `packages/shared/src`, `docs/runbooks`, `.planning/phases/26-*`  
**Files scanned:** 120+ via `rg --files` and targeted `rg` searches  
**Pattern extraction date:** 2026-05-22  
**Project skills:** `.codex/skills` / `.agents/skills` project directories absent  
**Primary analog groups:** QR token service, admin capability guard/schema/types, admin audit/export, Drizzle schema/migrations, admin dashboard/table/filter UI, Vitest/RTL/Playwright tests
