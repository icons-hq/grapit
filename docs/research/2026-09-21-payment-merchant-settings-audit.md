# 실제 Toss 가맹점 설정 확인 — 2026-09-21

현재 사용하는 국내·해외 카드·Alipay·PayPal의 가맹점 설정을 읽기 전용으로 확인했다. 공급자 설정을 변경하거나 키를 발급하지 않았다. 이 문서는 설정 조사 결과이며, 모든 결제수단의 실제 성공을 뜻하지 않는다.

기준 코드: `9a6ca20a8a19ac302b69bf459cc64605cb5dd961`. 실제 아이콘스 상점의 계약·위젯·API 키·웹훅 화면, Cloud Run의 현재 100% 트래픽 revision, 그 revision의 배포 이미지와 Secret Manager를 대조했다. 전체 MID·키·웹훅 인증 값·거래 식별자는 기록하지 않고 국내-A/외화-B로 부른다.

## 실제 연동 설정

| 경로 | 계약·청구통화 | 고객 위젯 | 키·환경 확인 | 웹훅 |
| --- | --- | --- | --- | --- |
| 국내 카드·계좌이체 | 국내-A, 카드·계좌이체 계약 완료. 기존 실제 테스트 거래 및 운영 웹훅 표본의 통화 KRW | `DEFAULT`, test/live 모두 카드·계좌이체 활성 | 상점 통합 gck/gsk. 테스트 쌍은 격리 환경과 일치. 운영 쌍은 배포 웹·API와 일치 | live 1개, Grabit endpoint. test 1개는 별도 ICONS IP endpoint |
| 해외 카드 | 외화-B, 상점 결제통화 USD. VISA·Mastercard·JCB·UnionPay 심사승인 | `uspay`, test/live의 Credit Card 활성. 표시 카드사는 VISA·MASTER·JCB | 운영 해외 카드 서버 키도 같은 live gsk. 격리 환경에 동일 상점 test gsk를 연결해 별도 고객 여정 검증 | 외화-B live 2개, 같은 Grabit endpoint. test 등록 없음 |
| Alipay | 외화-B, USD. 계약 화면의 Alipay 이용가능 | `uspay`, test/live Alipay 활성 | 위와 같은 상점 통합 키 | 위와 동일 |
| PayPal | 외화-B 이용서비스에 PayPal, USD | `uspay`, test/live PayPal 활성 | 위와 같은 상점 통합 키. 운영 `PAYPAL_CHECKOUT_ENABLED=true` | 위와 동일. 이 조사에서 PayPal 승인을 수행한 것은 아님 |

- 외화-B의 Alipay HK·GCash·Rabbit LINE Pay·Boost·TouchNGo·DANA·BPI·BillEase는 계약 화면에 이용가능으로 표시되지만 현재 `uspay`에서는 선택 해제다. TrueMoney·PayPay는 심사중이다. 코드·계약에 이름이 존재하는 것과 현재 구매자가 사용할 수 있는 수단은 다르다.
- 국내-A와 외화-B의 개별 API 버전 설정은 `2024-06-01`이다. 실제 운영 웹훅 표본도 같은 버전이었다. 한편 gsk로 조회한 국내·해외 카드 테스트 Payment 응답은 `2022-11-16`이었다. 두 버전의 응답을 같은 형식으로 가정하지 않는다.

## 배포 상태와 키 일치 검증

| 대상 | 확인 결과 |
| --- | --- |
| API | `grabit-api-00253-nlb`, 100% 트래픽 |
| 웹 | `grabit-web-00202-gk5`, 현재 배포 revision의 immutable 이미지 정적 JS 검사 |
| 서버 키 | `TOSS_SECRET_KEY`, `TOSS_FOREIGN_EASY_PAY_SECRET_KEY`, `TOSS_OVERSEAS_CARD_SECRET_KEY` 모두 Toss 관리자 live gsk와 값 일치 |
| 브라우저 키 | 실제 배포 이미지의 JS에 포함된 live gck가 관리자 live gck와 일치 |
| 위젯 조합 | 같은 배포 JS에 `DEFAULT,uspay` 존재, 관리자의 해당 두 variant가 국내-A/외화-B에 연결됨 |
| 판매·결제 플래그 | `BOOKING_ENABLED`, `ALIPAY_CHECKOUT_ENABLED`, `PAYPAL_CHECKOUT_ENABLED` 모두 true |
| 환율 설정 | `PAYPAL_KRW_USD_RATE=0.00068`. 운영 설정값이며 시장 환율 검증 결과가 아님 |

