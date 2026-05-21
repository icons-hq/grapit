# Phase 26: M1 Canary + Cutover Gates - Research

**Researched:** 2026-05-20  
**Domain:** launch cutover gates, production rehearsal, load/DR/payment operations  
**Confidence:** MEDIUM - codebase and official-doc evidence are strong, but live provider credentials, Toss live review state, Cloudflare rule state, and production database topology must be rechecked during execution. [VERIFIED: codebase rg] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]

<user_constraints>
## User Constraints (from CONTEXT.md)

The following locked decisions, discretion areas, and deferred ideas are copied from `.planning/phases/26-m1-canary-cutover-gates/26-CONTEXT.md`. [VERIFIED: .planning/phases/26-m1-canary-cutover-gates/26-CONTEXT.md]

### Locked Decisions

### Gate Failure And Operator Override

- **D-01:** Phase 26 is gate-driven, but failed gates may be overridden by the owner/operator only with explicit `ACCEPTED_RISK` approval. Without accepted-risk approval, `BOOKING_ENABLED=true` remains blocked.
- **D-02:** Use a `Gate Ledger` model. Each gate must be recorded as `PASS`, `FAIL`, `ACCEPTED_RISK`, `CONFIG_READY_NOT_DRILLED`, or `BLOCKED`, with failure reason, approval state, approver, approval timestamp, compensating monitoring, and rollback/close-booking trigger.
- **D-03:** Owner/operator single approval is sufficient for accepted-risk cutover because this is a 1-person development/operations project. The approval must still include the failed gate, monitoring plan, and rollback trigger.
- **D-04:** `BOOKING_ENABLED=true` go/no-go requires all gates to be accounted for. Empty or unreviewed gate rows are `no-go`.

### Deploy And Rollback

- **D-05:** Do not use Cloud Run traffic-split canary for Phase 26. This intentionally supersedes the older ROADMAP canary wording; downstream agents must record this as an owner decision, not as canary PASS evidence.
- **D-06:** Deployment path is `CI/CD green -> 100% direct deploy`, followed by a strict 15-minute watch.
- **D-07:** Strict watch must cover live smoke, Cloud Run logs, health, auth/session, public event detail, booking-disabled behavior, queue entry, and payment-safe path.
- **D-08:** Immediate rollback triggers are user-path critical failures: health 5xx, login/refresh failure, public event detail 5xx, `BOOKING_ENABLED=false` while lock/prepare/payment side effects occur, queue entry 5xx, or payment confirm unsafe behavior.

### Ticketing Rehearsal, Load, DR, And Infra Gates

- **D-09:** k6 load gates require both 10k baseline and 20k stress attempts, targeting p95 under 2 seconds and error rate under 1%. Failure can only proceed via the Gate Ledger accepted-risk override.
- **D-10:** Test scope is Ticketing Cutover Rehearsal, not broad SNS/signup load. Rehearsal must cover queue, seat lock, reservation prepare, payment confirm safe/test branch, QR issuance, refund/cancel, and cleanup.
- **D-11:** Rehearsal must use a Dedicated Test Event in a production-like environment. Do not use the real Girl Rules event or real user data as the load/cleanup target.
- **D-12:** DR/infra gate uses Critical Drill + Config Evidence. Cloud Run rollback, DB backup/restore path, and Valkey reconnect/failure behavior must be actually verified. pgBouncer, HA/read replica, and DB pool sizing may be verified as configuration/preparedness evidence and marked `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK` when not actually drilled.

### Production Data Safety

- **D-13:** Strict Test-Event Isolation is a hard constraint. Existing production users, social accounts, registrations, consents, sessions, real Girl Rules performance data, real reservations, real payments, real tickets, and real seat state must not be deleted or mutated by rehearsal cleanup.
- **D-14:** Cleanup must be constrained by dedicated test `performanceId`/`showtimeId`, test order prefix, and test marker. Cleanup requires dry-run counts/lists before mutation and backup/restore-point confirmation before execution.
- **D-15:** Cleanup queries must use denylist protection for the real Girl Rules event and real production records. If a cleanup dry-run returns unexpected rows, stop and require manual review.

### Monitoring, WAF, And On-call

- **D-16:** Monitoring gate requires Sentry, Cloud Run logs, Cloudflare, and business metrics. Business metrics include queue length/admission rate, lock/prepare/confirm success rates, payment success/failure, QR issuance, refund job failure, sellout behavior, and remaining seats.
- **D-17:** WAF/rate-limit gate requires Active Rule + Smoke Evidence. Cloudflare active zone must have queue-entry challenge, booking mutation rate-limit, and macro/block rules enabled; normal requests must pass; deliberate low-volume suspicious smoke must produce challenge/block/rate-limit evidence without impacting real users.
- **D-18:** On-call/playbook gate requires a 1-person operations playbook plus dry-run evidence. PG/DB, Valkey, Cloud Run, Cloudflare, Toss/payment failure, queue stuck, and oversell-risk procedures each need at least one dry-run command, log query, or evidence artifact.

### Toss Test-Key Rehearsal And Live Cutover

- **D-19:** Toss cutover uses Two-Step Cutover. First inject live keys while keeping `BOOKING_ENABLED=false`, then perform payment-safe smoke. Only after Gate Ledger approval should `BOOKING_ENABLED=true` be enabled.
- **D-20:** Toss test-key rehearsal is necessary but not sufficient for live cutover. Test keys can validate the payment flow model, amount verification, confirm/cancel/query/webhook handling, idempotency, QR issuance, and app state transitions, but they do not prove live merchant approval, live method availability, real deposits, or production concurrency safety.
- **D-21:** Because Toss review is not complete and live keys are not available yet, Phase 26 must include two layers: complete test-key Ticketing Cutover Rehearsal now, then after Toss review completion run a separate live-key smoke gate before enabling live ticketing.
- **D-22:** Live-key smoke must include at minimum live key presence/prefix validation, server-only secret handling, widget/client-key initialization, server confirm/query/cancel path verification where safely allowed, webhook delivery/query re-verification, and no leakage of secret keys to frontend/logs/docs.
- **D-23:** Toss general payment webhooks must not be trusted solely from the webhook payload. Re-query Toss by `paymentKey` before applying final payment state.
- **D-24:** The Toss test secret key was exposed in a user-provided screenshot during discussion. Do not write the raw key into any repo artifact. Before relying on the test environment for final rehearsal evidence, rotate/reissue the exposed test secret key in Toss and update Secret Manager/CI settings.

### QR Issuance And Field Scan Contract

- **D-25:** Current admin test-key payment completing without visible QR is a Phase 26 cutover blocker. Fix and verify QR visibility before ticketing open.
- **D-26:** QR verification must cover both payment complete page and My Page/ticket detail. `QR-01` is not satisfied unless the user can actually see/access the QR after confirmed payment.
- **D-27:** Phase 26 must add a field-scan contract smoke: QR payload, JWT/HMAC verification inputs, ticket status, and reservation/payment linkage must be suitable for Phase 27 scanner/use-processing work.
- **D-28:** Full manager mobile QR scan and ticket use-processing UI remains Phase 27 scope.

### First-24-Hour Monitoring

- **D-29:** First-24h monitor uses first-2-hour intensive watch plus 24-hour periodic checks. For the first 2 hours after ticketing open, check queue/payment/seat/QR/Cloud Run/Sentry/Cloudflare every 5-10 minutes; afterward check every 30-60 minutes until 24 hours.
- **D-30:** Immediate close-booking/rollback triggers use Financial/Seat Safety criteria: duplicate sale, payment confirm success but reservation/QR failure, payment failure spike, seat lock/prepare side-effect mismatch, queue admission stuck, or accumulated refund/cancel job failures.

### the agent's Discretion

- Planner may decide exact k6 script layout, SQL/API query format, dashboard shape, and cleanup implementation as long as D-09 through D-18 are preserved.
- Planner may choose whether pgBouncer/HA/read replica are implemented immediately or recorded as `CONFIG_READY_NOT_DRILLED`/`ACCEPTED_RISK`, but cannot mark undrilled infra as PASS.

### Deferred Ideas (OUT OF SCOPE)

- Full field-staff mobile QR scan/use-processing UI is deferred to Phase 27.
- Event-day entry monitor, offline fallback sync, settlement export, and post-event retrospective remain Phase 27 scope.
- Full Cloud Run traffic-split canary is intentionally omitted by owner decision and should not be reconstructed unless the user reopens that decision.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| M1-01 | Operator can complete M1 integrated smoke tests and canary deploy, then open advertising/signup surface on 2026-05-15. [VERIFIED: .planning/REQUIREMENTS.md] | Interpret the older "canary" wording through D-05 as direct CI/CD green -> 100% deploy -> 15-minute watch, with public detail, auth/session, booking-disabled, queue, WAF, and payment-safe smoke evidence. [VERIFIED: 26-CONTEXT.md] |
| LOAD-01 | Maintainer can run k6 10k baseline and 20k stress with p95 < 2s and error rate <1%. [VERIFIED: .planning/REQUIREMENTS.md] | Use k6 thresholds for `http_req_duration` and `http_req_failed`, target a dedicated test event, and keep payment confirm safe/test-key scoped. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] [VERIFIED: 26-CONTEXT.md] |
| DR-01 | Maintainer can execute DB PITR restore, Valkey failover, Cloud Run rollback drills. [VERIFIED: .planning/REQUIREMENTS.md] | Require actual Cloud Run rollback, Cloud SQL restore/PITR to a separate target, and Valkey reconnect/failure evidence; do not mark undrilled provider topology as PASS. [CITED: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration] [CITED: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr] |
| INFRA-01 | Platform can handle cutover traffic with pgBouncer transaction pooling, Cloud SQL HA, read replica, tuned per-instance DB pools. [VERIFIED: .planning/REQUIREMENTS.md] | Existing API uses `DB_POOL_MAX` env with `pg.Pool`, and production deploy currently sets `DB_POOL_MAX=3`; planner must collect pgBouncer/HA/read-replica/pool sizing evidence and preserve non-drilled state as `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK`. [VERIFIED: codebase rg] |
| OPS-01 | Operator can use on-call playbooks and Sentry alerts for PG, Valkey, DB, CDN, latency, error-rate, payment-failure incidents. [VERIFIED: .planning/REQUIREMENTS.md] | Extend existing Phase 24 runbooks and require Cloud Run logs, Sentry dry-run alerts, Cloudflare active-rule smoke, and business metric commands per gate. [VERIFIED: codebase rg] [CITED: https://docs.sentry.io/product/alerts/] |
| PAY-01 | Operator can enable live ticketing in five minutes through Toss live keys and `BOOKING_ENABLED=true` only after all gates pass. [VERIFIED: .planning/REQUIREMENTS.md] | Use two-step cutover: live keys injected with booking disabled, live-key smoke, then `BOOKING_ENABLED=true` only after Gate Ledger approval; server verifies amount, keeps secret key server-only, and re-queries webhook state by `paymentKey`. [VERIFIED: 26-CONTEXT.md] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| OPS-02 | Operator can monitor first 24h for 1-2만 concurrent users, sellout, payment failures, refund automation health. [VERIFIED: .planning/REQUIREMENTS.md] | Use first-2h 5-10 minute watch cadence and then 30-60 minute checks to 24h, with close-booking triggers for duplicate sale, payment/reservation/QR mismatch, payment spikes, queue stuck, and refund/cancel job failures. [VERIFIED: 26-CONTEXT.md] |
</phase_requirements>

## Summary

Phase 26 should be planned as a gate-ledger cutover program, not as a feature sprint or Cloud Run traffic-split canary. The user decision in D-05 supersedes older roadmap language: deployment is `CI/CD green -> 100% direct deploy -> strict 15-minute watch`, and rollback readiness is the safety mechanism. [VERIFIED: 26-CONTEXT.md] [VERIFIED: .planning/ROADMAP.md]

The implementation should preserve existing architecture: `BOOKING_ENABLED` hard-gates backend mutation paths, queue admission protects booking mutations, Toss confirm is server-side, Valkey locks protect seat inventory, and QR tickets are issued after confirmed reservation/payment state. Current gaps to plan around are the QR visibility blocker, missing Toss webhook re-query hardening, missing confirm/cancel idempotency headers, four-active-locale code vs five-locale success wording, and live provider evidence that cannot be proven from code alone. [VERIFIED: codebase rg] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]

