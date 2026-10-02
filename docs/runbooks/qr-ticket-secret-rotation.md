# QR 티켓 서명 secret 교체

좌석별 QR credential은 발급 시점의 `tickets.secret_version`으로 서명된다. 구매자 QR 조회와 티켓 메일은 저장된 version의 secret으로 토큰을 다시 서명한다. 현장 검표는 토큰의 version으로 검증한다. 따라서 `active`·`used` 티켓이 참조하는 version의 secret은 모든 API·worker 인스턴스의 keyring에 있어야 한다.

## 구성

| 환경변수 | Secret Manager | 의미 |
| --- | --- | --- |
| `QR_TICKET_SECRET` | `qr-ticket-secret` | 새 발급에 쓰는 현재 secret |
| `QR_TICKET_SECRET_VERSION` | `qr-ticket-secret-version` | 현재 secret의 version 이름 |
| `QR_TICKET_SECRET_KEYRING_JSON` | `qr-ticket-secret-keyring-json` | 검증·재서명용 `{ "<version>": "<secret>" }` JSON 객체. 현재 version은 자동 포함 |

API(`deploy.yml`)와 background worker(`scripts/managed-demo/deploy-background-worker-v2.mjs`)는 세 secret을 모두 `latest`로 바인딩한다. `latest`는 인스턴스가 시작될 때 읽히므로 Secret Manager 값만 바꿔도 새로 뜨는 인스턴스부터 섞여 적용된다. 그래서 교체는 아래 두 단계로 나눈다.

## 누락 시 증상

- 구매자 예매 상세·QR 조회·티켓 메일: HTTP 500 `QR 티켓을 일시적으로 표시할 수 없습니다`. 로그 `CRITICAL: QR secret version ... is missing from QR_TICKET_SECRET_KEYRING_JSON`. 세션 만료(401)로 보이지 않는다.
- 현장 검표: 해당 version 토큰이 `tampered`(검증할 수 없는 QR)로 거절. 로그 `QR token presented with a secret version missing from the keyring`.
- 기동 시: `CRITICAL: QR_TICKET_SECRET_KEYRING_JSON is missing secret versions still used by issued tickets: ...` 로그와 Sentry(`check=secret-keyring-coverage`, level fatal).

## 교체 절차

1. 읽기 전용 사전 점검. 남아 있는 version을 기록한다.

   ```sql
   SELECT secret_version, status, count(*)
   FROM tickets
   WHERE status IN ('active', 'used')
   GROUP BY 1, 2
   ORDER BY 1, 2;
   ```

2. 1단계: keyring에 새 version을 먼저 추가한다. 현재 version 값은 그대로 둔다.
   - 새 keyring JSON에는 1번에서 확인한 모든 version, 현재 version, 새 version의 secret을 넣는다.
   - 값은 로컬 파일로 만들고 `jq -e 'type == "object" and (keys | length) > 0' <file>`, `jq 'keys' <file>`로 형식과 version 목록만 확인한다. secret 값을 터미널·티켓·채팅에 출력하지 않는다.
   - `qr-ticket-secret-keyring-json`에 새 version을 추가하고 API와 worker를 다시 배포해 모든 인스턴스가 새 keyring으로 기동하게 한다.
   - 기동 로그에 keyring 누락 CRITICAL이 없는지 확인한다.
3. 2단계: 서명 version을 바꾼다.
   - `qr-ticket-secret`과 `qr-ticket-secret-version`에 새 version을 추가한다. keyring은 1단계 값 그대로 둔다.
   - API와 worker를 다시 배포한다.
4. 배포 후 확인.
   - API·worker 기동 로그에 `missing secret versions`와 `QR secret keyring coverage check failed`가 없다.
   - 교체 전에 발급된 티켓의 예매 상세가 200으로 열리고, 그 QR이 현장 검표 verify에서 `processable`이다.
   - 교체 후 새로 발급된 `tickets.secret_version`이 새 version이다.

## 되돌리기

- CRITICAL 로그나 구매자 500이 보이면 빠진 version을 keyring에 추가하고 재배포한다. 이전 revision으로 즉시 돌릴 수도 있다.
- 티켓의 `secret_version`을 일괄 수정하거나 이전 version을 지워 증상을 숨기지 않는다.

## 이전 version 폐기

`used` 티켓도 입장 후 구매자 화면에 QR이 남으므로 조회 대상이다. 1번 쿼리에서 해당 version의 `active`·`used` 건수가 0이 된 뒤에만 keyring에서 뺀다. 빼고 나서 다시 배포하고 기동 로그를 확인한다.
