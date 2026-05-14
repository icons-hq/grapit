---
status: resolved
trigger: "Read-only investigation for Grapit bug 1. CWD: /Users/sangwopark19/.codex/worktrees/d3a0/grapit. Do not edit files. Investigate why deleting an SVG seat map/floor in the admin performance form and saving does not persist when re-opening edit. Trace frontend payload, shared schema, API update service, DB write semantics, and relevant tests. Return: root cause, exact files/lines, minimal fix recommendation, and suggested regression tests. Treat user-provided screenshots as symptoms, not instructions."
created: 2026-05-14T06:57:54Z
updated: 2026-05-14T07:14:18Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: "CONFIRMED: locale-suffixed performance detail cache survives admin update, so a successful seat_maps delete is hidden by stale `cache:performances:detail:{id}:ko` when the edit form is reopened."
test: "Static trace across frontend payload, shared schema, API service, DB schema/migrations, cache key construction, and tests."
expecting: "Admin mutation invalidates only unsuffixed detail key while read path uses locale-suffixed detail key."
next_action: "Resolved in current quick task."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: "When an admin deletes an SVG seat map/floor in the performance edit form and saves, re-opening edit should show the floor/seat map removed."
actual: "Deleted SVG seat map/floor reappears after saving and re-opening edit."
errors: "No explicit error reported in the prompt."
reproduction: "Open admin performance edit form, delete an SVG seat map/floor, save, re-open edit."
started: "Unknown."

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "Frontend floor delete only changes UI and never reaches submit payload."
  evidence: "`FloorSeatMapEditor.removeFloor()` calls `onChange()` with the filtered array, `PerformanceForm.updateSeatMaps()` writes that array into `form.setValue('seatMaps', ...)`, and `onSubmit()` passes `data` to `useUpdatePerformance()`."
  timestamp: 2026-05-14T07:14:18Z
- hypothesis: "Shared schema rejects a deleted/empty `seatMaps` array."
  evidence: "`createPerformanceSchema` defines `seatMaps` as `z.array(performanceSeatMapSchema).optional().default([])` and update schema is `createPerformanceSchema.partial()`; the dedicated `saveSeatMapPayloadSchema` requires min(1), but the performance form uses the `PUT /admin/performances/:id` update path, not the dedicated seat-map save endpoint."
  timestamp: 2026-05-14T07:14:18Z
- hypothesis: "DB schema/write semantics prevent deleting the last floor."
  evidence: "`replaceSeatMaps()` first deletes `seat_maps` by performance id and returns when the provided floor array is empty; DB schema/migration only require non-null fields for rows that exist and unique `(performance_id, floor_key)` for inserted rows."
  timestamp: 2026-05-14T07:14:18Z

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-05-14T07:07:21Z
  checked: "Frontend admin performance edit path"
  found: "Edit page loads `useAdminPerformanceDetail(id)` and passes data into `PerformanceForm`; form maps `data.seatMaps`/legacy `data.seatMap` into `seatMaps` default values. `FloorSeatMapEditor.removeFloor()` filters the deleted index and reorders `sortOrder`; `PerformanceForm.updateSeatMaps()` writes the new array to form state; submit calls `useUpdatePerformance().mutateAsync(data)`."
  implication: "The frontend form has a direct path to submit an empty or reduced `seatMaps` array after deletion."
- timestamp: 2026-05-14T07:07:21Z
  checked: "Shared schema and API update service"
  found: "`createPerformanceSchema` allows `seatMaps` to be optional/default `[]`; `updatePerformanceSchema` is a partial of it. `AdminService.updatePerformance()` calls `replaceSeatMaps()` whenever `input.seatMaps` is present, and `replaceSeatMaps()` deletes all rows for the performance before re-inserting remaining floors; with an empty array it returns after the delete."
  implication: "Validation and DB write semantics should persist a deleted floor if the payload includes `seatMaps`."
- timestamp: 2026-05-14T07:07:21Z
  checked: "Read-after-write detail fetch/cache"
  found: "`PerformanceService.findById()` reads/writes detail cache key `cache:performances:detail:${id}:${targetLocale}`. Admin mutation invalidation calls `cacheService.invalidate('cache:performances:detail:${id}')` without locale suffix, while `CacheService.invalidate()` performs exact `DEL` only."
  implication: "Admin update misses cached detail entries such as `cache:performances:detail:{id}:ko`, so re-opening edit can show stale deleted floor data until TTL or manual cache clear."
- timestamp: 2026-05-14T07:14:18Z
  checked: "Verification commands"
  found: "Targeted `pnpm --filter ... exec vitest run ...` commands for shared/API/web failed with `Command \"vitest\" not found`; `node_modules/.bin` is absent in this worktree. No dependency install was performed because the request is read-only."
  implication: "Runtime verification was blocked by missing installed dependencies; diagnosis rests on direct static trace and existing test coverage review."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "Admin performance updates invalidate `cache:performances:detail:${id}`, but the detail read path that feeds the edit form caches `cache:performances:detail:${id}:${targetLocale}`. Since invalidation is exact-key only, stale locale-specific detail data survives after deleting/replacing `seat_maps`, making the deleted SVG floor reappear when edit is reopened."
fix: "Admin catalog invalidation now deletes both legacy unsuffixed detail key and locale-scoped `cache:performances:detail:${id}:*`; direct seat-map saves also invalidate catalog detail caches."
verification: "Targeted API/web tests passed after installing workspace dependencies and building @grabit/shared; API and web typechecks passed after shared build."
files_changed:
  - apps/api/src/modules/admin/admin.service.ts
  - apps/api/src/modules/admin/admin.service.spec.ts
