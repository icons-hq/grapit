---
quick_id: 260518-kib
status: planned
description: "favicon.ico 흰색 배경 제거 후 투명 아이콘으로 교체"
created: 2026-05-18
---

# Quick Task 260518-kib: Transparent favicon.ico

## Goal

Production browser tab에서 favicon 외곽의 흰색 배경이 보이지 않도록, 기존 `favicon.ico`를 alpha가 있는 투명 배경 아이콘으로 교체한다.

## Tasks

1. Remove only the border-connected white background from the provided source image while preserving the internal white logo.
2. Regenerate `apps/web/public/favicon.ico` with RGBA icon payloads.
3. Verify the web production build still passes.

## Verification

- `file apps/web/public/favicon.ico`
- Python alpha inspection for transparent corners and opaque logo sample
- `pnpm --filter @grabit/web build`
