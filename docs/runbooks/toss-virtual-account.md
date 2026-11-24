# 헤이그랩잇 가상계좌

국내 원화 상점 MID는 `gsangwbzqu`, 테스트 거래 응답의 MID는 `tgsangwbzqu`다. 토스 주문서형 결제의 공연별 가상계좌 위젯 키는 `GRABIT_VA`다. 외화 위젯은 기존 `uspay`를 사용한다.

## 발급과 입금

| 토스 상태 | 그랩잇 처리 |
| --- | --- |
| `WAITING_FOR_DEPOSIT` 발급 | 예매는 `PENDING_PAYMENT`, 결제는 `IN_PROGRESS/awaiting_deposit`다. 좌석 재고를 예매 ID로 잠그고 은행·입금 계좌·금액·기한을 구매자에게 표시한다. |
| `DONE` | 국내 MID, 주문, 결제 키, 통화, 금액, 결제수단을 서버에서 대조한다. 같은 예매가 보유한 좌석을 판매 처리하고 티켓과 QR을 발급한다. |
| `DONE` 이후 `WAITING_FOR_DEPOSIT` | 은행의 입금 취소다. 발권 권한과 미사용 특전을 정지하고 좌석을 보유한다. 재입금이 확인되면 기존 티켓의 권한을 복구한다. |
| 기한 경과 또는 구매자의 미입금 취소 | 구매자는 예매 상세에서 미입금 예매를 취소할 수 있다. 만료 스윕은 토스 거래를 조회하고 필요하면 미입금 계좌를 반납한다. 토스에서 미입금 종료가 확인되면 해당 예매 소유 좌석을 푼다. 조회 장애 중에는 좌석을 보존한다. |
| 입금 후 취소 | 기존 예매·좌석별 환불 금액과 수수료 정책을 적용한다. 승인 때 보관한 환불계좌를 취소 API에 전달한다. 여러 번 취소하면 토스가 잔액 0원과 `PARTIAL_CANCELED`를 함께 반환할 수 있다. |

입금 통지는 중복되거나 도착 순서가 바뀔 수 있다. `POST /api/v1/payments/toss/deposit-callback`은 발급 시 저장한 주문별 secret의 SHA-256과 본문 secret을 비교하고 결제사에서 현재 상태를 다시 조회한다. 기존 인증 헤더가 있는 `/payments/toss/webhook`은 `PAYMENT_STATUS_CHANGED`와 `CANCEL_STATUS_CHANGED`를 계속 받는다. 만료 시에는 웹훅이 오지 않을 수 있다. [토스 웹훅 이벤트](https://docs.tosspayments.com/reference/using-api/webhook-events) · [가상계좌 만료 FAQ](https://docs.tosspayments.com/resources/faq)

## 운영 적용 순서

1. 전용 국내 주문서형 위젯에 가상계좌를 추가하고 환불 정보 입력을 켠다. 테스트 위젯의 입금기한은 30분이다. 승인 응답의 실제 만료 시각이 공연 시작을 넘으면 발급을 반납한다. 기존 `DEFAULT`와 별도 위젯이므로 공연별로 선택할 수 있다. [주문서형 SDK](https://docs.tosspayments.com/sdk/v2/js/payment-widget)
2. 환불계좌 암호화에 쓸 32바이트 난수를 Base64로 저장한다. 운영에서는 Secret Manager의 `toss-virtual-account-refund-key`를 API와 환불 재처리 워커 양쪽에 연결한다. 배포 워크플로의 변수는 `TOSS_VIRTUAL_ACCOUNT_REFUND_KEY_CONFIGURED=true`, 웹 빌드 변수는 `NEXT_PUBLIC_TOSS_VIRTUAL_ACCOUNT_VARIANT_KEY=GRABIT_VA`다. 키 자체는 브라우저로 전달하지 않는다. 환불 가능 거래와 재처리 중인 취소 명령이 이전 키로 암호화돼 있으면 키 교체 전에 이관한다.
3. 환불 은행·계좌번호·예금주를 동의 안내 및 개인정보처리방침의 처리 항목에 반영하고 적용일을 정한다. 서버는 승인 응답의 환불계좌를 결제 키에 결합해 AES-256-GCM으로 암호화한다. 예매 상세에는 입금용 계좌만 제공한다. [토스 가상계좌 환불](https://docs.tosspayments.com/guides/v2/cancel-payment)
4. 배포 후 해당 환경의 국내 MID에 `DEPOSIT_CALLBACK`을 별도로 등록한다. 운영 URL은 `https://api.heygrabit.com/api/v1/payments/toss/deposit-callback`이다. 테스트 환경에는 테스트 키와 격리 DB를 사용하는 공개 HTTPS 수신처를 지정한다. 2026-11-24 확인한 국내 테스트의 기존 수신처 `iconsip`은 다른 서비스 소유다. [토스 웹훅 등록](https://docs.tosspayments.com/guides/v2/webhook)
5. 판매할 공연의 관리자 예매 정책에서 가상계좌를 선택한다. 신규 노출을 끌 때는 공연 정책에서 이 수단을 해제한다. 이미 발급한 주문은 약속된 입금기한까지 처리한다. 웹훅·워커·환불 키는 기존 주문 처리가 끝날 때까지 유지한다.

이전 버전에서 저장한 정책에도 이 수단이 남아 있을 수 있다. 운영 변수를 적용하기 전에 활성화될 공연을 읽기 전용으로 확인한다.

```sql
SELECT performance_id FROM booking_policies WHERE allowed_payment_methods ? 'VIRTUAL_ACCOUNT';
```

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
