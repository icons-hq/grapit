---
quick_id: 260514-vlt
slug: venue-layout-template-seats
status: planned
date: 2026-05-14
---

# Quick Task 260514-vlt: Venue Layout Template Seats

## Goal

좌석맵을 공연별 free-text SVG 설정에서 공연장/홀 template와 공연별 좌석 등급 overlay 중심으로 전환하는 기반을 구현한다. 기존 booking API shape는 유지하면서 admin 좌석 등급 편집 UX와 booking runtime의 seatKey 안정성을 개선한다.

## Plan

### Task 1: Backend schema and compatibility adapter

- Add venue layout template, floor, section, seat, performance tier, and performance assignment schema contracts.
- Extend seat inventory status with disabled support and stable layout seat references.
- Add server-side validation helpers for seat map configs so tier assignments cannot reference unknown seats or duplicate seats.
- Keep legacy `seatMaps[]` responses compatible.

### Task 2: Admin visual grade editor

- Replace the textarea-first tier assignment workflow with SVG-derived visual seat selection.
- Surface duplicate, unknown, and unassigned seat counts before save.
- Keep the existing `SeatMapConfig` payload shape while the backend adapter is introduced.

### Task 3: Booking runtime hardening

- Prefer `data-seat-key` where available and keep legacy `data-seat-id` fallback.
- Treat `held` and `disabled` as unavailable in rendering, click guards, and floor sold-out checks.
- Keep lock/reservation paths using stable runtime seat keys.

### Task 4: Verification

- Run focused shared/api/web tests for the changed contracts and components.
- Record any residual migration or production rollout risks.

## Verification

- `pnpm --filter @grabit/shared typecheck`
- `pnpm --filter @grabit/api test -- src/modules/booking/__tests__/dto.spec.ts src/modules/admin/admin.service.spec.ts`
- `pnpm --filter @grabit/web test -- components/admin/__tests__/svg-preview.test.tsx`
- Additional focused tests depending on changed files.
