---
quick_id: 260515-gke
slug: gnb-ip-ip
status: planned
created: 2026-05-15
---

# Quick Task 260515-gke: GNB and Home Genre Copy Cleanup

## Goal

Public GNB and the home bottom genre shortcuts should no longer show `ip_popup`, and `artist_celebrity` should display as artist-only copy.

## Tasks

1. Update public genre navigation surfaces so only `artist_celebrity` is rendered in GNB, mobile menu category list, and home genre shortcuts.
2. Update visible genre labels from artist/celebrity wording to artist-only wording across locale copy and shared Korean fallback labels.
3. Update focused UI tests and run targeted verification.

## Verification

- Run focused web tests covering GNB/home visible copy.
- Inspect git diff for unintended generated or unrelated changes.
