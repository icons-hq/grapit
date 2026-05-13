# Phase 25: Admin Operations Console - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 34 module groups
**Analogs found:** 31 / 34

## File Classification

| New/Modified File Or Module Group | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/web/app/admin/layout.tsx` | component | request-response | `apps/web/app/admin/layout.tsx` | exact |
| `apps/web/components/admin/admin-sidebar.tsx` | component | request-response | `apps/web/components/admin/admin-sidebar.tsx` | exact |
| `apps/web/app/admin/operations/page.tsx` | component | CRUD | `apps/web/app/admin/translations/page.tsx` | role-match |
| `apps/web/components/admin/operations-inbox.tsx` | component | CRUD | `apps/web/components/admin/translation-review-table.tsx` + `consent-audit-table.tsx` | partial |
| `apps/web/components/admin/event-publish-confirmation-dialog.tsx` | component | request-response | `apps/web/components/admin/admin-booking-detail-modal.tsx` | role-match |
| `apps/web/components/admin/performance-form.tsx` | component | CRUD + file-I/O | `apps/web/components/admin/performance-form.tsx` | exact |
| `apps/web/components/admin/banner-manager.tsx` | component | CRUD + file-I/O | `apps/web/components/admin/banner-manager.tsx` | exact |
| `apps/web/components/admin/reservation-export-panel.tsx` | component | file-I/O | `apps/web/components/admin/consent-audit-table.tsx` | partial |
| `apps/web/components/admin/seat-operations-panel.tsx` | component | CRUD + event-driven | `apps/web/components/admin/admin-booking-detail-modal.tsx` | role-match |
| `apps/web/components/admin/admin-audit-table.tsx` | component | CRUD | `apps/web/components/admin/consent-audit-table.tsx` | exact |
| `apps/web/app/admin/security/page.tsx` | component | request-response | `apps/web/components/admin/consent-audit-table.tsx` | role-match |
| `apps/web/hooks/use-admin.ts` | hook | request-response + CRUD | `apps/web/hooks/use-admin.ts` | exact |
| `apps/web/hooks/use-reservations.ts` | hook | request-response + CRUD | `apps/web/hooks/use-reservations.ts` | exact |
| `packages/shared/src/constants/locales.ts` | config | transform | `packages/shared/src/constants/locales.ts` | exact |
| `packages/shared/src/schemas/admin-operations.schema.ts` | model | CRUD | `packages/shared/src/schemas/performance.schema.ts` + `booking.schema.ts` | role-match |
| `packages/shared/src/types/admin-operations.types.ts` | model | transform | `packages/shared/src/types/booking.types.ts` | role-match |
| `packages/shared/src/schemas/performance.schema.ts` | model | CRUD | `packages/shared/src/schemas/performance.schema.ts` | exact |
| `apps/api/src/modules/admin/admin.module.ts` | config | request-response | `apps/api/src/modules/admin/admin.module.ts` | exact |
| `apps/api/src/modules/admin/admin-performance.controller.ts` | controller | request-response | `apps/api/src/modules/admin/admin-performance.controller.ts` | exact |
| `apps/api/src/modules/admin/admin-banner.controller.ts` | controller | request-response | `apps/api/src/modules/admin/admin-banner.controller.ts` | exact |
| `apps/api/src/modules/admin/admin-booking.controller.ts` | controller | request-response | `apps/api/src/modules/admin/admin-booking.controller.ts` | exact |
| `apps/api/src/modules/admin/admin-operations.controller.ts` | controller | request-response | `apps/api/src/modules/translation/translation.controller.ts` | role-match |
| `apps/api/src/modules/admin/admin-audit.controller.ts` | controller | request-response | `apps/api/src/modules/consent/consent-audit.controller.ts` | exact |
| `apps/api/src/modules/admin/admin-security.controller.ts` | controller | request-response | `apps/api/src/modules/consent/consent-audit.controller.ts` | partial |
| `apps/api/src/modules/admin/admin.service.ts` | service | CRUD | `apps/api/src/modules/admin/admin.service.ts` | exact |
| `apps/api/src/modules/admin/admin-booking.service.ts` | service | CRUD + event-driven | `apps/api/src/modules/admin/admin-booking.service.ts` | exact |
| `apps/api/src/modules/admin/admin-operations.service.ts` | service | CRUD + batch | `apps/api/src/modules/translation/translation.service.ts` | partial |
| `apps/api/src/modules/admin/admin-audit.service.ts` | service | CRUD | `apps/api/src/modules/consent/consent.service.ts` | role-match |
| `apps/api/src/common/guards/admin-capabilities.guard.ts` | middleware | request-response | `apps/api/src/common/guards/roles.guard.ts` | role-match |
| `apps/api/src/common/request-ip.ts` | utility | transform | `apps/api/src/common/request-ip.ts` | exact |
| `apps/api/src/database/schema/admin-audit-logs.ts` | model | CRUD | `apps/api/src/database/schema/booking-operation-audit-logs.ts` | role-match |
| `apps/api/src/database/schema/support-*.ts` | model | CRUD + batch | none exact; `translation-sources.ts`, `translation-drafts.ts` partial | no exact |
| `apps/api/src/database/schema/seat-operation-history.ts` | model | CRUD + event-driven | `booking-operation-audit-logs.ts` + `seat-inventories.ts` | role-match |
| `apps/api/src/database/migrations/0015_phase25_admin_operations_console.sql` | migration | batch | `0012_phase24_booking_core.sql` + `0014_locale_ja_drop_zh_tw.sql` | role-match |

## Pattern Assignments

### Admin Shell And Navigation

**Apply to:** `apps/web/app/admin/layout.tsx`, `apps/web/components/admin/admin-sidebar.tsx`, new `/admin/*` routes.

**Analog:** `apps/web/app/admin/layout.tsx`

**Auth shell pattern** (lines 21-33):
```tsx
const user = useAuthStore((s) => s.user);
const isInitialized = useAuthStore((s) => s.isInitialized);

useEffect(() => {
  if (isInitialized && (!user || user.role !== 'admin')) {
    router.replace('/');
  }
}, [isInitialized, user, router]);

if (!isInitialized || !user || user.role !== 'admin') {
  return null;
}
```

**Admin workspace pattern** (lines 41-72):
```tsx
<div className="flex min-h-screen">
  <AdminSidebar />
  <div className="flex flex-1 flex-col">
    <header className="sticky top-0 z-40 flex h-16 items-center border-b bg-white px-6">
      ...
    </header>
    <main className="flex-1 bg-[#F5F5F7] p-8">{children}</main>
  </div>
</div>
```

**Navigation item pattern** from `apps/web/components/admin/admin-sidebar.tsx` (lines 15-46, 58-78):
```tsx
const NAV_ITEMS = [
  { label: '대시보드', href: '/admin', icon: LayoutDashboard },
  { label: '공연 관리', href: '/admin/performances', icon: Theater },
  { label: '번역 검수', href: '/admin/translations', icon: Languages },
] as const;

<Link
  className={cn(
    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
    isActive
      ? 'border-l-[3px] border-primary bg-primary/5 text-primary'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  )}
>
  <Icon className="h-5 w-5" />
  {item.label}
</Link>
```

**Planner note:** Phase 25 should improve unauthorized UI to an explicit access-denied state, but keep backend guard authoritative.

---

### Dense Admin Tables, Inbox, Audit, And Export UI

**Apply to:** `operations-inbox.tsx`, `admin-audit-table.tsx`, `reservation-export-panel.tsx`, `seat-operations-panel.tsx`.

**Analog:** `apps/web/components/admin/consent-audit-table.tsx`

**Filter bar pattern** (lines 101-120, 149-205):
```tsx
function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  onSearch(compactFilters({ user: user.trim(), item: item.trim(), from, to }));
}

<form
  onSubmit={handleSubmit}
  className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4"
>
  <Select value={language} onValueChange={(value) => setLanguage(value as 'all' | ConsentAuditLanguage)}>
    <SelectTrigger id="consent-audit-language" className="h-11 w-full rounded-lg border-gray-200 bg-white text-base">
      <SelectValue />
    </SelectTrigger>
  </Select>
  <Button type="submit" className="h-11 w-full">
    <Search className="h-4 w-4" />
    조회
  </Button>
</form>
```

**Table state pattern** (lines 208-290):
```tsx
{isError && (
  <div role="alert" className="border-b bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828]">
    정보를 불러오지 못했습니다. 새로고침 후 다시 시도하고, 반복되면 운영자에게 문의하세요.
  </div>
)}
<Table>
  <TableHeader>
    <TableRow className="bg-[#F5F5F7]">...</TableRow>
  </TableHeader>
  <TableBody>
    {isLoading && Array.from({ length: 5 }).map((_, index) => (
      <TableRow key={`consent-audit-skeleton-${index}`} data-testid="consent-audit-skeleton-row">
        <TableCell><Skeleton className="h-4 w-36" /></TableCell>
      </TableRow>
    ))}
    {!isLoading && auditRows.length === 0 && (
      <TableRow>
        <TableCell colSpan={7} className="py-12 text-center">...</TableCell>
      </TableRow>
    )}
  </TableBody>
</Table>
```

**Clickable row pattern** (lines 257-285):
```tsx
<TableRow
  role="button"
  tabIndex={0}
  className="min-h-11 cursor-pointer hover:bg-gray-50"
  aria-label={`${row.itemKey} 동의 감사 상세 보기`}
  onClick={() => onRowOpen(row)}
  onKeyDown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowOpen(row);
    }
  }}
>
  <TableCell className="text-sm font-semibold">{row.itemKey}</TableCell>
</TableRow>
```

**Translation queue table analog** from `translation-review-table.tsx` (lines 26-57, 151-178):
```tsx
const STATUS_CONFIG = {
  review: { label: '검수 필요', className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent' },
  published: { label: '게시됨', className: 'bg-[#F0FDF4] text-[#15803D] border-transparent' },
  legal_blocked: { label: '자동 번역 불가', className: 'bg-[#FEF2F2] text-[#C62828] border-transparent' },
};

<TableRow className={cn('min-h-11 cursor-pointer hover:bg-gray-50', selectedDraftId === row.id && 'bg-[#F3EFFF]')}>
  <TableCell className="max-w-[220px] font-semibold"><span className="line-clamp-2">{title}</span></TableCell>
  <TableCell><Badge className={status.className}>{status.label}</Badge></TableCell>
</TableRow>
```

**Use for Phase 25:** SLA chips should copy this text+color badge pattern, not color-only row styling. Use red for `즉시 확인` and overdue; amber for due-soon/accepted-risk.

---

### Event Registration, Publish Confirmation, And Sale Settings

**Apply to:** `performance-form.tsx`, `event-publish-confirmation-dialog.tsx`, performance publish APIs/schemas.

**Analog:** `apps/web/components/admin/performance-form.tsx`

**Imports and form setup** (lines 3-26, 159-184):
```tsx
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createPerformanceSchema, type CreatePerformanceInput } from '@grabit/shared';
import { useCreatePerformance, useUpdatePerformance, usePresignedUpload } from '@/hooks/use-admin';

const form = useForm<CreatePerformanceFormInput, unknown, CreatePerformanceInput>({
  resolver: zodResolver(createPerformanceSchema),
  mode: 'onBlur',
  defaultValues: initialData ? mapToFormValues(initialData) : { ... },
});
```

**Submit and error pattern** (lines 271-308):
```tsx
async function onSubmit(data: CreatePerformanceInput) {
  const duplicateFloorKeys = findDuplicateFloorKeys(data.seatMaps ?? []);
  if (duplicateFloorKeys.length > 0) {
    setSeatMapDuplicateError(correctionMessage);
    toast.error('중복된 floorKey를 수정한 뒤 다시 저장해주세요.');
    return;
  }

  try {
    if (mode === 'create') await createMutation.mutateAsync(data);
    else if (performanceId) await updateMutation.mutateAsync(data);
    toast.success('공연이 저장되었습니다');
    router.push('/admin/performances');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '공연 저장에 실패했습니다.');
  }
}
```

**Booking policy controls** (lines 635-821):
```tsx
<div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
  <Controller
    control={form.control}
    name="bookingPolicy.allowedPaymentMethods"
    render={({ field }) => (
      <div className="grid gap-3 sm:grid-cols-2">
        {PERFORMANCE_ALLOWED_PAYMENT_METHODS.map((method) => (
          <label className="flex min-h-11 items-center gap-3 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-gray-900">
            <Checkbox checked={field.value?.includes(method) ?? false} onCheckedChange={...} />
            <span>{PAYMENT_METHOD_LABELS[method]}</span>
          </label>
        ))}
      </div>
    )}
  />
  <Controller
    control={form.control}
    name="bookingPolicy.manualOpenEnabled"
    render={({ field }) => (
      <Switch checked={field.value} onCheckedChange={field.onChange} />
    )}
  />
</div>
```

**Sticky action bar** (lines 854-873):
```tsx
<div className="sticky bottom-0 flex justify-end gap-3 border-t bg-white px-8 py-4">
  <Button type="button" variant="outline" onClick={() => router.push('/admin/performances')}>취소</Button>
  <Button type="submit" disabled={isSubmitting}>저장</Button>
</div>
```

**Confirmation dialog analog:** `apps/web/components/admin/admin-booking-detail-modal.tsx` lines 171-235:
```tsx
<Textarea
  id="refund-reason"
  placeholder="환불 사유를 입력하세요"
  value={refundReason}
  onChange={(e) => setRefundReason(e.target.value)}
/>
<Button
  variant="destructive"
  disabled={!refundReason.trim() || isRefunding}
  onClick={handleRefundConfirm}
>
  환불 확인
</Button>
```

**Use for Phase 25:** publish, raw CSV export, seat disable/reactivate, immediate open must copy the required reason/summary/disabled-until-valid pattern.

---

### Banner CRUD And Upload

**Apply to:** expanded banner schema/controller/service/UI.

**Analog:** `apps/web/components/admin/banner-manager.tsx`, `apps/api/src/modules/admin/admin-banner.controller.ts`, `apps/api/src/modules/admin/admin.service.ts`.

**Upload form pattern** from `banner-manager.tsx` (lines 35-60, 63-75):
```tsx
const handleImageUpload = useCallback(async (file: File) => {
  if (file.size > 5 * 1024 * 1024) {
    toast.error('이미지는 5MB 이하여야 합니다.');
    return;
  }
  const { uploadUrl, publicUrl } = await presignedUpload.mutateAsync({
    folder: 'banners',
    contentType: file.type,
    extension: ext,
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  setImageUrl(publicUrl);
  toast.success('배너 이미지가 업로드되었습니다.');
}, [presignedUpload]);
```

**Controller route ordering pattern** from `admin-banner.controller.ts` (lines 17-47):
```ts
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBannerController {
  @Post('banners')
  async createBanner(@Body(new ZodValidationPipe(createBannerSchema)) body: CreateBannerInput) {
    return this.adminService.createBanner(body);
  }

  // CRITICAL: Static route 'banners/reorder' MUST appear before dynamic 'banners/:id'
  @Put('banners/reorder')
  async reorderBanners(@Body() body: { orderedIds: string[] }) { ... }
}
```

**Service cache invalidation pattern** from `admin.service.ts` (lines 575-655):
```ts
async createBanner(input: CreateBannerInput): Promise<Banner> {
  const [result] = await this.db.insert(banners).values({ ... }).returning();
  await this.cacheService.invalidate('cache:home:banners');
  return { id: result!.id, imageUrl: result!.imageUrl, ... };
}

async reorderBanners(orderedIds: string[]): Promise<void> {
  await this.db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(banners).set({ sortOrder: i }).where(eq(banners.id, orderedIds[i]!));
    }
  });
  await this.cacheService.invalidate('cache:home:banners');
}
```

---

### Admin Hooks And React Query Invalidation

**Apply to:** new `useAdminOperations`, `useAdminAudit`, `useAdminSecurity`, `useSeatOperations`, `useReservationExport` hooks, or additions to `use-admin.ts`.

**Analog:** `apps/web/hooks/use-admin.ts`

**Search param builder pattern** (lines 87-128):
```ts
function buildTranslationQueueSearchParams(filters: TranslationQueueFilters) {
  const params = new URLSearchParams();
  if (filters.contentType) params.set('contentType', filters.contentType);
  if (filters.locale) params.set('locale', filters.locale);
  if (filters.status) params.set('status', filters.status);
  if (filters.updatedFrom) params.set('updatedFrom', toApiDateTime(filters.updatedFrom) ?? filters.updatedFrom);
  return params;
}
```

**Query + mutation invalidation pattern** (lines 150-219, 245-277, 321-371):
```ts
export function useTranslationQueue(filters: TranslationQueueFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'translations', filters],
    queryFn: () => apiClient.get<TranslationDraft[]>(`/api/v1/admin/translations/queue${query ? `?${query}` : ''}`),
  });
}

export function useReviewTranslationDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, translatedText }) =>
      apiClient.post<TranslationDraft>(`/api/v1/admin/translations/drafts/${draftId}/review`, { translatedText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'translations'] });
    },
  });
}
```

**Booking hook pattern** from `use-reservations.ts` (lines 52-94):
```ts
export function useAdminBookings(params: { status?: string; search?: string; page?: number }) {
  return useQuery({
    queryKey: ['admin', 'bookings', params],
    queryFn: () => apiClient.get(`/api/v1/admin/bookings?${searchParams.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useAdminRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => apiClient.post(`/api/v1/admin/bookings/${id}/refund`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
  });
}
```

---

### NestJS Admin Controllers, Guards, And Validation

**Apply to:** all new/modified admin controllers, capability guard, allowlist/security endpoints.

**Analog:** `admin-performance.controller.ts`, `admin-booking.controller.ts`, `consent-audit.controller.ts`, `roles.guard.ts`, `zod-validation.pipe.ts`.

**Controller guard + Zod pattern** from `admin-performance.controller.ts` (lines 27-69):
```ts
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminPerformanceController {
  @Post('performances')
  async createPerformance(
    @Body(new ZodValidationPipe(createPerformanceSchema)) body: CreatePerformanceInput,
  ) {
    return this.adminService.createPerformance(body);
  }
}
```

**Current-user sensitive action pattern** from `admin-booking.controller.ts` (lines 43-59):
```ts
@Post('bookings/:id/refund')
async refundBooking(
  @Param('id') id: string,
  @CurrentUser('id') operatorUserId: string,
  @Body(new ZodValidationPipe(adminRefundSchema)) body: AdminRefundInput,
) {
  await this.adminBookingService.refundBooking(id, operatorUserId, body.reason);
  return { message: '환불이 처리되었습니다' };
}
```

**Inline query schema pattern** from `consent-audit.controller.ts` (lines 1-31):
```ts
const consentAuditQuerySchema = z.object({
  itemKey: z.enum(CONSENT_ITEM_KEYS).optional(),
  version: z.string().min(1).optional(),
  language: z.enum(SUPPORTED_LOCALES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

@Get()
async queryAudit(@Query(new ZodValidationPipe(consentAuditQuerySchema)) query: ConsentAuditFilters) {
  return this.consentService.queryConsentAudit(query);
}
```

**Guard pattern** from `roles.guard.ts` (lines 9-20):
```ts
const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
  context.getHandler(),
  context.getClass(),
]);

if (!requiredRoles) return true;
const { user } = context.switchToHttp().getRequest() as { user: { role: string } };
return requiredRoles.includes(user.role);
```

**Validation error pattern** from `zod-validation.pipe.ts` (lines 21-29):
```ts
const result = this.schema.safeParse(value);
if (!result.success) {
  throw new BadRequestException({
    message: 'Validation failed',
    errors: result.error.flatten().fieldErrors,
  });
}
return result.data;
```

**Planner note:** new capability guard should keep `admin` as superuser compatibility and mirror `Reflector.getAllAndOverride` from `RolesGuard`.

---

### Admin Module Wiring

**Apply to:** `apps/api/src/modules/admin/admin.module.ts`.

**Analog:** `apps/api/src/modules/admin/admin.module.ts` (lines 1-34):
```ts
@Module({
  imports: [PerformanceModule, PaymentModule, BookingModule, RefundModule],
  controllers: [
    AdminPerformanceController,
    AdminBannerController,
    AdminBookingController,
    LocalUploadController,
    AdminDashboardController,
    AdminDiagnosticsController,
  ],
  providers: [
    AdminService,
    AdminBookingService,
    UploadService,
    AdminDashboardService,
  ],
})
export class AdminModule {}
```

**Use for Phase 25:** add new admin controllers/services here, and import supporting modules only when DI needs them. Do not create a separate admin app/service.

---

### Drizzle CRUD Transactions, Publish State, And Cache Invalidation

**Apply to:** publish lifecycle, event update audit, banner extension, support state changes.

**Analog:** `apps/api/src/modules/admin/admin.service.ts`

**Transactional create pattern** (lines 182-299):
```ts
const result = await this.db.transaction(async (tx) => {
  const [venue] = await tx.insert(venues).values(...).onConflictDoUpdate(...).returning();
  const [perf] = await tx.insert(performances).values(...).returning();
  await tx.insert(priceTiers).values(input.priceTiers.map(...));
  await this.replaceSeatMaps(tx as unknown as DrizzleDB, performanceId, input.seatMaps);
  await this.persistBookingPolicy(tx as unknown as DrizzleDB, performanceId, bookingPolicy);
  return { id: perf!.id, title: perf!.title, ... };
});

await this.invalidateCatalogCache();
return result;
```

**Partial update pattern** (lines 302-443):
```ts
const updateData: Record<string, unknown> = {};
if (input.title !== undefined) updateData['title'] = input.title;
if (input.description !== undefined) updateData['description'] = input.description;
updateData['updatedAt'] = new Date();

const [perf] = await tx.update(performances).set(updateData).where(eq(performances.id, id)).returning();
if (!perf) throw new NotFoundException(`공연을 찾을 수 없습니다 (id: ${id})`);

if (input.priceTiers) {
  await tx.delete(priceTiers).where(eq(priceTiers.performanceId, id));
  await tx.insert(priceTiers).values(input.priceTiers.map(...));
}
```

**Booking policy upsert** (lines 119-151):
```ts
await tx
  .insert(bookingPolicies)
  .values({ performanceId, maxTicketsPerUser, allowedPaymentMethods, manualOpenEnabled })
  .onConflictDoUpdate({
    target: bookingPolicies.performanceId,
    set: { maxTicketsPerUser, allowedPaymentMethods, manualOpenEnabled, updatedAt: new Date() },
  })
  .returning();
```

**Planner note:** event publish must not overload `performances.status`; current public enum is `upcoming|selling|closing_soon|ended` in `performances.ts` lines 11-28.

---

### Booking Manual-Open, Seat Operations, Audit, And WebSocket Broadcast

**Apply to:** `admin-booking.service.ts`, new seat operations service/controller, `seat-operation-history.ts`, reservation detail modal.

**Analog:** `apps/api/src/modules/admin/admin-booking.service.ts`

**Imports and DI pattern** (lines 1-77):
```ts
import { eq, and, sql, ilike, or, desc, inArray } from 'drizzle-orm';
import { reservations, reservationSeats, seatInventories, bookingPolicies, bookingOperationAuditLogs } from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { RefundService } from '../refund/refund.service.js';

@Injectable()
export class AdminBookingService {
  private readonly logger = new Logger(AdminBookingService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly bookingGateway: BookingGateway,
    private readonly refundService: RefundService,
  ) {}
}
```

**Manual-open validation + transaction + broadcast** (lines 289-377):
```ts
if (context.reservation.status !== 'CANCELLED') {
  throw new BadRequestException('수동 오픈은 취소된 예매에만 사용할 수 있습니다');
}
if (context.bookingPolicy?.manualOpenEnabled === false) {
  throw new BadRequestException('수동 오픈이 비활성화된 공연입니다');
}

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

  await tx.update(seatInventories).set({
    status: 'available',
    lockedBy: null,
    lockedUntil: null,
    soldAt: null,
    heldCancelledAt: null,
    reopenHoldUntil: null,
    reopenJobId: null,
  }).where(and(..., eq(seatInventories.status, 'held_cancelled')));
});

this.bookingGateway.broadcastSeatUpdate(showtimeId, seat.seatId, 'available');
```

**Gateway broadcast pattern** from `booking.gateway.ts` (lines 14-35, 77-86):
```ts
@WebSocketGateway({
  namespace: '/booking',
  cors: { origin: ..., credentials: true },
})
export class BookingGateway {
  @WebSocketServer()
  server!: Server;

  broadcastSeatUpdate(showtimeId: string, seatId: string, status: SeatState, userId?: string): void {
    this.server.to(`showtime:${showtimeId}`).emit('seat-update', { seatId, status, userId });
  }
}
```

**Test analog** from `admin-booking.service.spec.ts` (lines 120-180):
```ts
it('should reopen held cancelled seats immediately and write immutable manual-open audit rows', async () => {
  await service.manualOpen(reservationId, operatorUserId);
  expect(transaction.insertCalls[0]?.table).toBe(bookingOperationAuditLogs);
  expect(transaction.insertCalls[0]?.values).toEqual([
    expect.objectContaining({ operatorUserId, action: 'manual_open', seatKey: '2F:A-1', reservationId }),
  ]);
});
```

**Use for Phase 25:** disable/reactivate must mutate `seat_inventories`, write reasoned audit/history in the same transaction, then broadcast only after success.

---

### Masked Audit Query And Sensitive Data Handling

**Apply to:** `admin-audit-logs.ts`, `admin-audit.service.ts`, `admin-audit-table.tsx`, raw CSV export audit, allowlist denial/exception audit.

**Analog:** `apps/api/src/modules/consent/consent.service.ts`

**Audit row shape and filters** (lines 35-59):
```ts
export interface ConsentAuditFilters {
  itemKey?: ConsentItemKey;
  version?: string;
  language?: 'ko' | 'en' | 'th' | 'zh-CN' | 'ja';
  from?: string;
  to?: string;
  ip?: string;
  userId?: string;
  email?: string;
}

export interface MaskedConsentAuditRow {
  itemKey: string;
  version: string;
  maskedUser: { id: string; email: string; phone: string };
  maskedIp: string;
  timestamp: string;
}
```

**Audit query and masking pattern** (lines 131-192, 218-240):
```ts
const predicates: SQL[] = [];
if (filters.itemKey) predicates.push(eq(consentAuditLogs.itemKey, filters.itemKey));
if (filters.from) predicates.push(gte(consentAuditLogs.agreedAt, new Date(filters.from)));

const rows = predicates.length > 0 ? await baseQuery.where(and(...predicates)) : await baseQuery;

return rows.map((row) => ({
  maskedUser: {
    id: row.userId,
    email: ConsentService.maskEmail(row.email),
    phone: ConsentService.maskPhone(row.phone),
  },
  maskedIp: ConsentService.maskIp(row.ipAddress),
  timestamp: row.timestamp.toISOString(),
}));

static maskEmail(email: string): string { return `${visible}***@${domain}`; }
static maskPhone(phone: string): string { return `${phone.slice(0, 3)}${'*'.repeat(...)}${phone.slice(-2)}`; }
static maskIp(ipAddress: string): string { return `${octets[0]}.${octets[1]}.${octets[2]}.0`; }
```

**Trusted IP helper** from `apps/api/src/common/request-ip.ts` (lines 1-9):
```ts
export function resolveTrustedRequestIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || FALLBACK_IP;
  return isIP(ip) ? ip : FALLBACK_IP;
}
```

**Planner note:** raw CSV export audit must store actor, filters, type, timestamp, reason, status, IP/user-agent, but never exported row values.

---

### Translation Review And Locale Reconciliation

**Apply to:** locale constants, support multilingual content, event locale tabs, translation review states.

**Analog:** `packages/shared/src/constants/locales.ts`, `apps/api/src/modules/translation/translation.service.ts`, `apps/web/app/admin/translations/page.tsx`.

**Current drift source** from `locales.ts` (lines 1-11):
```ts
export const SUPPORTED_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'ja'] as const;
export const LOCALE_PREFIXES = {
  ko: '/',
  en: '/en',
  th: '/th',
  'zh-CN': '/zh-CN',
  'ja': '/ja',
} as const;
```

**Translation service locale/block pattern** (lines 15-19, 84-89, 135-145, 329-332):
```ts
export const TRANSLATION_TARGET_LOCALES = ['en', 'th', 'zh-CN', 'ja'] as const;
export type TranslationStatus = 'draft' | 'review' | 'published' | 'stale';
export type LegalBlockedContentType = 'legal' | 'notice' | 'refund' | 'booking_guide';

const LEGAL_BLOCKED_CONTENT_TYPES = new Set<string>(['legal', 'notice', 'refund', 'booking_guide']);

async generateDrafts(sourceId: string) {
  const source = await this.findSource(sourceId);
  this.assertTranslatableContentType(source.entityType);
  const drafts = await Promise.all(TRANSLATION_TARGET_LOCALES.map(async (locale) => ...));
  return drafts.map((draft) => this.mapDraft(draft, source));
}

assertTranslatableContentType(contentType: string): void {
  if (LEGAL_BLOCKED_CONTENT_TYPES.has(contentType)) {
    throw new BadRequestException('법적 고지는 자동 번역할 수 없습니다');
  }
}
```

**Review/publish transaction pattern** (lines 194-230, 233-279):
```ts
if (draft.status === 'stale') throw new BadRequestException('원문이 변경된 번역 초안은 다시 생성해야 합니다');
if (draft.status === 'published') throw new BadRequestException('이미 게시된 번역은 검수 상태로 되돌릴 수 없습니다');

const [published] = await this.db.transaction(async (tx) => {
  await tx.update(translationDrafts).set({ status: 'stale', updatedAt: new Date() }).where(and(...));
  return tx.update(translationDrafts)
    .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(translationDrafts.id, draftId))
    .returning();
});
```

**Frontend filter + split table/detail pattern** from `translations/page.tsx` (lines 88-203):
```tsx
<div className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-5">...</div>
{queue.isError && <div role="alert" className="rounded-lg bg-[#FEF2F2] p-4 text-sm font-semibold text-[#C62828]">...</div>}
<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
  <TranslationReviewTable rows={rows} isLoading={queue.isLoading} selectedDraftId={selectedDraft?.id ?? null} onSelectRow={setSelectedDraft} />
  <TranslationReviewDetailPanel draft={selectedDraft} onReviewDraft={...} onPublishDraft={...} />
</div>
```

**Detail panel disabled-state pattern** from `translation-review-detail-panel.tsx` (lines 49-75, 95-164):
```tsx
const canReview = draft.status === 'draft' && !isBlocked && !isStale && translatedText.trim().length > 0;
const canPublish = !isBlocked && !isStale && (draft.status === 'review' || reviewedDraftId === draft.id);

{isBlocked && (
  <div role="alert" className="mt-4 flex gap-2 rounded-lg bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]">
    법적 고지와 안내성 정책 문구는 자동 번역할 수 없습니다.
  </div>
)}
<Button disabled={!canReview || isReviewing}>검수 완료</Button>
<Button disabled={!canPublish || isPublishing}>게시</Button>
```

**Planner note:** Phase 25 UI-SPEC requires `ko,en,th,zh-CN,zh-TW`; current code uses `ja`. Treat locale reconciliation as Wave 0 before adding new multilingual surfaces.

---

### Shared Zod Schemas And Types

**Apply to:** `admin-operations.schema.ts`, additions to `performance.schema.ts`, booking/export schemas.

**Analog:** `packages/shared/src/schemas/performance.schema.ts`, `packages/shared/src/schemas/booking.schema.ts`.

**Enum/default/coercion pattern** (lines 17-44):
```ts
export const performanceQuerySchema = z.object({
  genre: z.enum(GENRES).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createBannerSchema = z.object({
  imageUrl: z.string().url('올바른 이미지 URL을 입력해주세요'),
  linkUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
```

**Nested validation + superRefine pattern** (lines 65-99):
```ts
export const performanceBookingPolicySchema = z.object({
  maxTicketsPerUser: z.number().int().positive('최대 예매 가능 매수는 1 이상이어야 합니다'),
  allowedPaymentMethods: z.array(z.enum(PERFORMANCE_ALLOWED_PAYMENT_METHODS)).min(1, '최소 1개의 결제 수단이 필요합니다'),
  manualOpenEnabled: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.cancelledSeatHoldMaxMinutes < value.cancelledSeatHoldMinMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '취소 좌석 hold 최대 시간은 최소 시간보다 작을 수 없습니다',
      path: ['cancelledSeatHoldMaxMinutes'],
    });
  }
});
```

**Export types pattern** (lines 160-164):
```ts
export type CreatePerformanceInput = z.infer<typeof createPerformanceSchema>;
export type CreatePerformanceFormInput = z.input<typeof createPerformanceSchema>;
export const updatePerformanceSchema = createPerformanceSchema.partial();
export type UpdatePerformanceInput = z.infer<typeof updatePerformanceSchema>;
```

---

### Drizzle Schema And Migration Naming

**Apply to:** all new schema files, enum additions, migration `0015_phase25_admin_operations_console.sql`, `schema/index.ts`.

**Analog:** `booking-operation-audit-logs.ts`, `seat-inventories.ts`, `translation-*.ts`, migrations `0012`, `0014`.

**Audit schema pattern** from `booking-operation-audit-logs.ts` (lines 1-42):
```ts
export const bookingOperationActionEnum = pgEnum('booking_operation_action', [
  'manual_open',
  'admin_refund',
]);

export const bookingOperationAuditLogs = pgTable(
  'booking_operation_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    operatorUserId: uuid('operator_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    action: bookingOperationActionEnum('action').notNull(),
    reservationId: uuid('reservation_id').notNull().references(() => reservations.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_booking_operation_audit_logs_operator_user_id').on(table.operatorUserId),
    index('idx_booking_operation_audit_logs_reservation_id').on(table.reservationId),
  ],
);
```

**Seat state schema gap** from `seat-inventories.ts` (lines 4-31):
```ts
export const seatStatusEnum = pgEnum('seat_status', [
  'available',
  'locked',
  'held_cancelled',
  'sold',
]);

export const seatInventories = pgTable('seat_inventories', {
  showtimeId: uuid('showtime_id').notNull().references(() => showtimes.id, { onDelete: 'cascade' }),
  floorKey: varchar('floor_key', { length: 20 }).notNull().default('1F'),
  seatKey: varchar('seat_key', { length: 80 }).notNull(),
  status: seatStatusEnum('status').notNull().default('available'),
}, (table) => [
  uniqueIndex('idx_seat_inv_showtime_floor_seat_key').on(table.showtimeId, table.floorKey, table.seatKey),
]);
```

**Translation relational schema pattern** from `translation-sources.ts` and `translation-drafts.ts`:
```ts
export const translationSources = pgTable('translation_sources', {
  entityType: varchar('entity_type', { length: 100 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  field: varchar('field', { length: 100 }).notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
}, (table) => [
  index('idx_translation_sources_entity_field').on(table.entityType, table.entityId, table.field),
]);

export const translationDrafts = pgTable('translation_drafts', {
  sourceId: uuid('source_id').notNull().references(() => translationSources.id, { onDelete: 'cascade' }),
  targetLocale: localeEnum('target_locale').notNull(),
  status: translationStatusEnum('status').notNull().default('draft'),
}, (table) => [
  uniqueIndex('idx_translation_drafts_one_published_per_source_locale')
    .on(table.sourceId, table.targetLocale)
    .where(sql`${table.status} = 'published'`),
]);
```

**Schema barrel export pattern** from `schema/index.ts` (lines 1-32):
```ts
export { translationSources, translationStatusEnum } from './translation-sources.js';
export { translationDrafts } from './translation-drafts.js';
export { seatInventories, seatStatusEnum } from './seat-inventories.js';
export {
  bookingOperationActionEnum,
  bookingOperationAuditLogs,
} from './booking-operation-audit-logs.js';
```

**Migration pattern** from `0012_phase24_booking_core.sql` (lines 1-14, 106-146):
```sql
CREATE TYPE "public"."booking_operation_action" AS ENUM('manual_open', 'admin_refund');--> statement-breakpoint
ALTER TYPE "public"."seat_status" ADD VALUE 'held_cancelled' BEFORE 'sold';--> statement-breakpoint
CREATE TABLE "booking_operation_audit_logs" (...);--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "floor_key" varchar(20) DEFAULT '1F' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_seat_inv_showtime_floor_seat_key" ON "seat_inventories" USING btree ("showtime_id","floor_key","seat_key");--> statement-breakpoint
```

**Locale migration drift pattern** from `0014_locale_ja_drop_zh_tw.sql` (lines 1-42):
```sql
ALTER TABLE "translation_drafts" ALTER COLUMN "target_locale" SET DATA TYPE text;--> statement-breakpoint
UPDATE "translation_drafts" SET "target_locale" = 'zh-CN' WHERE "target_locale" = 'zh-TW';--> statement-breakpoint
DROP TYPE "public"."locale";--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ko', 'en', 'th', 'zh-CN', 'ja');--> statement-breakpoint
ALTER TABLE "translation_drafts" ALTER COLUMN "target_locale" SET DATA TYPE "public"."locale" USING "target_locale"::"public"."locale";--> statement-breakpoint
```

**Planner note:** if Phase 25 moves from `ja` to `zh-TW`, migration must handle data migration and enum replacement deliberately, not only update `SUPPORTED_LOCALES`.

## Shared Patterns

### Authentication And Authorization

**Source:** `apps/api/src/common/guards/roles.guard.ts`, `apps/api/src/common/decorators/roles.decorator.ts`
**Apply to:** all admin controllers, especially publish/export/refund/seat/security endpoints.

Current guard only checks a single `user.role` string. New capability guard should copy the Reflector metadata pattern, preserve `@Roles('admin')` compatibility, and enforce capabilities server-side.

### Input Validation

**Source:** `apps/api/src/common/pipes/zod-validation.pipe.ts`
**Apply to:** all POST/PUT/PATCH/query DTOs.

Use shared Zod schemas where possible. Inline controller schemas are acceptable for narrow admin query filters, as in `ConsentAuditController` and `TranslationController`.

### Transaction + Audit

**Source:** `apps/api/src/modules/admin/admin-booking.service.ts`
**Apply to:** publish, export audit, seat disable/reactivate, CS escalation, allowlist changes.

Write state mutation and audit/history rows in the same Drizzle transaction where possible. Broadcast or cache invalidation should happen only after the transaction succeeds.

### Masked Output

**Source:** `apps/api/src/modules/consent/consent.service.ts`
**Apply to:** admin audit browse, raw CSV export audit previews, support inbox requester metadata.

Expose masked email/phone/IP in admin tables. Keep raw PII only in explicitly allowed CSV output, and do not copy raw CSV values into audit logs.

### Dense Operations UI

**Source:** `apps/web/components/admin/consent-audit-table.tsx`, `apps/web/components/admin/translation-review-table.tsx`, `apps/web/components/admin/admin-booking-table.tsx`
**Apply to:** operations inbox, audit table, export panel, seat operations panel.

Use white rounded content surfaces on `#F5F5F7`, filter bars above tables, text-bearing status badges, stable skeleton rows, explicit empty/error states, and keyboard-activatable rows.

### React Query Cache Coherence

**Source:** `apps/web/hooks/use-admin.ts`, `apps/web/hooks/use-reservations.ts`
**Apply to:** all admin hooks.

Use query keys rooted under `['admin', domain, filters]` and invalidate affected query families on mutation success. For paginated lists, use `keepPreviousData` where existing list behavior uses it.

### Translation Review Boundary

**Source:** `apps/api/src/modules/translation/translation.service.ts`
**Apply to:** multilingual support content, notices, event content, locale tabs.

Korean source content is canonical. Legal/notice/refund/booking-guide content is currently blocked from machine draft generation. Phase 25 must explicitly resolve notice/support policy before using assisted translation there.

## No Analog Found

| File Or Module Group | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/api/src/modules/admin/admin-operations.service.ts` full support inbox aggregation | service | CRUD + batch | No runtime Q&A/FAQ/notice/CS/refund-dispute domain exists yet. Use translation queue and consent audit as table/query analogs only. |
| `apps/api/src/database/schema/support-*.ts` | model | CRUD | No support/Q&A/FAQ/notice schema exists in runtime code. Use Drizzle schema conventions from `translation-*`, `legal-content.ts`, and `refunds.ts`. |
| `apps/web/components/admin/operations-inbox.tsx` exact SLA/escalation UI | component | CRUD | No existing SLA queue. Use `translation-review-table.tsx` for queue/detail and `consent-audit-table.tsx` for dense filters. |

## Metadata

**Analog search scope:** `apps/web/app/admin`, `apps/web/components/admin`, `apps/web/hooks`, `apps/api/src/modules/admin`, `apps/api/src/modules/consent`, `apps/api/src/modules/translation`, `apps/api/src/modules/booking`, `apps/api/src/common`, `apps/api/src/database/schema`, `apps/api/src/database/migrations`, `packages/shared/src`.

**Files scanned:** 80+ candidate files via `rg --files`, focused reads from 36 files.

**Pattern extraction date:** 2026-05-13

**Important planning risks:**
- Current locale runtime is `ko,en,th,zh-CN,ja`; Phase 25 contract says `zh-TW`. Resolve first.
- Current admin RBAC is only `user/admin`; capability work must be backend-enforced.
- Current booking audit is too narrow for Phase 25; add a generalized masked admin audit writer before broad sensitive-action work.
- `seat_status` lacks `disabled`; seat disable/reactivate requires schema, shared type, service, and WebSocket mapping changes.
- MFA is deferred accepted risk. Do not mark ADMIN-03 fully PASS.
