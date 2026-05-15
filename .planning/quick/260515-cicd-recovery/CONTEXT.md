---
quick_id: 260515-cicd-recovery
slug: cicd-recovery
status: in_progress
started: 2026-05-15
---

# Context

- Fix GitHub Actions CI/CD after main push CI run 25906669766 stuck queued with jobs=[] and cancel/force-cancel HTTP 500.
- Keep PR CI checks intact.
- Make deploy recoverable from main push / workflow_dispatch without depending on a separate main CI workflow_run object.
