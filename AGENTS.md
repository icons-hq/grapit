# AGENTS.md

Grabit은 라이브 엔터테인먼트 티켓 예매 플랫폼이다. 핵심 흐름은 `discover -> seat selection -> booking/payment -> QR ticket -> venue entry`다.

## 협업과 승인 범위

- 한국어로 간결하게 답하고, 기술 용어·명령·식별자는 원문을 유지한다.
- 수정·구현 요청은 관련 로컬 변경, 실행, 검증, 발생한 실패 수정까지 진행한다. 이미 승인된 범위는 재확인하지 않으며, 읽기·보고만 요청한 작업은 read-only로 유지한다.
- 배포, 운영 환경·DB 변경, 외부 API write, 결제·환불, 파괴적 작업은 명시적으로 요청되거나 승인된 범위에서만 실행한다. 추가 승인이 필요하면 가능한 준비·검증을 먼저 마친다.
- 요청의 범위나 승인에 꼭 필요한 정보만 질문한다. 문서·skill 때문에 멈춰야 한다면 기존 사용자 승인으로 해결되는지 먼저 확인하고, 남은 충돌의 정확한 출처와 이유를 설명한다.
- 변경 전 `git status --short --branch`를 확인하고 기존 사용자 변경을 보존한다. 수정·stage는 요청 범위의 파일에 한정한다.
- secret, token, password, cookie, authorization header는 출력하거나 문서에 기록하지 않는다. 필요한 경우 존재 여부와 마스킹한 정보만 보고한다.

## 작업별 참조

현재 동작은 관련 코드·설정·실측으로 확인한다. 아래 자료는 해당 작업에 필요한 부분만 읽으며, 문서와 구현이 다르면 차이를 밝히고 현재 구현을 기준으로 판단한다. `.planning/`과 과거 실행 기록은 현재 작업 지시가 아니다.

| 작업 | 확인할 자료 |
| --- | --- |
| 제품 범위·도메인 용어·설계 결정 | [CONTEXT.md](CONTEXT.md), [PRD](docs/02-PRD.md), 관련 [ADR](docs/adr/) |
| 모듈 경계·데이터 흐름·인프라 구조 | [Architecture](docs/03-ARCHITECTURE.md)와 해당 구현. 기존 ADR과 다른 설계는 충돌을 명시한다. |
| 버전·실행·검증 명령 | root와 대상 package의 `package.json`, `pnpm-lock.yaml`, `turbo.json` |
| UI·문구 변경 | `apps/web/components`, `apps/web/app`, `apps/web/messages`의 기존 패턴. [UI/UX 가이드](docs/04-UIUX-GUIDE.md)는 디자인 참고이며 현재 token·route는 코드에서 확인한다. |
| DB schema·API 계약 변경 | [Drizzle schema](apps/api/src/database/schema/), [migrations](apps/api/src/database/migrations/), [shared contracts](packages/shared/src/), 관련 호출부 |
| QR·좌석별 티켓·입장 처리 | [도메인 용어](CONTEXT.md), [QR ADR](docs/adr/0001-seat-level-qr-credentials.md), [Ticket Item ADR](docs/adr/0003-use-ticket-items-as-seat-level-ticket-records.md)와 현재 ticket/field 구현 |
| 과거 Ticket Item 부분 취소의 PG·DB 불일치 | [Cancellation reconciliation](docs/runbooks/ticket-cancellation-reconciliation.md) |
| CI·배포 | [CI workflow](.github/workflows/ci.yml), [Deploy workflow](.github/workflows/deploy.yml). Managed demo 비용·용량·cutover 변경은 [운영 runbook](docs/runbooks/managed-demo-cost-floor.md). |

## 설계 기준

