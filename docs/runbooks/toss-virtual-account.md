# 헤이그랩잇 가상계좌

국내 원화 상점 MID는 `gsangwbzqu`, 테스트 거래 응답의 MID는 `tgsangwbzqu`다. 토스 주문서형 결제의 공연별 가상계좌 위젯 키는 `GRABIT_VA`다. 외화 위젯은 기존 `uspay`를 사용한다.

## 발급과 입금

| 토스 상태 | 그랩잇 처리 |
| --- | --- |
| `WAITING_FOR_DEPOSIT` 발급 | 예매는 `PENDING_PAYMENT`, 결제는 `IN_PROGRESS/awaiting_deposit`다. 좌석 재고를 예매 ID로 잠그고 은행·입금 계좌·금액·기한을 구매자에게 표시한다. |
| `DONE` | 국내 MID·주문·결제 키·통화·금액·수단과 입금 잔액을 대조하고 5분간 좌석을 보유한다. 5분 뒤 토스 조회에서도 같은 입금 거래와 전액이 유지될 때 예매 확정과 좌석별 QR 발급을 진행한다. |
| `DONE` 이후 `WAITING_FOR_DEPOSIT` | 은행의 입금 취소다. 발권 전에는 확인 대기를 해제한다. 발권 후라면 티켓과 미사용 특전을 정지한다. 재입금이 확인된 시점부터 새로 5분을 기다린 뒤 발권하거나 기존 권한을 복구한다. |
| 기한 경과 또는 구매자의 미입금 취소 | 구매자는 예매 상세에서 미입금 예매를 취소할 수 있다. 만료 스윕은 토스 거래를 조회하고 필요하면 미입금 계좌를 반납한다. 토스에서 미입금 종료가 확인되면 해당 예매 소유 좌석을 푼다. 조회 장애 중에는 좌석을 보존한다. |
| 입금 후 취소 | 기존 예매·좌석별 환불 금액과 수수료 정책을 적용한다. 승인 때 보관한 환불계좌를 취소 API에 전달한다. 여러 번 취소하면 토스가 잔액 0원과 `PARTIAL_CANCELED`를 함께 반환할 수 있다. |

계좌 발급이 저장되면 원래 주문에 연결된 대기열 자리를 즉시 반환한다. 구매자가 다시 예매하면 새 순번을 받는다. 입금 대기 좌석은 해당 주문이 계속 보유하며, 입금 확인과 미입금 계좌 종료는 아래 절차를 따른다. 계좌 발급 전 결제를 준비 중인 주문은 기존 대기열·결제 복구 시간을 사용한다.

발권 대기 중 토스에서 일부 금액이 환불된 주문은 좌석을 보유하고 운영 대조 상태에 둔다. 구매자에게 추가 송금을 요청하지 않는다. 잔액 0원과 전액 취소 거래가 확인되면 미발권 예매를 종료하고 좌석을 해제한다.

