# Managed demo pre-change baseline — 2026-08-25

This is the immutable restoration ledger captured before the managed-demo cost cutover. It intentionally contains resource names and secret version numbers, but no secret values, private addresses, credentials, or customer data.

## Public state

| Check | Baseline |
| --- | --- |
| Web | `https://heygrabit.com/` returned HTTP `200` |
| API | `https://api.heygrabit.com/api/v1/health` returned HTTP `200` |
| Booking flag | public runtime flag returned `bookingEnabled: true` |
| Access pattern | both Cloud Run services had minimum instances `0`; an API cold health request took roughly 12 seconds |

## Cloud Run restoration points

| Item | `grabit-api` | `grabit-web` |
| --- | --- | --- |
| Latest ready revision | `grabit-api-00242-2vn` | `grabit-web-00191-zw8` |
| Image | `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:ad514b7fe661f94e7c1d779ab5807ac22055845e` | `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-web:ad514b7fe661f94e7c1d779ab5807ac22055845e` |
| CPU / memory | `1` / `512Mi` | `1` / `1Gi` |
| Concurrency | `250` | `250` |
| Timeout | `3600s` | `300s` |
| Minimum / maximum | `0` / `40` | `0` / `50` |
| CPU allocation | instance-based, `cpu-throttling=false` | request-based default |
| Other | session affinity, Direct VPC `default/default`, private-ranges-only, Cloud SQL attachment | startup CPU boost |

The pre-change deploy workflow did not match live state: it declared minimum instances `1` for both services. A rollback must choose either the live restoration points above or the ticket-opening configuration in the managed-demo runbook; it must not rely on the historical workflow defaults accidentally.

Stable Cloud Run service origins:

- Web: `https://grabit-web-d3c6wrfdbq-du.a.run.app`
- API: `https://grabit-api-d3c6wrfdbq-du.a.run.app`

## Cloud SQL restoration point

| Field | Baseline |
| --- | --- |
| Instance | `grapit-db` |
| Engine / region / zone | PostgreSQL 16 / `asia-northeast3` / `asia-northeast3-a` |
| Tier | `db-custom-2-12288` |
| Availability | ZONAL |
| Storage | `100GB` `PD_SSD`, automatic growth enabled |
| Backup | enabled at `03:00`, 7 retained backups |
| PITR | enabled, 7-day transaction-log retention |
| Network | public IPv4 enabled; no private network attached |
| Secret pointer before cutover | `database-url` version `2` |

Cloud SQL reported an in-place minimum shrink target of `52GB`, so the managed-demo `10GB` target cannot be reached by resizing this instance. The cutover must use a logical export and a new instance. The logical database size was not confirmed because the local Cloud SQL Auth Proxy metadata request returned `errorInvalidProject`; the export object must be below `8GB` before creating/importing into the `10GB` target.

## Valkey restoration point

| Field | Baseline |
| --- | --- |
| Instance | `grapit-valkey` |
| Engine | Valkey 8.0 |
| Mode | Cluster Mode Enabled (`VALKEY_MODE=cluster`) |
| Node / topology | `STANDARD_SMALL`, 1 shard, 0 replicas, multi-zone placement |
| Security | transit encryption disabled, auth disabled, PSC endpoint in the default VPC |
| Persistence | disabled |
| Deletion protection | enabled |
| Secret pointer before cutover | `redis-url` version `1` |

Cluster mode cannot be changed in place. Restoring this baseline requires the original instance while retained, or a new Cluster Mode Enabled instance and a new `redis-url` secret version.

## GCP load-balancer restoration point

| Resource type | Names |
| --- | --- |
| Global forwarding rule | `grabit-api-forwarding` |
| Target HTTPS proxy | `grabit-api-proxy` |
| URL map | `grabit-api-urlmap` |
| Backend services | `grabit-api-backend`, `grabit-web-backend` |
| Serverless NEGs | `grabit-api-neg`, `grabit-web-neg` |
| Managed certificates | `grabit-api-cert`, `grabit-web-cert` |

Both recorded managed certificates were expired and in `PROVISIONING_FAILED_PERMANENTLY`. Re-creating the names alone is not a valid ticket-opening rollback; new certificates must reach `ACTIVE` before returning traffic to a restored GCP load balancer.

## Other retained evidence

- Artifact Registry repository `grabit` held about `10.5GB`; cleanup must protect both the current and rollback image tags.
- `grabit-prewarm-scale-up` and `grabit-prewarm-step-down` existed in `PAUSED` state.
- Billing invoice data was not available. All cost figures are list-price estimates before tax, exchange rate, egress, third-party messaging, and payment-provider fees.
