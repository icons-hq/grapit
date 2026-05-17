# R2 CDN External Cutover

## Goal

Complete the external production cutover for R2-backed assets after the signup surge readiness implementation.

## Scope

- Verify `cdn.heygrabit.com` custom domain and Cloudflare cache behavior.
- Align production deploy defaults so future deploys keep immutable upload metadata enabled.
- Update production secrets for the canonical CDN public URL and GitHub deploy hostname.
- Backfill production DB URLs from the old `r2.dev` host to `https://cdn.heygrabit.com`.
- Smoke test live API/web asset paths after cutover.

## Verification

- Cloudflare R2 domain status and curl response headers.
- GitHub Actions deploy green.
- Production API health and performance detail URL fields.
- Production DB residual `r2.dev` count equals zero.