**Primary recommendation:** create a Phase 26 Gate Ledger artifact first, make every gate produce evidence into that ledger, and block `BOOKING_ENABLED=true` unless every required row is `PASS` or explicitly owner-approved as `ACCEPTED_RISK`; never normalize `ACCEPTED_RISK` or `CONFIG_READY_NOT_DRILLED` to `PASS`. [VERIFIED: 26-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Gate Ledger and go/no-go state | API / Backend plus planning artifact | Admin UI / Operations docs | The ledger is an operational source of truth and must preserve non-PASS states; the admin surface can display evidence, but cutover approval should not depend on client-only state. [VERIFIED: 26-CONTEXT.md] |
| `BOOKING_ENABLED` hard gate | API / Backend | Frontend runtime flag display | Existing `FeatureFlagsService.assertBookingEnabled()` blocks booking mutations before Redis/DB/Toss side effects, while web runtime flags only present disabled copy. [VERIFIED: codebase rg] |
| Public detail and locale smoke | Browser / Client | API / Backend | Detail pages, locale routing, and disabled booking copy are user-visible web behavior; backend must still reject mutations when disabled. [VERIFIED: codebase rg] |
| Queue admission and seat lock | API / Backend | Database / Valkey | `QueueService`, `AdmissionGuard`, and `BookingService` own admission, Redis/Valkey locks, and DB seat status checks. [VERIFIED: codebase rg] |
| Ticketing rehearsal | API / Backend | Browser / Client, Database / Storage | Rehearsal crosses queue, lock, reservation, Toss test-key confirm/cancel, QR issuance, My Page visibility, and cleanup. [VERIFIED: codebase rg] |
| k6 10k/20k load gates | External test runner | API / Backend, Cloud Run, DB, Valkey | k6 drives synthetic load; pass/fail depends on HTTP latency/error thresholds plus backend/cloud metrics. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] |
| Cloud Run rollback | CDN / Static or API service boundary | GitHub Actions / GCP ops | Cloud Run revisions and traffic updates are platform operations, not app code behavior. [CITED: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration] |
| Cloud SQL PITR / HA / read replica | Database / Storage | API / Backend | Backup, restore, HA, and replica evidence lives in Cloud SQL configuration and restore drills; app pool sizing must fit that capacity. [CITED: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr] |
| Valkey reconnect/failure | Database / Storage | API / Backend, Socket.IO adapter | Existing `redis.provider.ts`, Redis health indicator, queue, booking locks, and Socket.IO adapter depend on Valkey reconnect behavior. [VERIFIED: codebase rg] |
| WAF/rate limit readiness | CDN / Static | API / Backend | Cloudflare blocks/challenges edge traffic; app-layer `TrafficDefenseService` provides fallback policy decisions. [CITED: https://developers.cloudflare.com/waf/custom-rules/] [VERIFIED: codebase rg] |
| Toss test/live payment cutover | API / Backend | Browser / Client, Secret Manager | Server confirm, amount verification, secret-key custody, cancel/query/webhook handling are backend concerns; widget initialization uses client key. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| QR visibility and field-scan contract | API / Backend | Browser / Client | `QrTicketService` creates and verifies token state, while complete page and My Page must expose the QR/access path to users. [VERIFIED: codebase rg] |
| First-24h monitoring | Operations | API / Backend, CDN, DB, Payment provider | The watch combines Cloud Run logs, Sentry, Cloudflare, business metrics, DB/Valkey health, Toss state, refund jobs, and QR issuance. [VERIFIED: 26-CONTEXT.md] |

## Project Constraints (from AGENTS.md)

- User-facing responses and project docs should use Korean explanations while keeping technical terms and code identifiers in English. [VERIFIED: AGENTS.md]
- The project is a one-person monolith-first launch; complexity should stay low unless the gate requires provider-level evidence. [VERIFIED: AGENTS.md]
- The stack follows the project architecture documents and current monorepo packages; do not introduce unrelated deployment platforms such as Vercel. [VERIFIED: AGENTS.md]
- `.env` belongs at the monorepo root in local development, while Cloud Run uses Secret Manager or Cloud Run environment variables. [VERIFIED: AGENTS.md]
- Production secrets must not be written into repo artifacts; this matters especially for Toss keys, webhook secrets, cookies, tokens, and QR secrets. [VERIFIED: AGENTS.md] [VERIFIED: 26-CONTEXT.md]
- For GSD work, planning artifacts and execution state should stay in sync; this research file is written under the phase directory requested by the GSD workflow. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library / Tool | Current / Verified Version | Purpose | Why Standard |
|----------------|----------------------------|---------|--------------|
| Next.js | Repo `^16.2.0`; npm latest `16.2.6`, modified 2026-05-20. [VERIFIED: package.json] [VERIFIED: npm registry] | Public web, booking pages, runtime flag route, QR-visible pages. | Existing web app is Next App Router and deploys to Cloud Run standalone. [VERIFIED: codebase rg] |
| React | Repo `^19.1.0`. [VERIFIED: apps/web/package.json] | Web components and booking flow UI. | Existing component tests and Playwright E2E target React/Next surfaces. [VERIFIED: codebase rg] |
| NestJS | Repo `^11.1.0`; npm `@nestjs/core` latest `11.1.21`, modified 2026-05-14. [VERIFIED: package.json] [VERIFIED: npm registry] | API modules for feature flags, queue, booking, reservation, payment, ticket, health, ops. | Existing API module structure uses Nest controllers/services/guards/providers. [VERIFIED: codebase rg] |
| Drizzle ORM | Repo `^0.45.0`; npm latest `0.45.2`, modified 2026-05-18. [VERIFIED: package.json] [VERIFIED: npm registry] | Reservation, payment, ticket, seat inventory, and cleanup queries. | Existing schema and transaction code are Drizzle-based. [VERIFIED: codebase rg] |
| `pg` / `pg.Pool` | Repo `^8.20.0`; npm latest `8.21.0`, modified 2026-05-18. [VERIFIED: package.json] [VERIFIED: npm registry] | PostgreSQL driver and per-instance pool sizing. | Existing `drizzle.provider.ts` creates `pg.Pool` with `DB_POOL_MAX`, idle timeout, and connection timeout envs. [VERIFIED: codebase rg] |
| `ioredis` | Repo `^5.10.1`; npm latest `5.10.1`, modified 2026-03-19. [VERIFIED: package.json] [VERIFIED: npm registry] | Valkey/Redis locks, queue state, and Socket.IO Redis adapter. | Existing Redis provider supports standalone and cluster mode with retry strategy. [VERIFIED: codebase rg] |
| `pg-boss` | Repo `12.18.2`; npm latest `12.18.2`, modified 2026-05-02. [VERIFIED: package.json] [VERIFIED: npm registry] | QR ticket email scheduling and async jobs. | Existing QR issuance schedules D-1 ticket email through jobs. [VERIFIED: codebase rg] |
| `@tosspayments/tosspayments-sdk` | Repo `^2.6.0`; npm latest `2.7.0`, modified 2026-05-08. [VERIFIED: apps/web/package.json] [VERIFIED: npm registry] | Toss Payment Widget on the client. | Existing widget component uses Toss client-key initialization and payment request flow. [VERIFIED: codebase rg] |
| `@sentry/nestjs` / `@sentry/nextjs` | Repo `^10`; npm latest `10.53.1`, modified 2026-05-12. [VERIFIED: package.json] [VERIFIED: npm registry] | Error and alert evidence. | Phase 26 monitoring gate requires Sentry dry-run evidence. [VERIFIED: 26-CONTEXT.md] [CITED: https://docs.sentry.io/product/alerts/] |
| k6 | CLI missing locally; official docs current. [VERIFIED: local command] [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] | Load testing 10k baseline and 20k stress. | k6 natively supports thresholds for p95 latency and failed request rate. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] |
| Playwright | Repo `^1.59.1`; npm latest `1.60.0`, modified 2026-05-19. [VERIFIED: apps/web/package.json] [VERIFIED: npm registry] | Browser E2E for public detail, booking disabled, queue/payment/QR smoke. | Existing web E2E suite already covers booking, queue, i18n, Toss, and QR-adjacent flows. [VERIFIED: codebase rg] |

### Supporting

| Library / Tool | Version / Availability | Purpose | When to Use |
|----------------|------------------------|---------|-------------|
| `@nestjs/throttler` and `@nest-lab/throttler-storage-redis` | Repo `^6.4.0` and `^1.2.0`; `@nestjs/throttler` npm latest `6.5.0`. [VERIFIED: package.json] [VERIFIED: npm registry] | App-layer rate limits complement Cloudflare WAF. | Preserve current `TrafficDefenseService` policies and smoke them beside Cloudflare active rules. [VERIFIED: codebase rg] |
| `zod` | Repo `^3.25.76`; npm latest `4.4.3`. [VERIFIED: package.json] [VERIFIED: npm registry] | DTO validation in API and tests. | Do not upgrade to zod v4 inside Phase 26 unless explicitly planned, because current code imports and tests v3 behavior. [VERIFIED: codebase rg] |
| `gcloud` CLI | Installed `564.0.0`; local active project is `udamon-6840c0`, not Grabit. [VERIFIED: local command] | Cloud Run, Cloud SQL, logs, Secret Manager, and rollback drills. | Always pass `--project=grapit-491806` for Phase 26 commands unless production project is re-confirmed differently. [VERIFIED: local command] |
| Docker | Installed server/client `29.1.3`. [VERIFIED: local command] | k6 fallback and local service parity. | Use `grafana/k6` Docker image when local `k6` CLI is missing. [VERIFIED: local command] |
| `scripts/smoke-valkey-production.mjs` | Present in repo. [VERIFIED: codebase rg] | Valkey/Redis production smoke and reconnect evidence. | Run with Phase 26 artifact path to capture Valkey mode, health, Lua, idle reconnect, Socket.IO, and logs. [VERIFIED: codebase rg] |
| Cloudflare WAF / Rate Limiting Rules | Provider state must be rechecked live. [CITED: https://developers.cloudflare.com/waf/custom-rules/] [CITED: https://developers.cloudflare.com/waf/rate-limiting-rules/] | Edge challenge/block/rate-limit gate. | Use existing Phase 24 runbook and provider dashboard/API evidence; do not infer active WAF from code. [VERIFIED: docs/runbooks/phase24-queue-waf-prewarm.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON/Markdown Gate Ledger artifact | Runtime DB table plus admin editor | A DB table is useful if operators need runtime edits, but Phase 26 primarily needs auditable go/no-go evidence; artifact-first avoids adding a new critical mutation surface before cutover. [VERIFIED: 26-CONTEXT.md] |
| k6 | Artillery or custom Node load script | k6 has native threshold syntax and established scenario executors; custom scripts would hand-roll pass/fail math and reporting. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] |
| Cloud Run traffic-split canary | Cloud Run `update-traffic` gradual rollout | Owner decision D-05 forbids traffic-split canary for this phase, even though Cloud Run supports traffic migration. [VERIFIED: 26-CONTEXT.md] [CITED: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration] |
| Toss webhook shared-secret-only guard | Toss Payment Query API re-verification | Current guard can be kept as defense-in-depth, but final state must re-query Toss by `paymentKey` before applying payment state. [VERIFIED: codebase rg] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |

**Installation / execution notes:**

```bash
# k6 is not installed locally; Docker is available. [VERIFIED: local command]
docker run --rm -i grafana/k6 run - < scripts/k6/phase26-baseline.js

# Repo package manager is pnpm 10.28.1. [VERIFIED: package.json] [VERIFIED: local command]
pnpm --filter @grabit/api test
pnpm --filter @grabit/web test:e2e
```

**Version verification:** package versions above were checked with `npm view <package> version time.modified` on 2026-05-20. [VERIFIED: npm registry]

## Codebase Architecture Map For Phase 26

| Area | Files / Modules Likely Touched | Existing Pattern To Preserve | Current Gap To Inspect |
|------|-------------------------------|------------------------------|------------------------|
| Shared booking flag | `packages/shared/src/flags.ts`, `apps/api/src/modules/feature-flags/feature-flags.service.ts`, `apps/web/lib/runtime-flags.ts`, `apps/web/app/api/runtime-flags/route.ts` | `BOOKING_ENABLED=false` blocks backend mutation paths, while frontend displays localized disabled copy. [VERIFIED: codebase rg] | Confirm live smoke proves no Redis/DB/Toss side effects while flag is false. [VERIFIED: 26-CONTEXT.md] |
| Locale/public smoke | `packages/shared/src/constants/locales.ts`, `apps/web/i18n/routing.ts`, `apps/web/messages/*.json`, `apps/web/e2e/i18n-smoke.spec.ts` | Current active public locale code uses `ko`, `en`, `th`, `zh-CN`. [VERIFIED: codebase rg] | Phase 26 success criteria say five locales, but current code has four; planner must reconcile this before marking M1 smoke PASS. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: codebase rg] |
| Queue and admission | `apps/api/src/modules/queue/queue.service.ts`, `queue.controller.ts`, `guards/admission.guard.ts`, `queue.gateway.ts` | Queue sessions, active admissions, re-entry grace, `grabit_queue_admission` cookie, and admin bypass already exist. [VERIFIED: codebase rg] | k6 needs dedicated test-event admission flow and stable identifiers for performance/showtime/seat IDs. [VERIFIED: 26-CONTEXT.md] |
| Traffic defense | `apps/api/src/modules/traffic/traffic-defense.service.ts` | Existing policies cover `queue-entry`, `lock-seat`, `prepare-reservation`, `confirm-payment`, and `signup`. [VERIFIED: codebase rg] | Cloudflare WAF evidence must be collected separately from app-layer rate-limit tests. [VERIFIED: 26-CONTEXT.md] |
| Prewarm | `apps/api/src/modules/ops/prewarm.service.ts`, `docs/runbooks/phase24-queue-waf-prewarm.md` | Protected endpoint uses Google OIDC plus `x-prewarm-control-token` and can adjust Cloud Run min instances within configured max. [VERIFIED: codebase rg] | Need live endpoint/API enablement/log evidence, because prior prewarm closure required operational verification, not code-only proof. [VERIFIED: MEMORY.md] |
| Health/watch | `apps/api/src/health/health.controller.ts`, `apps/api/src/health/redis.health.indicator.ts` | `/health` uses Terminus and Redis/Valkey ping with redacted errors. [VERIFIED: codebase rg] | Current health check covers Redis/Valkey but not a DB query; DR/infra watch should add DB metric/query evidence separately. [VERIFIED: codebase rg] |
| DB pool sizing | `apps/api/src/database/drizzle.provider.ts`, `.github/workflows/deploy.yml` | API pool uses envs `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`; deploy currently sets `DB_POOL_MAX=3` and API `--max-instances=100`. [VERIFIED: codebase rg] | Prove Cloud Run max instances * pool max fits DB/pgBouncer capacity with headroom; do not claim capacity from Cloud Run slots alone. [VERIFIED: codebase rg] [VERIFIED: MEMORY.md] |
| Valkey/Redis | `apps/api/src/modules/booking/providers/redis.provider.ts`, `redis-io.adapter.ts`, `scripts/smoke-valkey-production.mjs` | Production requires `REDIS_URL`; `VALKEY_MODE` supports `standalone` or `cluster`; cluster retry and Socket.IO adapter are already implemented. [VERIFIED: codebase rg] | Actual failover/reconnect evidence must be collected; provider topology cannot be assumed from source. [VERIFIED: 26-CONTEXT.md] |
| Seat lock / inventory | `apps/api/src/modules/booking/booking.service.ts` | Lua lock operations are cluster-keysafe by showtime hash tags and DB statuses block sold/disabled seats. [VERIFIED: codebase rg] | Load and rehearsal must avoid real Girl Rules seat state and use a dedicated test showtime. [VERIFIED: 26-CONTEXT.md] |
| Reservation prepare/confirm | `apps/api/src/modules/reservation/reservation.service.ts` | Server calculates expected amount from DB seat map, validates DTO amount, verifies owned locks, and writes reservation/payment/ticket state transactionally. [VERIFIED: codebase rg] | Confirm flow calls Toss without `Idempotency-Key`; add hardening or record accepted risk before live cutover. [VERIFIED: codebase rg] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| Toss client/webhook | `apps/api/src/modules/payment/toss-payments.client.ts`, `payment-webhook.controller.ts`, `toss-webhook.guard.ts`, `payment.service.ts` | Confirm and cancel are server-side and Basic auth is built from the secret key plus colon. [VERIFIED: codebase rg] | No `queryPayment(paymentKey)` client method was found, and webhook processing currently relies on local guard/payload processing instead of official re-query. [VERIFIED: codebase rg] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| Toss widget | `apps/web/components/booking/toss-payment-widget.tsx` | Browser uses client-key widget surface. [VERIFIED: codebase rg] | Live-key smoke must verify no secret key reaches frontend bundle/logs/docs. [VERIFIED: 26-CONTEXT.md] |
| QR ticket service | `apps/api/src/modules/ticket/qr-ticket.service.ts`, `ticket.controller.ts`, `apps/api/src/database/schema/tickets.ts` | QR ticket issuance stores unique `qrTokenJti`, `secretVersion`, active status, and verifies reservation/payment/ticket state. [VERIFIED: codebase rg] | Need field-scan contract smoke for payload/JWT/HMAC inputs and Phase 27 scanner readiness. [VERIFIED: 26-CONTEXT.md] |
| QR web visibility | `apps/web/app/booking/[performanceId]/complete/page.tsx`, `apps/web/components/booking/booking-complete.tsx`, `apps/web/components/reservation/reservation-detail.tsx`, `apps/web/e2e/booking-complete-qr.spec.ts` | My Page detail shows QR ticket section when `qrTicket.status === 'ACTIVE'`; current complete page points user to My Page. [VERIFIED: codebase rg] | User-reported blocker says admin test-key payment completes without visible QR; current E2E is stubbed and does not prove live/API QR visibility. [VERIFIED: 26-CONTEXT.md] [VERIFIED: codebase rg] |
| Deploy | `.github/workflows/deploy.yml`, `docs/runbooks/phase23-canary-rollback.md` | Workflow deploys `grabit-api` and `grabit-web` to `asia-northeast3` with direct service deploy settings and secrets injection. [VERIFIED: codebase rg] | Older traffic-split canary runbook must be adapted to D-05 direct deploy plus 15-minute watch. [VERIFIED: 26-CONTEXT.md] |
| Operations runbooks | `docs/runbooks/phase24-queue-waf-prewarm.md`, `phase24-external-activation-checklist.md`, `phase24-production-operations-handling.md` | Existing runbooks cover WAF/prewarm, Toss activation, queue/payment/webhook/refund/QR/rollback handling. [VERIFIED: codebase rg] | Update runbooks into gate-specific evidence commands and first-24h checklist. [VERIFIED: 26-CONTEXT.md] |

