# Phase 26: M1 Canary + Cutover Gates - Context

**Gathered:** 2026-05-20T03:16:08Z
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 26 prepares the 2026-06 ticketing opening for the already-live SNS/signup production surface. The phase is no longer primarily about opening advertising/signup; it is about proving that ticketing cutover can run without damaging existing production users, registrations, sessions, real event data, payment state, seat inventory, QR issuance, and first-24-hour operations.

This phase covers ticketing cutover rehearsal, k6 load gates, critical DR drills, monitoring/WAF/on-call readiness, Toss test-key rehearsal, Toss live-key cutover after review completion, `BOOKING_ENABLED=true` go/no-go, rollback/close-booking triggers, and QR issuance readiness.

This phase does not implement the full event-day mobile QR scan/use-processing console. Field scan UI and event-day entry operations remain Phase 27 scope, but Phase 26 must verify that issued QR payloads, JWT/HMAC structure, and ticket status contract are sufficient for Phase 27 scanner work.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope And Requirements

- `.planning/ROADMAP.md` - Phase 26 goal, requirements, merged source phases, and older canary success wording that is superseded by D-05.
- `.planning/REQUIREMENTS.md` - `M1-01`, `LOAD-01`, `DR-01`, `INFRA-01`, `OPS-01`, `PAY-01`, and `OPS-02` requirement mapping.
- `.planning/PROJECT.md` - v2.0 fanmeet launch constraints, existing production data protection, cutover policy, and critical incident expectations.
- `.planning/STATE.md` - Current state after Phase 25, accepted-risk conventions, and Phase 26 readiness.
- `docs/v2.0-fanmeet-milestone-spec.md` - Source milestone spec for traffic/load/DR/on-call/payment cutover assumptions and Toss review timeline.

### Prior Phase Decisions And Caveats

- `.planning/phases/23-launch-foundation/23-CONTEXT.md` - `BOOKING_ENABLED=false` API-first hard gate, migration compatibility, locale/legal/auth foundations, and accepted-risk evidence policy.
- `.planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md` - Queue admission, traffic defense, multi-floor booking, payment/refund/QR contract, and Phase 26 deferred cutover gates.
- `.planning/phases/25-admin-operations-console/25-CONTEXT.md` - Admin operations, audit/export/seat operations, and explicit deferral of live booking/payment cutover to Phase 26.
- `.planning/phases/25-admin-operations-console/25-VERIFICATION.md` - Phase 25 verified-with-accepted-risk status; MFA is not PASS evidence.
- `.planning/phases/25-admin-operations-console/25-HUMAN-UAT.md` - Human evidence caveats and Phase 26/27 boundary confirmation.

### Runbooks And External Activation

- `docs/runbooks/phase23-canary-rollback.md` - Existing smoke categories and rollback expectations, adapted in Phase 26 to direct-deploy strict watch rather than traffic-split canary.
- `docs/runbooks/phase24-queue-waf-prewarm.md` - Cloudflare WAF/rate-limit, app-layer traffic defense, and prewarm endpoint contracts.
- `docs/runbooks/phase24-external-activation-checklist.md` - Cloudflare/Toss sandbox/webhook activation evidence and Toss webhook query-verification follow-up.
- `https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference` - Toss official payment flow, server-side amount verification, key separation, idempotency, webhook query verification, and test/live environment distinctions.

### Existing Code And Infrastructure Contracts