키 원문을 파일이나 보고서로 옮기지 않고 메모리에서 SHA-256을 대조해 일치 여부만 남겼다. 원래 개발 checkout의 오래된 `.env`를 운영 설정으로 사용하지 않았다.

## 웹훅

| 환경·대상 | 등록 | 이벤트·버전 | 확인 범위 |
| --- | --- | --- | --- |
| live 국내-A | `Grabit live domestic payment webhook` 1개, `https://api.heygrabit.com/api/v1/payments/toss/webhook` | `PAYMENT_STATUS_CHANGED`, `CANCEL_STATUS_CHANGED`; 개별 API 및 표본 payload `2024-06-01` | 등록 인증 값이 서버의 허용 secret과 일치. 표시된 최근 전송 이력은 성공, 최근 표시 2026-07-06 |
| live 외화-B | `Grabit live payment webhook`, `grabit-usdcard-webhook` 2개, 동일 Grabit endpoint | 두 개 모두 위 두 이벤트. 표본 payload `2024-06-01`, 통화 MUSD | 두 인증 값 모두 서버 설정과 일치. 동일 시각 이벤트가 양쪽 이력에 성공으로 존재, 최근 표시 2026-07-04 |
| test 국내-A | `iconsip`, `https://iconsip.com/api/webhooks/tosspayments` | `PAYMENT_STATUS_CHANGED` | Grabit 테스트 서버가 아닌 다른 서비스로 연결됨 |
| test 외화-B | 없음 | 없음 | Alipay 비동기 완료 검증에 필요한 테스트 수신 경로가 준비되지 않음 |

표시된 성공 이력은 과거 전달의 증거다. 오늘 새 운영 이벤트의 전달이나 전체 이력 무결성을 검증했다는 뜻은 아니다. 운영 웹훅을 재전송하거나 테스트 이벤트를 보내지 않았다. 외화-B의 이중 등록은 설계에서 중복 전달과 멱등 처리를 고려할 입력이다. 삭제가 필요하다고 단정하지 않는다.

테스트 데이터가 다른 제품으로 전달될 수 있는 현재 국내 테스트 웹훅을 Grabit 격리 완료 상태로 간주하면 안 된다. 별도 테스트 가맹점/웹훅 또는 명시적으로 분리된 라우팅을 준비하고, Alipay 테스트 웹훅 수신까지 연결한 뒤 비동기 성공·실패·취소를 검증해야 한다. 이 조사에서는 등록·URL 변경을 하지 않았다.

## Alipay 최소 재현

Grabit 서버·예매·React를 사용하지 않는 localhost 별도 HTML에서 공식 v2 SDK, 실제 가맹점 test gck, `uspay`, USD 259.76으로 검증했다. 매 실행마다 새 주문을 만들고 버튼과 호출 횟수 제한으로 `widgets.requestPayment()`를 한 번만 호출했다.

| 조건 | 호출 횟수 | 실제 결과 |
| --- | --- | --- |
| `foreignEasyPay.country=CN` — 공식 예제 조건 | 1 | failUrl로 복귀, `INVALID_PAYMENT_METHOD`, `Payment has already been requested.` |
| `foreignEasyPay.country=US` — 현행 영어 흐름 조건 | 1 | 위와 동일 |

계약상 Alipay 이용가능·위젯 활성·키 일치까지 확인했다. 따라서 **Grabit의 중복 클릭 또는 미계약만으로 이 오류를 설명할 수 없다.** 정확한 원인은 미확정이다. 동일 Chrome 프로필에서 수행했으며 새 브라우저 프로필 검증은 아니다. SDK·브라우저·테스트 가맹점 처리·외부 결제기관을 구분한 추가 확인이 필요하다. 앱의 F9(실패 복귀 후 대기 예매 회수 실패)와 별개로 추적한다.

확인된 오류 코드·최소 재현 조건을 공급자에게 전달할 수 있게 정리했다. 문의를 발송하지 않았다. 이 오류는 QR 인증 화면 이전에 발생했으므로 전용 테스트 앱 인증과 비동기 완료는 아직 수행하지 못했다.

## 별도 수행한 해외 카드 고객 여정

