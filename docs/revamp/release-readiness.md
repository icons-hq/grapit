# 전환·부하·외부 검증 기록 (#223)

기준일 2026-09-22 KST. #216–#222 구현과 격리 검증 뒤의 전환 준비다. **#214와 #223은 OPEN**이다. 아래 로컬 실험, 운영 읽기 전용 점검, 기술 배포, 실제 판매 오픈 준비를 구분한다.

## 격리 부하·장애 실험

`scripts/revamp/isolated-capacity.mjs`는 자체 PostgreSQL 16·Valkey 8 컨테이너와 API 프로세스를 만들고 종료 시 제거한다. 임의 대상 URL/운영 DATABASE_URL을 받지 않는다. 합성 구매자·현장 계정의 JWT/refresh family를 준비하되 실제 인증·대기열·권한 가드, HTTP, DB transaction을 통과한다. PG 승인, 메시지 발송, 실사용자 비밀번호/OAuth 부하는 포함하지 않는다.

API 1개, DB pool 2개, Valkey standalone인 로컬 Mac 환경에서 측정했다. 각 사용자 연결을 64개씩 준비한 뒤 측정 단계마다 동시에 요청했다. 단순히 동시 Promise 수만으로 운영의 지속 처리량이나 동시 접속 한도를 보장하지 않는다.

| 세션 | 입장 허용/개별 좌석 잠금/개별 QR 소비 | 전송 오류 | 지갑 p95 | 좌석 잠금 p95 | 온라인 입장 p95 | 초기 목표 |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 각각 100/100 | 0 | 92ms | 121ms | 211ms | 통과 |
| 500 | 각각 500/500 | 0 | 316ms | 493ms | 1,010ms | 입장 1초 초과 |
| 1,000 | 각각 1,000/1,000 | 0 | 615ms | 1,032ms | 1,957ms | 좌석·입장 1초 초과 |

세 단계 모두 한 좌석 경쟁의 성공자 1명, 같은 QR 입장 경쟁의 소비자 1명이며 DB 입장 행 수와 응답 성공 수가 일치했다. Valkey를 1.5초 중단하고 클라이언트 요청을 1초에 종료한 뒤 재시도하면 같은 소유자 잠금이 정확히 하나 남았다. PostgreSQL 중단 시 읽기가 시간 초과되고 복구 뒤 200으로 돌아왔다. 결제 동시 승인·PG 성공/DB 실패는 별도 PostgreSQL 거래 회귀에 있으며, 이 부하 실험에서 실제 PG 승인을 대량 발생시키지는 않았다.

첫 cold-connection 실험에서는 500/1,000 요청에서 `ECONNRESET`이 발생했다. Mac의 TCP accept backlog 설정은 128이고 수락된 요청 수가 128씩 늘어나는 패턴을 확인했다. 연결을 준비한 비교 실험에서 전송 오류가 없어졌지만, **새 연결 폭주 조건도 별도 용량 검증 대상**으로 남긴다. 그 결과를 삭제하거나 실제 고객 오류율 0으로 일반화하지 않는다.

최종 스크립트는 실행 직전 shared/API를 다시 빌드하고 commit·tracked diff hash·harness hash·Node/OS를 기록한다. 외부 공급자 환경변수는 자식 API에 넘기지 않는다. 기존 결과 파일은 덮어쓰지 않으며 권한 0600으로 쓴다. SIGINT/SIGTERM은 요청을 중단하고 공통 정리 경로를 거친다. 정리 실패 하나가 다른 자원 정리를 막지 않고 실패 자원 종류를 기록한다. API 준비 직후 실제 SIGTERM 중단으로 실패 exit 1과 모든 자원 제거를 확인했다. 강제 SIGKILL이나 호스트 종료는 이 정상 정리 보장 범위 밖이다. 목표 미달은 `capacity_limited` 및 exit 2, 실험 실패는 exit 1이다. 검토 후 최종 버전의 100 세션 확인은 좌석 122ms/입장 213ms, 오류 0, 장애 복구·정리까지 통과했다. 위 500/1,000 수치는 측정 로직이 같은 이전 버전의 보존된 실행 결과다.

```bash
# 저장소 루트, 의존성 설치 및 Docker 실행 필요. 같은 dist의 dev/build와 병행하지 않는다.
node scripts/revamp/isolated-capacity.mjs --run --sessions=100,500,1000 \
  --output=/absolute/private/new-capacity-result.json
```

