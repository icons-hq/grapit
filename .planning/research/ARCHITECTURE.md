# Project Research — Architecture for v2.0 Fanmeet Launch

**Milestone:** v2.0 Fanmeet Launch  
**Researched:** 2026-05-04

## Architectural Shape

Keep the modular monolith. v2.0 adds high-risk launch capabilities, but splitting services now would increase coordination cost and slow incident response. Use NestJS modules and clear database contracts instead.

## Data Flow

1. Admin creates event content in Korean and locked legal fields.
2. Translation job drafts en/th/zh-CN/zh-TW content and sends it to review.
3. Approved content publishes to locale routes with hreflang and translated transactional templates.
4. Users browse localized pages and sign up with email/social/LINE plus consent audit.
5. Before cutover, `BOOKING_ENABLED=false` blocks seat locks and payment while preserving event detail visibility.
6. At ticketing, WAF and queue admit users in batches.
7. Seat selection creates Valkey locks, payment confirm validates ownership, and reservation creation issues QR payloads.
8. Refund/cancellation jobs update seat release timing and refund states.
9. Event-day scanner validates QR JWT+HMAC online or against offline sync data.
10. Post-event export and retrospective close the milestone loop.

## New or Expanded Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Locale routing/messages | `apps/web` | Route groups, middleware, messages, sitemap/hreflang |
| Shared flags/locales | `packages/shared` | `BOOKING_ENABLED`, language flags, locale constants |
| Translation workflow | `apps/api` + admin UI | Draft, review queue, publish state, legal-field lockout |
| Consent/audit module | `apps/api` | Consent versioning, IP/language/item-level audit |
| Queue module | `apps/api` + `apps/web` | Valkey Sorted Set admission and queue status stream |
| Ops/infra scripts | `scripts/` or `.github/` | prewarm, WAF config evidence, cutover/rollback runbooks |
| Refund/holding jobs | `apps/api` | Toss refund, pg-boss delayed release, manual open override |
| QR module | `apps/api` + admin/field UI | Issue, email trigger, verify, duplicate detection |
| Admin extensions | `apps/web/app/admin` | Event authoring, CS, banners, audit, field console |

## Build Order Constraints

- Preflight phases 22-24 come first because they convert v1.1 caveats into v2.0 launch-readiness evidence.
- SP-0 must precede feature work because feature flags, migrations, URL policy, canary, and min-instance policy unblock all other phases.
- i18n routing should land before translated content, auth copy, legal copy, or admin content tabs.
- Queue/prewarm and WAF should be available by M1 because signup/ad traffic can arrive before payments.
- QR issuance must be ready before payment cutover; QR verification can follow before the event date.

## Migration Rules

- Use expand-then-contract only.
- Add nullable/defaulted columns first and backfill Korean content into locale tables/columns.
- Keep existing users, sessions, bookings, payment records, and Korean URLs valid throughout.
- Do not contract or rename production data structures until after the event and stabilization.

## Verification Rules

- Every roadmap phase needs observable user/operator behavior.
- Infrastructure gates need evidence artifacts: k6 reports, Cloud Monitoring/Sentry screenshots or logs, DR runbook output, WAF rule evidence.
- Payment cutover must have a dry-run and a rollback path before live keys are used.
