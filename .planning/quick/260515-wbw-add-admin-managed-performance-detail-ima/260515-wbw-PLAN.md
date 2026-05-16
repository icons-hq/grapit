# Quick Task 260515-wbw: Admin-managed performance detail images and public detail UX refresh - Plan

## Goal

Allow admins to upload, order, delete, and save performance detail images, then render those images on the public performance detail page in a modern, mobile-safe editorial layout. The supplied Girl Rules detail images should be attachable to the production performance after deployment.

## Task 1: Persist detail images through shared schema and API

**Files**

- `packages/shared/src/schemas/performance.schema.ts`
- `packages/shared/src/types/performance.types.ts`
- `apps/api/src/database/schema/performances.ts`
- `apps/api/src/database/migrations/*`
- `apps/api/src/modules/admin/admin.service.ts`
- `apps/api/src/modules/performance/performance.service.ts`

**Action**

- Add a structured `detailImages` field for performances.
- Validate each item as `{ imageUrl, altText, sortOrder }`.
- Save and return the field from admin create/update and public detail APIs.
- Keep existing performances backward compatible with an empty array.

**Verify**

- Shared schema tests or typecheck cover the new field shape.
- API unit tests or targeted service tests confirm create/update/detail mapping.

**Done**

- New field persists, round-trips, and appears on `PerformanceWithDetails`.

## Task 2: Add admin multi-image upload and ordering UI

**Files**

- `apps/web/components/admin/performance-form.tsx`
- Optional focused admin component/test files if the form becomes too large.

**Action**

- Reuse the existing presigned upload hook.
- Add a detail-image manager under media/sales detail content.
- Support multiple uploads, preview, alt text editing, remove, move up/down.
- Store ordered image metadata in the form.

**Verify**

- Targeted component test or web typecheck confirms form shape and UI compile.

**Done**

- Admin can manage an arbitrary ordered list of detail images.

## Task 3: Redesign public performance detail page for image stack

**Files**

- `apps/web/app/performance/[id]/page.tsx`
- `apps/web/app/performance/[id]/__tests__/*`

**Action**

- Replace the current hidden-tab-first detail layout with a clearer editorial structure.
- Keep poster, event facts, price summary, and booking CTA prominent.
- Render detail images as a large ordered stack with responsive widths and stable dimensions.
- Keep sales/refund text visible in a lower section.

**Verify**

- Existing performance detail tests pass after copy/layout updates.
- Browser smoke or Playwright screenshot verifies no blank/overlapping UI.

**Done**

- Public detail page shows supplied-style long images harmoniously without hiding core booking controls.

## Task 4: Production data connection

**Files / Systems**

- Supplied local image files
- Production admin upload/API path or equivalent safe production data update

**Action**

- After code is deployable, upload the three supplied images to production storage or use the production admin upload flow.
- Attach them to the Girl Rules production performance in the selected order.

**Verify**

- Production public performance detail API returns `detailImages`.
- Live public detail page renders the images.

**Done**

- The production performance has the three detail images visible in the redesigned page.
