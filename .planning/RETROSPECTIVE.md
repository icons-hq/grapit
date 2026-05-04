# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-09
**Phases:** 5 | **Plans:** 23 | **Tasks:** 45

### What Was Built
- 이메일/소셜 OAuth 인증 시스템 (JWT + Refresh Token Rotation, family-based 탈취 감지)
- 8개 장르 카탈로그 + tsvector 검색 + 관리자 CRUD + R2 포스터 업로드
- SVG 좌석맵 (react-zoom-pan-pinch) + Redis SET NX 10분 잠금 + Socket.IO 실시간 동기화
- Toss Payments 결제 (카드/카카오페이/네이버페이/계좌이체) + 예매 확인/취소/환불
- 모바일 반응형 + 스켈레톤 UI + 한국어 에러 핸들링 + Sentry + CI/CD + Cloud Run

### What Worked
- **Phase 격리 전략:** 좌석맵(Phase 3)과 결제(Phase 4)를 분리하여 고위험 영역을 각각 집중 처리 — 두 phase 모두 깔끔하게 완료
- **Drizzle ORM 선택:** TypeORM/Prisma 대신 Drizzle 채택으로 빠른 cold start + zod 스키마 통합 + SQL-first 쿼리 제어
- **shadcn/ui 디자인 시스템:** Phase 1에서 기반을 잡아두니 이후 phase에서 UI 생산성이 높았음
- **Quick task 패턴:** 25건의 빠른 버그픽스/UI 개선을 phase 작업과 분리하여 관리 — 메인 플로우를 방해하지 않고 품질 개선
- **코드리뷰 → Quick task 루프:** PR 코드리뷰에서 발견된 이슈를 quick task로 즉시 수정 — 기술 부채가 쌓이지 않음

### What Was Inefficient
- **REQUIREMENTS.md 체크박스 미갱신:** Phase 2~5에서 체크박스를 갱신하지 않아 감사 시점에 17건 stale — 각 phase 완료 시 즉시 갱신했어야 함
- **VERIFICATION.md 시점 불일치:** Phase 4 검증이 SDK 설치 전에 실행되어 stale 결과 기록 — 검증은 최종 상태에서 실행해야 함
- **Phase 1 SUMMARY 컨벤션 미확립:** one_liner 필드 등 SUMMARY 포맷이 Phase 1에서 정립되지 않아 이후 추출이 어려웠음
- **테스트 유지보수:** Phase 3에서 아키텍처 변경 후 기존 테스트 1건을 갱신하지 않아 회귀 발생

### Patterns Established
- pnpm + Turborepo 모노레포 (web/api/shared 3 workspace)
- Drizzle ORM + drizzle-zod로 DB 스키마 → zod validation → TypeScript 타입 단일 소스
- LayoutShell 클라이언트 컴포넌트로 /admin, /booking 등 라우트별 조건부 레이아웃
- Zustand 메모리 전용 access token + httpOnly refresh cookie (OWASP 패턴)
- Redis 이원화: Upstash HTTP (key/value) + ioredis TCP (pub/sub)

### Key Lessons
1. **Requirements 체크박스는 phase 완료 시 즉시 갱신** — 감사 단계에서 일괄 갱신은 17건 stale을 만듦
2. **검증(VERIFICATION)은 최종 상태에서 실행** — 중간 단계에서의 검증은 stale 결과를 생산
3. **고위험 영역은 phase를 분리** — 좌석맵과 결제를 섞지 않은 것이 정확한 판단이었음
4. **SUMMARY 컨벤션을 Phase 1부터 확립** — one_liner, requirements-completed 등 메타데이터 포맷을 초기에 정해야 함
5. **Quick task 패턴은 효과적** — 25건의 버그픽스를 메인 플로우와 분리 관리한 것이 생산성에 기여

### Cost Observations
- Model mix: 주로 opus + sonnet 병행
- Sessions: ~15 세션 (13일간)
- Notable: Phase 2는 6 plans을 ~14분에 완료 (plan당 ~2분) — 카탈로그 CRUD는 패턴화되어 빠름

