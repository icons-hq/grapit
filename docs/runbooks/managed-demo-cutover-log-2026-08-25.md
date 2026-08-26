# Managed demo cutover log — 2026-08-25

This log records external state changes and failed gates for the managed-demo migration. It contains no credential values or private endpoints.

## Completed preparation and access

- Captured the pre-change Cloud Run, Cloud SQL, Valkey, load-balancer, scheduler, Artifact Registry, and relevant Secret Manager version baseline.
- Created branch `ps/chore/managed-demo-cost-floor` and PR 188.
- Added the bounded background worker, Cloudflare edge proxy, deployment configuration, ADR, and restoration runbooks.
- Granted the active operator the scoped Cloud SQL, Valkey, Scheduler, Cloud Run, Secret Manager, service-account-use, load-balancer, network, and Artifact Registry roles needed for this migration. The identity already held project Owner; the redundant bindings added for this cutover must be removed after the migration closes.

## Database backup and verified restore

- Created private, uniform-access, public-access-prevented bucket `gs://grapit-db-rollback-20260825` in `asia-northeast3`.
- The offloaded export operation `5348e059-ad10-48af-922a-2eca00000042` failed only inside its temporary offload clone because that clone reported `database "grabit" does not exist`; it created no object.
- A normal Cloud SQL export then completed successfully as operation `c53dc8ac-c604-4ce6-adb9-1c1c00000042`.
- Primary object: `gs://grapit-db-rollback-20260825/20260825-managed-demo-r3/full.sql.gz`.
- Primary metadata: generation `1787640415506275`, size `10,781,900` bytes, CRC32C `FGM5sg==`, MD5 `jQfSzOWWQMCvsXObyqHEQQ==`, SHA-256 `b00138bd0680eded93ddfffaf7786659c229bd8aedc2f2654214a71f88c58ca5`; local `gzip -t` passed.
- Created independent private bucket `gs://grapit-db-rollback-secondary-20260825` in `asia-northeast1` and copied the object to the same relative path. Secondary generation is `1787640489074461`; size, CRC32C, and MD5 match the primary.
- Created `grabit-db-managed-demo` with operation `5f5ef866-26a5-4e1f-bb27-da0f00000042`: PostgreSQL 16 Enterprise, `db-f1-micro`, zonal `asia-northeast3-a`, 10GB SSD with auto-resize, public IPv4, seven retained backups, PITR, and deletion protection. The first create request made no resource because the edition was not explicit; `--edition=enterprise` is now recorded in the runbook.
- Created database `grapit` and application user, then imported the backup with operation `5a8085cb-4b71-4c59-8fc7-037b00000042` without exposing credentials.
- Source and target matched for all 50 public table row counts. A disposable independent restore matched all 59 non-system tables across `public`, `drizzle`, and `pgboss`, then the disposable database was deleted.
- `pg_database_size('grapit')` measured 91,773,975 bytes on the source and 68,631,575 bytes after restore on the managed-demo target. Both are far below the 10GiB target with the required 25% headroom; the compressed dump size was not used as the capacity proof.
- Drizzle migration state matched: 33 rows, max id 36, max created value `1782894990432`, digest `85c79f3e9368696989d9c015d3fe800b`. Payment/refund/ticket/admission counts and monetary sums also matched exactly.
- A Cloud Run execution using the production service account and target Cloud SQL attachment confirmed database `grapit`, 50 public tables, and 1,762 users.

## Valkey audit and replacement

