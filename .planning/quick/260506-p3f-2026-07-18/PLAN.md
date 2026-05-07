---
status: in_progress
created: 2026-05-06
quick_id: 260506-p3f
slug: 2026-07-18
---

# Quick Task 260506-p3f: Delete Production Test Performances Except 2026-07-18 Girl Rules

## Scope

Delete test performance data from the production database while preserving the newly registered Girl Rules performance scheduled for 2026-07-18.

## Guardrails

- Do not delete any performance whose title identifies Girl Rules / 걸룰스 and whose showtime or performance date is 2026-07-18.
- Query and list candidate performance rows before deletion.
- Prefer an explicit keep-set and delete only the reviewed candidate set.
- Run deletion inside a transaction and verify remaining rows afterward.
- Do not modify unrelated source files or existing user changes.

## Tasks

1. Inspect production database target and performance-related schema.
2. Identify the protected 2026-07-18 Girl Rules row and all other test performance candidates.
3. Delete only the reviewed test performance candidate rows and verify the protected row remains.
