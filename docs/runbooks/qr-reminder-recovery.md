# QR 예약메일 장애 복구

## 처리 계약

기존 구현은 발송 전에 `tickets.email_sent_at`을 선점값으로 기록했다. 이 기록 직후 프로세스가 종료되면 재시도가 이미 발송한 메일로 판단해 건너뛰었다. 이제 migration `0051_qr_reminder_deliveries`의 예매별 발송 행이 선점과 완료를 분리한다. QR 원문·수신 주소·메일 본문을 이 원장에 저장하지 않는다.

- 작업 선점은 5분 임대와 매번 바뀌는 토큰으로 한다. 발송 동안 DB 트랜잭션이나 row lock을 유지하지 않는다.
- 결제사 처리와 분리된 메일 복구다. 결제 승인·환불·티켓 소유권·QR 유효성을 변경하지 않는다.
- 메일 공급자가 접수한 다음에만 발송 행과 해당 좌석의 `email_sent_at`을 같은 트랜잭션에서 기록한다. 늦게 돌아온 과거 작업은 후속 작업의 상태를 변경할 수 없다.
- 발송 전 중단은 임대 만료 후 재시도한다. 공급자 접수 후 응답/DB 기록이 유실되면 동일 본문에 같은 Resend 멱등키를 보내 접수 결과를 복구한다. 예매별 멱등키는 고정하고 첫 요청의 본문 해시만 원장에 저장한다. 결과가 불명확한 동안 제목·좌석·인증된 수신처·발신 설정 등이 달라지면 `payload_changed` 확인 대상으로 전환하고 새 메일을 자동 발송하지 않는다.
- 별도 worker는 시작 시와 5분마다 최대 20개 예매를 점검한다. 예약 작업 등록 실패·작업 유실·pg-boss 재시도 소진도 점검 대상이다. 공급자 오류는 1분부터 최대 30분 간격으로 다시 시도한다. API의 `BACKGROUND_PROCESSING_ENABLED=false`는 유지하며 기존 bounded worker에서 처리한다.
- 복구 점검은 공연 시작 전의 활성 좌석과 인증된 이메일만 대상으로 한다. 취소된 좌석은 발송 본문에서 제외한다. 기존 수동 발송과 과거 발송 기록은 자동으로 다시 보내지 않는다.

Resend의 [멱등키 유지 기간은 24시간](https://resend.com/docs/dashboard/emails/idempotency-keys)이다. 인증·QR 본문 준비를 마치고 첫 공급자 요청을 시작한 뒤 23시간부터 자동 재전송을 멈추고 `attention_at`과 `QR_REMINDER_REQUIRES_ATTENTION` 로그/Sentry 오류를 남긴다. 접수 여부를 알 수 없는 메일을 유지 기간이 지난 키로 무조건 다시 보내지 않는다. 성공 응답과 발송 시각은 공급자 접수 증거이며 받은편지함 도달 증거와는 다르다.

## 조회와 대응

운영 DB는 연결 대상을 확인한 READ ONLY 트랜잭션으로 조회한다. 원문 메일·QR·연락처는 로그나 이슈에 붙이지 않는다.

```sql
SELECT reservation_id, attempts, first_attempt_at, next_attempt_at,
       lease_expires_at, sent_at, provider_message_id, attention_at,
       attention_reason, suppressed_at
FROM qr_reminder_deliveries
WHERE sent_at IS NULL
ORDER BY first_attempt_at NULLS FIRST;
```

1. worker Scheduler 활성 상태와 최근 실행 성공을 확인한다. 임대가 남아 있으면 진행 중인 작업을 중복 실행하지 않는다.
2. `attention_at`이 없으면 backoff/임대 만료 뒤 자동 복구를 확인한다. DB·키링·인증·공급자 장애를 먼저 해결한다.
3. `suppressed_at`은 기존/수동 발송 기록에 따른 중복 억제이며 새 공급자 접수 증거가 아니다. `attention_at`이 있으면 해당 예매 시각과 공급자 전송 기록으로 실제 접수 여부를 대조한다. 임대/첫 시도 값을 임의로 초기화하지 않는다. 접수되지 않은 것이 확인되고 구매자 요청이 있으면 기존 예매 상세의 이메일 재발송으로 처리하고 결과를 남긴다. 수신 기록이 있거나 결과가 불명확하면 운영 담당자가 중복 발송 가능성과 공연 시각을 판단한다.
4. migration 이전의 `email_sent_at`은 선점과 완료를 구분하지 못한다. 과거 `QR reminder claimed`에 대응하는 `sent` 로그와 공급자 이력을 대조한다. 일괄 NULL 처리나 일괄 재발송은 하지 않는다.

## 배포와 복귀

기존 CI/CD의 운영 migration 단계로 새 테이블과 due-reminder 부분 인덱스를 먼저 적용한다. 기존 티켓·결제·환불 행은 migration에서 수정하지 않는다. 자동 발송 준비 전 대기·미인증 상태에서는 멱등 기간을 소진하지 않는다. 동일 커밋의 worker → API → Web 배포와 worker 실행 성공을 확인한다. 공개 health/runtime 조회는 실결제나 고객 메일 발송을 대신하지 않는다.

복귀 시 API/Web/worker의 이전 이미지를 함께 적용하고 새 테이블은 남긴다. 이전 코드는 새 테이블을 읽지 않는다. 이미 공급자가 접수했지만 DB에 기록되지 않은 새 방식의 미완료 건은 복귀 전에 공급자와 대조한다. 복귀 후에는 이전 선점 방식의 중단 시 누락 한계가 다시 생긴다.

## 검증

발송 전 중단, 공급자 접수 후 DB 실패, 동시 작업, 만료된 임대의 회수, 과거 작업의 늦은 완료·해제, 예약 작업 유실, 취소 좌석 제외, 멱등 기간 초과를 `qr-ticket.integration.spec.ts`의 실제 PostgreSQL에서 검증한다. 공급자는 경계에서 대역을 사용하며 실사용자 메일·실결제는 발생시키지 않는다. SDK 멱등키/timeout과 worker 기동·중복 실행·종료는 별도 단위 테스트로 검증한다.