설정 조사와 구분하여, 기존에 승인된 고객 여정 범위에서 격리 Grabit 사이트를 실제 Chrome으로 조작했다. 합성 일반 계정, 가열 4번 1석, 공식 VISA 테스트 번호를 사용했다. 추가 실카드 입력은 없었다.

| 상태 | Grabit DB | Toss test Payment |
| --- | --- | --- |
| 결제 완료 | CONFIRMED/DONE, 상품·수수료 합계 382,000 KRW, 청구 견적 USD 25,976 minor, 활성 Ticket Item·QR·특전 각 1개, 좌석 sold | DONE, USD 259.76, 잔액 259.76 |
| 고객 전체 취소 | CANCELLED/CANCELED, Ticket Item cancelled, QR revoked, 특전 inactive. 좌석은 재오픈 보류 후 available 복구 확인 | CANCELED, 취소 USD 259.76, cancelStatus DONE, 잔액 0 |

결제 전 Grabit의 ‘KRW 기준으로 청구’ 문구와 결제 완료·환불 안내는 원화만 보여주지만 PG는 USD를 표시했다. F10의 고객 통화 안내 불일치를 실제 해외 카드 성공·취소 흐름으로 보강했다. 서버에는 KRW 주문 금액과 USD 청구 스냅샷이 구분되어 있고 PG 승인·취소 금액도 일치했다. 오청구가 발생했다고 판정하지 않는다.

F1(취소 상태 표시 불일치), F2(취소 뒤 마지막 확인창 잔류)도 해외 카드에서 재현했다. SDK 카드사 `<select>`를 자동 API로 선택했을 때의 위젯 오류는 제외하고, 실제 Chrome 기본 메뉴에서 VISA를 선택해 성공했다. 입력을 막은 Bitwarden 팝업은 직접 닫았다.

## 근거와 남은 범위

- 실제 UI 근거·비밀 제거 JSON: `/Users/sangwopark19/.codex/artifacts/grapit-foreign-payment-2026-09-21/`의 `contract-*.dom.txt`, `widget-*.dom.txt`, `webhooks-*.dom.txt`, `production-*-match.json`.
- 최소 재현: 같은 폴더의 `sdk-harness-server.py`, `sdk-events.jsonl`, `sdk-minimal-*-fail.dom.txt`. localhost에만 바인딩하고 test gck만 허용한다. 승인 API를 호출하지 않는다.
- 해외 카드 PG/DB 대조: `card-before-cancel.json`, `card-after-cancel.json`, `card-readback.cjs`. 실제 제품 코드 수정은 없다.
- 상점 설정 확인은 완료했다. 고객 여정 전체는 Alipay, PayPal, 실기기 앱 전환, 실제 SMS/메일/OAuth 등 미실행 범위가 남아 별도 검증 작업을 열린 상태로 유지한다.

공식 기준: [키 용도·버전](https://docs.tosspayments.com/reference/using-api/api-keys), [위젯 관리자](https://docs.tosspayments.com/guides/v2/payment-widget/admin), [해외 간편결제·비동기 흐름](https://docs.tosspayments.com/guides/v2/payment-widget/integration-foreignpay.md), [해외 카드 테스트](https://docs.tosspayments.com/guides/v2/learn/foreign-payment).

## 종료 상태

14:42 KST 최종 DB 대조: 취소 예매 2건, 만료 실패 3건, 대기 예매 0건. 테스트 결제 2건 모두 CANCELED, QR 3개 모두 revoked, 사용한 좌석 재고 3개 모두 available이다. 해외 카드 좌석도 정해진 보류 시각 후 재판매 가능 상태로 복구됐다. `final-local-state.json`에 최종 수치를 남겼다.

테스트 API·웹·SDK 재현 서버와 이 작업의 PostgreSQL·Valkey 컨테이너를 종료했다. 테스트 데이터와 도구는 재현용으로 보관하며, worktree의 추적된 제품 파일은 변경하지 않았다. 새 해외 카드 test key 연결은 격리 `.env`에만 남긴다. 이번 검증용 Chrome 탭은 닫고 기존 사용자 탭은 보존했다.

- [가맹점 설정 완료 기록](https://github.com/icons-hq/grapit/issues/213#issuecomment-5755904530)
- [고객 여정 추가 실행 기록](https://github.com/icons-hq/grapit/issues/214#issuecomment-5755915477)