- The original `grapit-valkey` audit found seven index keys: zero seat-owner/session keys, four stale locked-seat members, 9,971 stale waiting members, and 26 stale active members. The preceding 15-minute production log window contained no queue or seat-lock request.
- All members lacked their corresponding live owner/session keys and were old load-test artifacts. Cleanup execution `grabit-valkey-audit-20260825-ztb86` removed only those stale members.
- Final original-instance audit execution `grabit-valkey-audit-20260825-9hc6w` reported zero total keys and zero seat-lock, waiting, active, and queue-session members.
- Created `grabit-valkey-managed-demo` with operation `operation-1787642395353-659d9edf5e1e0-348e3c72-c6a4ea36`: `CUSTOM_PICO`, Valkey 8.0, Cluster Mode Disabled, one shard, zero replicas, single zone `asia-northeast3-a`, PSC on the default network, and deletion protection. It is `ACTIVE`.
- Cloud Run execution `grabit-valkey-audit-20260825-fn24d` connected through the production VPC path and reported zero keys. The temporary audit Job was deleted after the SQL and Valkey tests; execution logs remain.

## Cost controls and rollback artifacts

- Updated the project-scoped monthly Billing budget to KRW 76,000, approximately USD 55 at the 2026-08-25 observed rate. Alerts trigger at 82% current spend (approximately USD 45), 100% current spend, and 100% forecasted spend through the existing notification channel. Budget alerts notify; they do not cap spending.
- Tagged the current API and Web image commit `ad514b7fe661f94e7c1d779ab5807ac22055845e` as `rollback-20260825` in Artifact Registry.
- Applied `scripts/managed-demo/artifact-registry-cleanup-policy.json`: delete only untagged artifacts older than 14 days, keep ten recent versions per package, and keep `rollback-*` tags. The policy is active, not dry-run; parent-manifest-referenced Docker images are protected by Artifact Registry behavior.
- Created staging secrets `database-url-managed-demo-20260825:1` and `redis-url-managed-demo-20260825:1`. They contain the verified target connections and allow a coordinated production cutover without changing the baseline secrets early.

## Repository-public and CI state

- PR 188 merged as `4945905bcabe883e5623ca16a971d8dfe7688086` after CI run `32827811140` passed. Its earlier Actions run did not execute steps because GitHub reported a payment/spending-limit gate; this was not a test failure.
- Full-history Gitleaks scanning produced generic findings that collapsed to two account-specific Toss test-key values. Full-history TruffleHog reported zero verified secrets; its two unknown PostgreSQL findings were documentation placeholders.
- The historical Toss test secret is not the live production secret, but a read-only Toss API call proved the old test secret is still accepted. The operator explicitly instructed that it must not be reissued or changed and accepted proceeding with the existing value.
- Repository `icons-hq/grapit` was changed from private to public. CI run `32822184959` then executed normally and passed lint, typecheck, unit tests, Valkey Cluster integration, migrations, seed verification, login smoke, and Toss E2E in 6m43s.
- Pre-merge inline review found four valid issues. The follow-up fixes make background-context WebSocket broadcasts no-op without an initialized server, inject `PAYPAL_KRW_USD_RATE` into the bounded Job, allow path-routed workers.dev/local staging only outside production, and replace the compressed-dump capacity assumption with measured `pg_database_size` evidence.

## Warm deployment blockers and remediation

- Updated Workload Identity Federation from the former personal repository subject to `icons-hq/grapit` on `refs/heads/main`, and replaced the deployer service account principal-set binding accordingly.
- Granted the GitHub deployer direct `roles/iam.serviceAccountUser` on `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com`. Policy Troubleshooter returned `GRANTED`; the Cloud Run service agent also retained `roles/run.serviceAgent`.
- The legacy Cloud Run v1 Job deploy path still returned a false service-account `actAs` denial for both the deployer and project Owner. Cloud Run v2 `validateOnly` and create succeeded with the same IAM state, isolating the failure to the legacy deploy path rather than missing authority.
- Created permanent Job `grabit-background-worker` through Cloud Run v2. Its first execution `grabit-background-worker-ctnc6` reached the application but failed because `AdmissionGuard` could not resolve `QueueService` in the worker module graph.
- PR 189 adds the explicit queue dependency, a module-graph regression test, and one shared Redis provider owner so the bounded Job closes its only Redis client. Local compiled worker boot succeeded and the API suite passed 1,291 tests.
- Replaced the workflow's legacy Job deploy command with `scripts/managed-demo/deploy-background-worker-v2.mjs`. Its payload tests pass, the live `validateOnly` call passed, and a same-image/config v2 update completed with an exact image read-back without starting a new execution.

