---
phase: quick-260517-glr-admin-performance-detail-visibility-toggles
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/database/schema/performances.ts
  - apps/api/src/database/migrations/0019_performance_copy_visibility.sql
  - apps/api/src/database/migrations/meta/_journal.json
  - packages/shared/src/schemas/performance.schema.ts
  - packages/shared/src/schemas/performance.schema.test.ts
  - packages/shared/src/types/performance.types.ts
  - apps/api/src/modules/admin/admin.service.ts
  - apps/api/src/modules/admin/admin-performance.controller.ts
  - apps/api/src/modules/admin/admin.service.spec.ts
  - apps/api/src/modules/performance/performance.service.ts
  - apps/api/src/modules/performance/performance.service.spec.ts
  - apps/web/hooks/use-admin.ts
  - apps/web/components/admin/performance-form.tsx
  - apps/web/components/admin/__tests__/performance-form-visibility.test.tsx
  - apps/web/app/performance/[id]/page.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
autonomous: true
requirements:
  - QUICK-260517-GLR
must_haves:
  truths:
    - "Admin users can independently set 상세정보 and 판매정보 to 공개 or 비공개 from the edit form section headers."
    - "Toggling either section to 비공개 preserves the existing textarea content through save and later admin edit reload."
    - "Public users do not receive or render hidden 상세정보 or 판매정보 content when the matching visibility flag is false."
    - "Existing 상세 이미지 behavior remains unchanged by the 상세정보 text visibility toggle."
  artifacts:
    - path: "apps/api/src/database/schema/performances.ts"
      provides: "Boolean persistence columns for description/salesInfo visibility"
      contains: "descriptionVisible"
    - path: "packages/shared/src/schemas/performance.schema.ts"
      provides: "Create/update DTO validation for visibility booleans"
      contains: "descriptionVisible"
    - path: "apps/api/src/modules/performance/performance.service.ts"
      provides: "Public detail masking for hidden copy"
      contains: "includeHiddenCopy"
    - path: "apps/web/components/admin/performance-form.tsx"
      provides: "Section-header switches and state chips"
      contains: "descriptionVisible"
    - path: "apps/web/app/performance/[id]/page.tsx"
      provides: "Public omission of hidden sections and nav anchors"
      contains: "descriptionVisible"
  key_links:
    - from: "apps/web/components/admin/performance-form.tsx"
      to: "apps/api/src/modules/admin/admin.service.ts"
      via: "CreatePerformanceInput/UpdatePerformanceInput payload booleans"
      pattern: "descriptionVisible.*salesInfoVisible"
    - from: "apps/api/src/modules/admin/admin-performance.controller.ts"
      to: "apps/api/src/modules/performance/performance.service.ts"
      via: "guarded admin detail fetch with includeHiddenCopy"
      pattern: "includeHiddenCopy.*true"
    - from: "apps/api/src/modules/performance/performance.service.ts"
      to: "apps/web/app/performance/[id]/page.tsx"
      via: "public detail response masks text and exposes visibility state"
      pattern: "descriptionVisible.*false"
---

<objective>
Implement admin-controlled visibility toggles for performance 상세정보 and 판매정보 copy.

Purpose: let operators hide either public copy block without deleting large existing edits, while keeping public APIs and pages from exposing hidden content.
Output: one atomic quick implementation covering DB schema/migration, shared schema/types, admin/public API behavior, admin edit UI, public detail rendering, and focused regression tests.
</objective>

<execution_context>
@/Users/sangwopark19/.codex/get-shit-done/workflows/execute-plan.md
@/Users/sangwopark19/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260517-glr-https-heygrabit-com-admin-performances-1/260517-glr-CONTEXT.md
@apps/web/components/admin/performance-form.tsx
@apps/web/app/performance/[id]/page.tsx
@apps/web/hooks/use-admin.ts
@apps/api/src/modules/admin/admin.service.ts
@apps/api/src/modules/admin/admin-performance.controller.ts
@apps/api/src/modules/performance/performance.service.ts
@packages/shared/src/schemas/performance.schema.ts
@packages/shared/src/types/performance.types.ts
@apps/api/src/database/schema/performances.ts

