# AGENTS.md

Grabit은 라이브 엔터테인먼트 티켓 예매 플랫폼이다. 핵심 흐름은 공연 탐색 → 좌석 선택 → 예매·결제 → QR 티켓 → 입장이다.

## 협업과 승인 범위

- 한국어로 간결하게 답한다.
- 수정·구현 요청은 관련 실행·검증·실패 수정까지 완료한다. 읽기·보고 요청은 read-only로 유지한다.
- 배포, 운영 환경·DB 변경, 외부 API write, 결제·환불, 파괴적 작업은 명시적으로 요청되거나 승인된 범위에서 실행한다. 이미 승인된 후속 작업은 재확인하지 않으며, 추가 승인 전에도 가능한 준비·검증은 마친다.
- 기존 사용자 변경을 보존하고 요청 범위의 파일만 수정·stage한다.
- DB에 쓰는 명령은 실행 전 연결 대상 환경을 확인한다. 운영 migration은 승인된 CI/CD 또는 runbook 절차로 실행한다.
- secret·token·password·cookie·authorization header는 노출하지 않고, 필요한 증거는 마스킹한다.

## 작업별 참조

현재 동작은 코드·설정·실측으로 확인하고, 의도된 계약은 요구사항·ADR과 비교한다. 차이가 있으면 밝힌다. 아래 자료는 해당 작업에 필요한 부분만 읽는다. `.planning/`과 과거 실행 기록은 현재 작업 지시가 아니다.

| 작업 | 참조 |
| --- | --- |
| 제품 범위·도메인·설계 결정 | [CONTEXT.md](CONTEXT.md), [PRD](docs/02-PRD.md), 관련 [ADR](docs/adr/) |
| 모듈 경계·인프라·환경변수·기동 조건·접근 권한 | [Architecture](docs/03-ARCHITECTURE.md)의 관련 절과 현재 구현 |
| UI 디자인 | [UI/UX 가이드](docs/04-UIUX-GUIDE.md)는 디자인 참고용이며, 현재 component·token·route는 코드에서 확인 |
| DB schema·API 계약 | [Schema](apps/api/src/database/schema/), [migrations](apps/api/src/database/migrations/), [shared contracts](packages/shared/src/)와 호출부 |
| QR·좌석별 티켓·입장 | [QR ADR](docs/adr/0001-seat-level-qr-credentials.md), [Ticket Item ADR](docs/adr/0003-use-ticket-items-as-seat-level-ticket-records.md) |
| 과거 Ticket Item 부분 취소의 PG·DB 불일치 | [Cancellation reconciliation](docs/runbooks/ticket-cancellation-reconciliation.md) |
| CI·배포 | [CI](.github/workflows/ci.yml), [Deploy](.github/workflows/deploy.yml), [Architecture](docs/03-ARCHITECTURE.md)의 배포 절차. Cloudflare edge proxy는 GCP 배포와 별도 |
| Managed demo 비용·용량·cutover | [운영 runbook](docs/runbooks/managed-demo-cost-floor.md) |

## 프로젝트 기준

- 1인 운영을 위한 modular monolith와 기존 구현 패턴을 따른다. 핵심 스택 교체·서비스 분리는 합의된 설계 범위에서 진행한다.
- PostgreSQL을 영속 데이터의 기준으로 삼고 background job은 `pg-boss`를 사용한다. Valkey/Redis는 좌석 잠금·대기열·캐시·throttling·pub/sub용이며, Socket.IO의 다중 인스턴스 broadcast를 유지한다.
- 좌석 잠금·reservation·payment confirm·QR 발급의 transaction·동시성 경계를 보존한다.
- QR은 좌석별 Ticket Item 단위다. QR credential validity와 admission state를 분리하며, 입장 후에도 구매자의 예매 상세와 QR 조회를 유지한다.

## 완료 기준

- 검증은 변경 영향에 맞추고, 통과 후에는 새 변경·실패·미해결 우려가 있을 때만 확대하거나 반복한다. UI 변경은 영향을 받는 화면을 실제 렌더링해 확인한다.
- 동작·계약·운영 절차가 바뀌면 관련 문서를 갱신하고, 수행한 검증·미실행 사유·남은 위험을 보고한다.
- 배포가 승인된 작업은 배포 상태와 live smoke까지 확인한다. 기술적 배포 완료와 실제 운영 전환 준비는 구분한다.
