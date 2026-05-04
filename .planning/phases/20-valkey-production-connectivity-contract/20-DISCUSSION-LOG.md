# Phase 20: valkey-production-connectivity-contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-30
**Phase:** 20-valkey-production-connectivity-contract
**Areas discussed:** Production mode contract, Production smoke evidence, Socket.IO multi-instance proof, Idle reconnect and rollback, Scope guardrails

---

## Production Mode Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Keep implicit standalone client | Continue with `new IORedis(url)` and rely on existing code-level verification. Lowest change, but does not close the audit gap. | |
| Explicit mode contract + live validation | Make expected Valkey mode observable via env/config/probe and fail smoke on mismatch. Keeps changes narrow while proving runtime behavior. | ✓ |
| Full cluster-client migration immediately | Switch to `IORedis.Cluster` before evidence proves it is required. Higher blast radius. | |

**User's choice:** Auto-selected by Codex fallback after the user requested `$gsd-discuss-phase 20` and branch separation first.
**Notes:** Selected the narrowest option that closes the audit gap without assuming a larger migration is necessary.

---

## Production Smoke Evidence

| Option | Description | Selected |
|--------|-------------|----------|
| Code/tests only | Add local or CI tests and skip production evidence. Does not satisfy `human_needed` runtime gaps. | |
| Operator-run smoke with structured artifact | Capture Cloud Run revision, commands, sanitized outputs, logs, and PASS/FAIL for health, lock Lua path, pub/sub, and idle reconnect. | ✓ |
| Informal manual notes | Ask the operator to check production manually without a reproducible checklist. Too weak for downstream audit. | |

**User's choice:** Auto-selected by Codex fallback.
**Notes:** Private PSC networking means CI may not be able to hit the real Valkey endpoint, so a concrete human/operator artifact is acceptable.

---

## Socket.IO Multi-Instance Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Adapter unit tests only | Keep existing `RedisIoAdapter` tests as proof. Useful but only proves wiring. | |
| Temporary two-instance runtime smoke | Force or observe two Cloud Run API instances and verify `seat-update` crosses instance boundaries through Valkey pub/sub. | ✓ |
| Permanent scale change | Raise `min-instances` permanently to make testing easier. Conflicts with cost-minimized Cloud Run constraint. | |

**User's choice:** Auto-selected by Codex fallback.
**Notes:** The existing adapter wiring is already present. Phase 20 must prove deployed multi-instance behavior.

---

## Idle Reconnect And Rollback

| Option | Description | Selected |
|--------|-------------|----------|
| Health ping only | Verify `/health` once after deploy. Too narrow for idle reconnect and pub/sub failure modes. | |
| Health + lock + pub/sub after idle with rollback checklist | Exercise the user-critical paths after a realistic idle/cold-start interval and document rollback steps. | ✓ |
| Defer idle reconnect | Leave the original Phase 7 human-needed gap open. | |

**User's choice:** Auto-selected by Codex fallback.
**Notes:** The smoke must name concrete failure modes: startup failure, health red, cluster mismatch, CROSSSLOT, MOVED/ASK, connection resets/timeouts, and subscription loss.

---

## Scope Guardrails

| Option | Description | Selected |
|--------|-------------|----------|
| Narrow contract/evidence phase | Make production connectivity explicit and verifiable; preserve Phase 19 booking lock ownership semantics. | ✓ |
| Rebuild Valkey infrastructure | Recreate Memorystore, secrets, or networking during planning. Too risky unless evidence proves it is necessary. | |
| Fold broader Valkey tech debt | Also fix cache KEYS, getMyLocks TTL edge, or high-traffic readiness. Belongs to later phases unless blocking. | |

**User's choice:** Auto-selected by Codex fallback.
**Notes:** Keeps Phase 20 focused on closing the production connectivity audit gap.

---

## the agent's Discretion

- Exact environment variable names, probe implementation, smoke script format, and artifact naming are left to the planner.
- The planner may choose whether to produce `20-HUMAN-UAT.md`, `20-VERIFICATION.md`, or both.
- The planner may choose between a Node script, CLI runbook, browser/socket harness, or mixed smoke workflow.

## Deferred Ideas

- Cache invalidation `KEYS` hardening.
- `getMyLocks()` TTL/null edge hardening unless it blocks smoke.
- Permanent Cloud Run `min-instances` changes.
- Queueing/waiting-room or large-event admission control.
- Re-provisioning or renaming the existing Memorystore Valkey instance.
