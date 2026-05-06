# Roadmap: Grapit

## Milestones

- **v1.0 MVP** -- Phases 1-5, shipped 2026-04-09. Archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- **v1.1 안정화 + 고도화** -- Phases 6-21, shipped 2026-05-04. Archive: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- **v2.0 Fanmeet Launch** -- Phases 22-27, initialized 2026-05-04 from [docs/v2.0-fanmeet-milestone-spec.md](../docs/v2.0-fanmeet-milestone-spec.md), merged 2026-05-04 for GSD execution overhead control

## v2.0 Fanmeet Launch

**Goal:** 2026-07-04 Girl Rules fanmeet을 무사 진행하기 위해, 5개국 다국어 + 4종 결제 + 운영팀 풀 콘솔 + 1-2만 동접 흡수 체계를 구축하고 단일 critical incident 0건으로 운영한다.

**Phase numbering:** Continued from v1.1. v1.1 closed after Phase 21; v2.0 starts at Phase 22. Former Phases 22-43 are retained as merged sub-scope references inside six GSD execution phases.

**Coverage:** 6 phases, 39 requirements mapped, 0 unmapped.

| # | Phase | Goal | Requirements | Gate | Merged from |
|---|-------|------|--------------|------|-------------|
| 22 | Preflight Closure | v1.1에서 이월된 operator evidence, validation backfill, launch blocker hardening을 fanmeet 구현 전에 닫는다. | PREF-01, PREF-02, PREF-03 | Preflight | 22-24 |
| 23 | Launch Foundation | 기존 prod 보존, feature flags, 5개 로케일, translation/legal lock, auth/SMS (LINE excluded by D-13), consent/audit 기반을 만든다. | FLAG-01, FLAG-02, I18N-01, I18N-02, TRANS-01, TRANS-02, AUTH-01, AUTH-02, COMP-01, COMP-02 | M1 foundation | 25-29 |
| 24 | Traffic + Booking + Payment Core | 대기열/WAF/prewarm, 다층 좌석 선택, 결제 4종, 환불, QR 발급을 통합 booking core로 완성한다. | TRAF-01, TRAF-02, TRAF-03, BOOK-01, BOOK-02, BOOK-03, PAY-02, REFUND-01, REFUND-02, QR-01 | M1/M2 core | 30-32 |
| 25 | Admin Operations Console | 이벤트 등록, Q&A/FAQ/notice/CS, admin security, audit, seat operations를 운영 콘솔 단위로 묶어 완성한다. | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | M1 operations | 33-35 |
| 26 | M1 Canary + Cutover Gates | 2026-05-15 광고 오픈, k6, DR, on-call, WAF fine-tune, Toss live cutover를 순차 gate로 통과한다. | M1-01, LOAD-01, DR-01, INFRA-01, OPS-01, PAY-01, OPS-02 | M1/M2 cutover | 36-40 |
| 27 | Event Operations + Settlement | QR 현장 검표, field monitor, event-day playbook, settlement/export, retrospective를 행사 운영 단위로 닫는다. | QR-02, FIELD-01, OPS-03, POST-01, POST-02 | M3/M4 | 41-43 |

## Phase Details

### Phase 22: Preflight Closure

**Goal:** Phase 14 SMS OTP, Phase 15 email cutover, Phase 16 legal launch에서 남은 launch-facing evidence를 닫고, v1.1 validation gaps와 Valkey/R2/SMS/email/legal fragility를 fanmeet 구현 전 blocker 기준으로 정리한다.

**Requirements:** PREF-01, PREF-02, PREF-03

**Merged from:** 22 Operator UAT gates, 23 Nyquist validation backfill, 24 Operational hardening sweep

**Plans:** 6/6 plans complete

Plans:
**Wave 1**
- [x] 22-01-PLAN.md — Wave 1 evidence ledger and human UAT scaffold for PREF-01/PREF-02/PREF-03
- [x] 22-02-PLAN.md — Wave 1 v1.1 validation baseline/backfill for PREF-02
- [x] 22-03-PLAN.md — Wave 1 operational hardening register and Valkey smoke artifact-path fix for PREF-03

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 22-04-PLAN.md — Wave 2 SMS/email/legal human UAT closure for PREF-01

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 22-05-PLAN.md — Wave 3 final evidence aggregation and Phase 23 readiness verification for PREF-01/PREF-02/PREF-03

**Wave 4** *(gap closure after production UAT)*
- [x] 22-06-PLAN.md — Wave 4 SMS invalid international phone 500 gap closure for PREF-01

