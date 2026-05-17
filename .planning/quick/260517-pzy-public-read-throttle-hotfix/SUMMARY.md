---
status: complete
quick_id: 260517-pzy
slug: public-read-throttle-hotfix
completed_at: 2026-05-17T09:45:00Z
branch: quick/260517-public-read-throttle-hotfix
---

# Public Read Throttle Hotfix Summary

## Completed

- Added `@SkipThrottle()` to public, non-mutating read surfaces that are expected to receive campaign traffic:
  - `GET /api/v1/health`
  - `GET /api/v1/performances`
  - `GET /api/v1/performances/:id`
  - `GET /api/v1/home/*`
  - `GET /api/v1/search`
  - `GET /api/v1/booking/schedules/:showtimeId/seats`
- Kept auth, SMS, queue, seat-lock, reservation, and payment mutation throttling unchanged.
- Added regression coverage in `public-read-throttle.spec.ts`.

## Verification

- `pnpm --filter @grabit/api test -- public-read-throttle.spec.ts app.module.spec.ts traffic-defense.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/api lint`
- `git diff --check`

## Follow-up

- Deploy the hotfix and rerun the production load test. The first production run before this patch showed all public API read traffic blocked by the default `60/min` throttler at 80+ concurrency.