- 1인 운영에 맞는 modular monolith를 유지한다. 기존 Next.js web, NestJS API, Drizzle, Zod shared contract와 module/component/helper 패턴을 따른다. 핵심 스택 교체나 새 서비스 분리는 명시적으로 합의된 설계 범위에서 진행한다.
- PostgreSQL을 영속 데이터의 기준으로 삼고 background job은 `pg-boss`를 사용한다. Valkey/Redis는 좌석 잠금·대기열·캐시·throttling·pub/sub에 사용하며 Socket.IO의 다중 인스턴스 broadcast를 유지한다.
- 서버 상태는 TanStack Query, 클라이언트 예매 상태는 Zustand, form은 React Hook Form과 Zod, 다국어는 `next-intl`과 shared locale contract의 기존 방식을 따른다.
- 예매·운영 UI는 정보와 상태를 명확히 보여준다. 요청을 해결하는 최소 변경으로 완료하며, 별도 목적의 기능·추상화·리팩터링은 추가하지 않는다.

## 예매·결제·입장 불변 조건

- 좌석 잠금, reservation, payment confirm, QR 발급의 transaction·동시성 경계를 보존한다. SVG 업로드·parsing·rendering·좌석 선택 계약의 변경은 호출부까지 함께 다룬다.
- QR credential validity와 admission state를 분리한다. 입장 처리 후에도 구매자의 예매 상세와 QR 조회가 가능해야 한다.
- scanner 중복 방지, offline sync, field monitor, 구매자 상세는 서로 다른 흐름이다. 영향을 받는 흐름별로 동작을 확인한다.
- auth·role·admin guard 변경은 public/admin 양쪽 접근 권한을 확인한다. 고객 오류의 HTTP status와 표시 문구를 일치시킨다.
- API production startup의 `FRONTEND_URL` HTTPS 검증, Redis ping, Socket.IO Redis adapter 연결 실패 시 기동 중단 조건을 보존한다.

## 실행과 운영

- 로컬 `.env`는 monorepo root 한 곳에 둔다. web/API 하위에 별도 파일을 만들지 않으며, Drizzle CLI에는 필요 시 root 환경변수를 명시적으로 주입한다.
- integration test·seed·migration 실행 전 실제 DB 연결 대상을 확인한다. Production migration은 승인된 CI/CD 또는 runbook을 통해 실행한다.
- Cloud Run은 Secret Manager와 workflow/runtime 환경변수 주입을 사용한다. GCP 작업은 대상 project `grapit-491806`, region `asia-northeast3`를 명시해 대상 혼동을 피한다.
- 운영 장애는 live revision/status, API 응답, runtime flags, logs 등 관련 증거로 판단한다. 운영 데이터 정리는 보호·변경 대상을 구체화한 뒤 승인된 대상에만 적용한다.
- Production ship이 승인된 작업은 `branch -> PR -> CI green -> merge -> deploy -> live smoke`까지 완료한다. `main` 직접 push와 production 직접 변경은 해당 방식까지 명시적으로 요청된 경우에만 수행한다.
- PR 생성 시 사용자가 draft를 요청한 경우 외에는 ready-for-review로 만든다. Cloudflare edge proxy 배포는 GCP Deploy workflow와 별도라는 점을 확인한다.

## 완료 기준

- 변경 영향을 확인할 수 있는 가장 작은 검증을 선택한다. 통과 후에는 새 변경·실패·미해결 우려가 있을 때만 확대하거나 반복한다.
- shared/API/web 계약 변경은 관련 package의 typecheck·test를 함께 확인한다. UI 변경은 desktop/mobile 실제 render와 관련 loading·disabled·error 상태를 확인한다.
- 문서만 변경했다면 diff·참조 경로·민감정보 검사를 기본으로 하고, 동작을 바꾸지 않은 앱의 전체 build/test는 요구하지 않는다.
- 동작·계약·운영 절차가 바뀌어 기존 문서와 달라지면 해당 문서를 함께 갱신한다.
- 결과, 핵심 변경, 수행한 검증과 미실행 사유·남은 위험을 보고한다. 승인된 배포 작업은 배포 상태와 live smoke까지 확인하고, 기술적 배포 완료와 실제 운영 전환 가능 여부를 구분한다.
