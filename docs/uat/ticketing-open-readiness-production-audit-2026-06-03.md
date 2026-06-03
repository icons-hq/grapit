# Ticketing Open Production Readiness Audit - 2026-06-03

Generated: 2026-06-03 16:04:34 KST

Source document reviewed: `docs/uat/ticketing-open-readiness-uat-2026-05-29.md`

Scope: current repo truth, deployed production commit, production Cloud Run shape,
GitHub CI/CD state, GCP infrastructure metadata, production runtime probes, and
environment variable/secret wiring. Secret values were not intentionally read or
printed. Secret names, env var names, enabled state, and public/non-secret values
are recorded.

## Verdict

Public ticketing open remains **NO-GO**.

This is not because the latest production deploy is unhealthy. The current
production deploy is alive and matches `origin/main`. The blocking issue is that
production is still intentionally closed and the remaining launch evidence gates
are not accepted.

Primary current blockers:

- Live runtime flag returns `bookingEnabled:false`.
- The packaged Phase 26 Gate Ledger still has 16 blocking required gates.
- Production does not include the remediation branch that adds public support
  pages, hides sale badges under the booking gate, hardens public publish
  filtering, and fixes local QR rehearsal origin handling.
- Real Toss gateway happy path, real SMS OTP happy path, load/stress, WAF,
  on-call, first-24h watch, Cloud Run rollback, Cloud SQL PITR drill, Valkey
  reconnect drill, and cleanup isolation evidence are still not accepted.
- Several infra settings are acceptable for a small MVP only with explicit risk
  acceptance, not as objective public-sale readiness: Cloud SQL is ZONAL,
  deletion protection is off, Cloud SQL SSL is not required, Artifact Registry
  vulnerability scanning is disabled, and prewarm Scheduler jobs are paused.

## Owner Decision Overlay

After this audit, the owner chose the following launch interpretation for the
remaining work:

Decision record: `docs/adr/0005-use-admin-pre-open-booking-smoke-on-real-performance.md`.
Evidence template: `docs/runbooks/ticketing-open-evidence-gates-2026-06-03.md`.
Evidence artifact: `docs/uat/ticketing-open-admin-preopen-smoke-2026-06-03.md`.

- Evidence-only blockers may be approved as explicit **Evidence Waivers**, not
  as `PASS`.
- Code-remediable production gaps are not Evidence Waiver targets. They must be
  merged, deployed, and smoke-tested before public buyer booking opens.
- The remediation branch is an implementation candidate, not the launch gate
  itself. Equivalent scoped fixes are acceptable if production smoke proves the
  same buyer-visible gaps are closed.
- The audit does not rewrite the packaged Gate Ledger or claim unrun drills were
  objectively verified.
- Once the required Evidence Waivers are recorded and the code-remediable gaps
  are deployed, `BOOKING_ENABLED=true` is the Sitewide Booking Gate.
- `BOOKING_ENABLED=true` does not open every Performance by itself.
- A real Buyer can book a specific Performance only when that Performance is
  publicly published, the Sitewide Booking Gate is open, and the Performance
  Sale Status is `selling` (`오픈` in the admin performance form).
- The pre-open public posture for the target Performance is published but
  `upcoming` (`오픈예정`), not hidden draft. This lets Buyers inspect the
  Performance while booking remains closed.
- The controlled real payment smoke should use the existing Girl Rules
  Performance, not a separate test Performance.
- Before public sale, ordinary Buyers must still be blocked from booking and
  payment while an authorized admin account uses the Admin Booking Bypass for
  pre-open booking/payment smoke on the Girl Rules Performance.
- Admin Pre-Open Booking Smoke must cover the full Production Payment Matrix
  visible to Buyers for the Girl Rules Performance, not only domestic card.
  Each method/provider path needs its own redacted payment, reservation, ticket,
  QR, and cleanup evidence.
- Evidence should be captured as Markdown rows with links to redacted
  screenshots, logs, provider artifacts, and admin artifacts. Screenshots alone
  are not accepted as the full evidence chain.
