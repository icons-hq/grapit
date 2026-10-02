# QR 티켓 서명 secret 교체

좌석별 QR credential은 발급 시점의 `tickets.secret_version`으로 서명된다. 구매자 QR 조회와 티켓 메일은 저장된 version의 secret으로 토큰을 다시 서명한다. 현장 검표는 토큰의 version으로 검증한다. 따라서 `active`·`used` 티켓이 참조하는 version의 secret은 모든 API·worker 인스턴스의 keyring에 있어야 한다.

## 구성

| 환경변수 | Secret Manager | 의미 |
| --- | --- | --- |
| `QR_TICKET_SECRET` | `qr-ticket-secret` | 새 발급에 쓰는 현재 secret |
| `QR_TICKET_SECRET_VERSION` | `qr-ticket-secret-version` | 현재 secret의 version 이름 |
| `QR_TICKET_SECRET_KEYRING_JSON` | `qr-ticket-secret-keyring-json` | 검증·재서명용 `{ "<version>": "<secret>" }` JSON 객체. 현재 version은 자동 포함 |

API(`deploy.yml`)와 background worker(`scripts/managed-demo/deploy-background-worker-v2.mjs`)는 세 secret을 모두 `latest`로 바인딩한다. `latest`는 인스턴스가 시작될 때 읽히므로 Secret Manager 값만 바꿔도 새로 뜨는 인스턴스부터 섞여 적용된다. 그래서 교체는 아래 두 단계로 나눈다.

`QR_TICKET_SECRET`은 keyring JSON의 현재 version 항목보다 우선한다. `qr-ticket-secret`과 `qr-ticket-secret-version`은 서로 다른 Secret Manager secret이라 `latest`를 차례로 바꾸면 원자적이지 않다. 두 갱신 사이에 뜬 인스턴스(autoscale·재시작)는 어긋난 쌍을 읽고, 그 version을 다른 인스턴스와 다른 secret으로 서명·검증한다. 그 인스턴스가 보여준 QR은 다른 인스턴스에서 `tampered`가 된다. 그래서 2단계는 두 값을 번호가 고정된 version으로 한 revision에서 함께 바꾼다.

## 누락 시 증상

- 구매자 예매 상세·QR 조회·티켓 메일: HTTP 500 `QR 티켓을 일시적으로 표시할 수 없습니다`. 로그 `CRITICAL: QR secret version ... is missing from QR_TICKET_SECRET_KEYRING_JSON`. 세션 만료(401)로 보이지 않는다.
- 현장 검표: 해당 version 토큰이 `tampered`(검증할 수 없는 QR)로 거절. 로그 `QR token presented with a secret version missing from the keyring`.
- 기동 시: `CRITICAL: QR_TICKET_SECRET_KEYRING_JSON is missing secret versions still used by issued tickets: ...` 로그와 Sentry(`check=secret-keyring-coverage`, level fatal).
- 어긋난 secret·version 쌍으로 기동: `CRITICAL: QR_TICKET_SECRET_KEYRING_JSON entry for the current QR secret version "..." differs from QR_TICKET_SECRET` 로그와 Sentry(`check=secret-keyring-conflict`, level fatal). keyring JSON에 현재 version이 들어 있어야 감지된다. secret 값은 로그에 남지 않는다.

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
3. 2단계: 서명 version을 바꾼다. keyring은 1단계 값 그대로 둔다.
   - 교체가 끝날 때까지 `main` 병합을 멈춘다. `deploy.yml`이 돌면 binding이 다시 `latest`로 바뀐다.
   - 현재 번호를 기록한다. `gcloud secrets versions describe latest --secret=<secret> --format='value(name)'`을 `qr-ticket-secret`, `qr-ticket-secret-version`, `qr-ticket-secret-keyring-json`에 각각 실행하고 끝의 숫자를 적는다. 값을 출력하는 `versions access`는 쓰지 않는다.
   - (a) 실행 중인 binding을 현재 번호로 고정한다. 동작은 바뀌지 않고, 이후 `latest` 변경이 기존 revision에 섞여 들어가지 않는다.

     ```bash
     PINNED="QR_TICKET_SECRET=qr-ticket-secret:<현재>,QR_TICKET_SECRET_VERSION=qr-ticket-secret-version:<현재>,QR_TICKET_SECRET_KEYRING_JSON=qr-ticket-secret-keyring-json:<현재>"
     gcloud run services update grabit-api --region asia-northeast3 --update-secrets="$PINNED"
     gcloud run jobs update grabit-background-worker --region asia-northeast3 --update-secrets="$PINNED"
     ```

   - (b) `qr-ticket-secret`에 새 secret, `qr-ticket-secret-version`에 새 version 이름을 새 version으로 추가한다. 고정된 인스턴스는 영향을 받지 않는다.
   - (c) 두 binding을 한 명령으로 새 번호로 바꾼다. 한 revision의 모든 인스턴스가 같은 쌍을 읽는다.

     ```bash
     NEXT="QR_TICKET_SECRET=qr-ticket-secret:<새 번호>,QR_TICKET_SECRET_VERSION=qr-ticket-secret-version:<새 번호>"
     gcloud run services update grabit-api --region asia-northeast3 --update-secrets="$NEXT"
     gcloud run jobs update grabit-background-worker --region asia-northeast3 --update-secrets="$NEXT"
     ```

     API와 worker 사이, 이전·새 revision 사이의 짧은 차이는 괜찮다. 두 쌍 모두 자체로 일치하고, keyring에 두 version이 모두 있어 서로의 서명을 검증한다. (a)와 (c) 뒤에는 `gcloud run services describe grabit-api --region asia-northeast3 --format='value(status.traffic)'`로 새 revision이 트래픽 100%를 받는지 확인한다.
   - 다음 정규 배포가 binding을 `latest`로 되돌린다. 이때 `latest`는 (c)의 번호와 같다.
4. 배포 후 확인.
   - API·worker 기동 로그에 `missing secret versions`, `differs from QR_TICKET_SECRET`, `QR secret keyring coverage check failed`, `QR secret keyring conflict check failed`가 없다.
   - 교체 전에 발급된 티켓의 예매 상세가 200으로 열리고, 그 QR이 현장 검표 verify에서 `processable`이다.
   - 교체 후 새로 발급된 `tickets.secret_version`이 새 version이다.

## 되돌리기

- CRITICAL 로그나 구매자 500이 보이면 빠진 version을 keyring에 추가하고 재배포한다. 이전 revision으로 즉시 돌릴 수도 있다.
- `differs from QR_TICKET_SECRET`가 보이면 3번 (c)를 일치하는 번호 쌍으로 다시 실행하거나, (a)의 고정 번호로 되돌린다.
- 티켓의 `secret_version`을 일괄 수정하거나 이전 version을 지워 증상을 숨기지 않는다.

## 이전 version 폐기

`used` 티켓도 입장 후 구매자 화면에 QR이 남으므로 조회 대상이다. 1번 쿼리에서 해당 version의 `active`·`used` 건수가 0이 된 뒤에만 keyring에서 뺀다. 빼고 나서 다시 배포하고 기동 로그를 확인한다.
