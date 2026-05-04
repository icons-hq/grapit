# Roadmap: Grapit

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-5 (shipped 2026-04-09)
- ✅ **v1.1 안정화 + 고도화** -- Phases 6-21 (shipped 2026-05-04; Phase 22-24 deferred to v2.0)
- 🧭 **v2.0 Fanmeet Launch** -- Phase 22+ (planned; starts with deferred operator/validation/hardening gates)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) -- SHIPPED 2026-04-09</summary>

- [x] Phase 1: Foundation + Auth (5/5 plans) -- completed 2026-03-30
- [x] Phase 2: Catalog + Admin (6/6 plans) -- completed 2026-03-31
- [x] Phase 3: Seat Map + Real-Time (4/4 plans) -- completed 2026-04-02
- [x] Phase 4: Booking + Payment (3/3 plans) -- completed 2026-04-07
- [x] Phase 5: Polish + Launch (5/5 plans) -- completed 2026-04-08

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

- ✅ **v1.1 안정화 + 고도화** -- Phases 6-21, 77 completed plans (+1 superseded placeholder), shipped 2026-05-04. Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md); requirements archive: [milestones/v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md).

## v2.0 Fanmeet Launch Preflight

The following phases were originally planned as v1.1 gap-closure work. They are now deferred into the v2.0 Fanmeet Launch milestone so operator verification, validation backfill, and operational hardening are handled against the real fanmeet launch surface instead of extending v1.1.

### Phase 22: Operator UAT gates

**Goal:** Phase 14 SMS OTP, Phase 15 email cutover, Phase 16 legal launch에 남은 실기기/외부 sign-off/operator smoke gate를 v2.0 fanmeet launch preflight로 완료한다.
**Requirements:** SMS-02, CUTOVER-05, D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15
**Depends on:** v2.0 Fanmeet Launch milestone initialization
**Plans:** 0 plans

Plans:
- [ ] TBD (run `/gsd-plan-phase 22`)

### Phase 23: Nyquist validation backfill

**Goal:** Audit가 partial/missing으로 분류한 phase validation artifacts를 보강하여 v2.0 launch-readiness baseline에서 v1.1 coverage gaps를 명확히 닫는다.
**Requirements:** R2-01, R2-02, R2-03, R2-04, DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06
**Depends on:** Phase 22
**Plans:** 0 plans

Plans:
- [ ] TBD (run `/gsd-plan-phase 23`)

### Phase 24: Operational hardening sweep

**Goal:** Audit tech-debt에 남은 fragile 운영 항목을 fanmeet launch blocker 관점에서 정리하여 v2.0 re-audit 때 반복 gap으로 남지 않게 한다.
**Requirements:** VALK-03, VALK-05, R2-02, SMS-02, CUTOVER-05, SC-4
**Depends on:** Phase 23
**Plans:** 0 plans

Plans:
- [ ] TBD (run `/gsd-plan-phase 24`)

## Progress

**Execution Order:**
v1.1 executed through Phase 21 and is closed. v2.0 resumes with deferred Phase 22 -> 23 -> 24 before fanmeet implementation phases.

| Milestone | Phase Range | Plans Complete | Status | Completed |
|-----------|-------------|----------------|--------|-----------|
| v1.0 MVP | 1-5 | 23/23 | Shipped | 2026-04-09 |
| v1.1 안정화 + 고도화 | 6-21 | 77/77 (+1 superseded placeholder) | Shipped | 2026-05-04 |
| v2.0 Fanmeet Launch Preflight | 22-24 | 0/0 | Planned | - |

## Backlog

### Phase 999.1: 홈 HOT/신규 오픈 "더보기" 전 장르 라우트 신설 (BACKLOG)

**Goal:** [Captured for future planning]
**Requirements:** TBD
**Plans:** 0 plans

**Context (from Phase 12 code review IN-06):**
- `apps/web/components/home/hot-section.tsx:22-27` 및 `new-section.tsx:18-23`의 "더보기" 링크가 `/genre/musical?sort=popular|latest`로 musical 장르에 하드코딩되어 있음.
- HOT / 신규 오픈 섹션은 전 장르 큐레이션이므로 제품 의도와 불일치. 코드만으로는 의도 여부를 확정할 수 없어 Info 레벨 finding으로 남음.
- 제품 결정 필요: (A) 전 장르 대상 `/performances?sort=popular|latest` 같은 통합 목록 라우트 신설 -> 링크 교체, (B) MVP 주력이 musical인 의도적 제약 -> 주석으로만 명시.

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)
