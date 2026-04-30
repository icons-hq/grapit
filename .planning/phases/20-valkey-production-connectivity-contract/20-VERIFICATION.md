---
phase: 20-valkey-production-connectivity-contract
status: pending-production-smoke
human_needed: true
evidence_artifact: .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md
updated: 2026-04-30
---

# Phase 20 Verification - Valkey Production Connectivity Contract

This report intentionally separates local/CI code verification from production smoke evidence. Code-level checks can prove the script and contracts exist. Only `20-HUMAN-UAT.md` can close the Cloud Run to Valkey runtime evidence gap after an operator records real revision-scoped smoke results.

## Code-Level Automated Verification

These checks are required before the human production checkpoint:

```bash
node --check scripts/smoke-valkey-production.mjs
pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help
rg -n "GRABIT_SMOKE_AUTH_HEADER_FILE|GRABIT_SMOKE_ARTIFACT|--help|--check all|createRequire|\\.\\./apps/web/package\\.json|webRequire\\('socket\\.io-client'\\)|CROSSSLOT|MOVED|ASK|ECONNRESET|ETIMEDOUT|redact" scripts/smoke-valkey-production.mjs
rg -n "defaultArtifactUrl|\\.\\./\\.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT\\.md|fileURLToPath\\(defaultArtifactUrl\\)" scripts/smoke-valkey-production.mjs
rg -n "Production Runtime Contract|Safe Fixture Approval|Socket.IO Two-Instance Propagation|Idle Reconnect Window|Rollback Checklist|PII And Secret Redaction Rules" .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md
rg -n "status: pending-production-smoke|human_needed: true|Observable Truths|20-HUMAN-UAT.md" .planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md
```

## Production Smoke Evidence

Production smoke remains human-needed until the operator records evidence in `20-HUMAN-UAT.md`.

Required production command shape:

```bash
pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help
pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all
```

`GRABIT_SMOKE_ARTIFACT` is optional. The preferred path is the script-root default `20-HUMAN-UAT.md`; relative override values are caller-CWD relative.

## Observable Truths

| Truth | Status | Evidence Source |
|-------|--------|-----------------|
| Production mode is visible through Cloud Run env, health metadata, and live Memorystore mode evidence. | pending-production-smoke | `20-HUMAN-UAT.md` Production Runtime Contract |
| `/api/v1/health` reports Redis up from the deployed API revision. | pending-production-smoke | `20-HUMAN-UAT.md` Health Ping Smoke |
| Lua lock/status/unlock or TTL expiry path runs against an operator-approved safe fixture. | pending-production-smoke | `20-HUMAN-UAT.md` Lua Lock Status Unlock Smoke |
| Socket.IO `seat-update` propagates across two Cloud Run API instances. | pending-production-smoke | `20-HUMAN-UAT.md` Socket.IO Two-Instance Propagation |
| Idle reconnect validates health, Lua, and Socket.IO after a realistic idle/cold-start interval. | pending-production-smoke | `20-HUMAN-UAT.md` Idle Reconnect Window |
| Cloud Logging and Sentry are clean for Valkey and adapter failure keywords. | pending-production-smoke | `20-HUMAN-UAT.md` Log And Sentry Cleanliness |
| Temporary scaling is restored and rollback criteria are ready. | pending-production-smoke | `20-HUMAN-UAT.md` Scale Pre-State And Restore and Rollback Checklist |

## Redaction Gate

The production artifact must not contain actual secret or customer values. Policy words are allowed only without values.

```bash
rg -n 'redis://[^`[:space:]]+|Authorization: Bearer [A-Za-z0-9._-]{16,}|Cookie: [^`[:space:]]+=|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|(paymentKey|orderId)[[:space:]]*[:=][[:space:]]*"?[A-Za-z0-9_-]{12,}|\+82[0-9]{8,}' .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md && exit 1 || exit 0
```

## Current Status

`status: pending-production-smoke` and `human_needed: true` must remain until an operator approves real `20-HUMAN-UAT.md` evidence. Do not change this file to passed in this executor run.
