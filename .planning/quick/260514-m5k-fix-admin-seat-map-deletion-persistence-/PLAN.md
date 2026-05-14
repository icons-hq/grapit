---
quick_id: 260514-m5k
slug: fix-admin-seat-map-deletion-persistence
status: complete
created: 2026-05-14
---

# Quick Task Plan

Fix two admin booking test blockers:

1. Admin performance edit must persist deleting all SVG seat maps, and reopening the edit form must not read stale cached detail data.
2. Admin users must bypass the public booking queue/disabled flag for payment testing while public users remain locked out.
3. Queue waiting Korean helper copy must wrap naturally instead of breaking by syllable.

## Verification

- Add targeted tests for cache invalidation, admin admission bypass, and frontend admin booking permission.
- Run focused API/web test files plus typecheck if the scoped tests pass.