- The Production Payment Matrix is determined from the buyer-visible production
  checkout UI and provider widget. API `allowedPaymentMethods` and provider admin
  settings are cross-check evidence, not the primary source.
- Run payment-method smoke sequentially. Each method/provider path gets its own
  order, seat, evidence bundle, and Smoke Booking Cleanup before the next path
  starts.
- Use one operator-selected low-risk seat per method/provider path. The same
  seat may be reused only after Smoke Booking Cleanup verifies it is sellable
  again.
- Keep the test seat traceable internally, but avoid exposing full seat/order
  identifiers in public docs or screenshots.
- Before the first admin payment path and after the final cleanup, prove that an
  ordinary Buyer session is still blocked while the Girl Rules Performance
  remains `오픈예정`. Capture both buyer-facing UI copy/CTA state and a blocked
  booking mutation result. Prefer the earliest safe mutation, such as seat lock,
  so the proof does not create a payment request.
- If any method/provider path fails or cleanup cannot restore inventory, stop
  the matrix immediately and keep public sale blocked until the cause is
  understood and fixed or explicitly waived.
- The admin smoke must not leave a paid test reservation in the real Performance.
  After payment/QR evidence is captured, immediately cancel/refund the test
  reservation and verify the seat is restored to sellable inventory. If normal
  cancellation/refund does not restore the seat, use the admin controlled reopen
  path, record the reason, and preserve audit evidence.
- Therefore, after Launch Evidence Approval and Sitewide Booking Gate enablement,
  a Performance remains blocked while its admin open status is `오픈예정`; it
  becomes buyer-bookable when an operator changes that Performance to `오픈`.
- Post-open smoke must include one controlled real payment path through public
  detail, seat selection, reservation prepare, Toss approval/confirm,
  reservation/ticket/QR visibility, and support visibility. Because this changes
  external provider state, run it only with an approved account, amount, payment
  method, and refund or settlement handling plan.

## Audit Caveat

One production `POST /api/v1/sms/send-code` probe was accidentally executed
during this audit against a masked KR E.164 test-shaped phone value. The response
was `200 success`. This is **not** accepted SMS evidence because it was not run
under an approved controlled-number provider runbook. Do not repeat real SMS
provider actions without an approved window and explicit target.

## Truth Sources

Current source state:

- `git status --short --branch`: `## main...origin/main`
- `HEAD`: `16ac387c896a5efa9d6ef868ca7d40735537ddbf`
- `origin/main`: `16ac387c896a5efa9d6ef868ca7d40735537ddbf`
- `origin/ps/ticketing-open-readiness-remediation`:
  `63788e1ae9dc5d0db6655e8d3b39bbd6f4acae78`
- The reviewed UAT source document was untracked at audit start.

Production deploy state:

- Latest Deploy workflow: success,
  `https://github.com/sangwopark19/grapit/actions/runs/26855517146`
- Deploy head SHA:
  `16ac387c896a5efa9d6ef868ca7d40735537ddbf`
- Deploy jobs all succeeded: `migrate-production`, `build-api-image`,
  `build-web-image`, `deploy-api`, `deploy-web`.
- PR #109 CI check succeeded and merged into `main`.

Deployed Cloud Run commit parity:

| Service | Ready revision | Traffic | Image tag |
| --- | --- | --- | --- |
| `grabit-api` | `grabit-api-00162-7tk` | 100% | `16ac387c896a5efa9d6ef868ca7d40735537ddbf` |
| `grabit-web` | `grabit-web-00115-qsq` | 100% | `16ac387c896a5efa9d6ef868ca7d40735537ddbf` |

Artifact Registry digest mapping exists for both deployed image tags:

- API tag digest: `sha256:595b5383e9d4cdec3cde5d40ec89e48df96bf7f61cddf5b29c7f5c046b29dd1f`
- Web tag digest: `sha256:aa3e130f85938a979e530ffc0cae04f2ed6ecec8b5991440389f6eebdaab3821`

## Production Runtime Probes