## Architecture Patterns

### System Architecture Diagram

```text
Operator / CI
  |
  | CI green, deploy artifact, gate evidence
  v
Gate Ledger Artifact/API
  |-- if any row empty/FAIL/BLOCKED without ACCEPTED_RISK --> NO-GO
  |-- if CONFIG_READY_NOT_DRILLED without owner approval ------> NO-GO
  v
100% Direct Cloud Run Deploy
  |
  v
15-Minute Strict Watch
  |-- health/auth/detail/booking-disabled/queue/payment-safe fail --> Rollback
  |-- pass -------------------------------------------------------> Continue gates
  v
Dedicated Test Event Rehearsal
  |
  | queue -> admission -> seat lock -> prepare reservation
  v
Toss Test-Key Safe Confirm/Cancel
  |
  | confirm success -> reservation/payment/ticket state
  v
QR Visibility + Field-Scan Contract Smoke
  |
  v
k6 Baseline/Stress + DR/Infra + WAF/On-call Evidence
  |
  | all PASS or explicit ACCEPTED_RISK
  v
Toss Live-Key Smoke with BOOKING_ENABLED=false
  |
  | pass
  v
Enable BOOKING_ENABLED=true
  |
  v
First-2h Intensive Watch -> 24h Periodic Watch
```

