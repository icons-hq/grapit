---
quick_id: 260517-obg
status: in_progress
created_at: 2026-05-17T08:30:33.729Z
---

# Production Signup Surge Readiness

Implement the approved Grabit production surge readiness plan for a 2,000+ concurrent signup launch.

## Decisions

- Upgrade Cloud SQL `grapit-db` from `db-f1-micro` to `db-n1-standard-4` after an on-demand backup.
- Use `https://cdn.heygrabit.com` as the canonical R2/CDN asset host.
- Add immutable upload caching for UUID-keyed asset folders.
- Add explicit API DB pool settings and deploy them through Cloud Run.
- Backfill existing `r2.dev` asset URLs only after `cdn.heygrabit.com` resolves and serves the R2 bucket.

## Implementation

- Add API upload folder/MIME/extension allowlist and `Cache-Control` metadata for R2 PUTs.
- Return the required upload cache header to the frontend and fail admin uploads when PUT returns non-2xx.
- Add explicit DB pool config parsing in the Drizzle provider.
- Add production deploy env vars for DB pool settings.
- Verify local tests and production health after deployable changes.

