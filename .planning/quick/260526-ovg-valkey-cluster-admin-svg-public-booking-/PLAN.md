---
quick_id: 260526-ovg
slug: valkey-cluster-admin-svg-public-booking-
created_at: 2026-05-26T08:54:32Z
---

# Valkey Cluster Admin SVG Public Booking Cache Fix Plan

## Goal

Production admin SVG seat-map saves commit successfully, but public booking/detail pages can show stale seat maps until cache TTL because Valkey Cluster rejects cross-slot multi-key cache invalidation.

## Tasks

1. Replace pattern invalidation's `KEYS` + multi-key `DEL` path with Valkey Cluster-safe `SCAN` over master nodes and per-key `DEL`.
2. Make explicit cache invalidation delete keys one by one so future multi-key invalidations do not reintroduce `CROSSSLOT`.
3. Add regression coverage for cluster master scanning, duplicate key handling, and cross-slot delete failure handling.
4. Invalidate public React Query performance/home/list caches after admin performance and seat-map mutations.
5. Run targeted API tests and api/web typechecks.