### Recommended Project Structure

```text
.planning/phases/26-m1-canary-cutover-gates/
├── 26-RESEARCH.md              # this research artifact
├── 26-GATE-LEDGER.md           # human-readable source of truth for gate state
├── 26-GATE-LEDGER.json         # optional machine-validated mirror
├── evidence/                   # redacted command outputs, screenshots, summaries
└── runbooks/                   # phase-specific operator runbooks if not added under docs/

scripts/
├── k6/
│   ├── phase26-baseline.js     # 10k attempt scenario with thresholds
│   └── phase26-stress.js       # 20k attempt scenario with thresholds
└── phase26/
    ├── validate-gate-ledger.mjs
    ├── rehearsal-smoke.mjs
    ├── cleanup-dry-run.sql
    └── cleanup-test-event.sql
```

This structure keeps planner-visible gate evidence near the phase while putting reusable scripts under `scripts/`. [VERIFIED: repo layout] [VERIFIED: 26-CONTEXT.md]

### Pattern 1: Gate Ledger As Go/No-Go Contract

**What:** A ledger row records gate ID, requirement, state, evidence, scope, failure reason, owner approval, compensating monitoring, rollback/close-booking trigger, and timestamp. [VERIFIED: 26-CONTEXT.md]

**When to use:** Every Phase 26 gate must write or reference one row before `BOOKING_ENABLED=true`; empty rows remain no-go. [VERIFIED: 26-CONTEXT.md]

**Example:**

```json
{
  "gateId": "PAY-01-TOSS-WEBHOOK-QUERY",
  "requirement": "PAY-01",
  "state": "BLOCKED",
  "evidenceType": "operator",
  "evidence": [],
  "failureReason": "Toss queryPayment(paymentKey) path not implemented yet",
  "approver": null,
  "approvedAt": null,
  "compensatingMonitoring": "Payment webhook events and manual Toss dashboard reconciliation",
  "rollbackOrCloseTrigger": "Payment DONE without reservation CONFIRMED or active QR ticket",
  "updatedAt": "2026-05-20T00:00:00+09:00"
}
```

Source: D-01 through D-04 require gate states and no-go handling. [VERIFIED: 26-CONTEXT.md]

### Pattern 2: Direct Deploy Watch, Not Traffic-Split Canary

**What:** Use the current GitHub Actions deploy path to deploy the latest revision at 100%, then watch critical user paths for 15 minutes. [VERIFIED: 26-CONTEXT.md] [VERIFIED: codebase rg]

**When to use:** Phase 26 M1/M2 cutover deploys, because D-05 explicitly rejects traffic-split canary for this phase. [VERIFIED: 26-CONTEXT.md]

**Evidence to capture:** deploy run URL, deployed revision IDs, `/health`, public detail page, auth/session, runtime flags, queue entry, payment-safe path, Cloud Run logs, and rollback command target. [VERIFIED: 26-CONTEXT.md] [CITED: https://cloud.google.com/run/docs/logging]

### Pattern 3: Dedicated Test Event Rehearsal

**What:** Run queue -> lock -> prepare -> safe/test confirm -> QR -> cancel/refund -> cleanup against a dedicated test performance/showtime and test order prefix. [VERIFIED: 26-CONTEXT.md]

**When to use:** All rehearsal, cleanup, and load tests that may write reservations, payments, tickets, locks, jobs, or seat state. [VERIFIED: 26-CONTEXT.md]

**Production safety boundaries:** Do not mutate existing production users, sessions, registrations, consents, real Girl Rules performance data, real reservations, real payments, real tickets, or real seat state. [VERIFIED: 26-CONTEXT.md]

### Pattern 4: Payment Server Authority

**What:** Server calculates expected amount, verifies requested amount, performs Toss confirm/cancel/query using secret key, and only applies local payment state after provider evidence matches. [VERIFIED: codebase rg] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]

**When to use:** Reservation prepare/confirm, payment webhook, refund/cancel, and live-key smoke. [VERIFIED: 26-CONTEXT.md]

**Gap to plan:** Existing `TossPaymentsClient` confirms/cancels but does not add `Idempotency-Key` headers and no `queryPayment(paymentKey)` method was found. [VERIFIED: codebase rg]

### Anti-Patterns to Avoid

- **Treating accepted risk as pass:** `ACCEPTED_RISK` and `CONFIG_READY_NOT_DRILLED` must remain visibly non-PASS states in the ledger. [VERIFIED: 26-CONTEXT.md]
- **Reintroducing Cloud Run traffic-split canary:** D-05 explicitly supersedes old roadmap wording. [VERIFIED: 26-CONTEXT.md]
- **Testing rehearsal against Girl Rules real event:** D-11 through D-15 forbid real event/user data as load or cleanup targets. [VERIFIED: 26-CONTEXT.md]
- **Declaring capacity from Cloud Run max instances alone:** Existing API pool settings and prior launch audit show DB capacity can be the bottleneck even when Cloud Run request slots look high. [VERIFIED: codebase rg] [VERIFIED: MEMORY.md]
- **Trusting Toss webhook payload alone:** Official guardrail requires re-query by `paymentKey`; current local guard is not final payment-state authority. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] [VERIFIED: codebase rg]
- **Using stubbed QR E2E as live QR proof:** Existing QR E2E stubs reservation detail and does not prove live reservation/payment/ticket persistence. [VERIFIED: codebase rg]
- **Marking provider config as drilled:** pgBouncer, HA/read replica, and pool sizing can be evidence, but undrilled items must be `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK`. [VERIFIED: 26-CONTEXT.md]

## Gate Ledger Design Guidance

| Design Choice | Recommendation | Tradeoff |
|---------------|----------------|----------|
| Source of truth | Start with `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md` plus optional JSON mirror validated by script. [VERIFIED: 26-CONTEXT.md] | Fast, auditable, low-risk; not a runtime admin editor. [VERIFIED: repo layout] |
| State enum | Exactly `PASS`, `FAIL`, `ACCEPTED_RISK`, `CONFIG_READY_NOT_DRILLED`, `BLOCKED`. [VERIFIED: 26-CONTEXT.md] | Prevents accidental normalization of caveats into pass. [VERIFIED: 26-CONTEXT.md] |
| Evidence model | Store command, timestamp, actor, target env, redacted output path, and decision. [VERIFIED: 26-CONTEXT.md] | Requires a little discipline, but enables later verification and rollback decisions. [VERIFIED: 26-CONTEXT.md] |
| API/admin surface | Optional read-only admin page or export link after artifact model is stable. [VERIFIED: codebase rg + 26-CONTEXT.md] | Avoids adding a write surface to gate state during launch pressure. [VERIFIED: codebase rg + 26-CONTEXT.md] |
| Cutover check | Add `validate-gate-ledger.mjs` that exits nonzero if required rows are missing, `FAIL`, `BLOCKED`, or non-approved `ACCEPTED_RISK`/`CONFIG_READY_NOT_DRILLED`. [VERIFIED: 26-CONTEXT.md] | Makes go/no-go mechanical without hiding operator override. [VERIFIED: 26-CONTEXT.md] |

**Required row classes:** M1 smoke, direct deploy watch, rollback target, k6 baseline, k6 stress, test-event rehearsal, QR visibility, field-scan contract, Cloud SQL PITR/restore, Valkey reconnect/failure, pgBouncer evidence, HA/read-replica evidence, pool sizing, WAF active-rule smoke, Sentry alert dry-run, on-call playbooks, Toss test-key rehearsal, Toss live-key smoke, `BOOKING_ENABLED=true` enablement, first-2h watch, 24h watch. [VERIFIED: 26-CONTEXT.md] [VERIFIED: .planning/REQUIREMENTS.md]

## Ticketing Rehearsal Plan

| Step | What To Prove | Automation | Safety Boundary |
|------|---------------|------------|-----------------|
| Create/identify dedicated test event | Test performance/showtime/seat map exists and is not Girl Rules. [VERIFIED: 26-CONTEXT.md] | SQL/API setup script with test marker. [VERIFIED: codebase rg + 26-CONTEXT.md] | Denylist real Girl Rules IDs and stop on unexpected rows. [VERIFIED: 26-CONTEXT.md] |
| Queue enter | `QueueService` issues or reuses session/admission and active window. [VERIFIED: codebase rg] | API smoke or k6 setup phase. [VERIFIED: codebase rg + 26-CONTEXT.md] | Use test event only. [VERIFIED: 26-CONTEXT.md] |
| Seat lock | `BookingService.lockSeat` checks `BOOKING_ENABLED`, showtime booking open, DB seat status, and Valkey lock. [VERIFIED: codebase rg] | API smoke; browser seat test for hit-target regressions. [VERIFIED: MEMORY.md] | No real seat inventory mutation. [VERIFIED: 26-CONTEXT.md] |
| Prepare reservation | Server calculates canonical amount and writes pending reservation. [VERIFIED: codebase rg] | API smoke with known seat IDs. [VERIFIED: codebase rg + 26-CONTEXT.md] | Use test order prefix and test user/admin account. [VERIFIED: 26-CONTEXT.md] |
| Safe/test confirm | Toss test-key confirm path creates payment and confirmed reservation. [VERIFIED: codebase rg] | Browser/API rehearsal, not high-volume load. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Test keys only until live smoke gate; no real deposits. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| QR issue and visible access | `QrTicketService` issues active ticket and complete/My Page expose visible QR/access path. [VERIFIED: codebase rg] | Playwright plus API check for ticket state. [VERIFIED: codebase rg + 26-CONTEXT.md] | QR secret/token output must be redacted in artifacts. [VERIFIED: AGENTS.md] |
| Cancel/refund | Payment cancel/refund path and reservation/ticket/seat follow-up state are coherent. [VERIFIED: codebase rg] | API smoke with test payment. [VERIFIED: codebase rg + 26-CONTEXT.md] | No cancellation of live real orders. [VERIFIED: 26-CONTEXT.md] |
| Cleanup dry-run | Counts/lists are scoped to test IDs/order prefix/marker. [VERIFIED: 26-CONTEXT.md] | SQL dry-run script and review artifact. [VERIFIED: 26-CONTEXT.md] | Backup/restore-point confirmation before mutation. [VERIFIED: 26-CONTEXT.md] |
| Cleanup execute | Test event residue removed or restored without touching protected production data. [VERIFIED: 26-CONTEXT.md] | Transactional cleanup script. [VERIFIED: MEMORY.md + 26-CONTEXT.md] | If dry-run returns unexpected rows, stop. [VERIFIED: 26-CONTEXT.md] |

**Implementation note:** Admin bypass exists in `FeatureFlagsService` and `AdmissionGuard`, but normal-user `BOOKING_ENABLED=false` protection must still be smoked because Phase 26 cutover safety depends on backend-side blocking, not UI state. [VERIFIED: codebase rg] [VERIFIED: 26-CONTEXT.md]

