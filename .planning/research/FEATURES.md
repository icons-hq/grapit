# Project Research — Feature Expectations for v2.0 Fanmeet Launch

**Milestone:** v2.0 Fanmeet Launch  
**Researched:** 2026-05-04  
**Input:** `docs/v2.0-fanmeet-milestone-spec.md`, `.planning/PROJECT.md`, selected seed `SEED-001-phone-input-i18n`

## Feature Categories

### Preflight and Launch Readiness

**Table stakes:** SMS/email/legal operator sign-off, artifact backfill, Valkey/R2/SMS/email/legal hardening, production smoke evidence.  
**Differentiators:** Treat these as first v2.0 phases so old v1.1 caveats are resolved against the real launch surface.

### Production Compatibility and Feature Flags

**Table stakes:** expand-only migrations, default Korean URL preservation, booking disabled mode, canary deploy, min/max instance policy.  
**Differentiators:** 5-minute payment cutover through one flag and live key replacement after gates pass.

### Globalization and Content Pipeline

**Table stakes:** ko/en/th/zh-CN/zh-TW pages, locale-aware URLs, hreflang, localized email/SMS, locale preference.  
**Differentiators:** AI translation review queue, "automatically translated" label, schema-locked legal notice fields, PhoneInput localization from `SEED-001`.

### Auth and Compliance

**Table stakes:** LINE login, email verification expiry/resend, 5-country SMS OTP, 3-device session limit, consent version audit.  
**Differentiators:** PIPA/PDPA/PIPL/cross-border transfer consent in one signup flow with evidence-grade audit logs.

### Traffic Absorption

**Table stakes:** Valkey queue, batch admission, position stream, rate limiting, WAF, Cloud Run prewarm.  
**Differentiators:** 10k baseline + 20k stress gate before payment cutover; gate failure explicitly delays ticketing.

### Booking, Payment, Refund, QR Issuance

**Table stakes:** multi-floor SVG, lock TTL, 7-minute countdown, four Toss payment paths, refund state machine, cancellation fee engine.  
**Differentiators:** random 1-10 minute cancelled-seat holding, QR JWT issuance at booking completion, D-1 QR email trigger.

### Operator Console and Event Operations

**Table stakes:** event authoring, multilingual content tabs, review/approval RBAC, banners, FAQ/Q&A/CS, reservation CSV, audit logs.  
**Differentiators:** seat operations, refund dispute retention, QR scan console, offline fallback, abnormal scan alerts, post-event settlement/export.

## Anti-Features

- No notification signup between M1 and M2; SNS marketing handles D-day announcements.
- No separate event landing page.
- No legal counsel workflow inside this milestone.
- No ticket transfer/name change unless policy is explicitly decided later.
- No mobile app, WeChat login, PASS identity verification, virtual account payment, or partial refund.

## Requirement Implications

- M1 must ship a complete browsing/signup/admin surface with payment disabled.
- M2 pre-cutover must be treated as a release gate, not a later hardening task.
- M2 cutover work must be small and rehearsed because it swaps live keys and flips `BOOKING_ENABLED`.
- M3/M4 are operational software requirements, not documentation-only tasks.