원 근거는 비공개 `grapit-revamp-autonomy-2026-09-21/isolated-capacity*.json`과 `isolated-capacity-warm-sessions-as-run.mjs`에 있다. 이번 결과로 운영 DB pool·인스턴스 상한·과금 설정을 올리지 않았다. 실제 판매 목표 부하, 연결 폭주, 지속 부하, Cloud Run cold start, Cloud SQL/Valkey 자원·p95는 격리된 운영 동등 환경에서 추가 확인해야 한다.

## 운영 기준선과 보존 확인

2026-09-22 읽기 전용 기준선:

| 대상 | 확인 값 |
| --- | --- |
| 프로젝트/리전 | `grapit-491806` / `asia-northeast3` |
| API 이전 revision | `grabit-api-00253-nlb`, traffic 100% |
| Web 이전 revision | `grabit-web-00202-gk5`, traffic 100% |
| 이전 이미지 commit | `9a6ca20a8a19ac302b69bf459cc64605cb5dd961` |
| 원본 DB | `grabit-db-managed-demo`, database `grapit`, PostgreSQL 16, `db-f1-micro` |
| 운영 모드 | API/Web `BOOKING_ENABLED=true`, min 0/max 4, API pool 2·background false, standalone Valkey |
| worker | 5분 주기 Scheduler ENABLED, 별도 bounded worker Job |
| 백업 | 자동 백업 SUCCESSFUL, 최근 확인 2026-09-21 05:20 UTC 완료; 보존 7개·PITR 7일 설정 |
| 진행 중 거래 | PENDING_PAYMENT 0, provider READY/IN_PROGRESS/WAITING_FOR_DEPOSIT 0, cancellation_pending 0, 미완료 환불 0 |
| schema | migration 34개, checkout method/handoff 확장 열 없음 |

이 값은 배포 직전 다시 읽는다. 이미 판매가 활성화돼 있으므로 배포를 이유로 예매 flag를 임의로 끄지 않는다. 승인 API도 해당 flag를 검사하므로 준비 중 결제가 있을 때 단순 차단은 결제 복귀를 방해할 수 있다. 운영 SQL 변경은 `.github/workflows/deploy.yml`의 migration job만 사용한다.

`scripts/revamp/production-preflight.mjs`는 정확한 Cloud SQL secret 대상과 DB 이름을 검사하고, `default_transaction_read_only=on` 및 repeatable-read READ ONLY transaction으로 환불·관리자/예매 감사·webhook ledger까지 17개 테이블을 조회한다. 출력에는 원본 행·연락처·인증값·QR을 넣지 않고 SHA-256 지문만 남긴다. `--baseline`으로 이전 열만 대조하므로 추가된 nullable 열은 데이터 변경으로 오인하지 않는다. 새 행은 별도로 세며, 기존 식별자 누락, 주문/결제 소유권·원금·원청구액 변경, 완료 환불 또는 append-only 동의/운영 감사의 변경은 exit 2다. 다른 기존 열의 변경도 별도로 보고해 정상적인 로그인/거래와 대조한다. `preservationPassed`만으로 동의·권리 상태 변경까지 자동 합격시키지 않는다.

실행자는 해당 instance에 연결한 로컬 Cloud SQL Auth Proxy만 사용한다. `database-url` secret은 CLI 인자·파일·출력에 쓰지 않고 프로세스 환경에만 전달한다. 전후 출력은 서로 다른 절대 경로로 보관한다. 격리 통합 테스트는 실제 PostgreSQL에서 정상 추가/설정 변경과 원금 변조/식별자 삭제/완료 환불 및 감사 변조·삭제를 구분하며 원문 민감값 비노출을 검증한다.

## 한 번의 통합 배포와 복귀 절차

1. #224–#230의 검증된 구현을 포함한 출시 후보 SHA를 고정하고 main 대상 통합 PR에서 CI·production build를 확인한다. 여러 기능 PR을 연달아 main에 합쳐 중간 조합을 운영에 배포하지 않는다.
2. API/Web 현재 revision·traffic·이미지 SHA, worker 이미지, Scheduler 상태, 최신 백업, 진행 중 결제/환불과 보존 지문을 다시 수집한다. 기존 method 없는 준비 주문이 새로 생겼으면 종료를 임의 처리하지 않고 PG와 대조해 전환 시점을 조정한다.
3. CI/CD가 additive `0034`–`0037` migration → 동일 SHA worker → API → Web 순서로 반영하도록 한다. 정산 구 API의 HTTP 410 전환은 ADR 0012에 따른 명시적 예외이며 API/Web을 한 릴리스로 다루고 열린 정산 화면을 새로고침한다.
4. API/Web ready revision 및 실제 traffic·이미지 SHA가 후보와 일치하고 worker 실행이 성공했는지 확인한다. canonical 도메인에서 로그인 유지·홈/내 티켓/과거 예매·관리자 읽기·번역·권한 거부·모바일 렌더를 확인한다. 새 실결제/입장/특전 지급은 별도 리허설 대상이다.
5. 읽기 전용 보존 지문을 비교한다. 신규 정상 행은 별도 집계하며 기존 원금/식별자 누락은 즉시 조사한다. 로그인·조회로 바뀐 열도 감사/요청과 설명 가능해야 한다. 기술 배포 성공과 아래 외부 gate 상태를 따로 기록한다.
6. 새 거래·입장·지급·보안 감사 사실이 없는 배포 직후 실패라면 같은 대상의 이전 API/Web traffic과 worker 이미지를 함께 복귀한다. `0034`–`0037`의 추가 열은 남겨 둔다. **이미 새 계약으로 처리한 사실이 있으면 예전 계정 일괄 입장 동작으로 단순 복귀하지 않고, 사실을 보존하는 호환 revision/전진 수정을 사용한다.** DB를 과거 백업으로 덮어써 거래를 지우지 않는다.

