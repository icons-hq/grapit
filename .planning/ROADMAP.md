# Roadmap: Grapit

## Milestones

- **v1.0 MVP** -- Phases 1-5, shipped 2026-04-09. Archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- **v1.1 안정화 + 고도화** -- Phases 6-21, shipped 2026-05-04. Archive: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- **v2.0 Fanmeet Launch** -- Phases 22-43, initialized 2026-05-04 from [docs/v2.0-fanmeet-milestone-spec.md](../docs/v2.0-fanmeet-milestone-spec.md)

## v2.0 Fanmeet Launch

**Goal:** 2026-07-04 Girl Rules fanmeet을 무사 진행하기 위해, 5개국 다국어 + 4종 결제 + 운영팀 풀 콘솔 + 1-2만 동접 흡수 체계를 구축하고 단일 critical incident 0건으로 운영한다.

**Phase numbering:** Continued from v1.1. v1.1 closed after Phase 21; v2.0 starts at Phase 22.

**Coverage:** 22 phases, 39 requirements mapped, 0 unmapped.

| # | Phase | Goal | Requirements | Gate |
|---|-------|------|--------------|------|
| 22 | Operator UAT gates | SMS/legal/email launch-facing human/operator evidence를 닫는다. | PREF-01 | Preflight |
| 23 | Nyquist validation backfill | v1.1 artifact gaps를 launch-readiness baseline으로 정리한다. | PREF-02 | Preflight |
| 24 | Operational hardening sweep | Valkey/R2/SMS/email/legal fragility를 launch blocker 관점에서 해소한다. | PREF-03 | Preflight |
| 25 | Prod compatibility + flags | 기존 prod를 보존하고 booking-disabled/canary/feature flag 기반을 만든다. | FLAG-01, FLAG-02 | SP-0 |
| 26 | i18n routing + locale foundation | 5개 로케일 라우팅, PhoneInput, SEO, 메시지 기반을 구축한다. | I18N-01, I18N-02 | M1 |
| 27 | Translation workflow + legal lock | AI 번역 검수 큐와 법적 고지 수동 lock을 만든다. | TRANS-01, TRANS-02 | M1 |
| 28 | LINE login + 5-country SMS | LINE OAuth, 5종 가입, 이메일 검증, 3대 세션 정책을 확장한다. | AUTH-01, AUTH-02 | M1 |
| 29 | Multinational consent + audit | PIPA/국외이전/PDPA/PIPL 동의와 audit log를 구축한다. | COMP-01, COMP-02 | M1 |
| 30 | Queue + WAF + prewarm | 대기열, rate limit, bot/macro 차단, Cloud Run prewarm을 만든다. | TRAF-01, TRAF-02, TRAF-03 | M1 |
| 31 | Seat selection refinements | 다층 SVG, lock/countdown, event policy, seat re-open controls 기반을 만든다. | BOOK-01, BOOK-02, BOOK-03 | M1 |
| 32 | Payment + refund + QR issuance | 4종 결제, 환불 머신, random holding, QR 발급을 완성한다. | PAY-02, REFUND-01, REFUND-02, QR-01 | M1 |
| 33 | Event registration console | 다국어 이벤트 등록, 출연자, SVG, 가격, 판매 설정, 승인 RBAC를 만든다. | ADMIN-01 | M1 |
| 34 | Q&A/FAQ/notice/CS | Q&A, FAQ, 공지, CS, escalation, SLA를 만든다. | ADMIN-02 | M1 |
| 35 | Admin security + operations | MFA/IP allowlist, audit, banners, CSV, seat operations를 만든다. | ADMIN-03, ADMIN-04 | M1 |
| 36 | M1 integration + canary | 2026-05-15 광고 오픈 전 통합 테스트와 canary deploy를 통과한다. | M1-01 | M1 gate |
| 37 | k6 load gate | 10k baseline + 20k stress 부하 테스트를 통과한다. | LOAD-01 | Cutover gate |
| 38 | DR + DB capacity gate | PITR/Valkey/rollback 훈련과 pgBouncer/HA/read replica connection 검증을 통과한다. | DR-01, INFRA-01 | Cutover gate |
| 39 | On-call + alert gate | on-call playbook, Sentry alerts, WAF fine-tune dry-run을 통과한다. | OPS-01 | Cutover gate |
| 40 | Live payment cutover | gates PASS 후 Toss live keys와 `BOOKING_ENABLED=true`로 티켓팅을 연다. | PAY-01, OPS-02 | M2 |
| 41 | QR verification + field monitor | QR 검증, 중복/위변조/오프라인 fallback, 입장 모니터링을 만든다. | QR-02, FIELD-01 | M3 |
| 42 | Event-day playbooks | 강제 환불, 우천/시설/배우 사정, 현장 환불/교환 절차를 준비한다. | OPS-03 | M3 |
| 43 | Settlement + retrospective | 입장/미입장/정산 export와 회고를 완료한다. | POST-01, POST-02 | M4 |

## Phase Details

### Phase 22: Operator UAT gates

