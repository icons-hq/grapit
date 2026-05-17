# 260517-obg Production Signup Surge Readiness Summary

## Status

- Cloud SQL capacity action completed in production.
- Application code changes implemented and locally verified.
- R2 CDN cutover/backfill is prepared but not applied because `cdn.heygrabit.com` is not resolving and current R2 credentials cannot update CORS.

## Production Actions

- Created on-demand Cloud SQL backup before tier change:
  - operation: `0fc51ed4-0150-44ca-871c-b8b400000042`
  - status: `DONE`
  - window: `2026-05-17T08:32:21Z` to `2026-05-17T08:33:32Z`
- Patched `grapit-db` tier:
  - requested plan tier `db-n1-standard-4` was rejected by Cloud SQL for PostgreSQL
  - applied equivalent supported tier `db-custom-4-15360`
  - operation: `0520b353-a143-4de1-be7c-a4db00000042`
  - status: `DONE`
- Confirmed current instance:
  - state: `RUNNABLE`
  - tier: `db-custom-4-15360`
  - availability: `ZONAL`
  - region: `asia-northeast3`
- Post-change live smoke:
  - `https://api.heygrabit.com/api/v1/health`: `200`
  - `https://heygrabit.com`: `200`
- Latest Cloud Monitoring sample after upgrade:
  - Cloud SQL CPU utilization: `0.02496450987871694`
  - Cloud SQL memory utilization: `0.40782121740236377`
  - PostgreSQL backends latest sample: `2`

## Code Changes

- Added explicit PostgreSQL pool configuration:
  - `DB_POOL_MAX`
  - `DB_POOL_IDLE_TIMEOUT_MS`
  - `DB_POOL_CONNECTION_TIMEOUT_MS`
- Added deploy defaults for API Cloud Run:
  - `DB_POOL_MAX=3`
  - `DB_POOL_IDLE_TIMEOUT_MS=30000`
  - `DB_POOL_CONNECTION_TIMEOUT_MS=5000`
- Added R2 upload validation:
  - allowed folders: `posters`, `performance-detail`, `banners`, `seat-maps`, `castings`
  - folder-specific MIME/extension allowlists
- Added immutable upload cache metadata support:
  - `Cache-Control: public, max-age=31536000, immutable`
  - guarded by `R2_UPLOAD_CACHE_CONTROL_ENABLED`
  - production deploy default remains `false` until R2 CORS permits `Cache-Control`
- Added frontend presigned-upload helper:
  - blocks saving public URL when PUT returns non-2xx
  - sends `Cache-Control` only when API returns `cacheControl`
- Added `cdn.heygrabit.com` remote pattern test path.
- Added production backfill script:
  - `scripts/backfill-r2-public-url.mjs`
  - dry-run by default, transaction on `--apply`
  - targets `performances.poster_url`, `performances.detail_images[].imageUrl`, `seat_maps.svg_url`, `banners.image_url`, `castings.photo_url`

## Verification

- `pnpm --filter @grabit/api test -- upload.service.spec.ts drizzle.provider.spec.ts`
  - passed: 68 files, 705 tests
- `pnpm --filter @grabit/web test -- admin-upload.test.ts next-config.test.ts banner-manager.test.tsx svg-preview.test.tsx`
  - passed: 76 files, 450 tests
- `pnpm --filter @grabit/api typecheck`
  - passed
- `pnpm --filter @grabit/web typecheck`
  - passed
- `pnpm --filter @grabit/api lint`
  - passed with existing warnings
- `pnpm --filter @grabit/web lint`
  - passed with existing warnings

## Remaining External Blockers

- `cdn.heygrabit.com` currently does not resolve, so CDN cutover and DB backfill were not applied.
- R2 CORS update via current S3-compatible credentials failed with `AccessDenied`.
- Current R2 CORS preflight allows `content-type` but rejects `cache-control`; therefore `R2_UPLOAD_CACHE_CONTROL_ENABLED` must stay `false` until Cloudflare R2 CORS is updated.
- Cloudflare Cache Rule and R2 custom domain connection require Cloudflare dashboard/API-token access.
- Production backfill dry-run could not be executed locally because the production `DATABASE_URL` uses Cloud Run `/cloudsql/...` socket routing and local Cloud SQL Auth Proxy failed with current gcloud credentials.

## Scheduler State

- `grabit-prewarm-scale-up`: `25 09 * * *`, `Asia/Seoul`, enabled, API only.
- `grabit-prewarm-step-down`: `10 11 * * *`, `Asia/Seoul`, enabled, API only.
- If the actual campaign window differs from this, update Scheduler before launch.
