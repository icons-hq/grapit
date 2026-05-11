---
status: complete
quick_id: 260511-i3d
slug: resolve-phase-24-remaining-toss-method-m
created: 2026-05-11T04:01:38.015Z
completed: 2026-05-11T04:05:04Z
---

# Resolve Phase 24 Remaining Toss Method Matrix Gaps

## Goal

Close the remaining Phase 24 Toss method-matrix evidence gap without recording secrets: domestic card branch, overseas card, Alipay+, truemoney, webhook delivery, DB ledger, and user-facing pending/complete UI.

## Tasks

1. Reproduce the production queue admission failure blocking method-matrix testing.
2. Fix Redis Cluster stale-session purge so queue entry can proceed in production.
3. Accept Toss webhook provider code `ALIPAY` and normalize it to internal `ALIPAY_PLUS`.
4. Run focused API unit tests, API typecheck, web Toss browser regression, and web production build.
5. Build and deploy API/web production images, then restore `BOOKING_ENABLED=false` and remove temporary smoke tags.
6. Exercise Toss sandbox method-matrix branches and verify Cloud Run logs plus production DB ledger.
7. Update Phase 24 UAT, verification, and external activation runbook artifacts with non-secret evidence.
