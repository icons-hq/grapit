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

## Production state deliberately not cut over yet

- Baseline `database-url:2` and `redis-url:1` remain unchanged and are still the production values.
- The original `grapit-db` remains runnable; `grapit-valkey` remains active. Neither has been resized, stopped, or deleted.
- Cloud Run API/Web remain on revisions `grabit-api-00242-2vn` and `grabit-web-00191-zw8`. The permanent background Job exists and is Ready, but its latest execution is the pre-hotfix failed run; no Scheduler job exists yet.
- No Cloudflare Worker/Route, DNS record, GCP load-balancer resource, payment/refund, or production business record has been changed by the cutover work.

## Next execution point

1. Pass CI on PR 189, merge it, and deploy once with warm defaults to update and smoke the bounded Cloud Run Job.
2. Create the five-minute Scheduler job, promote the two staged target connections into new versions of `database-url` and `redis-url`, set the managed-demo repository variables, and deploy the scale-to-zero revision.
3. Complete HTTP, auth, queue/seat-lock, WebSocket, payment-webhook, refund, QR/check-in, email/SMS, and admin-write-safe smoke tests. No real financial charge or refund is part of an infrastructure smoke without separate transaction approval.
4. Keep the original Valkey for at least 24 hours and the original SQL stopped for seven days after clean smoke evidence. Load-balancer retirement also waits for at least 24 hours of clean Cloudflare canary evidence.