## Pre-cutover checkpoint

Before the connection cutover, `database-url:2` and `redis-url:1` were the production values, the original `grapit-db` was runnable, and `grapit-valkey` was active. Cloud Run API/Web were on `grabit-api-00242-2vn` and `grabit-web-00191-zw8`. This checkpoint is retained as historical evidence; it is not the current state.

## Production cutover and deploy evidence

- PR 189 merged as `58360d4cc26648097d6c98d335bb4374269491a0`. CI run `32835148478` passed, and warm deploy run `32835793656` passed migration, immutable API/Web image builds, the v2 Job deploy, Job smoke, and API/Web deploy.
- Created Scheduler job `grabit-background-worker-every-5m` with schedule `*/5 * * * *`, UTC, and state `ENABLED`. A manual Scheduler execution and subsequent regular executions completed successfully.
- Promoted the target connections to `database-url:3` and `redis-url:2`. Value-only comparison confirmed they match the staged managed-demo secrets and differ from preserved rollback versions `database-url:2` and `redis-url:1`; all four versions remain enabled.
- Set repository variables to API `0/4`, Web `0/4`, request-based API CPU, `DB_POOL_MAX=2`, `VALKEY_MODE=standalone`, and `BACKGROUND_PROCESSING_ENABLED=false`. The bounded Job explicitly uses `BACKGROUND_PROCESSING_ENABLED=true`.
- The first cutover migration attempt failed before any deployment because the GitHub `DATABASE_URL` contained the Cloud Run Unix-socket form while GitHub-hosted migration uses the local Cloud SQL Auth Proxy. The secret was corrected to the proxy-compatible form without printing it.
- Deploy run `32836813158` passed target migration, builds, and Job smoke. Its first API step was blocked by missing `cloudscheduler.jobs.get`; the deployer received the minimal `roles/cloudscheduler.viewer` binding. One immediate retry still saw IAM propagation, and attempt 3 then completed API/Web deployment.
- Scheduler executions at 10:20 and 10:25 UTC failed during the deliberate interval in which latest connection secrets had changed but the old Job spec was still active. The workflow smoke, 10:26 execution, and every observed regular execution after the updated spec succeeded.

## Producer-only API remediation

- Revision `grabit-api-00244-mq8` served successful HTTP requests but emitted four pg-boss connection-timeout errors one minute after startup. Root cause was pg-boss supervisor, scheduler, workers, and the pending-payment timer continuing inside a request-CPU service after CPU suspension.
- PR 190 merged as `4f5ea62cf33be45c238ddcf20b20f6aa9f34846c`. CI run `32838548424` passed in 7m04s, including unit/integration tests, migration/seed, login smoke, and Toss test E2E. Deploy run `32839206598` passed migration, both image builds, bounded Job deploy/smoke, API deploy, and Web deploy.
- Deploy run `32839206598` produced and verified API revision `grabit-api-00245-kd9` and Web revision `grabit-web-00194-rr5` at 100% traffic. Both images use merge SHA `4f5ea62cf33be45c238ddcf20b20f6aa9f34846c`.
- API read-back shows no minimum-instance annotation, max instances `4`, CPU throttling enabled, pool size `2`, standalone Valkey, `BOOKING_ENABLED=true`, and background processing disabled only inside the API. The Job generation is `4`, Ready, uses the same API image, and has background processing enabled.
- After more than one timer interval and public requests, the new API revision had zero ERROR logs and zero pg-boss connection-timeout logs. The new-image Job executions had zero ERROR logs. The regular 11:00 UTC execution `grabit-background-worker-5zkwm` succeeded.