**Goal:** Phase 14 SMS OTP, Phase 15 email cutover, Phase 16 legal launch에 남은 실기기/외부 sign-off/operator smoke gate를 v2.0 preflight로 완료한다.  
**Requirements:** PREF-01  
**Success criteria:**
1. SMS real-device verification evidence is attached.
2. Email delivery/reset evidence is operator-approved or caveated with explicit launch risk.
3. Legal public pages and footer/dialog sign-off evidence is recorded.

### Phase 23: Nyquist validation backfill

**Goal:** v1.1 validation artifacts marked partial/missing are backfilled into a launch-readiness baseline.  
**Requirements:** PREF-02  
**Success criteria:**
1. v1.1 artifact gaps are classified as complete, accepted caveat, or v2.0 blocker.
2. No launch-facing requirement remains unmapped to an evidence location.
3. Backfill results update traceability without marking human-needed work as automated proof.

### Phase 24: Operational hardening sweep

**Goal:** Existing operational fragility is resolved before fanmeet feature work expands the same surfaces.  
**Requirements:** PREF-03  
**Success criteria:**
1. Valkey/R2/SMS/email/legal fragile points have concrete fixes or explicit launch-blocker decisions.
2. Pre-existing debug sessions are either closed or carried as v2.0 risk items.
3. Phase 25 can start without unresolved v1.1 launch-readiness blockers.

### Phase 25: Prod compatibility + flags

**Goal:** Build the compatibility layer every later phase depends on.  
**Requirements:** FLAG-01, FLAG-02  
**Success criteria:**
1. Expand-only migrations preserve existing users, reservations, sessions, and Korean root URLs.
2. Shared feature flag helper exposes booking/language/provider flags to web and API.
3. `BOOKING_ENABLED=false` blocks API seat locks and payment attempts, not only UI buttons.
4. Canary deploy and Cloud Run min/max policy are documented and smoke-tested.

### Phase 26: i18n routing + locale foundation

**Goal:** Establish the five-locale routing and localized UI infrastructure.  
**Requirements:** I18N-01, I18N-02  
**Success criteria:**
1. Korean routes remain prefixless and foreign routes use `/en`, `/th`, `/zh-CN`, `/zh-TW`.
2. hreflang, sitemap, locale switch, locale preference, time/currency formatting, and transactional template scaffolds exist.
3. `SEED-001` PhoneInput localization and phone verification copy are included.

### Phase 27: Translation workflow + legal lock

**Goal:** Let operators safely generate and review multilingual content.  
**Requirements:** TRANS-01, TRANS-02  
**Success criteria:**
1. Korean source edits generate translated drafts for four target locales.
2. Review/publish workflow controls which translations are visible.
3. Automatic-translation labels display where required.
4. Legal notices accept only Korean/English manual content and block auto-translation.

### Phase 28: LINE login + 5-country SMS

**Goal:** Expand account creation for the fanmeet audience.  
**Requirements:** AUTH-01, AUTH-02  
**Success criteria:**
1. Kakao, Naver, Google, LINE, and email signup/login paths work in test coverage.
2. Email verification expires after 30 minutes and supports immediate resend.
3. 5-country SMS OTP paths are verified with cost/rejection monitoring hooks.
4. Refresh token family enforces the three-device policy.

### Phase 29: Multinational consent + audit

**Goal:** Capture consent evidence for the launch trade-offs.  
**Requirements:** COMP-01, COMP-02  
**Success criteria:**
1. Signup captures required PIPA, cross-border transfer, PDPA/PIPL English notice, under-14, and marketing choices.
2. Consent audit logs include item, version, language, timestamp, IP, and user.
3. Footer exposes business, commerce registration, refund account, DPO/contact, and opt-out surfaces.

### Phase 30: Queue + WAF + prewarm

**Goal:** Absorb advertising and ticketing traffic before payment opens.  
**Requirements:** TRAF-01, TRAF-02, TRAF-03  
**Success criteria:**
1. Queue admission uses Valkey Sorted Set and batch admission with position/ETA/remaining-seat updates.
2. Booking APIs require valid admission and cannot be bypassed by direct calls.
3. WAF/rate-limit/bot/macro rules are documented and verified.
4. Cloud Scheduler prewarm raises and lowers Cloud Run min instances according to runbook.

### Phase 31: Seat selection refinements

**Goal:** Make the booking selection surface fanmeet-ready.  
**Requirements:** BOOK-01, BOOK-02, BOOK-03  
**Success criteria:**
1. Multi-floor SVG upload/render/switching works on desktop and mobile.
2. Seat locks, countdown, expiry, and payment failure return behavior are verified against Valkey.
3. Event-specific max tickets, cancellation/change policy, and manual seat operation controls are configurable.

### Phase 32: Payment + refund + QR issuance

**Goal:** Complete the full test-key payment and post-payment flow before cutover.  
**Requirements:** PAY-02, REFUND-01, REFUND-02, QR-01  
**Success criteria:**
1. Domestic Toss, overseas card, Alipay+, and truemoney paths are exercised with proper disclaimers.
2. Refund preview, Toss refund request, refund state machine, and delayed seat release work.
3. Cancelled seats reopen after random 1-10 minute holding unless manually opened.
4. Successful booking issues QR JWT/HMAC and schedules D-1 email.

