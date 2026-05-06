---
quick_id: 260506-oef
status: complete
completed: 2026-05-06
commit: 6b8137e
---

# Quick Task 260506-oef Summary

## Completed

- Generated `apps/web/public/seed/donghae-girl-rules-20260718-seat-map.svg` from the 동해문화예술관 대극장 `.xls` layout.
- Added seed data for `2026 걸룰스 팬미팅` at `동해문화예술관 대극장`.
- Added price tiers and seat map config:
  - `SVIP석`: 700 seats, 380,000원
  - `VIP석`: 500 seats, 260,000원
  - `R석`: 800 seats, 120,000원
- Uploaded the SVG to production R2 using production GCP Secret Manager credentials:
  - `https://pub-9eb4eb2187b94ca8a746f62301c0a87f.r2.dev/seat-maps/donghae-girl-rules-20260718-seat-map.svg`
- Updated production Cloud SQL via `gcloud` + Cloud SQL Auth Proxy:
  - performanceId: `18a3bcc6-5e75-463d-abfd-634601328754`
  - title: `Girl Rules FAN MEETING IN SEOUL`
  - seat map total: `2,000`
  - production tier labels preserved as `SVIP`, `VIP`, `R` to match existing price tiers.

## Notes

- Excel source has 1,299 seats on 2F and 706 seats on 3F. Requested inventory totals 2,000 seats.
- To preserve the requested count, the SVG exposes 2,000 sellable `data-seat-id` seats and leaves 5 Excel seats as non-sellable visual seats.
- Because 3F has 706 seats in the Excel file, `R석` is 3F 706 seats plus 2F rear overflow 94 seats.

## Verification

- `node --check apps/api/src/database/seed.mjs`
- SVG count check: 2,000 unique `data-seat-id`, tier counts 700/500/800.
- SVG vs seed config check: missing 0, extra 0 for all tiers.
- `pnpm --filter @grabit/api test -- --runInBand`: 41 files, 485 tests passed.
- R2 `HEAD` check: `200 OK`, `Content-Type: image/svg+xml`.
- Production API check:
  - `/api/v1/performances/18a3bcc6-5e75-463d-abfd-634601328754`
  - returns `seatMap.svgUrl`, `totalSeats: 2000`, and tier counts `SVIP 700 / VIP 500 / R 800`.

## Caveat

- API dev server launch was attempted but blocked by an existing `FeatureFlagsService` Nest DI error. The server was stopped; this appears unrelated to the seat map/seed changes.
- A mistaken local development DB insert was removed after production update; production Cloud SQL is the authoritative applied state.