## Live functional evidence

- `https://heygrabit.com`, its Cloud Run origin, the public API health endpoint, and the API origin returned HTTP 200. Health reported standalone ioredis configured and up; DB-backed performance listing and email-availability checks also returned HTTP 200.
- `/auth`, `/admin`, `/field/check-in`, and `/mypage` rendered over the public domain. Kakao, Naver, and Google login entry routes returned provider redirects. No seeded `admin@grabit.test` account exists in production.
- Socket.IO polling handshake returned HTTP 200 and an Engine.IO open packet. Browser-shaped seat-lock and payment-confirm requests reached the API and returned the expected unauthenticated 401. Refund preview/request, queue session, QR/check-in, and admin read/write routes also returned their expected authentication guards.
- A shaped SMS verification request with no issued code reached the real verification path and returned the expected expired-code response. An invalid Toss webhook reached the webhook guard and returned 401. Production has secret references for Toss, Resend, Infobip/Twilio, QR signing, R2, and social OAuth.
- No real charge, refund, SMS, email, QR consumption, or admin business-record write was created during infrastructure smoke. CI covers the real application contracts with Toss test credentials; the production smoke proves routing, runtime dependencies, guards, and provider configuration without external side effects.

## Cost cutover and retained rollback resources

- At 11:00 UTC, the original `grapit-db` (`db-custom-2-12288`) was changed from `ALWAYS/RUNNABLE` to `NEVER/STOPPED`. Cloud SQL rejected enabling deletion protection while stopped, so it was started once at 11:04 UTC with protection enabled and returned to `NEVER/STOPPED` at 11:08 UTC. Production connections already pointed only to the target; the source was not resized or deleted and is now deletion-protected for the seven-day retention window.
- After the source stop, API health and Web remained HTTP 200, the 11:00 UTC regular worker succeeded, and the API revision had zero ERROR logs.
- Target `grabit-db-managed-demo` remains `RUNNABLE`, `db-f1-micro`, 10GB, with backups, PITR, and deletion protection. Target `grabit-valkey-managed-demo` remains `ACTIVE`, `CUSTOM_PICO`, one shard, zero replicas, single-zone, and deletion-protected.
- Original `grapit-valkey` remains active and unchanged for at least 24 hours after clean cutover evidence. This creates a temporary overlap charge; delete it only after the retention gate and a final zero-live-key audit.
- At the end of the initial GCP cutover, no Cloudflare Worker Route had been deployed and no DNS or GCP load-balancer resource had been deleted. The 2026-08-26 edge canary below supersedes the route portion of this checkpoint; the load balancer remains a rollback asset and has not been deleted.
- The historical Toss test key and all Toss production secrets were left unchanged and were not reissued.

## Cloudflare edge canary — 2026-08-26