**Success criteria:**
1. SMS real-device, email reset-to-login, legal public/sign-off evidence가 `PASS`, `ACCEPTED_RISK`, `BLOCKER`로 분류된다.
2. v1.1 artifact gaps가 complete, accepted caveat, v2.0 blocker 중 하나로 정리되고 evidence 위치가 traceable하다.
3. Valkey/R2/SMS/email/legal fragile points가 concrete fix, accepted risk, launch blocker 중 하나로 닫힌다.
4. Phase 23 Launch Foundation이 unresolved v1.1 launch-readiness blocker 없이 시작 가능하다.
5. Production UAT에서 발견된 invalid-but-regex-valid SMS phone 500 gap은 로컬 코드/테스트 기준으로 닫히고, 배포 후 production rerun 필요성이 명시된다.

### Phase 23: Launch Foundation

**Goal:** 이후 fanmeet 기능이 의존하는 prod compatibility, flags, localization, auth, translation, legal lock, consent/audit 기반을 한 실행 단위로 구축한다.

**Requirements:** FLAG-01, FLAG-02, I18N-01, I18N-02, TRANS-01, TRANS-02, AUTH-01, AUTH-02, COMP-01, COMP-02

**Merged from:** 25 Prod compatibility + flags, 26 i18n routing + locale foundation, 27 Translation workflow + legal lock, 28 email verification + 5-country SMS (LINE excluded by Phase 23 D-13), 29 Multinational consent + audit

**Plans:** 12/17 plans executed

Plans:
**Wave 1**
- [x] 23-01-PLAN.md — Reconcile stale LINE scope per D-13 and create shared flag/locale/consent contracts

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 23-02-PLAN.md — Expand Drizzle schema and run the blocking Phase 23 migration apply gate
- [x] 23-03-PLAN.md — Enforce runtime booking feature flags on API booking/payment creation paths

**Wave 3** *(blocked on foundation contracts/schema)*
- [x] 23-04-PLAN.md — Implement five-locale routing, sitemap, and locale suggestion UI
- [x] 23-05-PLAN.md — Implement backend translation workflow, DeepL adapter, and legal machine-translation guard
- [x] 23-06-PLAN.md — Implement email verification, three-device refresh-family policy, SMS validation, and LINE absence gates (D-13 excluded)
- [x] 23-14-PLAN.md — Implement KST/KRW formatting helpers and wire them into public performance detail
- [x] 23-15-PLAN.md — Localize PhoneInput labels, wire auth/OTP caller locale, and define the launch copy manifest
- [x] 23-16-PLAN.md — Add locale switch/suggestion UI, wire visible shell/header/menu surfaces, and persist logged-in locale preference
- [x] 23-17-PLAN.md — Add English legal canonical fallback files and lock legal content locales

**Wave 4** *(blocked on schema, i18n, translation, legal content, and auth foundations)*
- [x] 23-07-PLAN.md — Implement itemized consent capture and masked audit query API
- [x] 23-08-PLAN.md — Wire runtime booking-disabled UI without build-time flag freezing
- [ ] 23-09-PLAN.md — Add localized auth, email verification, SMS OTP, and auth status UI copy
- [ ] 23-13-PLAN.md — Wire legal English fallback labels and footer compliance surfaces

**Wave 5** *(blocked on API/i18n foundations)*
- [ ] 23-10-PLAN.md — Replace boolean signup consent with itemized UI, submit payload/API contract wiring, and no-LINE auth surface (D-13 excluded)
- [ ] 23-12-PLAN.md — Build masked admin consent audit query UI

**Wave 6** *(blocked on public performance detail and admin hook/sidebar file ownership)*
- [ ] 23-11-PLAN.md — Build admin translation workflow and wire automatic translation label into public performance detail

**Success criteria:**
1. Expand-only migrations, canary policy, and shared feature flag helper preserve existing production users, reservations, sessions, and Korean root URLs.
2. Korean routes remain prefixless and foreign routes use `/en`, `/th`, `/zh-CN`, `/zh-TW` with hreflang, sitemap, locale preference, time/currency formatting, and PhoneInput localization.
3. Korean source content can generate reviewed translations, while legal notices stay Korean/English manual and auto-translation is blocked for legal copy.
4. Kakao, Naver, Google, email verification, 5-country SMS OTP, and three-device refresh token policy are covered by tests and launch evidence; LINE remains excluded from Phase 23 per D-13.
5. PIPA, cross-border transfer, PDPA/PIPL English notice, under-14, marketing consent, audit log, and footer legal surfaces are captured.
6. `BOOKING_ENABLED=false` blocks API seat locks and payment attempts, not only UI buttons.

### Phase 24: Traffic + Booking + Payment Core

**Goal:** 광고/티켓팅 트래픽 흡수부터 좌석 선택, 결제, 환불, QR 발급까지 사용자의 core booking path를 test-key 기준으로 완성한다.

**Requirements:** TRAF-01, TRAF-02, TRAF-03, BOOK-01, BOOK-02, BOOK-03, PAY-02, REFUND-01, REFUND-02, QR-01

**Merged from:** 30 Queue + WAF + prewarm, 31 Seat selection refinements, 32 Payment + refund + QR issuance