| Probe | Result | Readiness meaning |
| --- | --- | --- |
| `GET https://heygrabit.com/api/runtime-flags` | `200`, `bookingEnabled:false` | Booking is intentionally closed. |
| `GET https://api.heygrabit.com/api/v1/health` | `200`, Redis `mode:cluster`, `client:ioredis-cluster`, `configured:true`, `status:up` | Production API is healthy and using real cluster Redis/Valkey wiring. |
| `GET https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/health` | `200`, same Redis evidence | API Cloud Run origin is healthy. |
| `GET https://heygrabit.com/support` | `404` | Public support page is not deployed on `main`. |
| `GET https://heygrabit.com/en/support` | `404` | English support page is not deployed on `main`. |
| `GET https://api.heygrabit.com/api/v1/support-content?locale=ko` | `404` | Public support content API is not deployed on `main`. |
| `GET https://api.heygrabit.com/api/v1/admin/cutover/gates` without auth | `401` | Admin cutover API is protected as expected; live authenticated smoke was not performed. |
| `GET https://api.heygrabit.com/api/v1/performances?...` | `200`, one public `upcoming` performance | Public catalog read path is alive. |
| `GET https://api.heygrabit.com/api/v1/performances/:id` | `200`, one showtime, four price tiers, two seat maps | Performance detail read path is alive. |

Production public performance detail currently exposes allowed payment methods
including `FOREIGN_EASY_PAY`, but booking remains blocked by
`bookingEnabled:false` and performance status `upcoming`.

## Gate Ledger State

Production API image packages:

- `CUTOVER_GATE_LEDGER_PATH=/app/phase26/26-GATE-LEDGER.json`
- API Dockerfile copies
  `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json` into that
  runtime path.

Current source ledger summary:

- Generated: `2026-05-21T03:27:30.198Z`
- Required gates: 19
- Rows present: 19
- State counts: `PASS=2`, `BLOCKED=13`, `ACCEPTED_RISK=1`,
  `CONFIG_READY_NOT_DRILLED=3`
- Blocking required gates: 16
- First blocking gate in source order: `M1_LOCALE_SCOPE`

Blocking gate IDs:

- `M1_LOCALE_SCOPE`
- `ADMIN_CUTOVER_UI`
- `TOSS_TEST_REHEARSAL`
- `TOSS_LIVE_KEY_SMOKE`
- `BOOKING_ENABLED_GO_NO_GO`
- `LOAD_10K_BASELINE`
- `LOAD_20K_STRESS`
- `DR_CLOUD_RUN_ROLLBACK`
- `DR_CLOUD_SQL_PITR`
- `DR_VALKEY_RECONNECT`
- `INFRA_POOL_PGBOUNCER`
- `INFRA_HA_REPLICA`
- `WAF_ACTIVE_RULES`
- `ONCALL_PLAYBOOKS`
- `FIRST_24H_WATCH`
- `CLEANUP_ISOLATION`

Conclusion: even if `BOOKING_ENABLED` were set to true, current Gate Ledger
state does not objectively support public open.

## Production Environment And Infrastructure Inventory

### GitHub Actions Variables

These are non-secret repo variables used by `.github/workflows/deploy.yml`:

| Name | Current value class |
| --- | --- |
| `CLOUD_RUN_API_URL` | `https://api.heygrabit.com` |
| `CLOUD_RUN_WEB_URL` | `https://heygrabit.com` |
| `NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY` | `DEFAULT,paypal,alipay` |
| `PAYPAL_CHECKOUT_ENABLED` | `true` |
| `PAYPAL_KRW_USD_RATE` | `0.00068` |
| `ALIPAY_CHECKOUT_ENABLED` | `true` |

### GitHub Actions Secrets

Only secret names were listed:

- `CLOUD_SQL_CONNECTION_NAME`
- `DATABASE_URL`
- `GCP_PROJECT_ID`
- `GCP_SERVICE_ACCOUNT`
- `GCP_WIF_PROVIDER`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_TOSS_CLIENT_KEY`
- `NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY`
- `R2_PUBLIC_HOSTNAME`
- `TEST_USER_EMAIL`
- `TEST_USER_PASSWORD`
- `TOSS_CLIENT_KEY_TEST`
- `TOSS_SECRET_KEY_TEST`

The deploy workflow references
`NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY`, but `gh secret list` did not show a
secret with that exact name during this audit. The web build still succeeded, so
this is either intentionally unset or no longer required for the current
production path. Treat overseas-card live smoke as not proven until verified in
the provider runbook.

### Cloud Run: `grabit-api`

| Field | Current state |
| --- | --- |
| Region | `asia-northeast3` |
| Service account | `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com` |
| Ingress | all |
| Invoker | `allUsers` |
| Port | `8080` |
| CPU / memory | `1` / `512Mi` |
| Concurrency | `80` |
| Timeout | `3600s` |
| Min / max instances | `0` / `100` |
| CPU throttling | false |
| Session affinity | true |
| Cloud SQL attachment | `grapit-db` |
| VPC | `default/default`, private ranges only |

Literal API env vars:

- `NODE_ENV=production`
- `VALKEY_MODE=cluster`
- `FRONTEND_URL=https://heygrabit.com`
- `KAKAO_CALLBACK_URL=https://api.heygrabit.com/api/v1/auth/social/kakao/callback`
- `NAVER_CALLBACK_URL=https://api.heygrabit.com/api/v1/auth/social/naver/callback`
- `GOOGLE_CALLBACK_URL=https://api.heygrabit.com/api/v1/auth/social/google/callback`
- `PREWARM_ALLOWED_SERVICE_NAME=grabit-api`
- `PREWARM_MAX_MIN_INSTANCES=100`
- `DB_POOL_MAX=3`
- `DB_POOL_IDLE_TIMEOUT_MS=30000`
- `DB_POOL_CONNECTION_TIMEOUT_MS=5000`
- `R2_UPLOAD_CACHE_CONTROL_ENABLED=true`
- `CUTOVER_GATE_LEDGER_PATH=/app/phase26/26-GATE-LEDGER.json`
- `PAYPAL_CHECKOUT_ENABLED=true`
- `PAYPAL_KRW_USD_RATE=0.00068`
- `ALIPAY_CHECKOUT_ENABLED=true`

API env vars sourced from Secret Manager:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `KAKAO_CLIENT_ID`
- `KAKAO_CLIENT_SECRET`
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `REDIS_URL`
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `INFOBIP_API_KEY`
- `INFOBIP_BASE_URL`
- `INFOBIP_SENDER`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_VERIFY_SERVICE_SID`
- `SENTRY_DSN`
- `TOSS_SECRET_KEY`
- `TOSS_OVERSEAS_CARD_SECRET_KEY`
- `TOSS_FOREIGN_EASY_PAY_SECRET_KEY`
- `TOSS_WEBHOOK_SECRET`
- `QR_TICKET_SECRET`
- `QR_TICKET_SECRET_VERSION`
- `QR_TICKET_SECRET_KEYRING_JSON`
- `PREWARM_CONTROL_TOKEN`
- `PREWARM_PROJECT_ID`
- `PREWARM_REGION`
- `PREWARM_ALLOWED_SCHEDULER_EMAIL`
- `PREWARM_ALLOWED_AUDIENCE`

### Cloud Run: `grabit-web`

| Field | Current state |
| --- | --- |
| Region | `asia-northeast3` |
| Service account | `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com` |
| Ingress | all |
| Invoker | `allUsers` |
| Port | `3000` |
| CPU / memory | `1` / `512Mi` |
| Concurrency | `80` |
| Timeout | `300s` |
| Min / max instances | `0` / `10` |

Web runtime env vars:

- `NODE_ENV=production`
- `SENTRY_DSN` from `sentry-dsn-web:latest`

Important: web public config is injected at image build time, not Cloud Run
runtime env. `.github/workflows/deploy.yml` passes these build args:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_R2_HOSTNAME`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_TOSS_CLIENT_KEY`
- `NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY`
- `NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY`
- `NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY`

Production bundle scan:

- `https://api.heygrabit.com` string found.
- `FOREIGN_EASY_PAY` code path string found.
- No raw server-secret key pattern was found.
- Toss client key/variant literal was not directly found in the scanned route
  chunks, so provider-widget proof still depends on a controlled payment smoke,
  not bundle string search.

