# Managed demo cutover log — 2026-08-25

This log records external state changes and failed gates for the managed-demo migration. It contains no credential values or private endpoints.

## Completed preparation

- Captured the pre-change Cloud Run, Cloud SQL, Valkey, load-balancer, scheduler, Artifact Registry, and relevant Secret Manager version baseline.
- Created branch `ps/chore/managed-demo-cost-floor`.
- Added the bounded background worker, Cloudflare edge proxy, deployment configuration, ADR, and restoration runbooks locally.
- Created private bucket `gs://grapit-db-rollback-20260825` in `asia-northeast3` with uniform bucket-level access and public-access prevention.
- Granted the source Cloud SQL service account `roles/storage.objectAdmin` on that rollback bucket so an authorized Cloud SQL export can write the object.

## Blocked gate

The attempted serverless export to:

`gs://grapit-db-rollback-20260825/20260825-managed-demo/grapit-full.sql.gz`

was rejected before an export operation started:

```text
PERMISSION_DENIED: The caller does not have permission.
```

The active gcloud identity can create the bucket but does not have the Cloud SQL export permission. The target object does not exist, so no checksum or size gate is available yet.

## Confirmed not changed

- No Cloud SQL instance was created, resized, stopped, or deleted.
- No Valkey instance was created, updated, or deleted.
- `database-url` and `redis-url` received no new versions.
- No Cloud Run service, Job, Scheduler job, Cloudflare Worker/Route, DNS record, or GCP load-balancer resource was changed.
- Production remained on the baseline revisions and original data services.

## Next authorized execution point

Resume only with an identity that has the required Cloud SQL export permission. The next command is the export command in `managed-demo-cost-floor.md`; do not create the small Cloud SQL target until the export object exists and the size/checksum gate passes.