<locked_decisions>
- D-01: Add separate visibility toggles for `description` / 상세정보 and `salesInfo` / 판매정보.
- D-02: Preserve entered content when hidden; store explicit visibility state separately from text content.
- D-03: Public user surfaces must omit hidden content. This must be enforced through backend/public data behavior, not only admin UI hiding.
- D-04: Admin controls must live in the 상세정보 and 판매정보 section headers with a clear 공개/비공개 switch and compact state chip.
- D-05: Existing detail images stay governed by current behavior and are not hidden by the 상세정보 text toggle.
- D-06: Keep the implementation narrow and preserve existing form save, validation, translation, publish, cache invalidation, showtime update, and admin edit stability.
</locked_decisions>

<interfaces>
- `performances.description` maps to shared `Performance.description`; `performances.salesInfo` maps to shared `Performance.salesInfo`.
- `createPerformanceSchema` is the source of `CreatePerformanceInput` and `CreatePerformanceFormInput`; `updatePerformanceSchema` is `createPerformanceSchema.partial()`.
- `PerformanceService.findById(id, locale?)` currently serves both public detail and guarded admin detail; admin controller `GET /api/v1/admin/performances/:id` currently calls that same method.
- `useAdminPerformanceDetail(id)` currently calls public `/api/v1/performances/:id`; this must change to guarded `/api/v1/admin/performances/:id` so hidden text can reload in admin without leaking through public API.
- Prior admin edit incidents: avoid broad `PerformanceForm` refactors and avoid new `setValue` feedback loops; keep `showtimeId` preservation and `syncShowtimes(...)` behavior unchanged.
</interfaces>
</context>

<source_audit>
## Multi-Source Coverage Audit

| Source | Item | Coverage |
|--------|------|----------|
| GOAL | Admin performance edit page visibility toggles for `description` and `salesInfo`. | Covered by Task 1 and Task 2 |
| GOAL | Preserve values while hidden. | Covered by Task 1 API persistence and Task 2 admin form test |
| GOAL | Hide hidden copy from public users. | Covered by Task 1 public API masking and Task 2 public page omission |
| GOAL | Polished section-header switches/chips in admin UI. | Covered by Task 2 |
| REQ | QUICK-260517-GLR quick task, no ROADMAP phase requirement. | Covered by this single plan |
| RESEARCH | No separate research artifact requested; existing stack uses Drizzle, zod, NestJS, React Hook Form, Tailwind, Vitest. | Covered by existing patterns |
| CONTEXT D-01 | Separate 상세정보 and 판매정보 toggles. | Covered by Task 1 and Task 2 |
| CONTEXT D-02 | Preserve text and store visibility separately. | Covered by Task 1 and Task 2 |
| CONTEXT D-03 | Public users must not see hidden content. | Covered by Task 1 and Task 2 |
| CONTEXT D-04 | Controls in section headers with switch/chip. | Covered by Task 2 |
| CONTEXT D-05 | Detail images unchanged. | Covered by Task 2 public page action |
| CONTEXT D-06 | Narrow, compatible implementation. | Covered by both task action constraints |

