# Project Research — Stack Additions for v2.0 Fanmeet Launch

**Milestone:** v2.0 Fanmeet Launch  
**Researched:** 2026-05-04  
**Scope:** 기존 Next.js 16 + NestJS 11 + PostgreSQL + Valkey + Toss Payments 기반 위에 Girl Rules fanmeet launch 기능을 추가한다.

## Keep Existing

| Area | Existing choice | v2.0 use |
|------|-----------------|----------|
| Frontend | Next.js 16.2, React 19, Tailwind CSS v4 | App Router 다국어 라우팅, fanmeet 상세/예매/운영 UI |
| Backend | NestJS 11 modular monolith | Auth, consent, booking, queue, admin, QR, ops modules 확장 |
| DB | PostgreSQL + Drizzle | expand-then-contract migration, audit log, consent versioning, refund/QR state |
| Realtime/cache | Google Memorystore for Valkey + ioredis | queue Sorted Set, seat locks, Socket.IO adapter, OTP hash-tag convention |
| Payments | `@tosspayments/tosspayments-sdk` + Toss REST client | Toss live key cutover, Alipay+, truemoney, overseas card paths |
| SMS/email | Infobip SMS v3 + Resend | 5-country OTP and multilingual transactional templates |
| Infra | Cloud Run + Cloudflare + R2 + Sentry | canary, prewarm, WAF, load gates, incident monitoring |

## Add or Formalize

| Addition | Purpose | Notes |
|----------|---------|-------|
| `next-intl` | 5-locale routing and message loading | Use `localePrefix: "as-needed"` so Korean remains `/`; foreign locales use `/en`, `/th`, `/zh-CN`, `/zh-TW`. |
| Feature flag helper in shared package | `BOOKING_ENABLED`, language flags, LINE login flag | Keep env-based. Do not add LaunchDarkly. The spec requires one-toggle payment cutover. |
| DeepL API + LLM post-processing job | Korean source -> 4-language draft translation | Output must enter admin review queue and display "automatically translated" label after publication. |
| LINE OAuth strategy | Fifth login provider | Add beside Kakao/Naver/Google/email. Verify provider package during implementation before pinning. |
| pg-boss delayed jobs | Random seat re-open, QR email scheduling, refund reconciliation | Already selected stack; add as backend provider if not installed yet. |
| k6 | Load-test gate | 10k baseline and 20k stress scripts are milestone artifacts, not app runtime dependencies. |
| pgBouncer | Cloud SQL connection protection | Required before M2 cutover load gate if Cloud Run max instances rises. |
| QR signing utilities | JWT + HMAC ticket payload | Keep implementation small and auditable. Rotate event-day key separately from general JWT secrets. |
| Device/BIN risk scoring | Fraud defense | Prefer minimal scoring pipeline first; external fingerprinting can be toggled if procurement allows. |

## What Not To Add

| Technology | Reason |
|------------|--------|
| LaunchDarkly or external flag platform | Spec fixes env/helper-based flags; extra vendor adds launch risk. |
| CAPTCHA-first queue | Spec explicitly wants Cloudflare bot score/challenge and macro scoring without CAPTCHA as the normal path. |
| New microservices | 1-person development and short deadline favor modular monolith. |
| WeChat login | Explicitly out of scope. |
| Separate landing app | Event detail page on existing site is the M1 surface. |
| New payment abstraction provider | Toss is already integrated and PG applications are in progress. |

## Integration Points

- `packages/shared` should own feature flag names and locale constants so web/API/test fixtures share one contract.
- `apps/web` needs route/message structure, locale-aware SEO, hreflang sitemap, localized PhoneInput labels from `SEED-001`, and localized booking/admin copy.
- `apps/api` needs OAuth, consent/audit, queue, refund, QR, and ops endpoints without splitting deployment topology.
- Infrastructure work must be explicit roadmap scope: Cloud Run min/max policy, Cloud Scheduler prewarm, WAF rules, Sentry alert dry-run, pgBouncer, HA/read replica, and rollback runbooks.

## Quality Gates

- No contract migration before the 2026-07-04 event and post-event stabilization.
- Every new Valkey multi-key operation uses existing hash-tag convention.
- `BOOKING_ENABLED=false` must prevent seat locks and payment initiation, not just hide the button.
- 5/말 payment cutover is blocked unless k6, DR, and on-call gates pass.
