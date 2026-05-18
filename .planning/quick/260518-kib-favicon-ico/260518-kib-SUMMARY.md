---
quick_id: 260518-kib
status: complete
description: "favicon.ico 흰색 배경 제거 후 투명 아이콘으로 교체"
completed: 2026-05-18
---

# Quick Task 260518-kib Summary

## Completed

- Regenerated `apps/web/public/favicon.ico` with transparent outer corners and RGBA icon payloads.
- Used border-connected background removal so the internal white Grabit logo remains opaque.

## Verification

- `file apps/web/public/favicon.ico` reports PNG image data with `RGBA` and multiple icon sizes.
- Alpha inspection confirmed all four corners are transparent and the center logo remains opaque.
- `pnpm --filter @grabit/web build` passed.