Deferred Ideas: none in `260517-glr-CONTEXT.md`.
</source_audit>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Persist visibility flags and enforce API masking</name>
  <files>apps/api/src/database/schema/performances.ts, apps/api/src/database/migrations/0019_performance_copy_visibility.sql, apps/api/src/database/migrations/meta/_journal.json, packages/shared/src/schemas/performance.schema.ts, packages/shared/src/schemas/performance.schema.test.ts, packages/shared/src/types/performance.types.ts, apps/api/src/modules/admin/admin.service.ts, apps/api/src/modules/admin/admin-performance.controller.ts, apps/api/src/modules/admin/admin.service.spec.ts, apps/api/src/modules/performance/performance.service.ts, apps/api/src/modules/performance/performance.service.spec.ts</files>
  <behavior>
    - Test 1: `createPerformanceSchema` defaults `descriptionVisible` and `salesInfoVisible` to `true`; `updatePerformanceSchema` accepts explicit `false` without requiring text changes.
    - Test 2: `AdminService.createPerformance()` and `AdminService.updatePerformance()` persist and return `descriptionVisible` and `salesInfoVisible` independently from `description` and `salesInfo`.
    - Test 3: public `PerformanceService.findById(id, locale)` returns `description: null` when `descriptionVisible === false` and `salesInfo: null` when `salesInfoVisible === false`, even if translated copy exists.
    - Test 4: guarded admin detail fetch uses an include-hidden path and returns the stored text plus visibility flags so the edit page can reload hidden content.
  </behavior>
  <action>Add two narrow boolean flags per D-01 and D-02: DB columns `description_visible boolean not null default true` and `sales_info_visible boolean not null default true`, Drizzle properties `descriptionVisible` and `salesInfoVisible`, shared type fields on `Performance`, and zod fields on `createPerformanceSchema`. Create migration `0019_performance_copy_visibility.sql` with `ALTER TABLE "performances" ADD COLUMN ... DEFAULT true` statements, and register it in `_journal.json` using the next `idx`/tag after `0018_performance_detail_images`. Update `AdminService` create/update/publish response mapping and update data so visibility flags save independently from text. Update `PerformanceService.findById` to support a small options object such as `{ includeHiddenCopy?: boolean }`; default public behavior must mask hidden text after translation overlay so translated drafts cannot repopulate hidden fields per D-03. Update `AdminPerformanceController.getPerformance()` to call the include-hidden path, and update tests around existing fixtures/mocks without changing `syncShowtimes(...)`, price tier replacement, booking policy, publish lifecycle, or cache invalidation paths per D-06.</action>
  <verify>
    <automated>pnpm --filter @grabit/shared test -- src/schemas/performance.schema.test.ts</automated>
    <automated>pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts src/modules/performance/performance.service.spec.ts</automated>
    <automated>pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api typecheck</automated>
  </verify>
  <done>Visibility flags persist with default `true`, admin APIs can save/reload hidden copy, public APIs never return hidden copy text, and existing admin edit/showtime/cache tests remain green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add admin header controls and public section omission</name>
  <files>apps/web/hooks/use-admin.ts, apps/web/components/admin/performance-form.tsx, apps/web/components/admin/__tests__/performance-form-visibility.test.tsx, apps/web/app/performance/[id]/page.tsx, apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx</files>
  <behavior>
    - Test 1: `PerformanceForm` renders separate 상세정보 and 판매정보 header controls with switches and 공개/비공개 chips.
    - Test 2: toggling 상세정보 or 판매정보 to 비공개 does not clear the corresponding textarea value and submits the boolean flag with the preserved text.
    - Test 3: admin edit detail loads from `/api/v1/admin/performances/:id`, not the public detail endpoint, so hidden text is not lost during edit reload.
    - Test 4: public detail page omits the 상세정보 nav anchor/section when `descriptionVisible === false`, omits the 판매정보 nav anchor/section when `salesInfoVisible === false`, and still renders detail images when `descriptionVisible === false`.
  </behavior>
  <action>Wire the frontend to the Task 1 contract per D-01 through D-06. Change `useAdminPerformanceDetail()` to call guarded `/api/v1/admin/performances/${id}`. In `PerformanceForm`, add `descriptionVisible` and `salesInfoVisible` to `mapToFormValues`, default values, and submit payload through the existing `react-hook-form` schema path. Replace the current single `판매/상세 정보` heading with two dense section-header rows: each row contains the section title, a `Switch` controlled by `Controller`, and a compact chip that reads `공개` or `비공개`. Use helper copy exactly as recommended where it fits: 공개 state explains `사용자 상세 페이지에 표시`; 비공개 state explains `입력값은 저장되고 사용자에게는 숨김`. Keep textareas enabled in both states so content is preserved, and do not add effects or `setValue` calls for these switches to avoid prior admin edit stability regressions. In the public detail page, compute `showDescriptionSection = performance.descriptionVisible !== false` and `showSalesSection = performance.salesInfoVisible !== false`; hide the matching side-nav anchors and entire copy sections when false. Keep detail images independent per D-05 and keep the existing no-detail/refund fallback only when the section is visible but text is empty.</action>
  <verify>
    <automated>pnpm --filter @grabit/web test -- components/admin/__tests__/performance-form-visibility.test.tsx 'app/performance/[id]/__tests__/performance-detail-formatting.test.tsx'</automated>
    <automated>pnpm --filter @grabit/web typecheck</automated>
  </verify>
  <done>Admin users can clearly toggle 상세정보 and 판매정보 visibility in the section headers without losing text, admin edit reloads hidden text from the protected endpoint, and public detail UI omits hidden copy sections while preserving detail images.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Admin browser -> protected admin API | Admin-controlled visibility flags and preserved copy cross into guarded mutation/read endpoints. |