---

## Milestone: v1.1 — 안정화 + 고도화

**Shipped:** 2026-05-04
**Phases:** 18 tracked phase dirs | **Plans:** 77 completed (+1 superseded placeholder)

### What Was Built
- Valkey migration, R2 production evidence, SMS v3 OTP, admin dashboard, UX modernization, Grabit brand/domain cutover, legal public pages, and email cutover were brought into the product baseline.
- Password reset production API origin, seat lock ownership, Valkey runtime contract, and missing verification artifacts were addressed as explicit audit gap closures.
- Phase 22-24 work was moved out of v1.1 into v2.0 Fanmeet Launch so remaining human/operator evidence is tested against the real launch surface.

### What Worked
- **Audit-to-gap-closure loop:** The v1.1 audit surfaced real integration breaks, and Phase 18-21 closed the highest-risk ones without expanding the milestone indefinitely.
- **Quick task hotfix lane:** Production issues such as social login race, R2 CORS, SMS OTP expiry, and deploy secret drift were handled quickly without derailing planned phases.
- **Verification backfill discipline:** Missing `VERIFICATION.md` files were repaired without fabricating satisfied evidence; `human_needed` stayed visible where evidence was not actually collected.

### What Was Inefficient
- **Artifact drift stayed expensive:** Many requirements were implemented but not reflected in SUMMARY frontmatter, REQUIREMENTS status, or phase verification artifacts until audit time.
- **Scope boundary was too late:** Phase 22-24 were still modeled as v1.1 until the end, making roadmap analysis report incomplete phases even after the intended closure point.
- **Human/operator checks accumulated:** SMS real-device, legal sign-off, mailbox observation, and Valkey production smoke evidence should have been promoted earlier as explicit launch gates.

### Patterns Established
- Treat production-facing human checks as launch preflight phases instead of burying them in implementation phases.
- Keep `human_needed` as a first-class status when evidence is absent; do not convert it to complete for archive neatness.
- Use gap-closure phases for real integration breaks, and move lower-confidence operational hardening into the next milestone when it depends on launch context.

### Key Lessons
1. Requirements and verification metadata need to be updated at phase completion, not during milestone close.
2. A milestone close can accept known gaps only when they are named, counted, and routed to the next milestone.
3. Runtime contracts for Valkey/R2/SMS/email need both automated tests and operator evidence; one does not replace the other.
4. Phase archives keep the active ROADMAP small, but the archive must preserve caveats instead of rewriting history.

### Cost Observations
- Model mix: quality profile with GSD subagents and inline fallback where Codex Default mode blocked interactive choice tools
- Sessions: multi-week milestone execution with phase, quick, debug, and audit workflows
- Notable: The late artifact cleanup created avoidable context churn; v2.0 should keep validation state current per phase.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Timeline | Key Change |
|-----------|--------|-------|----------|------------|
| v1.0 MVP | 5 | 23 | 13일 | GSD 워크플로우 최초 적용, phase 격리 전략 검증 |
| v1.1 안정화 + 고도화 | 18 | 77 | 26일 | 운영 안정화 + audit gap closure + launch-facing gates를 v2.0으로 명시 이월 |

### Cumulative Quality

| Milestone | Backend Tests | Frontend Tests | Tech Debt Items |
|-----------|--------------|----------------|-----------------|
| v1.0 | 63 | 45 | 12 |
| v1.1 | 323+ | 186+ | 70 deferred artifacts tracked at close |

### Top Lessons (Verified Across Milestones)

1. 고위험 영역은 독립 phase로 격리하면 집중도와 완성도가 높아진다
2. Requirements 추적은 실시간으로 — 나중에 일괄 정리하면 stale 데이터가 쌓인다
3. Human/operator evidence는 구현 phase의 부속물이 아니라 launch-readiness phase로 승격해야 한다