### Phase 33: Event registration console

**Goal:** Give operators the content authoring controls needed for M1.  
**Requirements:** ADMIN-01  
**Success criteria:**
1. Event form supports multilingual tabs, cast cards, venue/transport, multi-SVG, price tiers, and sale settings.
2. Operator/reviewer/approver/finance RBAC is enforced.
3. Draft, review, approval, and publish states are covered by tests.

### Phase 34: Q&A/FAQ/notice/CS

**Goal:** Prepare support operations before global users arrive.  
**Requirements:** ADMIN-02  
**Success criteria:**
1. Q&A 12 categories, FAQ, notices, and CS 10 categories are manageable.
2. CS SLA and escalation rules highlight urgent payment/refund/fraud cases.
3. Signup failure lookup and refund dispute conversation retention are available to operators.

### Phase 35: Admin security + operations

**Goal:** Harden admin access and launch operations controls.  
**Requirements:** ADMIN-03, ADMIN-04  
**Success criteria:**
1. Admin MFA and IP allowlist are enforced.
2. Sensitive admin actions write audit logs.
3. Banners, reservation CSV filters, seat disable/reactivate, immediate cancelled-seat opening, and seat history work.

### Phase 36: M1 integration + canary

**Goal:** Open advertising and signup safely on 2026-05-15.  
**Requirements:** M1-01  
**Success criteria:**
1. Full event detail page is visible in five locales with payment disabled.
2. Signup, consent, admin content, queue/WAF/prewarm, and booking-disabled E2E pass.
3. Cloud Run canary advances through the agreed traffic steps with rollback ready.

### Phase 37: k6 load gate

**Goal:** Prove the system can absorb ticketing load before enabling payment.  
**Requirements:** LOAD-01  
**Success criteria:**
1. 10k baseline scenario passes p95 and error-rate targets.
2. 20k stress scenario completes with documented bottlenecks.
3. Worst-case sold-out lock/payment/refund cycle is included in the report.

### Phase 38: DR + DB capacity gate

**Goal:** Prove rollback and database capacity before live ticketing.  
**Requirements:** DR-01, INFRA-01  
**Success criteria:**
1. Cloud SQL PITR restore drill is executed and timed.
2. Valkey failover and Cloud Run rollback runbooks are executed.
3. pgBouncer, HA/read replica, and per-instance pool sizing survive load rehearsal.

### Phase 39: On-call + alert gate

**Goal:** Make incident response operational before cutover.  
**Requirements:** OPS-01  
**Success criteria:**
1. PG, Valkey, DB, CDN, latency, error-rate, and payment-failure playbooks exist.
2. Sentry alert dry-runs route to the expected responders.
3. WAF fine-tune evidence is recorded after load rehearsal.

### Phase 40: Live payment cutover

**Goal:** Enable real ticketing only after all cutover gates pass.  
**Requirements:** PAY-01, OPS-02  
**Success criteria:**
1. Toss live keys and `BOOKING_ENABLED=true` are applied through the cutover runbook within five minutes.
2. Post-cutover smoke confirms booking, payment, QR issuance, refund, and monitoring.
3. First 24 hours track concurrency, sellout, payment failures, and refund automation health.

### Phase 41: QR verification + field monitor

**Goal:** Prepare field entry operations before 2026-07-04.  
**Requirements:** QR-02, FIELD-01  
**Success criteria:**
1. QR scanner validates normal, duplicate, tampered, refunded, and offline cases.
2. Entry monitor shows entered, not-entered, entry rate, duplicate scan, and abnormal access alerts.
3. Offline fallback sync is rehearsed with stale and recovered connectivity cases.

### Phase 42: Event-day playbooks

**Goal:** Make event-day decisions executable under pressure.  
**Requirements:** OPS-03  
**Success criteria:**
1. Forced refund procedure covers operator fault and compensation policy.
2. Weather, facility, cast issue, on-site refund, and exchange scenarios are documented.
3. Operators know which console actions and external contacts to use for each scenario.

### Phase 43: Settlement + retrospective

**Goal:** Close the fanmeet with exportable evidence and reusable learnings.  
**Requirements:** POST-01, POST-02  
**Success criteria:**
1. Entry status, no-show reservation list, settlement, and accounting exports are generated.
2. Retrospective records incidents, non-incidents, improvements, and next-event carry-forward items.
3. v2.0 completion evidence is committed for future milestone planning.

## Progress

| Milestone | Phase Range | Requirements | Plans Complete | Status |
|-----------|-------------|--------------|----------------|--------|
| v1.0 MVP | 1-5 | archived | 23/23 | Shipped |
| v1.1 안정화 + 고도화 | 6-21 | archived | 77/77 | Shipped |
| v2.0 Fanmeet Launch | 22-43 | 39/39 mapped | 0/0 | Ready for Phase 22 planning |

## Backlog

### Phase 999.1: 홈 HOT/신규 오픈 "더보기" 전 장르 라우트 신설

**Goal:** Promote later if product decides HOT/new-open sections should link to an all-genre listing instead of musical-only routes.
**Requirements:** TBD
**Plans:** 0 plans
