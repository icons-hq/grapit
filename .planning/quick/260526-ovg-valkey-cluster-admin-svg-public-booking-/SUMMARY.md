---
status: complete
quick_id: 260526-ovg
slug: valkey-cluster-admin-svg-public-booking-
completed_at: 2026-05-26T08:58:18Z
branch: main
---

# Valkey Cluster Admin SVG Public Booking Cache Fix Summary

## Completed

- Updated `CacheService.invalidatePattern()` to scan cache keys with `SCAN`, using every cluster master node when running against Valkey Cluster.
- Updated cache deletion to issue single-key `DEL` calls instead of cross-slot multi-key `DEL`.
- Preserved graceful degradation: cache failures still log warnings and do not roll back committed admin DB writes.
- Added regression tests for cluster master scanning, duplicate key de-duplication, per-key deletion, and `CROSSSLOT` handling.
- Updated admin performance and seat-map mutation hooks to invalidate public performance detail/list/home React Query caches after successful saves.

## Verification

- `pnpm --filter @grabit/api test -- src/modules/performance/__tests__/cache.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/web typecheck`
- `git diff --check`
- `pnpm --filter @grabit/api lint` (0 errors, existing warnings)
- `pnpm --filter @grabit/web lint` (0 errors, existing warnings)