입금 통지는 중복되거나 도착 순서가 바뀔 수 있다. `POST /api/v1/payments/toss/deposit-callback`은 발급 시 저장한 주문별 secret의 SHA-256과 본문 secret을 비교하고 결제사에서 현재 상태를 다시 조회한다. 기존 인증 헤더가 있는 `/payments/toss/webhook`은 `PAYMENT_STATUS_CHANGED`와 `CANCEL_STATUS_CHANGED`를 계속 받는다. 만료 시에는 웹훅이 오지 않을 수 있다. [토스 웹훅 이벤트](https://docs.tosspayments.com/reference/using-api/webhook-events) · [가상계좌 만료 FAQ](https://docs.tosspayments.com/resources/faq)

## 운영 적용 순서

1. 전용 국내 주문서형 위젯에 가상계좌를 추가하고 환불 정보 입력을 켠다. 테스트 위젯의 입금기한은 30분이다. 승인 응답의 실제 만료 시각이 공연 시작을 넘으면 발급을 반납한다. 기존 `DEFAULT`와 별도 위젯이므로 공연별로 선택할 수 있다. [주문서형 SDK](https://docs.tosspayments.com/sdk/v2/js/payment-widget)
2. 환불계좌 암호화에 쓸 32바이트 난수를 Base64로 저장한다. 운영에서는 Secret Manager의 `toss-virtual-account-refund-key`를 API와 환불 재처리 워커 양쪽에 연결한다. 배포 워크플로의 변수는 `TOSS_VIRTUAL_ACCOUNT_REFUND_KEY_CONFIGURED=true`, 웹 빌드 변수는 `NEXT_PUBLIC_TOSS_VIRTUAL_ACCOUNT_VARIANT_KEY=GRABIT_VA`다. 키 자체는 브라우저로 전달하지 않는다. 환불 가능 거래와 재처리 중인 취소 명령이 이전 키로 암호화돼 있으면 키 교체 전에 이관한다.
3. 결제 단계와 [구매자 개인정보 안내](https://heygrabit.com/legal/privacy#virtual-account)에서 환불 은행·계좌번호·예금주, 이용 목적과 다른 결제수단 선택 안내를 확인한다. 서버는 승인 응답의 환불계좌를 결제 키에 결합해 AES-256-GCM으로 암호화한다. 예매 상세에는 입금용 계좌만 제공한다. 기본 개인정보처리방침 자체를 개정할 때에는 기존 방침의 사전 공지 기간과 [동의 문서 버전 절차](consent-document-versions.md)를 따른다. [토스 가상계좌 환불](https://docs.tosspayments.com/guides/v2/cancel-payment)
4. 배포 후 해당 환경의 국내 MID에 `DEPOSIT_CALLBACK`을 별도로 등록한다. 운영 URL은 `https://api.heygrabit.com/api/v1/payments/toss/deposit-callback`이다. 테스트 환경에는 테스트 키와 격리 DB를 사용하는 공개 HTTPS 수신처를 지정한다. 2026-11-24 확인한 국내 테스트의 기존 수신처 `iconsip`은 다른 서비스 소유다. [토스 웹훅 등록](https://docs.tosspayments.com/guides/v2/webhook)
5. 판매할 공연의 관리자 예매 정책에서 가상계좌를 선택한다. 신규 노출을 끌 때는 공연 정책에서 이 수단을 해제한다. 이미 발급한 주문은 약속된 입금기한까지 처리한다. 웹훅·워커·환불 키는 기존 주문 처리가 끝날 때까지 유지한다.

6. 국내 라이브 `DEFAULT`와 `GRABIT_VA`에서 퀵계좌이체(실시간 계좌이체)를 해제하고 모바일과 PC 미리보기를 확인한다. 공개 판매 중·예정 공연의 예매 정책에서 `TRANSFER`를 `VIRTUAL_ACCOUNT`로 바꾼다. 다른 상점 MID와 외화 결제 UI는 각각의 계약에 따른다. [토스 결제 어드민](https://docs.tosspayments.com/guides/v2/payment-widget/admin)

이전 버전에서 저장한 정책에도 이 수단이 남아 있을 수 있다. 운영 변수를 적용하기 전에 활성화될 공연을 읽기 전용으로 확인한다.

```sql
SELECT performance_id FROM booking_policies WHERE allowed_payment_methods ? 'VIRTUAL_ACCOUNT';
```

## 5분 입금 재확인

확인 시작 시각은 그랩잇의 첫 토스 조회를 기준으로 한다. 계좌 발급 직후 은행이 입금을 철회하는 사례에 대응한다. 중복 완료 통지는 시간을 연장하지 않는다. 거래 키 또는 승인 시각이 바뀌면 새 입금으로 처리한다. 조회 장애 시 좌석을 유지하고 다음 실행에서 다시 조회한다. [토스 가상계좌 지연통보 안내](https://docs.tosspayments.com/resources/glossary/virtual-account)

운영 Cloud Scheduler `grabit-verify-deposits-every-minute`은 매분 발권 대기 시간이 지난 주문만 조회한다. 평소 발권까지 약 5~6분이 걸린다. 기존 5분 주기 백그라운드 작업도 같은 대기 주문을 복구한다. 두 작업과 구매자 상태 조회는 기존 주문별 잠금을 공유한다. 스케줄러의 Google OIDC 서비스 계정은 기존 운영 Scheduler 계정이며 audience는 아래 요청 URL 전체다.

```sh
project=grapit-491806
region=asia-northeast3
service_url=$(gcloud run services describe grabit-api --project="$project" --region="$region" --format='value(status.url)')
verify_url="$service_url/api/v1/internal/virtual-account/verify-deposits"
gcloud scheduler jobs create http grabit-verify-deposits-every-minute \
  --project="$project" --location="$region" --schedule='* * * * *' --time-zone=Asia/Seoul \
  --uri="$verify_url" --http-method=POST --attempt-deadline=60s \
  --oidc-service-account-email="scheduler-prewarm@$project.iam.gserviceaccount.com" --oidc-token-audience="$verify_url"
```

기존 스케줄을 갱신할 때는 위 명령에서 `create` 대신 `update`를 쓴다. 운영 연결 확인은 Cloud Scheduler 실행 결과와 해당 경로의 Cloud Run HTTP 200을 대조한다.

## 환불 거래 식별

그랩잇은 원래 취소 사유를 보관하고, 가상계좌 취소 요청에는 시도별 고유 번호를 짧은 사유로 전송한다. 개별 취소 POST의 성공 응답에서 원결제·취소 금액·전후 잔액과 완료 거래 키를 대조해 같은 환불 명령에 저장한다. 마지막 거래 키가 생략되면 직전 조회 이후 새로 생긴 완료 거래가 단 하나인지 확인한다. 이후 조회나 중복 웹훅은 저장한 키 또는 원래 요청의 고유 표기와 금액으로 대조한다. 결제 조회의 마지막 거래 키는 이후 부분취소로 바뀔 수 있다. 과거 건의 근거가 부족하면 기존 멱등 명령과 거래 원장을 확인한다. [토스 결제 취소 API](https://docs.tosspayments.com/reference#결제-취소)

## 입금 대조

기한이 지났는데 처리되지 않은 주문은 다음 읽기 전용 조회로 찾는다. 관리자 상세와 토스의 같은 주문을 대조한다. `VIRTUAL_ACCOUNT_UNRECORDED_DEPOSIT` 진단은 입금됐으나 발급 기록이 없는 건이다. 환불계좌를 확인한 후 정산한다.

```sql
SELECT r.reservation_number, r.toss_order_id, r.payment_deadline_at, p.status, p.async_status
FROM reservations r JOIN payments p ON p.reservation_id = r.id
WHERE r.status = 'PENDING_PAYMENT' AND p.method = 'VIRTUAL_ACCOUNT'
  AND r.payment_deadline_at <= now()
ORDER BY r.payment_deadline_at;
```

## 2026-11-24 검증

크롬에서 테스트 전용 위젯을 설정하고 우리은행 2,200원 테스트 계좌를 발급했다. 개발자센터에서 모의 입금한 뒤 조회한 상태는 `DONE`이었다. 원래 발급 응답을 동일한 멱등 키로 다시 읽고 격리 PostgreSQL에서 구매자 예매 상세와 발권을 확인했다. 동일한 주문별 통지를 두 번 처리한 뒤에도 좌석 티켓과 QR은 각 하나였다. 제품의 취소 클라이언트로 1,000원 부분 환불과 잔여 1,200원 환불을 실행해 토스 잔액이 0원인 것을 확인했다. 이 검증에서 외부 웹훅의 네트워크 전달과 운영 실거래는 수행하지 않았다.