## k6 / Load Strategy

### Scenario Split

| Scenario | Target | Purpose | Writes? |
|----------|--------|---------|---------|
| `baseline-10k-read-queue` | Public detail, runtime flags, queue entry/status, lightweight seat status. [VERIFIED: codebase rg] | Prove 10k attempt baseline under p95 < 2s and error rate <1%. [VERIFIED: 26-CONTEXT.md] | Queue writes only, scoped to test event. [VERIFIED: 26-CONTEXT.md] |
| `stress-20k-read-queue` | Same path at higher arrival rate. [VERIFIED: 26-CONTEXT.md] | Find saturation and prove failure handling without real-user mutation. [VERIFIED: 26-CONTEXT.md] | Queue writes only, scoped to test event. [VERIFIED: 26-CONTEXT.md] |
| `booking-mutation-sampled` | lock -> prepare for small controlled sample. [VERIFIED: codebase rg] | Exercise Valkey locks and DB transaction path without exhausting seats. [VERIFIED: codebase rg + 26-CONTEXT.md] | Yes, but test event only. [VERIFIED: 26-CONTEXT.md] |
| `payment-safe-smoke` | Toss test-key confirm/cancel/query/webhook. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Prove correctness, not load; Toss/payment provider should not be hammered by 10k/20k stress. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Yes, one/few test orders only. [VERIFIED: 26-CONTEXT.md] |

### Threshold Pattern

```javascript
// Source: k6 official threshold docs. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/]
export const options = {
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 500),
      timeUnit: '1s',
      duration: __ENV.DURATION || '20m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 1000),
      maxVUs: Number(__ENV.MAX_VUS || 5000),
    },
  },
};
```

### What Can Be Automated

