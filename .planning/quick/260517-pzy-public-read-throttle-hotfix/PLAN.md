---
quick_id: 260517-pzy
slug: public-read-throttle-hotfix
created_at: 2026-05-17T09:43:08Z
---

# Public Read Throttle Hotfix Plan

## Goal

Production load testing showed public API read endpoints returning `429` under campaign-like concurrent traffic because the coarse default `@nestjs/throttler` policy limits every IP to 60 requests per minute.

## Tasks

1. Exempt non-mutating launch read endpoints from the coarse default throttler:
   - health check
   - public catalog/home/search endpoints
   - public booking seat-status reads
2. Preserve existing write-side and abuse-sensitive throttling:
   - auth/signup
   - SMS
   - queue entry
   - seat lock
   - reservation/payment mutation paths
3. Add regression tests proving public reads skip the default throttler while seat locking remains eligible for throttling.
4. Run targeted API tests, typecheck, lint, deploy, and repeat production load/log verification.
