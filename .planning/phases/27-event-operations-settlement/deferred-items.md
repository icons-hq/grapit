# Phase 27 Deferred Items

## 2026-05-22 - Plan 27-10

- `pnpm --filter @grabit/web typecheck` fails outside Plan 27-10 scope. The first failures are missing future-plan RED contract modules (`components/field/scanner-check-in`, `components/field/field-monitor`, `components/admin/settlement-dashboard`) introduced by earlier Phase 27 work, plus existing admin/shared TypeScript issues. Plan 27-10's dependency import check, QR unit test, and targeted ESLint check pass.

## 2026-05-22 - Plan 27-11

- `pnpm --filter @grabit/web typecheck` still fails outside Plan 27-11 scope on sibling Phase 27 surfaces: missing `components/admin/settlement-dashboard`, `components/field/field-monitor`, and `components/field/scanner-check-in` implementation modules, plus existing `admin-user-management` role/permission map drift for scanner and settlement permissions. Plan 27-11's targeted component tests and QR E2E tests pass.

## 2026-05-22 - Plan 27-12

- `pnpm --filter @grabit/web typecheck` no longer reports errors from Plan 27-12 files after the scanner route and hook type fixes, but still fails outside Plan 27-12 scope on missing future/sibling modules `components/admin/settlement-dashboard` and `components/field/field-monitor`, plus existing `admin-user-management` label-map drift for the scanner bundle and field/settlement permissions. Plan 27-12's targeted scanner component test and QR check-in E2E both pass.
