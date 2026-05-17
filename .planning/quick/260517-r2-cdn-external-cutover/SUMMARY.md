# R2 CDN External Cutover Summary

## Completed

- Created R2 custom domain `cdn.heygrabit.com` for bucket `grapit-assets`.
- Updated R2 CORS to allow browser uploads with `cache-control`.
- Created Cloudflare Cache Rule for `https://cdn.heygrabit.com/*`.
- Verified CDN responses return `cache-control: max-age=31536000` and `cf-cache-status: HIT`.
- Switched deploy defaults to `R2_UPLOAD_CACHE_CONTROL_ENABLED=true`.

## Remaining

- Update GCP/GitHub secrets.
- Deploy the updated default.
- Run production DB backfill and live smoke checks.