기존 `scripts/rollback-cutover.sh`는 과거 LB URL map용이다. 현재 Cloudflare/Cloud Run 앱 릴리스 복귀에 사용하지 않는다. 앱 복귀는 정확한 Cloud Run revision으로 `services update-traffic`, worker는 기록된 immutable 이미지로 승인된 배포 경로를 사용하고 결과를 재조회한다. edge·secret·비용 설정을 함께 바꾸는 작업은 이번 앱 릴리스에 포함하지 않는다.

## 실제 환경에서 남은 인수 항목

| 항목 | 현재 증거 | 실행에 필요한 마지막 입력과 합격 결과 |
| --- | --- | --- |
| 국내 카드 | 사용자가 현대카드 인증 후 Toss test 승인→QR 2장→전체 취소/PG 잔액 0 확인 | 공급자 test webhook 분리 후 전송 이력까지 연결. 기존 국내 test MID는 다른 제품 endpoint도 등록돼 있으므로 임의 변경 금지 |
| 해외 카드 | 공개 VISA test USD 승인→복귀→QR→취소 DONE 확인 | 물리 iOS/Android의 결제 앱/브라우저 복귀에서 같은 주문 유지 |
| Alipay | 독립 공식 SDK 1회 호출도 `INVALID_PAYMENT_METHOD / Payment has already been requested` 재현 | 실제 test 구매자 앱/계정과 공급자 원인 확인. 요청 ID·시각·가맹점 test 조건을 마스킹한 문의 자료로 전달하고 인증→비동기 승인/취소까지 검증 |
| PayPal | 계약/위젯 활성 확인, 실제 승인 미실행 | 사용 가능한 Personal Sandbox 계정. 격리 서버의 test flag를 켜 로그인→복귀→승인→QR→취소 대조 |
| test webhook | Nest HTTP 정상/중복 200·입력 400·처리 실패 500 회귀 통과 | 외화 test MID 전용 HTTPS 수신 경로와 test 인증값. 전체 API 노출 없이 webhook 경로만 연결, 실제 전송·중복·지연과 원장 대조 |
| SMS/메일/OAuth | 앱 생성·오답·재요청·실패·언어/returnTo는 실제 API, 외부 전달은 대역 | 승인된 테스트 수신 번호/메일과 공급자 로그인. 실제 도달 후 기존 주문 복귀·중복 계정 방지 |
| 실제 단말/현장 | viewport·키보드·대체 입력·HTTP 동시 소비·오프라인 재전송 통과 | iOS Safari, Android Chrome, 카메라 2대, 현장 담당자. 동행자 분리 입장·통신 단절/재연결·중복 스캔·실물 품목별 1회 인수 |
| 실제 용량 | 로컬 100/500/1,000 및 장애 결과 위 표 | 예정 판매 동시 트래픽과 운영 동등 격리 환경. 지속 부하·cold start·연결 폭주·자원 및 오류율 증거 |
| 소액 live/정산 | test PG·격리 원장/CSV 재계산 완료 | 운영 테스트 공연/좌석·카드 소유자·1건 금액/수수료·환불 조건을 먼저 고정. 본인 인증 뒤 실제 PG 승인/취소와 은행·카드사 자료를 별도 대조 |

위 입력 없이 agent가 본인 인증, 실제 기기, 실물 지급, 은행 반영을 완료했다고 기록하지 않는다. 구체적인 리허설 준비까지 진행하고 사람이 필요한 마지막 동작만 인계한다. 외부 연락은 사용자의 전송 지시가 있을 때만 한다.
