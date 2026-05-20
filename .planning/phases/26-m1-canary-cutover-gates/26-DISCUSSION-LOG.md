# Phase 26: M1 Canary + Cutover Gates - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20T03:16:08Z
**Phase:** 26-M1 Canary + Cutover Gates
**Areas discussed:** Gate failure and override, deploy and rollback, ticketing rehearsal/load/DR, monitoring/WAF/on-call, Toss cutover, production data safety, QR blockers

---

## Gate Failure And Operator Override

| Question | Options considered | Selected |
|----------|--------------------|----------|
| Phase 26 gate failure handling | Hard Block; Block Critical Only; Operator Override Friendly | Operator Override Friendly |
| Override level | 승인형 Override; Critical No-Go 유지; 완전 재량형 Override | 승인형 Override |
| Override record | Gate Ledger; Runbook Note; Incident-Style Record | Gate Ledger |
| Approver model | Owner 단일 승인; 2인 확인 필요; Gate별 승인자 분리 | Owner 단일 승인 |

**Notes:** Gate failure can proceed only as accepted risk with owner approval, compensating monitoring, and rollback trigger. Empty gates remain no-go.

---

## Cloud Run Canary And Rollback

| Question | Options considered | Selected |
|----------|--------------------|----------|
| Canary traffic step | 5% -> 25% -> 50% -> 100%; 5% -> 50% -> 100%; tag-only smoke -> 10% -> 50% -> 100% | Do not use Cloud Run traffic-split canary |
| No-canary deploy validation | Tagged revision smoke -> 100% promote; CI/CD green -> 100% direct deploy; deploy then rollback watch | CI/CD green -> 100% direct deploy |
| Post-deploy rollback trigger | Strict 15분 watch; Smoke only; Manual 판단 | Strict 15분 watch |
| Critical failure scope | User Path Critical; Availability Only; Financial Safety First | User Path Critical |

**Notes:** This intentionally supersedes the older canary wording in ROADMAP. Direct deploy requires strict live watch and immediate rollback on user-path critical failure.

---

## Load DR And Infrastructure Gates

| Question | Options considered | Selected |
|----------|--------------------|----------|
| k6 load gate | 10k baseline + 20k stress both required; 10k required and 20k accepted risk possible; synthetic load-lite | 10k baseline + 20k stress both required |
| Rehearsal scope | Ticketing Cutover Rehearsal; Queue + Booking Mutation; Full Live-Like Dress Rehearsal | Ticketing Cutover Rehearsal |
| Fixture isolation | Dedicated Test Event; Real Event Hidden Showtime; Local/Staging Only | Dedicated Test Event |
| DR/infra scope | Full Drill Evidence; Critical Drill + Config Evidence; Runbook-Only | Critical Drill + Config Evidence |

**Notes:** User clarified signup is already live via SNS, so Phase 26 should focus on June ticketing opening. Rehearsal covers queue, lock, prepare, payment confirm safe/test branch, QR, refund/cancel, and cleanup.

---

## On-call WAF And Monitoring

| Question | Options considered | Selected |
|----------|--------------------|----------|
| Monitoring gate | Sentry + Cloud Run Logs + Cloudflare + Business Metrics; Infra/App Monitoring; Minimal Watch | Sentry + Cloud Run Logs + Cloudflare + Business Metrics |
| WAF/rate-limit gate | Active Rule + Smoke Evidence; Rule Presence Only; App-Layer 우선 | Active Rule + Smoke Evidence |
| On-call/playbook gate | 1인 운영 Playbook + Dry Run; Playbook Only; Live War Room Checklist | 1인 운영 Playbook + Dry Run |

**Notes:** Business metrics are required because ticketing can fail while infrastructure still returns 200. WAF smoke should be low-volume and safe.

---

## Toss Live Cutover And First-24h Monitor

| Question | Options considered | Selected |
|----------|--------------------|----------|
| Toss live cutover | Two-Step Cutover; Single Switch; Test Key 유지 + Booking만 Open | Two-Step Cutover |
| `BOOKING_ENABLED=true` go/no-go | Gate Ledger All Accounted; Critical PASS 중심; Owner 판단 | Gate Ledger All Accounted |
| First-24h monitor cadence | First 2h 집중 + 24h 주기 점검; First 24h 고정 15분 점검; Alert 기반 점검 | First 2h 집중 + 24h 주기 점검 |
| Close/rollback trigger | Financial/Seat Safety Trigger; Hard Outage Only; Owner 판단 중심 | Financial/Seat Safety Trigger |

**Notes:** Key cutover and booking open are separated. First-24h watch prioritizes financial and seat safety.

---

## Production Data Safety And QR Blockers

| Question | Options considered | Selected |
|----------|--------------------|----------|
| Production data safety | Strict Test-Event Isolation; Test Event with planner cleanup discretion; 수동 확인 중심 | Strict Test-Event Isolation |
| QR scope | QR Issuance Blocker + Field Scan Contract; QR Issuance만 Phase 26; QR 현장 스캔까지 Phase 26 | QR Issuance Blocker + Field Scan Contract |
| Toss review/test-key interpretation | Test-key validation is enough after key swap; test-key rehearsal plus separate live smoke gate; defer payment planning until review | Test-key rehearsal plus separate live smoke gate |

**Notes:** Existing production signup/user data must not be damaged. Admin test-key payment currently completing without visible QR is a cutover blocker. Toss review is not complete; test-key PASS is not live PASS. The user-provided screenshot exposed a Toss test secret key, so rotation is required before final rehearsal evidence.

---

## the agent's Discretion

- Exact k6 script structure, query/dashboard format, and cleanup implementation are planner discretion under the safety constraints.
- Exact pgBouncer/HA/read replica handling is planner discretion, but undrilled infrastructure cannot be marked PASS.

## Deferred Ideas

- Full manager mobile QR scan/use-processing UI remains Phase 27.
- Field entry monitor, offline fallback sync, settlement export, and post-event retrospective remain Phase 27.
