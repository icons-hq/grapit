# Project Research — Pitfalls for v2.0 Fanmeet Launch

**Milestone:** v2.0 Fanmeet Launch  
**Researched:** 2026-05-04

## Critical Pitfalls

| Pitfall | Why it matters | Prevention |
|---------|----------------|------------|
| Booking disabled only in UI | Users or bots can still lock seats or hit payment APIs | Enforce `BOOKING_ENABLED=false` in API lock/prepare/confirm paths and E2E it. |
| Load tests after ticketing opens | Real traffic becomes the test | Make k6, DR, on-call, pgBouncer/HA gates mandatory before cutover. |
| Locale routing breaks Korean SEO | Existing `/` URLs are already live | Use prefix-as-needed, preserve Korean root paths, validate URL matrix and sitemap. |
| Translation applies to legal notices | Incorrect legal copy creates disputes | Schema-lock legal notices to Korean/English manual input only. |
| Consent audit is too coarse | Cross-border transfer disputes need item-level evidence | Store consent item, version, language, timestamp, IP, user, and source surface. |
| Queue bypass through APIs | UI queue is useless if API endpoints are open | Gate booking APIs by queue admission token and account/device/session limits. |
| Valkey CROSSSLOT regression | Existing Phase 14 fixed SMS hash-tags; new queue keys can reintroduce failures | Reuse hash-tag convention and add integration tests for multi-key operations. |
| Cloud SQL connection exhaustion | 100-200 prewarmed instances can exceed DB connections | Add pgBouncer, tune per-instance pool size, and verify under stress. |
| Toss partial capability mismatch | Alipay+/truemoney/overseas card availability may depend on merchant review | Treat unavailable methods as cutover risk with user-facing fallback, not implementation assumption. |
| QR key leakage or replay | Event-day fraud affects entry operations | Separate event-day secret, HMAC, duplicate scan state, offline sync, and key rotation runbook. |

## Phase Placement

- Phase 23 must address flag enforcement, migration compatibility, and canary foundations before later feature work depends on them.
- Phase 24 should enforce queue tokens at API boundaries, not just build a waiting screen.
- Phase 26 must keep load/DR/on-call gates before live payment cutover inside the phase execution plan.
- Phase 27 must test duplicate, tampered, offline, and already-refunded QR states.

## Operational Watchpoints

- Monitor registration conversion by locale; untranslated PhoneInput or OTP copy can silently block overseas users.
- Track SMS cost and rejection by country before marketing pushes.
- Track payment failure by method after live cutover; Alipay+/truemoney failures should not poison domestic card flow.
- Treat any p95, error-rate, or DB connection budget breach during rehearsal as cutover-blocking unless explicitly waived.