### Secret Manager

All 38 Cloud Run-referenced Secret Manager resources checked during this audit
had an enabled latest version. Values were not read.

Checked secret resources:

- `database-url`
- `jwt-secret`
- `jwt-refresh-secret`
- `kakao-client-id`
- `kakao-client-secret`
- `naver-client-id`
- `naver-client-secret`
- `google-client-id`
- `google-client-secret`
- `redis-url`
- `r2-account-id`
- `r2-bucket-name`
- `r2-public-url`
- `r2-access-key-id`
- `r2-secret-access-key`
- `resend-api-key`
- `resend-from-email`
- `infobip-api-key`
- `infobip-base-url`
- `infobip-sender`
- `twilio-account-sid`
- `twilio-api-key-sid`
- `twilio-api-key-secret`
- `twilio-verify-service-sid`
- `sentry-dsn`
- `sentry-dsn-web`
- `toss-secret-key`
- `toss-overseas-card-secret-key`
- `toss-foreign-easy-pay-secret-key`
- `toss-webhook-secret`
- `qr-ticket-secret`
- `qr-ticket-secret-version`
- `qr-ticket-secret-keyring-json`
- `prewarm-control-token`
- `prewarm-project-id`
- `prewarm-region`
- `prewarm-allowed-scheduler-email`
- `prewarm-allowed-audience`

### Cloud SQL

| Field | Current state |
| --- | --- |
| Instance | `grapit-db` |
| Version | PostgreSQL 16 |
| Region | `asia-northeast3` |
| State | `RUNNABLE` |
| Tier | `db-custom-4-15360` |
| Availability | `ZONAL` |
| Storage | SSD, 10GB, auto-resize on |
| Backup | enabled |
| PITR | enabled |
| Transaction log retention | 7 days |
| Retained backups | 7 |
| Deletion protection | false |
| IPv4 | enabled |
| SSL requirement | not required / allow unencrypted and encrypted |

Readiness implication:

- Backup/PITR is configured, but the restore drill remains blocked in Gate
  Ledger.
- ZONAL availability and disabled deletion protection require explicit launch
  risk acceptance or remediation.
- SSL-not-required is acceptable only if all production app connectivity is
  through approved Cloud SQL connector/private path and this is documented as an
  accepted infrastructure posture.

### Redis / Valkey

Production app health proves the API is connected to a cluster-mode Redis/Valkey
client:

- `mode: cluster`
- `client: ioredis-cluster`
- `configured: true`
- `status: up`

GCP Memorystore Redis API is disabled for project `grapit-491806`, so this audit
could not inventory a GCP Memorystore Redis instance. Because `REDIS_URL` is a
secret and values were not read, the actual provider/endpoint must be verified
through the approved Valkey/Redis runbook.

Readiness implication:

- The old local-only blocker "`in-memory` Redis" is not true for production
  health.
- Production/cluster rehearsal is still not accepted: queue, seat lock,
  ranking/cache, throttling, and Socket.IO pub/sub behavior still need approved
  evidence under load/failure scenarios.

### Cloud Scheduler / Prewarm

Two production Scheduler jobs exist in `asia-northeast3`:

| Job | State | Schedule | Target |
| --- | --- | --- | --- |
| `grabit-prewarm-scale-up` | `PAUSED` | `25 09 * * *` KST | API prewarm scale-up |
| `grabit-prewarm-step-down` | `PAUSED` | `10 11 * * *` KST | API prewarm step-down |

