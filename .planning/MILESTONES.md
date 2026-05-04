# Milestones

## v1.1 안정화 + 고도화 (Shipped: 2026-05-04)

**Delivered:** v1.0 이후 운영 안정화와 gap closure를 Phase 21까지 진행하고, 남은 operator/validation/hardening work는 v2.0 Fanmeet Launch의 실제 launch surface로 이월.

**Phases:** 18 tracked phase dirs through Phase 21 (including inserted 09.1 and 10.1)
**Plans:** 77 completed plans (+1 superseded 10.1 placeholder plan)
**Timeline:** 26일 (2026-04-09 ~ 2026-05-04) | **Commits:** 651 | **LOC:** 40,208 TypeScript/TSX
**Git range:** `9d96536..bad2df4`

**Key accomplishments:**

1. **인프라 안정화** — Upstash Redis 의존을 제거하고 ioredis + Google Memorystore for Valkey 기반으로 좌석 잠금, pub/sub, catalog cache 계약을 재정리
2. **스토리지/도메인 정합성** — Cloudflare R2 업로드/CORS/CDN evidence를 복구하고 브랜드 `grapit -> grabit`, heygrabit.com, transactional email cutover를 완료
3. **인증/커뮤니케이션 회귀 해소** — 소셜 로그인 refresh race, SMS OTP CROSSSLOT, password reset production API origin, email delivery cutover 문제를 phase/quick 루프로 해결
4. **운영자 경험 고도화** — admin dashboard, charting, 통계 캐시, legal public pages, local dev health parity를 v1.1 운영 품질 기준으로 편입
5. **좌석/결제 경계 강화** — reservation prepare/payment confirm이 client-provided seats만 신뢰하지 않고 active Valkey lock ownership을 강제
6. **검증 artifact 복구** — Phase 06/08/13/15 verification gaps와 AUTH-01/R2 traceability를 backfill하고, 남은 human-needed evidence는 v2.0 launch gate로 명시 이월

**Known deferred items at close:** 70 open artifacts acknowledged and deferred. See `.planning/STATE.md` `Deferred Items`.

**Scope closure decision:**

1. **v1.1 closes after Phase 21** — Phase 22-24 are no longer active v1.1 scope.
2. **Phase 22-24 deferred to v2.0** — operator UAT gates, Nyquist validation backfill, and operational hardening become v2.0 fanmeet preflight/quality gates.
3. **Known human-needed evidence remains explicit** — Phase 20 production smoke and launch-facing legal/SMS/email gates are not marked complete; they move forward as v2.0 launch readiness work.

**Archived:**

- [v1.1 ROADMAP](milestones/v1.1-ROADMAP.md)
- [v1.1 REQUIREMENTS](milestones/v1.1-REQUIREMENTS.md)
- [v1.1 MILESTONE AUDIT](milestones/v1.1-MILESTONE-AUDIT.md)

---

## v1.0 MVP (Shipped: 2026-04-09)

**Delivered:** 공연 탐색부터 좌석 선택, 결제, 예매 관리까지 전체 티켓 예매 플로우를 갖춘 MVP

**Phases:** 5 | **Plans:** 23 | **Tasks:** 45
**Timeline:** 13일 (2026-03-27 ~ 2026-04-09) | **Commits:** 331 | **LOC:** 23,547 TypeScript
**Git range:** `26ed1b4..9d96536`

**Key accomplishments:**

1. **인증 시스템** — 이메일/비밀번호 + 카카오/네이버/구글 소셜 OAuth, JWT + Refresh Token Rotation, family-based 탈취 감지
2. **공연 카탈로그** — 8개 장르 카테고리, tsvector+ILIKE 검색, 관리자 CRUD + R2 포스터 업로드
3. **SVG 좌석맵** — react-zoom-pan-pinch 기반 인터랙티브 좌석 선택, Redis SET NX 10분 잠금, Socket.IO 실시간 동기화
4. **결제 연동** — Toss Payments SDK v2 (카드/카카오페이/네이버페이/계좌이체), 서버사이드 금액 검증, 취소/환불
5. **프로덕션 준비** — 모바일 반응형 + 스켈레톤 UI + 한국어 에러 핸들링 + Sentry + Docker + CI/CD + Cloud Run

### Known Tech Debt (12 items)

- Password reset email: console.log stub (nodemailer 미설정)
- Terms dialog: placeholder 텍스트 (법률 검토 필요)
- seat-map-viewer.test.tsx: locked seat click 테스트 1건 회귀
- admin-booking-detail-modal.tsx: formatDateTime null 타입 경고
- Phase 4 VERIFICATION.md stale (SDK 설치 후 미갱신)
- Toss Payments E2E 테스트: human verification 필요

### Known Integration Issue

- `useShowtimes` hook의 `/api/v1/performances/:id/showtimes` 라우트 미존재 (enabled:false, 런타임 영향 없음)

---

## v2.0 Fanmeet Launch (Planned)

**Goal:** 2026-07-04 Girl Rules fanmeet을 위해 5개국 다국어, 글로벌 결제, 운영 콘솔, 대기열/부하/DR/on-call, QR 입장 운영을 구축한다.

**Starting scope:**

1. Phase 22 Operator UAT gates — SMS/legal/email operator checks as launch preflight
2. Phase 23 Nyquist validation backfill — v1.1 artifact gaps as v2.0 quality baseline
3. Phase 24 Operational hardening sweep — Valkey/R2/SMS/email/legal fragility cleanup as launch blockers
4. Phase 25+ fanmeet implementation — see [docs/v2.0-fanmeet-milestone-spec.md](../docs/v2.0-fanmeet-milestone-spec.md)

---