**Success criteria:**
1. Queue admission uses Valkey Sorted Set and batch admission with position, ETA, and remaining-seat updates; booking APIs require valid admission.
2. WAF/rate-limit/bot/macro rules and Cloud Scheduler prewarm runbook are documented and verified.
3. Multi-floor SVG upload/render/switching works on desktop and mobile, with lock/countdown/expiry/payment-failure return behavior verified against Valkey.
4. Event-specific max tickets, cancellation/change policy, and manual seat operation controls are configurable.
5. Domestic Toss, overseas card, Alipay+, and truemoney paths work with proper disclaimers.
6. Refund preview, Toss refund request, refund state machine, random cancelled-seat holding, QR JWT/HMAC issuance, and D-1 QR email scheduling work.

### Phase 25: Admin Operations Console

**Goal:** 운영자가 M1 광고 오픈과 이후 티켓팅/CS 운영을 처리할 수 있는 admin console, RBAC, audit, seat operations를 완성한다.

**Requirements:** ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04

**Merged from:** 33 Event registration console, 34 Q&A/FAQ/notice/CS, 35 Admin security + operations

**Success criteria:**
1. Event form supports multilingual tabs, cast cards, venue/transport, multi-SVG, price tiers, sale settings, review, approval, and publish states.
2. Operator/reviewer/approver/finance RBAC is enforced and tested.
3. Q&A 12 categories, FAQ, notices, CS 10 categories, escalation rules, SLA, signup failure lookup, and refund dispute retention are available.
4. Admin MFA, IP allowlist, and sensitive action audit logs are enforced.
5. Banners, reservation CSV filters, seat disable/reactivate, immediate cancelled-seat opening, and seat history work.

### Phase 26: M1 Canary + Cutover Gates

**Goal:** M1 광고 오픈과 M2 결제 cutover를 gate-driven으로 진행한다. 부하, DR, on-call, WAF, live payment 조건 중 하나라도 실패하면 cutover를 막는다.

**Requirements:** M1-01, LOAD-01, DR-01, INFRA-01, OPS-01, PAY-01, OPS-02

**Merged from:** 36 M1 integration + canary, 37 k6 load gate, 38 DR + DB capacity gate, 39 On-call + alert gate, 40 Live payment cutover

**Success criteria:**
1. Full event detail page is visible in five locales with payment disabled, and signup/consent/admin content/queue/WAF/prewarm/booking-disabled E2E pass.
2. Cloud Run canary advances through agreed traffic steps with rollback ready.
3. k6 10k baseline and 20k stress scenarios pass agreed p95/error-rate targets or cutover is explicitly blocked.
4. Cloud SQL PITR, Valkey failover, Cloud Run rollback, pgBouncer, HA/read replica, and per-instance DB pool sizing are rehearsed.
5. PG, Valkey, DB, CDN, latency, error-rate, payment-failure playbooks and Sentry alert dry-runs are complete.
6. Toss live keys and `BOOKING_ENABLED=true` are applied only after gates pass; post-cutover smoke and first-24-hour monitoring cover booking, payment, QR, refund, concurrency, sellout, and payment failures.

### Phase 27: Event Operations + Settlement

**Goal:** 2026-07-04 행사 당일 현장 입장 운영과 행사 후 settlement/retrospective까지 v2.0 launch evidence로 닫는다.

**Requirements:** QR-02, FIELD-01, OPS-03, POST-01, POST-02

**Merged from:** 41 QR verification + field monitor, 42 Event-day playbooks, 43 Settlement + retrospective

**Success criteria:**
1. QR scanner validates normal, duplicate, tampered, refunded, and offline cases.
2. Entry monitor shows entered, not-entered, entry rate, duplicate scan, and abnormal access alerts.
3. Offline fallback sync is rehearsed with stale and recovered connectivity cases.
4. Forced refund, weather, facility, cast issue, on-site refund, and exchange scenarios are documented with console actions and external contacts.
5. Entry status, no-show reservation list, settlement, and accounting exports are generated.
6. Retrospective records incidents, non-incidents, improvements, next-event carry-forward items, and v2.0 completion evidence.

## Progress

| Milestone | Phase Range | Requirements | Plans Complete | Status |
|-----------|-------------|--------------|----------------|--------|
| v1.0 MVP | 1-5 | archived | 23/23 | Shipped |
| v1.1 안정화 + 고도화 | 6-21 | archived | 77/77 | Shipped |
| v2.0 Fanmeet Launch | 22-27 | 39/39 mapped | 5/5 | Ready for Phase 23 planning |

## Backlog

### Phase 999.1: 홈 HOT/신규 오픈 "더보기" 전 장르 라우트 신설

**Goal:** Promote later if product decides HOT/new-open sections should link to an all-genre listing instead of musical-only routes.
**Requirements:** TBD