Both use OIDC with `scheduler-prewarm@grapit-491806.iam.gserviceaccount.com`.
Both job metadata also contains a literal `x-prewarm-control-token` header.
Raw Scheduler job describe output must therefore be treated as sensitive. The
token value is intentionally omitted here.

Readiness implication:

- First-sale prewarm automation is not active while the jobs are paused.
- If these jobs are needed for launch, unpause only in an approved window.
- Consider rotating the prewarm token after any broad job metadata exposure and
  moving toward an OIDC-only authorization posture if feasible.

### Artifact Registry

Repository: `asia-northeast3-docker.pkg.dev/grapit-491806/grabit`

Observed state:

- Docker repository exists.
- Current API/Web image tags for `16ac387c...` exist.
- Vulnerability scanning is disabled because `containerscanning.googleapis.com`
  is not enabled.

Readiness implication:

- Deploy traceability is good.
- Container vulnerability scanning is an unresolved infrastructure hygiene gap.

### IAM

Relevant service accounts:

- `github-actions-deployer@grapit-491806.iam.gserviceaccount.com`
- `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com`
- `scheduler-prewarm@grapit-491806.iam.gserviceaccount.com`

Project-level roles observed:

- deployer: Artifact Registry writer, Cloud SQL client, Run admin, service
  account user
- runtime: Artifact Registry reader, Cloud SQL client, Secret Manager secret
  accessor

Cloud Run service IAM:

- `grabit-api`: `allUsers` has `roles/run.invoker`
- `grabit-web`: `allUsers` has `roles/run.invoker`
- `grabit-api`: runtime service account also has service-level `roles/run.admin`

Readiness implication:

- Public invoker is expected for public web/API services.
- Runtime service account having Run admin on the API service appears related
  to prewarm min-instance control, but it should be reviewed as an explicit
  least-privilege exception.

### Cloudflare / DNS / R2

HTTP/DNS evidence:

- `https://heygrabit.com` response includes `server: cloudflare`.
- Response also includes `via: 1.1 google`, consistent with Cloudflare in front
  of Google Cloud Run.
- DNS resolves to Cloudflare addresses.
- R2 is wired through API Secret Manager refs and web build arg
  `NEXT_PUBLIC_R2_HOSTNAME`.

Not verified:

- Cloudflare WAF rule state
- Cloudflare zone configuration
- R2 bucket admin state
- R2 object-level read/write smoke

Readiness implication:

- CDN/proxy presence is confirmed.
- WAF readiness remains blocked because rule configuration and launch-mode smoke
  were not verified.

## Current Codebase Findings

### Booking Gate

`packages/shared/src/flags.ts` defaults `BOOKING_ENABLED` to false. The web
runtime route `apps/web/app/api/runtime-flags/route.ts` reads this env from the
web runtime. Current `grabit-web` Cloud Run runtime env does not include
`BOOKING_ENABLED`, and live `runtime-flags` returns false.

This is correct for a closed launch state. It is still a No-Go for public sale.

### Support Surface

Current `origin/main` has:

- admin support content management route: `/admin/support-content`
- protected API controller: `@Controller('admin/support-content')`
- support tables in the database schema

Current `origin/main` does not have:

- `apps/web/app/support/page.tsx`
- public `GET /api/v1/support-content`
- live `/support` or `/en/support`

Production evidence confirms both public support pages return `404`.

### Public Performance Exposure

On `origin/main`, public performance reads do not consistently filter
`performances.publishState = 'published'`:

- `PerformanceService.findByGenre`
- `PerformanceService.findById`
- `getHotPerformances`
- `getNewPerformances`
- `SearchService.search`

On `origin/main`, `StatusBadge` renders status labels directly from
`performance.status`. `PerformanceCard` and performance detail do not pass
`bookingEnabled` into a display-status resolver. Therefore sale-facing labels
such as `오픈` / `On sale` can appear independently of the runtime booking gate.

This is a production code gap unless the remediation branch is merged and
deployed.

### Payment

Production env and code now support foreign payment paths:

- `PAYPAL_CHECKOUT_ENABLED=true`
- `ALIPAY_CHECKOUT_ENABLED=true`
- `PAYPAL_KRW_USD_RATE=0.00068`
- `TOSS_SECRET_KEY`, `TOSS_OVERSEAS_CARD_SECRET_KEY`,
  `TOSS_FOREIGN_EASY_PAY_SECRET_KEY`, and `TOSS_WEBHOOK_SECRET` are present as
  enabled Secret Manager refs.
- `ProviderChargeQuoteService` requires the flags/rate/secret shape for
  provider-charge quote paths.
- `PaymentService` and `TossPaymentsClient` have scoped secret handling for
  foreign easy pay.

Still not proven:

- Toss sandbox happy path under approved runbook
- Toss live-key smoke
- Real buyer payment request -> provider approval -> API confirm -> webhook or
  finalization -> reservation/ticket/QR consistency
- Provider admin widget/payment UI settings

Conclusion: payment wiring is materially better than the original UAT, but
payment readiness remains evidence-blocked.

### SMS

Production SMS service is wired for Twilio Verify:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_VERIFY_SERVICE_SID`

The service hard-fails in production if required credentials are missing.
Because production booted and health is green, required runtime shape exists.

Still not proven:

- approved controlled-number send
- controlled device receipt
- verify-code happy path
- provider dashboard evidence
- redacted app/provider logs

The accidental send-code probe in this audit must not be counted as evidence.

### QR And Field Entry

Current production code renders QR values only when the QR URL is HTTPS and
builds field check-in URLs through `buildFieldCheckInUrl`.

Current `origin/main` still falls back to `https://heygrabit.com` for non-HTTPS
local origins in `apps/web/components/field/qr-ticket-image.tsx`. That is
reasonable for production but risky for local phone-camera rehearsal because a
local browser can generate a production-origin QR.

The remediation branch adds a safer local rehearsal origin configuration. It is
not deployed.

### Local Parity

Current `docker-compose.yml` on `origin/main` starts Postgres only. It does not
provide a local Redis/Valkey service. Local development without `REDIS_URL`
therefore still falls back to in-memory Redis for parts of the stack.

Production is cluster-mode, but local open-readiness rehearsal still needs a
real Valkey/Redis option or an approved production-like rehearsal target.

## Remediation Branch Delta

The branch `origin/ps/ticketing-open-readiness-remediation` is ahead of
`origin/main` by 10 commits and 56 changed files. It is not deployed.

Key branch changes:

- public support page and public support content read API
- support/i18n launch surfaces
- public performance publish filtering
- sale badge display guarded by runtime booking gate
- local QR rehearsal origin override and tests
- local Valkey compose option
- E.164-safe fixture cleanup
- evidence-gate runbook for remaining live/provider/ops blockers

Important files added on the branch:

- `apps/web/app/support/page.tsx`
- `apps/web/hooks/use-support-content.ts`
- `apps/api/src/modules/admin/public-support-content.controller.ts`
- `docs/runbooks/ticketing-open-evidence-gates-2026-06-03.md`
- `docs/uat/ticketing-open-readiness-remediation-2026-06-03.md`

Conclusion: several code-remediable UAT blockers already have an implementation
path, but the public production site has not received it.

## Original UAT Findings Reclassified

| 2026-05-29 finding | 2026-06-03 production status | Current classification |
| --- | --- | --- |
| Local runtime flag `bookingEnabled:false` | Live runtime flag is also false | Still No-Go; intentional closed state |
| Local Redis in-memory | Production health is cluster ioredis and up | Production health resolved; local/cluster rehearsal still required |
| Cutover gates unresolved | Ledger still has 16 blocking gates | Still No-Go |
| Real Toss happy path not proven | Env/secret wiring improved, real path not proven | Still blocked |
| Real SMS happy path not proven | Twilio env exists, approved happy path not proven | Still blocked |
| `/support` and `/en/support` 404 | Still 404 in production | Still production gap |
| i18n/support launch gaps | Remediation branch exists, not deployed | Still production gap |
| Sale-facing copy under closed gate | Main code still allows badge/status drift | Still production gap |
| QR local rehearsal points production | Main code still falls back to production for local HTTP | Still local rehearsal gap |
| Load/DR/WAF/on-call/first-24h/cleanup evidence missing | Still blocked in ledger | Still No-Go |

