# Quick Task 260517-glr: Admin performance detail visibility toggles - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Task Boundary

Implement visibility controls on the admin performance edit page for:

- `description` / 상세정보
- `salesInfo` / 판매정보

The target admin page is:

`https://heygrabit.com/admin/performances/18a3bcc6-5e75-463d-abfd-634601328754/edit`

Admins need to keep large existing edits in these fields while hiding either section from public users through toggles.

</domain>

<decisions>
## Implementation Decisions

### Visibility Scope
- Add separate visibility toggles for 상세정보 and 판매정보.
- `description` visibility controls only the 상세정보 text block.
- `salesInfo` visibility controls only the 판매정보 text block.
- Existing detail images remain governed by their current behavior and are not hidden by the 상세정보 toggle in this quick task.

### Data Behavior
- Preserve entered content when a section is hidden.
- Store explicit visibility state separately from the text content.
- Public user surfaces must omit hidden content, rather than relying on admin UI-only hiding.

### Admin UX
- Place the controls in the 상세정보 and 판매정보 section headers.
- Each controlled section should have a clear 공개/비공개 switch and a compact state chip.
- The visual direction is refined, operational, and modern: dense enough for admin work, but polished enough that the state is instantly readable.

### Agent Discretion
- Choose the narrowest durable data model that fits existing schema/API patterns.
- Keep the public page behavior conservative: if a field is hidden, do not render its user-facing content block.
- Preserve existing form save behavior, validation, translation, publish, cache invalidation, and admin edit stability.

</decisions>

<specifics>
## Specific Ideas

- Existing memory says `description` and `salesInfo` are public detail API/page fields, so implementation must reach backend/public rendering, not just the admin form.
- Existing memory also says production admin edit page has had crash/save regressions before; avoid broad refactors and preserve showtime/update paths.
- Recommended admin wording:
  - 공개: "사용자 상세 페이지에 표시"
  - 비공개: "입력값은 저장되고 사용자에게는 숨김"

</specifics>

<canonical_refs>
## Canonical References

- `apps/web/components/admin/performance-form.tsx`
- `apps/web/app/performance/[id]/page.tsx`
- `apps/api/src/modules/admin/admin.service.ts`
- `apps/api/src/modules/performance/performance.service.ts`
- `packages/shared/src/schemas/performance.schema.ts`
- `packages/shared/src/types/performance.types.ts`
- `apps/api/src/database/schema/performances.ts`

</canonical_refs>
