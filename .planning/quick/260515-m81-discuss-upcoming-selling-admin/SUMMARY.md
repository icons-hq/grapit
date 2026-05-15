---
quick_id: 260515-m81
slug: discuss-upcoming-selling-admin
status: complete
completed: 2026-05-15
---

# Summary

Implemented existing-status based open controls:

- `upcoming` now displays as `오픈예정`; `selling` now displays as `오픈`.
- Admin performance form now saves a two-option open status selector: `오픈예정` or `오픈`.
- Public cards, public performance detail, and admin performance list show `오픈예정` instead of stored start/end dates for upcoming performances.
- Public users are blocked from upcoming performance booking CTA, direct booking UI, queue entry, seat lock, and reservation preparation.
- Admin users retain the existing booking bypass for upcoming-performance testing.
- Payment confirmation remains server-driven after lock/prepare so existing payment recovery and idempotent complete-page flows are not blocked by client-side open-state checks.

Verification run:

- `pnpm --filter @grabit/shared exec vitest run src/schemas/performance.schema.test.ts`
- `pnpm --filter @grabit/web exec vitest run components/performance/__tests__/status-badge.test.tsx components/performance/__tests__/performance-card.test.tsx 'app/performance/[id]/__tests__/performance-detail-formatting.test.tsx'`
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/booking.service.spec.ts src/modules/reservation/reservation.service.spec.ts`
- `pnpm --filter @grabit/web exec vitest run hooks/__tests__/booking-disabled-runtime.test.tsx hooks/__tests__/use-booking.test.tsx components/booking/__tests__/booking-page-timezone.test.tsx`
- `pnpm --filter @grabit/api test:integration`
- `pnpm --filter @grabit/shared build`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/api typecheck`
