---
phase: 13-grapit-grabit-rename
verified: 2026-05-04
status: human_needed
score: automated evidence recorded; human UAT still open
overrides_applied: 0
backfill: true
human_needed: true
source_audit_gap: missing verification artifact
---

# Phase 13: Grapit to Grabit Rename Verification Report

**Backfill Note:** Backfilled from Phase 13 evidence; unchecked HUMAN-UAT and cleanup rows remain human_needed.
**Phase Goal:** 브랜드 `grapit` -> `grabit` rename, `heygrabit.com` cutover, and related infrastructure identifiers are recorded from Phase 13 artifacts.
**Verified:** 2026-05-04
**Status:** human_needed

## Goal Achievement

Phase 13 has strong automated/static and cutover evidence for the rename itself. The code/config inventory, user-facing copy scan, historical preservation guard, Cloud Run/LB cutover evidence, Sentry event routing, and OAuth callback configuration are documented in Phase 13 summaries and validation artifacts.

The phase remains `human_needed` because the operator-facing `13-HUMAN-UAT.md` checklist still has unchecked user-facing verification rows and the 7-day cleanup sign-off is not recorded. This report records evidence boundaries; it does not convert unchecked runtime evidence into completion claims.

### Automated/Static Evidence

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC-1 code/config rename inventory | VERIFIED | `13-01-SUMMARY.md` records D-10 inventory-driven rename, `scripts/audit-brand-rename.sh`, `ALL CHECKS PASSED`, and `pnpm -r test` green evidence for api/web suites. |
| SC-2 user-facing copy rename | VERIFIED | `13-02-SUMMARY.md` records `SC-2 gate green`, zero stale user-facing copy matches, D-07 legal email transition, and `D-15 negative audit` for deferred legal comments. |
| SC-3 infra/domain cutover evidence | PARTIAL | `13-03-SUMMARY.md` and `13-04-SUMMARY.md` record apex/api/Sentry/OAuth evidence: `heygrabit.com`, `www.heygrabit.com`, and `api.heygrabit.com` HTTP 200, Sentry api/web event separation, and OAuth callback SoT. User-facing UAT and cleanup sign-offs remain open in `13-HUMAN-UAT.md`. |
| SC-4 historical preservation | VERIFIED | `13-01-SUMMARY.md` and `13-02-SUMMARY.md` record historical preservation checks and active-phase-only planning artifact changes. |

**Score:** automated evidence recorded; human UAT still open

### Human-Needed Evidence

| Evidence Label | Status | Evidence Boundary |
|----------------|--------|-------------------|
| OAuth Kakao/Naver/Google E2E | HUMAN NEEDED | `13-UAT.md` records social login runtime checks as pass, but `13-HUMAN-UAT.md` still has unchecked Kakao, Naver, and Google checklist rows for operator sign-off. |
| password reset mailbox | HUMAN NEEDED | `13-UAT.md` records production password reset mailbox as an issue, and `13-HUMAN-UAT.md` keeps mailbox receipt unchecked. Later follow-up artifacts route this to email cutover work; this report does not convert it to Phase 13 completion. |
| SMS OTP device receipt | HUMAN NEEDED | `13-UAT.md` records SMS receipt with OTP verification issue, and `13-HUMAN-UAT.md` keeps real-device SMS receipt unchecked. Later follow-up artifacts route this to SMS/Valkey work. |
| Sentry production traffic | HUMAN NEEDED | `13-03-SUMMARY.md` records D-12 test event IDs for api/web projects, but `13-HUMAN-UAT.md` still has unchecked production traffic event confirmation. |
| 7-day cleanup | HUMAN NEEDED | `13-HUMAN-UAT.md` keeps the grace-period cleanup checklist and sign-off blank; `13-04-SUMMARY.md` lists cleanup as deferred. |

### 13-UAT.md issue carryover

`13-UAT.md` records the Phase 13 runtime sampling state as:

- total 12
- pass 8
- issues 4

The four issue rows are carried over as unresolved or routed evidence:

| UAT Truth | Status in this report | Carryover |
|-----------|-----------------------|-----------|
| Fresh local API `/api/v1/health` returns 200 | PARTIAL | `13-UAT.md` routes this to local health indicator follow-up. |
| Production password reset email reaches a real mailbox | HUMAN NEEDED | `13-UAT.md` routes this to Resend/transactional email cutover work. |
| Signup SMS OTP receipt and verification succeed on a real device | HUMAN NEEDED | `13-UAT.md` routes this to SMS OTP CROSSSLOT and real-device verification work. |
| Legal documents render at public `heygrabit.com` URLs | PARTIAL | `13-UAT.md` routes this to legal public page launch work. |

### Human Verification Required

### 1. User-Facing Rename/Cutover UAT

**Test:** Complete the unchecked `13-HUMAN-UAT.md` user-facing verification rows for Kakao, Naver, Google, password reset mailbox, SMS OTP device receipt, and Sentry production traffic.
**Expected:** Each row has operator-provided evidence and sign-off.
**Why human:** These checks depend on external OAuth providers, real mailboxes, real devices, and Sentry dashboard/operator observation.

### 2. 7-Day Cleanup Sign-Off

**Test:** Complete the grace-period cleanup in `13-HUMAN-UAT.md`, including old `grapit-*` resource cleanup and legacy OAuth callback removal.
**Expected:** Cleanup command evidence and sign-off are recorded after the grace period.
**Why human:** Cleanup requires production timing judgment and operator confirmation that rollback is no longer needed.

### Phase 21 Requirement Boundary

This Phase 13 report is a verification artifact backfill only. It does not mark AUTH-01 or R2-* requirements as complete, and it does not edit any Phase 13 SUMMARY requirement metadata.

False-claim guard: no Phase 21 requirement row is marked SATISFIED in this Phase 13 backfill.

### Gaps Summary

Phase 13 remains human_needed because 13-HUMAN-UAT.md contains unchecked user-facing verification and cleanup sign-off rows.

---

_Verified: 2026-05-04_
_Verifier: the agent (gsd-executor)_
