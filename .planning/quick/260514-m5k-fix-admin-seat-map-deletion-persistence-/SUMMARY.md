---
quick_id: 260514-m5k
slug: fix-admin-seat-map-deletion-persistence
status: complete
completed: 2026-05-14
---

# Summary

Fixed admin SVG seat-map deletion persistence by invalidating locale-scoped performance detail caches after admin performance and seat-map mutations.

Fixed admin-only booking tests by adding a role-aware admin booking bypass while preserving public `BOOKING_ENABLED=false` lockout. Admins now skip the public queue in the frontend, receive server-side bypass admission when needed, and can pass seat lock, reservation prepare, and payment confirm feature-flag checks. Public users remain blocked.

Improved queue waiting resilience by polling waiting sessions as a socket fallback, and added Korean wrapping guards to the queue waiting copy.

## Verification

- `pnpm --filter @grabit/api test src/modules/admin/admin.service.spec.ts src/modules/queue/queue.guard.spec.ts src/modules/booking/__tests__/booking.service.spec.ts src/modules/reservation/reservation.service.spec.ts`
- `pnpm --filter @grabit/web test hooks/__tests__/use-booking.test.tsx hooks/__tests__/use-queue.test.tsx hooks/__tests__/booking-disabled-runtime.test.tsx lib/booking-access.test.ts`
- `pnpm --filter @grabit/shared build`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/web typecheck`