- `packages/shared/src/flags.ts` - Shared `BOOKING_ENABLED` flag parsing.
- `apps/api/src/modules/feature-flags/feature-flags.service.ts` - API-side booking hard gate and admin bypass behavior.
- `apps/web/lib/runtime-flags.ts` - Web runtime flag fetch and localized booking-disabled copy.
- `apps/api/src/modules/queue/queue.service.ts` - Queue session/admission, active window, re-entry grace, and performance booking-open checks.
- `apps/api/src/modules/queue/guards/admission.guard.ts` - Admission guard for booking mutation paths and admin bypass behavior.
- `apps/api/src/modules/traffic/traffic-defense.service.ts` - Named throttler policies and macro decision model.
- `apps/api/src/modules/ops/prewarm.service.ts` - Protected Cloud Scheduler/Cloud Run prewarm control path.
- `apps/api/src/health/health.controller.ts` - Health endpoint used in deploy/rollback checks.
- `apps/api/src/health/redis.health.indicator.ts` - Valkey/Redis health indicator and redaction behavior.
- `apps/api/src/modules/booking/booking.service.ts` - Seat lock, `BOOKING_ENABLED` assertion, seat inventory protection, and Valkey lock behavior.
- `apps/api/src/modules/reservation/reservation.service.ts` - Reservation prepare/confirm, Toss confirm flow, QR issuance linkage, and booking side effects.
- `apps/api/src/modules/payment/toss-payments.client.ts` - Toss confirm/cancel/query client and server-side secret usage.
- `apps/api/src/modules/payment/payment-webhook.controller.ts` - Toss webhook ingress path.
- `apps/api/src/modules/payment/toss-webhook.guard.ts` - Current webhook guard behavior.
- `apps/web/components/booking/toss-payment-widget.tsx` - Toss widget initialization and payment request surface.
- `apps/web/app/booking/[performanceId]/complete/page.tsx` - Payment completion page that must show QR after confirmed payment.
- `apps/web/components/booking/booking-complete.tsx` - User-facing complete/QR surface to verify or fix.
- `apps/web/components/reservation/reservation-detail.tsx` - My Page reservation/ticket detail QR visibility surface.
- `.github/workflows/deploy.yml` - Current Cloud Run deploy flags, service settings, env/secrets injection, and Toss key deployment path.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `FeatureFlagsService` and `packages/shared/src/flags.ts` already provide the shared `BOOKING_ENABLED` hard gate. Phase 26 should test and preserve it rather than inventing another flag system.
- `QueueService` already models queue sessions, admission tokens, active windows, re-entry grace, and active admission sets. k6 and rehearsal should exercise this path.
- `TrafficDefenseService` already defines named throttlers for queue entry, lock seat, prepare reservation, confirm payment, and signup. WAF smoke should complement this app-layer guard.
- `PrewarmService` already exposes protected Cloud Run min-instance control using Google OIDC plus `x-prewarm-control-token`; Phase 26 can verify this contract instead of rebuilding prewarm.
- `HealthController` plus `RedisHealthIndicator` provide live readiness signals for Cloud Run/Valkey watch.
- Existing booking/reservation/payment/refund/QR modules provide the rehearsal path: lock -> prepare -> confirm -> QR -> cancel/refund.
- Existing admin audit/export/seat operation surfaces from Phase 25 can support evidence capture and cleanup review where appropriate.

### Established Patterns

- `BOOKING_ENABLED=false` must block backend mutation paths before Redis, DB, and Toss side effects, not just disable UI.
- Accepted risk is not PASS evidence. Gate Ledger entries must preserve `ACCEPTED_RISK` and `CONFIG_READY_NOT_DRILLED` separately from `PASS`.
- Sensitive data must not be copied into planning artifacts: no raw Toss keys, raw payment keys, OTPs, cookies, tokens, PII rows, or full CSV payloads.
- Existing production users, sessions, registrations, consents, and real event data must be preserved through expand-only/data-safe operations.
- Current active public locale code appears to use `ko`, `en`, `th`, and `zh-CN`; older docs still mention `zh-TW`. Phase 26 smoke should verify the current active locale surface rather than silently reintroducing stale locale scope.

### Integration Points

- k6 scripts and smoke commands should target a Dedicated Test Event and test order prefix.
- Cleanup needs API/SQL guardrails around test event identifiers and dry-run counts.
- Toss test-key rehearsal should run before review completion; live-key smoke must run after review completion.
- First-24h monitoring likely needs saved Cloud Run log queries, Sentry filters, Cloudflare analytics checks, and SQL/API business metric checks.
- QR blocker investigation should start from complete page, My Page detail, reservation/payment/ticket persistence, and QR secret configuration.

</code_context>

<specifics>
## Specific Ideas

- The user has already opened SNS/signup in production; Phase 26 should focus on 2026-06 ticketing opening rather than redoing broad advertising-open validation.
- The user emphasized that production now contains real signup data and it must never be damaged.
- The user reported that admin test-key payment currently completes without visible QR. Treat this as a cutover blocker, not a cosmetic issue.
- Toss review is not complete yet. Test-key rehearsal should proceed now, but live ticketing cannot be treated as proven until live review/key smoke passes later.

</specifics>

<deferred>
## Deferred Ideas

- Full field-staff mobile QR scan/use-processing UI is deferred to Phase 27.
- Event-day entry monitor, offline fallback sync, settlement export, and post-event retrospective remain Phase 27 scope.
- Full Cloud Run traffic-split canary is intentionally omitted by owner decision and should not be reconstructed unless the user reopens that decision.

</deferred>

---

*Phase: 26-M1 Canary + Cutover Gates*
*Context gathered: 2026-05-20T03:16:08Z*