## Go / No-Go Decision

Current objective decision by audit evidence: **NO-GO for public ticketing
open**.

Owner decision overlay: once all remaining evidence-only gates are recorded as
explicit Evidence Waivers, and once the code-remediable production gaps are
merged and deployed, final buyer availability should be controlled by the
Sitewide Booking Gate plus each Performance's Publication and Sale Status.

Minimum path to a defensible Go:

1. Merge and deploy the code-remediation branch or equivalent scoped fixes. Do
   not waive these code-remediable gaps, and do not treat a branch name as the
   readiness proof.
2. Re-check production `/support`, `/en/support`, public support-content API,
   runtime-gated sale labels, public publish filtering, and QR rehearsal config.
3. Record every evidence-only blocker as either accepted evidence or an explicit
   Evidence Waiver with owner, timestamp, monitoring, and rollback/close trigger.
4. Review infra risk posture as accepted risk or remediate it: Cloud SQL ZONAL,
   deletion protection, SSL mode, Artifact scanning disabled, paused prewarm
   jobs, runtime SA Run admin exception, and Scheduler literal control header
   exposure.
5. Only then enable `BOOKING_ENABLED=true` in an approved window.
6. Keep the target Performance published but `오픈예정` until the intended public
   sale moment, rather than hiding it as draft.
7. Before the sale moment, capture ordinary Buyer block evidence for the Girl
   Rules Performance while it is still `오픈예정`: public UI copy/CTA state plus
   a blocked non-admin seat-lock or equivalent earliest-safe booking mutation
   result. Do not use a mutation that can create a payment request for this
   blocked proof.
8. Run Admin Pre-Open Booking Smoke on the existing Girl
   Rules Performance with the authorized admin account while ordinary Buyers
   remain blocked. Cover every method/provider path in the Production Payment
   Matrix that Buyers will see at launch, one path at a time.
9. Use an operator-selected low-risk test seat for each payment path. Reuse the
   same seat only after the previous cleanup proves the seat is sellable again.
10. Complete Smoke Booking Cleanup immediately after the admin payment smoke:
   cancel/refund the test reservation and verify the seat returns to sellable
   inventory. If the seat does not return automatically, run the admin
   controlled reopen path with an explicit reason and capture audit evidence.
   Do not start the next payment path until cleanup is complete.
11. After the final Smoke Booking Cleanup, capture ordinary Buyer block evidence
    again to prove admin bypass did not open public booking early.
12. At the sale moment, change the target Performance Sale Status to `오픈`.
13. Capture post-open smoke through at least one controlled real payment:
   public detail, queue/seat selection, reservation prepare, Toss
   approval/confirm, reservation/ticket/QR visibility, support visibility, and
   rollback/close readiness.

## Commands Used

Representative read-only commands and probes:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/ps/ticketing-open-readiness-remediation
gh pr view 109 --json number,title,state,mergeCommit,statusCheckRollup,url
gh run list --workflow=Deploy --branch main --limit 8 --json databaseId,status,conclusion,headSha,url
gh run view 26855517146 --json conclusion,status,headSha,url,jobs
gcloud run services describe grabit-api --project=grapit-491806 --region=asia-northeast3 --format=json
gcloud run services describe grabit-web --project=grapit-491806 --region=asia-northeast3 --format=json
gcloud sql instances describe grapit-db --project=grapit-491806 --format=json
gcloud secrets versions describe latest --secret=<redacted-name> --project=grapit-491806 --format=json
gcloud scheduler jobs list --project=grapit-491806 --location=asia-northeast3 --format=json
curl -sSI https://heygrabit.com
```

One non-read-only SMS probe was accidentally executed and is documented in
`Audit Caveat`; it should not be repeated or treated as launch evidence.