| Public API -> public browser | Public users receive performance detail data that must not include hidden text content. |
| Database migration -> existing production rows | New visibility columns are added to existing performances and must default to visible. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260517-glr-01 | I | `PerformanceService.findById` | mitigate | Mask hidden `description` and `salesInfo` after translation overlay unless `includeHiddenCopy` is true; public controller uses default masked path. |
| T-260517-glr-02 | E/I | `AdminPerformanceController.getPerformance` | mitigate | Keep route under existing `RolesGuard`/`AdminCapabilitiesGuard`; use protected `/admin/performances/:id` for admin reloads instead of exposing raw hidden text on public endpoint. |
| T-260517-glr-03 | T | `createPerformanceSchema` / `updatePerformanceSchema` | mitigate | Validate visibility inputs as booleans through zod and persist only explicit `descriptionVisible` / `salesInfoVisible` fields. |
| T-260517-glr-04 | D | `0019_performance_copy_visibility.sql` | accept | Two boolean columns with default `true`; no table rewrite of text content or destructive data transform. |
</threat_model>

<verification>
Run focused gates after implementation:

<automated>pnpm --filter @grabit/shared test -- src/schemas/performance.schema.test.ts</automated>
<automated>pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts src/modules/performance/performance.service.spec.ts</automated>
<automated>pnpm --filter @grabit/web test -- components/admin/__tests__/performance-form-visibility.test.tsx 'app/performance/[id]/__tests__/performance-detail-formatting.test.tsx'</automated>
<automated>pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck</automated>

Optional manual smoke after automated gates: open `/admin/performances/18a3bcc6-5e75-463d-abfd-634601328754/edit`, toggle each header switch to 비공개, save, reload admin edit, confirm text remains; then open the public detail page and confirm hidden copy sections are not visible while detail images remain visible.
</verification>

<success_criteria>
- `descriptionVisible` and `salesInfoVisible` exist in DB, migration, shared schema/types, admin API responses, and public detail responses.
- Both flags default to `true` for existing and new performances.
- Admin can set each flag independently without clearing `description` or `salesInfo`.
- Public API/page omit hidden copy content and section anchors; hidden translated copy cannot leak through locale overlays.
- Existing detail images, publish review, showtime preservation, cache invalidation, and admin form save flow remain unchanged except for the new visibility fields.
</success_criteria>

<output>
After completion, create `.planning/quick/260517-glr-https-heygrabit-com-admin-performances-1/260517-glr-SUMMARY.md`.
</output>
