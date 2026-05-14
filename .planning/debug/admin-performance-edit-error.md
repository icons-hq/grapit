---
status: fixing
trigger: "https://heygrabit.com/admin/performances/18a3bcc6-5e75-463d-abfd-634601328754/edit admin performance detail edit page renders generic error"
created: "2026-05-14"
updated: "2026-05-14"
---

# Debug Session: admin-performance-edit-error

## Symptoms

- expected_behavior: Admin should be able to open the performance detail edit page for performance `18a3bcc6-5e75-463d-abfd-634601328754` and manage the performance details.
- actual_behavior: The page shows the global error UI: `문제가 발생했습니다` / `일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`
- error_messages: User-visible generic Next.js error boundary text only.
- timeline: Unknown. Reported on 2026-05-14 KST against production `https://heygrabit.com`.
- reproduction: Open `https://heygrabit.com/admin/performances/18a3bcc6-5e75-463d-abfd-634601328754/edit` as admin.

## Current Focus

- hypothesis: Production admin edit crashes from a frontend render/update loop in the controlled SVG seat-map editor, not from a missing performance detail payload.
- test: Reproduce the route with an admin-shaped browser state, inspect production console/network, compare live API payload and production route chunks with the current worktree.
- expecting: Production console shows React maximum-update-depth and the production bundle contains the controlled SvgPreview sync effect that loops through PerformanceForm `form.setValue('seatMaps', ...)`.
- next_action: push hotfix branch, run CI/CD, and verify the production edit page no longer enters the global error boundary
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-14T10:08:36+0900
  source: "curl https://api.heygrabit.com/api/v1/performances/18a3bcc6-5e75-463d-abfd-634601328754"
  found: "HTTP 200 JSON includes seatMaps array length 1, seatMap object, bookingPolicy, priceTiers array, showtimes array, and castings array."
  implication: "Current live public performance detail payload is not missing the new floor-aware fields; `data.seatMaps.length` is not the observed production crash cause."

- timestamp: 2026-05-14T10:11:27+0900
  source: "Playwright production route reproduction with fake admin auth refresh/users-me routes"
  found: "`/admin/performances/18a3bcc6-5e75-463d-abfd-634601328754/edit` renders the same global error UI. Console reports React minified error #185 and Sentry event transaction `/admin/performances/:id/edit`; request #34 to `/api/v1/performances/:id` was HTTP 200."
  implication: "The failure happens after successful detail fetch during client rendering/update, not in the API detail endpoint."

- timestamp: 2026-05-14T10:12:02+0900
  source: "React error decoder https://react.dev/errors/185"
  found: "React #185 is `Maximum update depth exceeded`."
  implication: "The generic Next.js error UI is caused by an infinite React update loop."

- timestamp: 2026-05-14T10:14:00+0900
  source: "Production chunk `/tmp/grapit-prod-chunks/04kix-t6qqv6s.js`"
  found: "Production `SvgPreview` contains `useEffectEvent` plus `useEffect(() => { isControlled && svgUrl && emitChange({ svgUrl, seatConfig: { tiers }, totalSeats }) }, [emitChange, isControlled, svgUrl, tiers, totalSeats])`."
  implication: "On edit pages with an existing SVG URL, controlled `SvgPreview` emits `onChange` during prop/state sync."

- timestamp: 2026-05-14T10:14:30+0900
  source: "apps/web/components/admin/performance-form.tsx:610-629 and production chunk"
  found: "`PerformanceForm` passes `SvgPreview onChange` that calls `updateFloor(...)`; `FloorSeatMapEditor` forwards this to `PerformanceForm` `onChange`, which calls `form.setValue('seatMaps', nextSeatMaps, { shouldDirty: true })`."
  implication: "The production `SvgPreview` sync effect creates a feedback loop: existing SVG props -> child effect emits onChange -> parent updates form seatMaps -> child receives updated config -> child effect emits again."

- timestamp: 2026-05-14T10:15:00+0900
  source: "current worktree diff"
  found: "`apps/web/components/admin/svg-preview.tsx` removes `useEffectEvent` and the mount-time controlled sync effect, and only emits `onChange` from explicit SVG upload or TierEditor edits. `apps/web/components/admin/__tests__/svg-preview.test.tsx` adds controlled-mode regression tests."
  implication: "The smallest code fix is frontend-only and does not require backend endpoint changes."

- timestamp: 2026-05-14T10:17:07+0900
  source: "`pnpm --filter @grabit/web test -- svg-preview`"
  found: "Vitest completed successfully: 56 test files passed, 356 tests passed. Existing jsdom/act warnings were printed but did not fail the run."
  implication: "The current worktree's SvgPreview fix direction passes the available web test suite."

- timestamp: 2026-05-14T10:20:19+0900
  source: "`pnpm --filter @grabit/web exec vitest run components/admin/__tests__/svg-preview.test.tsx`"
  found: "Targeted SvgPreview regression suite passed: 1 test file, 10 tests."
  implication: "The controlled-mode regression is covered directly."

- timestamp: 2026-05-14T10:20:19+0900
  source: "`pnpm --filter @grabit/web typecheck`; `NEXT_PUBLIC_API_URL=https://api.heygrabit.com pnpm --filter @grabit/web build`"
  found: "Web typecheck passed after building `@grabit/shared`; production Next build completed successfully."
  implication: "The fix is type-safe and production-buildable."

- timestamp: 2026-05-14T10:22:00+0900
  source: "Playwright against local production build at `http://localhost:3015` with the live performance payload mocked from production API"
  found: "The route rendered heading `공연 수정`, save button, and title value `Girl Rules FAN MEETING IN SEOUL`; `문제가 발생했습니다` count was 0 and console errors were 0."
  implication: "The edit form no longer crashes with the live problematic payload once the frontend fix is applied."

## Eliminated

## Resolution

- root_cause: "Production bundle contains a controlled `SvgPreview` mount/update sync effect that emits `onChange` whenever an existing `svgUrl`/tiers/seat count is present; on the admin performance edit page this feeds back into `PerformanceForm` `form.setValue('seatMaps', ...)`, causing React #185 maximum update depth and the global Next.js error UI."
- fix: "Remove the controlled mount-time `useEffectEvent`/`useEffect` emission from `SvgPreview`; emit `onChange` only for explicit user actions such as SVG upload or tier edits. Add controlled-mode regression coverage in `apps/web/components/admin/__tests__/svg-preview.test.tsx`."
- verification: "Production reproduction: failed with React #185 before deploy. Local production build with the current fix and the same performance payload rendered the edit form successfully. Targeted SvgPreview tests, web typecheck, and web production build passed."
- files_changed: "`apps/web/components/admin/svg-preview.tsx`; `apps/web/components/admin/__tests__/svg-preview.test.tsx`; `.planning/debug/admin-performance-edit-error.md`."