- k6 script execution, thresholds, JSON summary export, and redacted evidence attachment can be automated. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/]
- Test-event queue/read paths can be automated after test IDs and auth/session setup are provided. [VERIFIED: codebase rg]
- Cloud Run log queries and metrics export can be scripted with `gcloud logging read` and Monitoring API. [CITED: https://cloud.google.com/run/docs/logging]
- Local environment can run k6 through Docker because Docker is installed and local `k6` is missing. [VERIFIED: local command]

### What Needs Operator / Production Credentials

- Production k6 target URL, test user/admin credentials, dedicated test event IDs, and safe traffic window need owner confirmation. [VERIFIED: 26-CONTEXT.md]
- Cloud SQL restore/PITR, Cloudflare rule state, Sentry alert dry-runs, Toss dashboard review/live keys, and Secret Manager updates require production/provider credentials. [VERIFIED: local command] [VERIFIED: 26-CONTEXT.md]
- The local shell's default GCP project is `udamon-6840c0`, so Phase 26 production commands must explicitly pass or verify the Grabit project before reading or mutating cloud state. [VERIFIED: local command] [VERIFIED: MEMORY.md]

## DR / Infra Gate Research

| Gate | Required Evidence | Evidence Classification |
|------|-------------------|-------------------------|
| Cloud Run rollback | Known-good revision, rollback command, rollback drill or dry-run with service describe/log evidence. [CITED: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration] | `PASS` only if rollback path is actually verified; otherwise `BLOCKED` or accepted risk. [VERIFIED: 26-CONTEXT.md] |
| Cloud SQL PITR / restore | Backup/PITR enabled and restore to separate instance or safe target, then schema/count validation. [CITED: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr] | `PASS` only if restore path is exercised; config-only backup state is not enough for D-12. [VERIFIED: 26-CONTEXT.md] |
| Cloud SQL HA | HA configuration evidence for primary instance. [CITED: https://cloud.google.com/sql/docs/postgres/high-availability] | If not drilled, mark `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK`; do not mark PASS. [VERIFIED: 26-CONTEXT.md] |
| Read replica | Replica configuration and read-routing plan if implemented. [CITED: https://cloud.google.com/sql/docs/postgres/replication/create-replica] | Config evidence only unless app/query paths are actually exercised. [VERIFIED: 26-CONTEXT.md] |
| pgBouncer | Transaction pooling endpoint, max connections, app `DATABASE_URL`/pool routing, and connection math. [VERIFIED: 26-CONTEXT.md] | If absent or not drilled, ledger row should be `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK`, not PASS. [VERIFIED: 26-CONTEXT.md] |
| Per-instance DB pool sizing | `DB_POOL_MAX`, Cloud Run max instances, DB max connections, pgBouncer max client/server connections, and headroom math. [VERIFIED: codebase rg] | `PASS` requires current live config plus math; code defaults alone are insufficient. [VERIFIED: codebase rg] |
| Valkey reconnect/failover | `scripts/smoke-valkey-production.mjs` evidence plus provider topology/failure behavior. [VERIFIED: codebase rg] | Reconnect can be PASS with smoke; failover PASS requires actual/provider failover evidence. [VERIFIED: 26-CONTEXT.md] |

**Key planning constraint:** do not treat Cloud Run concurrency as total cutover capacity without DB/Valkey/payment evidence; prior Grabit launch analysis separated Cloud Run headroom from the smaller DB/pool bottleneck. [VERIFIED: MEMORY.md]

## WAF / Rate-Limit / Monitoring / On-Call Readiness

| Domain | Evidence Needed | Existing Asset |
|--------|-----------------|----------------|
| Cloudflare WAF | Active zone/rules, queue-entry challenge, booking mutation rate-limit, macro/block rules, normal pass smoke, low-volume suspicious challenge/block smoke. [VERIFIED: 26-CONTEXT.md] [CITED: https://developers.cloudflare.com/waf/custom-rules/] | `docs/runbooks/phase24-queue-waf-prewarm.md`. [VERIFIED: codebase rg] |
| App-layer rate limit | Named policy tests for queue-entry, lock-seat, prepare-reservation, confirm-payment, signup. [VERIFIED: codebase rg] | `TrafficDefenseService`. [VERIFIED: codebase rg] |
| Cloud Run logs | 5xx, latency, auth/session, queue, payment-safe behavior, deploy revision, rollback trigger queries. [VERIFIED: 26-CONTEXT.md] [CITED: https://cloud.google.com/run/docs/logging] | `.github/workflows/deploy.yml` service names and Phase 24 operations runbook. [VERIFIED: codebase rg] |
| Sentry | Dry-run alerts or test events for API/web errors, payment failure, latency/error-rate conditions. [VERIFIED: 26-CONTEXT.md] [CITED: https://docs.sentry.io/product/alerts/] | Sentry packages and DSN/env injection exist in repo/deploy config. [VERIFIED: package.json] [VERIFIED: codebase rg] |
| Business metrics | Queue length/admission rate, lock/prepare/confirm success, payment success/failure, QR issuance, refund failures, sellout, remaining seats. [VERIFIED: 26-CONTEXT.md] | DB schemas/services for queue/reservation/payment/ticket/refund exist. [VERIFIED: codebase rg] |
| First-2h/24h cadence | First 2h every 5-10 min; then every 30-60 min until 24h. [VERIFIED: 26-CONTEXT.md] | New Phase 26 first-24h checklist should extend `phase24-production-operations-handling.md`. [VERIFIED: codebase rg] |

## Toss Test-Key And Live-Key Cutover Guardrails

| Guardrail | Planning Implication |
|-----------|----------------------|
| Secret key is server-only and client key is browser-only. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Check frontend bundle/log artifacts for no `TOSS_SECRET_KEY`, no raw secret in docs, no leaked env echo. [VERIFIED: 26-CONTEXT.md] |
| Server must verify intended amount before confirm. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Existing `ReservationService` compares server-calculated amount and confirm DTO amount; preserve this path and test mismatch rejection. [VERIFIED: codebase rg] |
| Basic auth uses `base64(SECRET_KEY:)`. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Existing client builds Basic auth from secret plus colon; no client-side confirm. [VERIFIED: codebase rg] |
| POST APIs support `Idempotency-Key`. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Add or plan `Idempotency-Key` for confirm/cancel retry safety; current Toss client lacks it. [VERIFIED: codebase rg] |
| General payment webhooks have no signature header and must be re-verified by Payment Query API using `paymentKey`. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Add `queryPayment(paymentKey)` and re-query before applying final payment state; current shared-secret guard is not final authority. [VERIFIED: codebase rg] |
| Test keys use `test_*`, live keys use `live_*`, and live means real deposits. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Test-key rehearsal can proceed now, but live-key smoke is separate and must stay booking-disabled until the ledger approves cutover. [VERIFIED: 26-CONTEXT.md] |
| The prior Toss test secret was exposed in discussion. [VERIFIED: 26-CONTEXT.md] | Rotate/reissue test secret before relying on final test-key evidence and never write raw key into artifacts. [VERIFIED: 26-CONTEXT.md] |

## QR Visibility Blocker Research

| Surface | Current Finding | Planning Action |
|---------|-----------------|-----------------|
| Payment complete page | `apps/web/components/booking/booking-complete.tsx` currently tells users QR is available in My Page and shows a "QR ticket view" CTA rather than rendering a visible/scannable QR on the complete page. [VERIFIED: codebase rg] | Decide whether D-26 requires actual QR display on complete page or visible access is enough; current user-reported blocker says treat missing visible QR as blocker. [VERIFIED: 26-CONTEXT.md] |
| My Page reservation/ticket detail | `reservation-detail.tsx` renders QR ticket status/token details when `qrTicket.status === 'ACTIVE'`. [VERIFIED: codebase rg] | Add production-like E2E/API smoke proving confirmed payment returns active `qrTicket` and My Page visibly exposes it. [VERIFIED: codebase rg] |
| API ticket persistence | `QrTicketService.ensureIssuedTicketForReservation()` inserts active ticket linked to reservation/payment and unique `qrTokenJti`. [VERIFIED: codebase rg] | Verify `reservation CONFIRMED`, `payment DONE`, and `ticket ACTIVE` after test-key confirm. [VERIFIED: codebase rg] |
| QR secrets/config | QR token signing uses `QR_TICKET_SECRET_VERSION`, `QR_TICKET_SECRET`, and optional keyring JSON. [VERIFIED: codebase rg] | Live smoke must verify env presence without exposing values. [VERIFIED: AGENTS.md] |
| Field-scan contract | `verifyTicketToken()` checks token payload, reservation/payment/showtime linkage, status, expiry, and one-time state. [VERIFIED: codebase rg] | Add smoke that decodes/validates payload contract and calls verify path; full manager scan UI stays Phase 27. [VERIFIED: 26-CONTEXT.md] |

**Blocking interpretation:** If an admin/test-key payment completes but the user cannot see or access an active QR from complete page and My Page, `PAY-01` and QR-adjacent cutover gates must remain `BLOCKED` even if payment state is `DONE`. [VERIFIED: 26-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Load threshold runner | Custom Node loop with manual percentiles | k6 thresholds and scenarios | k6 directly supports `http_req_failed` and `http_req_duration` thresholds. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] |
| Payment state authority | Client-side amount trust or webhook-payload-only updates | Server-side Toss confirm/query/cancel plus DB amount verification | Official guardrails require server authority and webhook re-query. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| Booking flag system | New flag store | Existing `BOOKING_ENABLED` shared flag and API `FeatureFlagsService` | Current code already blocks mutation paths before side effects and supports admin bypass. [VERIFIED: codebase rg] |
| Queue/seat lock model | New queue or lock engine | Existing `QueueService`, `AdmissionGuard`, `BookingService` Valkey Lua locks | Existing path already coordinates admission, locks, DB seat status, and broadcasts. [VERIFIED: codebase rg] |
| WAF substitute | App-only throttling as WAF proof | Cloudflare WAF plus `TrafficDefenseService` | Phase gate requires active Cloudflare rule evidence and app-layer guard evidence. [VERIFIED: 26-CONTEXT.md] [CITED: https://developers.cloudflare.com/waf/rate-limiting-rules/] |
| QR token crypto | Custom crypto beyond existing service contract | Existing `QrTicketService` JWT/HMAC-style contract and verify path | Ticket status, reservation/payment linkage, and secret versioning already exist. [VERIFIED: codebase rg] |
| Production cleanup | Broad deletes or seed reset scripts | Scoped dry-run + backup + test IDs/order prefix/denylist | D-13 through D-15 forbid touching real users/events/payment/ticket/seat state; prior cleanup experience showed backup-first and scoped transaction matter. [VERIFIED: 26-CONTEXT.md] [VERIFIED: MEMORY.md] |

**Key insight:** Phase 26 failures are mostly integration and operations failures, not missing primitives. The planner should wire evidence around existing primitives instead of replacing queue, flag, payment, QR, or rate-limit systems. [VERIFIED: codebase rg]

## Common Pitfalls

### Pitfall 1: Old Canary Language Causes Wrong Plan
**What goes wrong:** Planner creates Cloud Run 5%/50%/100% traffic split tasks. [VERIFIED: .planning/ROADMAP.md]  
**Why it happens:** ROADMAP and milestone spec still contain older canary wording. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md]  
**How to avoid:** Treat D-05 as source of truth: direct deploy to 100% plus strict 15-minute watch. [VERIFIED: 26-CONTEXT.md]  
**Warning signs:** Gate ledger has "canary PASS" without direct-deploy watch evidence. [VERIFIED: 26-CONTEXT.md]

### Pitfall 2: Four-Locale Code vs Five-Locale Success Criterion
**What goes wrong:** M1 smoke is marked PASS while only four locales are implemented. [VERIFIED: codebase rg] [VERIFIED: .planning/ROADMAP.md]  
**Why it happens:** Current code has `ko`, `en`, `th`, `zh-CN`, while older docs/success criteria mention five locales. [VERIFIED: codebase rg] [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md]  
**How to avoid:** Wave 0 must reconcile the expected locale set with the owner before M1-01 PASS. [VERIFIED: codebase rg + .planning/ROADMAP.md]  
**Warning signs:** E2E updates only the existing four-locale smoke and claims five-locale coverage. [VERIFIED: codebase rg]

### Pitfall 3: Stubbed QR Test Hides Production Blocker
**What goes wrong:** Tests pass but admin test-key complete page still lacks visible QR. [VERIFIED: 26-CONTEXT.md] [VERIFIED: codebase rg]  
**Why it happens:** Existing QR E2E uses mocked reservation detail and checks a My Page path, not a real test-key confirm-to-ticket path. [VERIFIED: codebase rg]  
**How to avoid:** Add API/browser smoke that confirms test payment, verifies `ticket ACTIVE`, then opens complete page and My Page. [VERIFIED: codebase rg + 26-CONTEXT.md]  
**Warning signs:** Evidence only shows mocked Playwright route fulfillment. [VERIFIED: codebase rg]

### Pitfall 4: Capacity Claim Ignores DB Pool
**What goes wrong:** Cutover is approved from Cloud Run max instances while DB connection pressure is unproven. [VERIFIED: MEMORY.md]  
**Why it happens:** `.github/workflows/deploy.yml` sets API max instances and `DB_POOL_MAX=3`, but provider DB capacity and pgBouncer/HA state must be checked live. [VERIFIED: codebase rg]  
**How to avoid:** Ledger row must include connection math and current provider evidence. [VERIFIED: 26-CONTEXT.md]  
**Warning signs:** "100 instances * 80 concurrency" appears without DB max connections or pooler proof. [VERIFIED: MEMORY.md]

### Pitfall 5: Payment Webhook Applies State Without Provider Re-Query
**What goes wrong:** Spoofed or stale webhook payload changes local payment state. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]  
**Why it happens:** Existing webhook guard uses shared secret patterns and controller/service process local payload; no query client method was found. [VERIFIED: codebase rg]  
**How to avoid:** Implement/query Toss by `paymentKey` before final state transition and log redacted evidence. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]  
**Warning signs:** Webhook test asserts local payload handling but never calls query path. [VERIFIED: codebase rg]

### Pitfall 6: Cleanup Touches Real Production Data
**What goes wrong:** Rehearsal cleanup deletes or mutates real users, Girl Rules event data, payments, tickets, or seat state. [VERIFIED: 26-CONTEXT.md]  
**Why it happens:** Broad seed/reset scripts and unscoped SQL are tempting under launch pressure. [VERIFIED: MEMORY.md]  
**How to avoid:** Require dry-run counts, backup/restore-point, test IDs/order prefix/marker, and denylist protection. [VERIFIED: 26-CONTEXT.md]  
**Warning signs:** Cleanup query lacks explicit `performanceId`/`showtimeId` and real-event denylist. [VERIFIED: 26-CONTEXT.md]

## Code Examples

### Gate Ledger Validation Skeleton

```javascript
// Source: Phase 26 D-01 through D-04. [VERIFIED: 26-CONTEXT.md]
const REQUIRED_STATES = new Set(['PASS', 'FAIL', 'ACCEPTED_RISK', 'CONFIG_READY_NOT_DRILLED', 'BLOCKED']);
const PASSING_WITHOUT_OVERRIDE = new Set(['PASS']);

export function validateGate(row) {
  if (!REQUIRED_STATES.has(row.state)) return { ok: false, reason: 'unknown-state' };
  if (PASSING_WITHOUT_OVERRIDE.has(row.state)) return { ok: true };
  if (row.state === 'ACCEPTED_RISK' && row.approver && row.approvedAt && row.rollbackOrCloseTrigger) {
    return { ok: true, acceptedRisk: true };
  }
  return { ok: false, reason: `no-go-${row.state}` };
}
```

### Toss Confirm With Idempotency Header

```typescript
// Source: Toss official docs say POST APIs support Idempotency-Key. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]
await fetch('https://api.tosspayments.com/v1/payments/confirm', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': `confirm:${orderId}`,
  },
  body: JSON.stringify({ paymentKey, orderId, amount }),
});
```

### Cleanup Dry-Run Guard Shape

```sql
-- Source: D-13 through D-15 require test IDs, dry-run, backup, and denylist. [VERIFIED: 26-CONTEXT.md]
select count(*) as reservations_to_touch
from reservations r
where r.showtime_id = :test_showtime_id
  and r.toss_order_id like 'PH26_TEST_%'
  and not exists (
    select 1
    from performances p
    where p.id = :real_girl_rules_performance_id
      and p.id = :test_performance_id
  );
```

### QR Contract Smoke Shape

```typescript
// Source: QrTicketService verifies reservation/payment/ticket linkage and active status. [VERIFIED: codebase rg]
const detail = await api.getReservationDetail(reservationId, actor);
assert.equal(detail.status, 'CONFIRMED');
assert.equal(detail.payment.status, 'DONE');
assert.equal(detail.qrTicket.status, 'ACTIVE');
assert.ok(detail.qrTicket.token);
await qrTicketService.verifyTicketToken(detail.qrTicket.token);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cloud Run traffic-split canary for Phase 26 | 100% direct deploy after CI/CD green plus strict 15-minute watch | Phase 26 discuss decision D-05 on 2026-05-20. [VERIFIED: 26-CONTEXT.md] | Planner must not create 5%/50%/100% traffic split tasks. [VERIFIED: 26-CONTEXT.md] |
| Webhook shared-secret/payload handling as final proof | Toss Payment Query API re-verification by `paymentKey` before applying final payment state | Current official Toss guardrail checked for Phase 26. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] | Existing code needs hardening or ledger accepted risk before live cutover. [VERIFIED: codebase rg] |
| Config-only infra readiness marked green | Actual drill for Cloud Run rollback, DB restore/PITR, Valkey reconnect/failure; config-only items remain non-PASS | Phase 26 D-12. [VERIFIED: 26-CONTEXT.md] | pgBouncer/HA/read replica/pool sizing cannot be silently treated as PASS. [VERIFIED: 26-CONTEXT.md] |
| Payment test-key rehearsal as live readiness | Test-key rehearsal now plus separate live-key smoke after Toss review/live keys | Phase 26 D-19 through D-22. [VERIFIED: 26-CONTEXT.md] | `BOOKING_ENABLED=true` waits for all gates, not just test-key flow. [VERIFIED: 26-CONTEXT.md] |

**Deprecated/outdated for this phase:**

- Cloud Run traffic-split canary wording in older roadmap/milestone docs is outdated for Phase 26 because D-05 supersedes it. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: 26-CONTEXT.md]
- Any payment webhook plan that lacks Toss query re-verification is incomplete for live cutover. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] [VERIFIED: codebase rg]
- Any QR proof based only on stubbed frontend tests is insufficient for the user-reported blocker. [VERIFIED: 26-CONTEXT.md] [VERIFIED: codebase rg]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Dedicated test event IDs and safe production load window will be supplied by the operator before destructive or high-volume rehearsal. [ASSUMED] | Ticketing Rehearsal Plan / k6 Strategy | Without this, automation could target the wrong data or be blocked from production validation. |
| A2 | Production credentials, dedicated test event, and provider quotas/topology must be confirmed before Load/DR gate execution. [ASSUMED] | Metadata | If wrong, the planner may overstate how much can be automated without operator access. |
| A3 | This research remains valid until 2026-05-27 for provider/live cutover assumptions and 2026-06-19 for codebase architecture if no major refactor lands. [ASSUMED] | Metadata | If provider state or code changes sooner, plan tasks may use stale evidence. |

## Open Questions (RESOLVED)

1. **What is the required Phase 26 locale set: current four locales or the older five-locale success criterion?**  
   What we know: code and E2E currently use `ko`, `en`, `th`, `zh-CN`; ROADMAP/milestone success criteria say five locales. [VERIFIED: codebase rg] [VERIFIED: .planning/ROADMAP.md]  
   RESOLVED: Phase 26 plans must reconcile the mismatch before M1 smoke can be recorded as PASS. Plan 26-07 asserts the active locale set from current code (`ko`, `en`, `th`, `zh-CN`) and records any mismatch with older five-locale wording in the `M1_LOCALE_SCOPE` gate. Final cutover cannot treat the locale gate as PASS unless either the code/test surface is restored to the required five-locale criterion or the owner-approved Gate Ledger records a non-PASS state with explicit approval metadata. [VERIFIED: 26-CONTEXT.md] [VERIFIED: 26-07-PLAN.md]

2. **Is pgBouncer/HA/read replica implementation required now, or will owner accept non-PASS ledger state?**  
   What we know: D-12 allows pgBouncer/HA/read replica/pool sizing as `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK` when not drilled. [VERIFIED: 26-CONTEXT.md]  
   RESOLVED: Plan 26-08 must inspect current live topology and classify each infra row separately. Actual Cloud Run rollback, Cloud SQL PITR/restore safe target, and Valkey reconnect/failure evidence are PASS only when drilled. pgBouncer, HA/read replica, and DB pool sizing evidence may be `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK`, but never PASS unless drilled; owner-approved non-PASS progression requires approvalState, approver, compensatingMonitoring, and rollbackOrCloseTrigger. [VERIFIED: 26-CONTEXT.md] [VERIFIED: 26-08-PLAN.md]

3. **Can Toss live-key smoke safely perform confirm/cancel before full public booking open?**  
   What we know: live keys mean real deposits and live smoke must include key/prefix, widget, server confirm/query/cancel where safely allowed, webhook delivery/query re-verification, and no leakage. [VERIFIED: 26-CONTEXT.md] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]  
   RESOLVED: Plan 26-10 separates live-key smoke from test-key rehearsal. Live-key smoke happens only after Toss review/live-key availability is confirmed, with `BOOKING_ENABLED=false`, server-only secret checks, no raw keys, and provider-safe confirm/query/cancel only where explicitly allowed by the runbook/operator. Webhook state must be re-queried from Toss before local finalization, and unavailable live provider state is BLOCKED or owner-approved non-PASS, not PASS. [VERIFIED: 26-CONTEXT.md] [VERIFIED: 26-10-PLAN.md]

4. **Does complete page need an actual scannable QR image or is a visible My Page QR access path acceptable?**  
   What we know: D-26 says complete page and My Page/ticket detail must let the user see/access QR, and current complete page mainly links to My Page. [VERIFIED: 26-CONTEXT.md] [VERIFIED: codebase rg]  
   RESOLVED: Phase 26 requires visible or direct QR access on both the payment complete page and My Page/ticket detail before cutover. Plan 26-03 implements and tests both surfaces. A My Page-only link is not enough if the complete page cannot visibly expose QR-ready/direct access; QR pending remains non-PASS until safe retry/readiness evidence exists. [VERIFIED: 26-CONTEXT.md] [VERIFIED: 26-03-PLAN.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | repo scripts, API/web build/test | yes | `v24.13.0` local; repo requires `>=22.0.0`. [VERIFIED: local command] [VERIFIED: package.json] | Use repo/deploy Node 22 if local v24 causes parity issues. [VERIFIED: package.json] |
| pnpm | monorepo package manager | yes | `10.28.1`. [VERIFIED: local command] [VERIFIED: package.json] | none needed. |
| npm | registry checks, ctx7 fallback | yes | `11.6.2`. [VERIFIED: local command] | none needed. |
| Docker | k6 fallback and local parity | yes | `29.1.3`. [VERIFIED: local command] | install local k6 if Docker unavailable. |
| gcloud | Cloud Run/SQL/logs/Secret Manager gates | yes | `564.0.0`; active local project `udamon-6840c0`. [VERIFIED: local command] | Always pass explicit Grabit project; use Cloud Console if CLI auth lacks permission. [VERIFIED: local command] |
| gh | GitHub Actions/PR/deploy run checks | yes | `2.89.0`. [VERIFIED: local command] | GitHub web UI. |
| jq | script parsing | yes | `jq-1.7.1-apple`. [VERIFIED: local command] | Node JSON parser. |
| k6 | load gates | no | local command missing. [VERIFIED: local command] | Docker `grafana/k6` image; Docker is available. [VERIFIED: local command] |
| psql | DB drill/query evidence | no | local command missing. [VERIFIED: local command] | Cloud SQL Auth Proxy + installed `libpq`, Cloud Shell, or CI job. [VERIFIED: local command] |
| redis-cli | Valkey manual checks | no | local command missing. [VERIFIED: local command] | Existing Node smoke script using `ioredis`. [VERIFIED: codebase rg] |
| wrangler | Cloudflare command-line checks | no direct global command | repo has `wrangler ^4.81.1` dev dependency. [VERIFIED: package.json] [VERIFIED: local command] | `pnpm exec wrangler` or Cloudflare dashboard/API. [VERIFIED: package.json] |

**Missing dependencies with no fallback:**

- None found for research. Production execution still depends on provider permissions and owner-approved credentials. [VERIFIED: local command] [VERIFIED: 26-CONTEXT.md]

**Missing dependencies with fallback:**

- `k6` CLI missing; use Docker `grafana/k6`. [VERIFIED: local command]
- `psql` missing; use Cloud Shell/CI or install `libpq` for local DB evidence. [VERIFIED: local command]
- `redis-cli` missing; use `scripts/smoke-valkey-production.mjs` or install Redis CLI. [VERIFIED: codebase rg]
- global `wrangler` missing; use `pnpm exec wrangler` or Cloudflare dashboard/API. [VERIFIED: package.json]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest for API/shared/web unit tests; Playwright for web E2E; k6 for load thresholds. [VERIFIED: codebase rg] [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] |
| Config file | `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`. [VERIFIED: codebase rg] |
| Quick run command | `pnpm --filter @grabit/api test -- --runInBand` is not the repo pattern; use package scripts as defined: `pnpm --filter @grabit/api test`, `pnpm --filter @grabit/web test`. [VERIFIED: package.json] |
| Full suite command | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, plus selected Playwright and k6 gates. [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| M1-01 | Public detail, runtime flag, booking-disabled, queue smoke, direct deploy watch. [VERIFIED: 26-CONTEXT.md] | E2E + ops smoke | `pnpm --filter @grabit/web test:e2e -- apps/web/e2e/i18n-smoke.spec.ts` plus Phase 26 watch script. [VERIFIED: codebase rg] | Partial; watch script is Wave 0 gap. |
| LOAD-01 | k6 10k baseline and 20k stress p95/error-rate gates. [VERIFIED: .planning/REQUIREMENTS.md] | Load | `docker run --rm -i grafana/k6 run - < scripts/k6/phase26-baseline.js` and stress variant. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] | No; Wave 0/1 gap. |
| DR-01 | Cloud Run rollback, Cloud SQL restore/PITR, Valkey reconnect/failure. [VERIFIED: .planning/REQUIREMENTS.md] | Ops drill | `gcloud run services describe ...`, Cloud SQL restore command, `node scripts/smoke-valkey-production.mjs`. [VERIFIED: codebase rg] [CITED: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr] | Partial; Valkey script exists, DR harness missing. |
| INFRA-01 | pgBouncer/HA/read replica/pool sizing evidence. [VERIFIED: .planning/REQUIREMENTS.md] | Config + ops evidence | New `scripts/phase26/infra-evidence.mjs` or runbook commands. [VERIFIED: 26-CONTEXT.md] | No; Wave 0 gap. |
| OPS-01 | Playbooks, Sentry alert dry-runs, Cloud Run/Cloudflare/business metrics. [VERIFIED: .planning/REQUIREMENTS.md] | Ops smoke | Runbook commands plus Sentry/Cloudflare evidence capture. [CITED: https://docs.sentry.io/product/alerts/] | Partial; Phase 24 runbooks exist. |
| PAY-01 | Test-key rehearsal, live-key smoke, webhook query re-verification, `BOOKING_ENABLED=true` only after gates. [VERIFIED: .planning/REQUIREMENTS.md] | Integration + ops smoke | Existing payment/booking tests plus new Toss query/idempotency tests and rehearsal smoke. [VERIFIED: codebase rg] | Partial; query/idempotency missing. |
| OPS-02 | First-2h and 24h monitoring cadence with close-booking triggers. [VERIFIED: .planning/REQUIREMENTS.md] | Runbook + manual/ops | New `26-FIRST-24H-WATCH.md` checklist and ledger updates. [VERIFIED: 26-CONTEXT.md] | No; Wave 0/plan gap. |

### Sampling Rate

- **Per task commit:** run relevant Vitest file(s), typecheck for touched package, and ledger validator if gate files changed. [VERIFIED: codebase rg + 26-CONTEXT.md]
- **Per wave merge:** run `pnpm test`, targeted Playwright smoke, and any new Phase 26 scripts in dry-run mode. [VERIFIED: package.json]
- **Phase gate:** full suite green, Gate Ledger valid, k6 gates complete or accepted-risk ledgered, DR/infra/WAF/on-call/Toss/QR rows accounted for before `$gsd-verify-work`. [VERIFIED: 26-CONTEXT.md]

### Wave 0 Gaps (RESOLVED BY PLANS)

- [x] `scripts/phase26/validate-gate-ledger.mjs` - planned in 26-01 Task 2; validates D-01 through D-04 gate semantics. [VERIFIED: 26-CONTEXT.md]
- [x] Admin Gate Ledger/cutover UI - planned in 26-11 and 26-12; covers the UI-SPEC admin cutover readiness surface. [VERIFIED: 26-UI-SPEC.md]
- [x] `scripts/k6/phase26-baseline.js` and `scripts/k6/phase26-stress.js` - planned in 26-06 Task 1; covers LOAD-01 thresholds. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/]
- [x] `apps/web/e2e/phase26-qr-visibility.spec.ts` or equivalent production-like smoke - planned in 26-03 Task 1; covers D-25 through D-27. [VERIFIED: 26-CONTEXT.md]
- [x] API tests for Toss `Idempotency-Key` and `queryPayment(paymentKey)` webhook re-verification - planned in 26-04 Task 1. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] [VERIFIED: codebase rg]
- [x] `scripts/phase26/cleanup-dry-run.sql` and cleanup execution guard - planned in 26-05 Task 1; covers D-13 through D-15. [VERIFIED: 26-CONTEXT.md]
- [x] `26-FIRST-24H-WATCH.md` or equivalent runbook/checklist - planned in 26-09 Task 3; covers D-29 and D-30. [VERIFIED: 26-CONTEXT.md]
- [x] Locale scope decision/test update for four vs five locales - planned in 26-07 Task 1 and 26-01 `M1_LOCALE_SCOPE`; must be reconciled before M1 smoke PASS. [VERIFIED: codebase rg] [VERIFIED: .planning/ROADMAP.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing auth/session smoke and queue admission identity must be verified during 15-minute watch. [VERIFIED: 26-CONTEXT.md] [VERIFIED: codebase rg] |
| V3 Session Management | yes | Refresh/session behavior is rollback trigger if it fails. [VERIFIED: 26-CONTEXT.md] |
| V4 Access Control | yes | Admin bypass is allowed, but normal users must remain blocked when `BOOKING_ENABLED=false`. [VERIFIED: codebase rg] [VERIFIED: 26-CONTEXT.md] |
| V5 Input Validation | yes | Existing API DTO validation uses zod; reservation amount mismatch is server-side rejected. [VERIFIED: package.json] [VERIFIED: codebase rg] |
| V6 Cryptography | yes | QR ticket JWT/HMAC-style secret versioning uses server secrets; do not expose raw QR secrets/tokens in artifacts. [VERIFIED: codebase rg] [VERIFIED: AGENTS.md] |
| V7 Error Handling and Logging | yes | Redis health indicator redacts sensitive values; Toss/payment logs and artifacts must also stay redacted. [VERIFIED: codebase rg] [VERIFIED: AGENTS.md] |
| V8 Data Protection | yes | Production users, sessions, registrations, consents, event data, reservations, payments, tickets, and seats must not be mutated by rehearsal cleanup. [VERIFIED: 26-CONTEXT.md] |
| V10 Malicious Code / Integrity | yes | Deploy must be CI/CD green, and scripts must not embed raw secrets or destructive broad cleanup. [VERIFIED: AGENTS.md] [VERIFIED: 26-CONTEXT.md] |
| V13 API and Web Service | yes | Toss confirm/query/cancel and webhook re-query are API trust boundaries. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |

### Known Threat Patterns for Phase 26 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leakage through docs/logs/frontend bundle | Information Disclosure | Server-only Toss/QR secrets, redacted artifacts, no raw keys in planning files. [VERIFIED: AGENTS.md] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| Webhook spoofing or stale payment state | Spoofing / Tampering | Re-query Toss by `paymentKey` before final local state transition. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] |
| Duplicate payment confirmation retry | Tampering / Repudiation | Use Toss `Idempotency-Key` for POST confirm/cancel and keep local confirm lock. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] [VERIFIED: codebase rg] |
| Oversell under concurrency | Tampering | Keep Valkey Lua locks, DB seat status checks, transaction conflict handling, and sellout monitoring. [VERIFIED: codebase rg] |
| Rehearsal cleanup deleting real production state | Tampering / Denial of Service | Test-event isolation, dry-run counts, backup/restore-point, denylist, and stop-on-unexpected rows. [VERIFIED: 26-CONTEXT.md] |
| WAF false positive blocking real buyers | Denial of Service | Normal pass smoke plus low-volume suspicious smoke; tune rules before live opening. [VERIFIED: 26-CONTEXT.md] [CITED: https://developers.cloudflare.com/waf/rate-limiting-rules/] |

## Risks, Blockers, And Recommended Plan Waves

### Current Blockers / High-Risk Gaps

| Risk / Blocker | Severity | Why It Matters | Recommended Planner Treatment |
|----------------|----------|----------------|-------------------------------|
| QR not visible after admin test-key payment | BLOCKER | D-25 declares this a cutover blocker. [VERIFIED: 26-CONTEXT.md] | First implementation wave should reproduce, fix, and prove complete page + My Page QR visibility. |
| Toss webhook re-query missing | HIGH | Official guardrail says general payment webhooks require re-query by `paymentKey`; current code lacks query client path. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] [VERIFIED: codebase rg] | Add query client/re-query tests or ledger accepted risk before live cutover. |
| Toss POST idempotency missing | HIGH | Official docs support `Idempotency-Key`; confirm/cancel retries around cutover need duplicate-safety evidence. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] [VERIFIED: codebase rg] | Add headers/tests to Toss client or ledger accepted risk. |
| Locale count mismatch | HIGH | ROADMAP says five locales, code supports four active public locales. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: codebase rg] | Wave 0 owner decision; do not mark M1 smoke PASS until reconciled. |
| Live provider evidence unavailable from code | HIGH | Cloudflare, Cloud SQL HA/PITR, Valkey failover, Toss live keys, Sentry alert state require provider access. [VERIFIED: local command] [VERIFIED: 26-CONTEXT.md] | Make evidence-collection tasks explicit and classify missing provider state as `BLOCKED` or accepted risk. |
| Local GCP default project is not Grabit | MEDIUM | Wrong project reads can produce false conclusions. [VERIFIED: local command] [VERIFIED: MEMORY.md] | All commands should pass explicit `--project=grapit-491806` unless re-confirmed. |

### Recommended Plan Decomposition / Waves

1. **Wave 0 - Gate and Safety Foundation:** create Gate Ledger schema/artifact/validator, reconcile locale scope, define dedicated test event IDs/order prefix, add cleanup dry-run guard, and verify no raw secrets in artifacts. [VERIFIED: 26-CONTEXT.md]
2. **Wave 1 - QR and Payment Hardening:** reproduce/fix QR visibility, add complete page + My Page smoke, implement Toss `queryPayment(paymentKey)` webhook re-query, add `Idempotency-Key` for confirm/cancel, and rotate exposed Toss test secret before final evidence. [VERIFIED: 26-CONTEXT.md] [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]
3. **Wave 2 - Ticketing Rehearsal:** run dedicated test-event queue -> lock -> prepare -> test-key confirm -> QR -> cancel/refund -> cleanup with dry-run and backup/restore-point evidence. [VERIFIED: 26-CONTEXT.md]
4. **Wave 3 - Direct Deploy Watch:** adapt Phase 23 canary runbook into direct deploy 100% + 15-minute watch, including Cloud Run logs, health, auth/session, public detail, booking-disabled, queue entry, and payment-safe path. [VERIFIED: 26-CONTEXT.md] [CITED: https://cloud.google.com/run/docs/logging]
5. **Wave 4 - Load Gates:** add/run k6 10k baseline and 20k stress scripts with p95/error-rate thresholds, export summaries, and record Cloud Run/DB/Valkey evidence. [VERIFIED: 26-CONTEXT.md] [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/]
6. **Wave 5 - DR/Infra Evidence:** run Cloud Run rollback drill, Cloud SQL restore/PITR drill to safe target, Valkey reconnect/failure smoke, and pgBouncer/HA/read-replica/pool sizing evidence classification. [VERIFIED: 26-CONTEXT.md] [CITED: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr]
7. **Wave 6 - WAF/On-Call/Monitoring:** prove Cloudflare active rules and app-layer rate limits, Sentry dry-runs, Cloud Run log queries, business metrics, playbooks, and first-24h watch checklist. [VERIFIED: 26-CONTEXT.md] [CITED: https://docs.sentry.io/product/alerts/]
8. **Wave 7 - Live-Key Cutover Gate:** after Toss review/live keys, inject live keys while `BOOKING_ENABLED=false`, run live-key smoke, validate ledger, enable `BOOKING_ENABLED=true`, and execute first-2h/24h watch. [VERIFIED: 26-CONTEXT.md]

## Sources

### Primary (HIGH confidence)

- `.planning/phases/26-m1-canary-cutover-gates/26-CONTEXT.md` - locked decisions D-01 through D-30, discretion, deferred scope, canonical refs. [VERIFIED: local file]
- `.planning/REQUIREMENTS.md` - `M1-01`, `LOAD-01`, `DR-01`, `INFRA-01`, `OPS-01`, `PAY-01`, `OPS-02`. [VERIFIED: local file]
- `.planning/ROADMAP.md` - Phase 26 roadmap/success criteria and older canary wording. [VERIFIED: local file]
- `.planning/STATE.md` - current Phase 26 readiness and accepted-risk conventions. [VERIFIED: local file]
- `docs/v2.0-fanmeet-milestone-spec.md` - source milestone spec and M1/M2/M3 launch context. [VERIFIED: local file]
- `AGENTS.md` - project constraints, response language, env/secrets conventions. [VERIFIED: local file]
- Codebase search/read of listed modules under `apps/api`, `apps/web`, `packages/shared`, `.github/workflows`, `docs/runbooks`, and `scripts`. [VERIFIED: codebase rg]
- npm registry checks for Next, NestJS, Drizzle, pg, pg-boss, ioredis, Toss SDK, Playwright, Sentry, zod, throttler. [VERIFIED: npm registry]
- Toss official quick reference - payment flow, key separation, amount verification, Basic auth, idempotency, webhook query verification, test/live distinction. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference]
- Grafana k6 official docs - thresholds and scenario patterns. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] [CITED: https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/]
- Cloud Run official docs - rollouts/rollback/traffic migration and logs. [CITED: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration] [CITED: https://cloud.google.com/run/docs/logging]
- Cloud SQL official docs - PostgreSQL PITR, HA, and read replica. [CITED: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr] [CITED: https://cloud.google.com/sql/docs/postgres/high-availability] [CITED: https://cloud.google.com/sql/docs/postgres/replication/create-replica]
- Cloudflare official docs - WAF custom rules and rate limiting rules. [CITED: https://developers.cloudflare.com/waf/custom-rules/] [CITED: https://developers.cloudflare.com/waf/rate-limiting-rules/]
- Sentry official docs - alerts. [CITED: https://docs.sentry.io/product/alerts/]

### Secondary (MEDIUM confidence)

- Prior local memory about Grabit production readiness, cleanup, prewarm, and webhook hardening patterns was used only as planning caution and cross-checked against current code where possible. [VERIFIED: MEMORY.md]

### Tertiary (LOW confidence)

- None used as authoritative evidence. [VERIFIED: research log]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - package files and npm registry versions were verified. [VERIFIED: package.json] [VERIFIED: npm registry]
- Architecture: HIGH - exact modules and runbooks were inspected from the codebase. [VERIFIED: codebase rg]
- External/provider gates: MEDIUM - official docs were checked, but live Cloudflare/Toss/Cloud SQL/Sentry state requires operator credentials during execution. [CITED: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference] [CITED: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr] [CITED: https://developers.cloudflare.com/waf/custom-rules/] [CITED: https://docs.sentry.io/product/alerts/] [VERIFIED: local command]
- QR blocker: MEDIUM - code surfaces and tests were inspected, but live/admin test-key reproduction still needs execution. [VERIFIED: codebase rg] [VERIFIED: 26-CONTEXT.md]
- Load/DR feasibility: MEDIUM - k6 and Cloud docs are clear, but production credentials, dedicated test event, and provider quotas/topology must be confirmed. [CITED: https://grafana.com/docs/k6/latest/using-k6/thresholds/] [CITED: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration] [ASSUMED]

**Research date:** 2026-05-20  
**Valid until:** 2026-05-27 for provider/live cutover assumptions; 2026-06-19 for codebase architecture if no major refactor lands. [ASSUMED]