- Authorized the local Wrangler CLI through Cloudflare OAuth with only `user:read`, `account:read`, `workers_scripts:write`, `workers_routes:write`, `workers_tail:read`, `zone:read`, and the required offline refresh access. No OAuth token or Cloudflare credential was added to the repository, GitHub, or GCP. The account's active Workers plan read back as Free (`US$0`).
- Re-ran the edge proxy checks before deployment: all six unit tests passed, TypeScript typecheck passed, and both staging and production Wrangler dry-run bundles passed. Neither `grabit-origin-proxy-staging` nor `grabit-origin-proxy` existed before this deployment.
- Deployed staging Worker `grabit-origin-proxy-staging` at 2026-08-26 00:03:44 UTC. Version `b7a1c1df-8f15-4616-b32c-38477d60692b` serves `https://grabit-origin-proxy-staging.sangwopark19.workers.dev` with staging hosts enabled. Web, auth, admin, field check-in, mypage, API health, a DB-backed performance query, and Socket.IO polling returned HTTP 200; Google, Kakao, and Naver launch routes redirected to their provider origins.
- Deployed production Worker `grabit-origin-proxy` at 2026-08-26 00:05:07 UTC. Version `15728230-8b21-49d3-9069-7589f0c32285` is at 100% and owns `heygrabit.com/*`, `www.heygrabit.com/*`, and `api.heygrabit.com/*`; `ALLOW_STAGING_HOSTS=false`. DNS and every GCP load-balancer resource remain unchanged behind the routes.
- Production Web, auth, admin, field check-in, mypage, runtime flags, API health, DB-backed performance listing, and Socket.IO polling passed. `www` redirected to `https://heygrabit.com/`, `BOOKING_ENABLED=true`, health reported standalone Valkey up, and an isolated browser rendered the auth page with Google, Kakao, and Naver actions and zero console errors.
- Browser-shaped probes for seat lock, payment confirm, refund preview/request, queue enter/session, QR ticket/email, field verify/consume, admin read/write, and an invalid Toss webhook all traversed the Worker and reached their expected HTTP 401 guards. Provider-denied Google, Kakao, and Naver callback probes returned to `https://heygrabit.com/auth/callback`. No redirect leaked a `run.app` hostname, and no charge, refund, message, QR consumption, check-in, or business-record write was created.
- Worker tail showed the canary probes with `outcome=ok`, zero exceptions, and 0–2ms CPU. An error-only tail captured zero events. One Sentry uptime request was recorded as client-canceled after a successful HTTP 200 response with zero Worker exceptions. Cloud Run API ERROR count, pg-boss timeout count, and bounded-worker ERROR count were all zero after route activation; scheduled execution `grabit-background-worker-jkpj4` succeeded.
- The 24-hour edge canary clock begins at 2026-08-26 00:05:07 UTC. The earliest load-balancer retirement review is 2026-08-27 00:05:07 UTC (09:05:07 KST), and time alone is insufficient: the route, OAuth/callback, webhook, WebSocket, provider, and error-log gates must still be clean. No load-balancer resource is approved for deletion before that review.
- This is the first production Worker version, so there is no earlier Worker version to pass to `wrangler rollback`. During the initial canary, emergency rollback means removing only the three production Worker Routes and verifying that the unchanged proxied DNS records fall through to the retained GCP load balancer. Preserve the Worker script/version as evidence and do not delete DNS records.

## Exact restoration posture

1. Treat the managed-demo database as source of truth after cutover. Before reverting database writes, compare and reconcile every write made after 2026-08-25 10:18 UTC; never blindly point production at the stale source.
2. Start the preserved SQL instance with `gcloud sql instances patch grapit-db --project=grapit-491806 --activation-policy=ALWAYS --quiet` and wait for `RUNNABLE`.
3. Add new latest versions whose values come from preserved `database-url:2` and `redis-url:1`; do not disable or destroy the preserved versions. Set GitHub `CLOUD_SQL_CONNECTION_NAME` to `grapit-491806:asia-northeast3:grapit-db`, and set the GitHub migration `DATABASE_URL` to the corresponding proxy-compatible form without printing credentials.
4. Restore repository variables: API `1/40`, Web `1/50`, `API_CPU_ALLOCATION_FLAG=--no-cpu-throttling`, `DB_POOL_MAX=4`, `VALKEY_MODE=cluster`, and `BACKGROUND_PROCESSING_ENABLED=true`.
5. Deploy through GitHub Actions. Verify the API revision mounts exactly `grapit-db`, uses the restored secret versions, stays warm, and has continuous pg-boss workers without ERROR logs.
6. Disable `grabit-background-worker-every-5m` only after the continuous workers pass refund retry, QR email, cancelled-seat release, and pending-payment expiration smokes. Keep it enabled if any continuous-worker evidence is incomplete.
7. Run HTTP, signup/login, queue/seat-lock/WebSocket, payment/webhook/refund, QR/check-in, email/SMS, admin-write, and data-reconciliation gates before restoring ticket sales capacity.
