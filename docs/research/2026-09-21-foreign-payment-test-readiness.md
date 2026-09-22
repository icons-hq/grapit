# 해외 결제 sandbox 검증 준비 조건 — 2026-09-21

공식 Toss·Antom·PayPal·ngrok 문서와 현재 소스를 읽어 남은 검증 조건을 정리했다. 기준 커밋은 `9a6ca20a8a19ac302b69bf459cc64605cb5dd961`이다. 이 조사에서는 앱 설치, 로그인, 결제, 웹훅 등록·변경, 공급자 문의를 실행하지 않았다. 키·전체 MID·거래 식별자·로그인 비밀번호는 기록하지 않는다.

| 항목 | 확인 | 미확인 | 다음 실행 |
| --- | --- | --- | --- |
| Alipay | 공식 테스트 앱과 Toss 제공 테스트 로그인 절차가 존재한다. 실제 가맹점의 설정 확인과 독립 SDK 1회 호출 재현은 선행 조사에서 완료했다 | `INVALID_PAYMENT_METHOD`와 `Payment has already been requested.` 조합의 원인, 해당 가맹점의 sandbox QR 생성·승인 | 새 브라우저 세션에서 최소 재현 1회와 공급자 응답을 기록한다. QR 생성에 성공해야 테스트 앱 인증과 비동기 완료를 진행한다 |
| PayPal | Toss 테스트 결제에는 PayPal Personal Sandbox 계정이 필요하다 | 접근 가능한 개발자 계정·Personal 계정, 실제 승인·취소 | 기존 개발자 계정의 Personal Sandbox를 확보해 USD 결제 → 복귀 → 승인 → 취소를 검증한다 |
| 웹훅 | 외부에서 접근 가능한 수신 주소와 MID별 등록이 필요하다. 현재 webhook 성공 코드에 명시적 HTTP 200이 없다 | 외화-B test 웹훅 수신, 중복·지연 전달, 실제 HTTP 응답·시간 | 로컬 HTTP 200 계약을 먼저 검증한 후 외화-B의 test에만 별도 수신 경로를 등록한다 |

가맹점 설정·기존 거래 사실은 [선행 설정 진단](2026-09-21-payment-merchant-settings-audit.md), 고객 화면 문제는 [고객 여정 진단](2026-09-21-customer-journey-audit.md)을 따른다. 이번 조사는 그 성공·실패를 다시 실행했다는 뜻이 아니다.

## 1. Alipay

### 확인

- Toss는 Alipay 등 중국·동남아 간편결제를 비동기 방식으로 안내한다. 정상 요청 후 `pendingUrl`에 도착하며, 최종 결과는 `PAYMENT_STATUS_CHANGED` 웹훅으로 판단한다. 처리에는 최대 10분이 걸릴 수 있다. 테스트 앱으로 Alipay와 Touch 'n Go를 시험하는 절차와 공개 테스트 로그인 정보가 있다. [Toss 해외 간편결제](https://docs.tosspayments.com/guides/v2/payment-widget/integration-foreignpay.md)
- Toss 문서의 **테스트 앱 다운로드**는 [Alipay+ 배포 페이지](https://g.alipayplus.com/page/aplus-linker/acwallet/download.html), **테스트 앱 사용 방법**은 현재 [Antom Test wallet](https://docs.antom.com/ac/ref/testwallet)로 연결된다. iOS는 TestFlight의 `IAP_Wallet+`, Android는 공식 APK를 안내한다. 앱에서 대상 wallet을 Alipay로 선택한 뒤 sandbox QR을 스캔한다. iOS 직접 안내 링크는 [TestFlight](https://testflight.apple.com/join/eFAxdeIz)다. 계정 원문은 Toss 공식 문서에서 확인하며 이 보고서에 복제하지 않는다.
- Antom은 데스크톱에서 QR이면 테스트 앱으로 스캔하고, 계정·비밀번호 형식의 **sandbox 모의 화면이 실제 표시되는 경우**에는 임의 값으로 진행할 수 있다고 설명한다. 이는 모든 Alipay 흐름이 데스크톱만으로 완료된다는 보장이 아니다. 모바일 흐름에는 테스트 앱이 필요하다. [Antom digital wallet testing](https://docs.antom.com/ac/ref/wallet)
- 위젯 이용서비스, 계약 MID와 연결된 test 키, `variantKey`, USD 금액, 리다이렉트 주소가 연동 조건이다. `foreignEasyPay.country`는 구매자가 위치한 국가의 ISO 2자리 코드이며 화면 언어와 동일한 개념이 아니다. [Toss 해외 결제 설정](https://docs.tosspayments.com/guides/v2/learn/foreign-payment), [v2 SDK](https://docs.tosspayments.com/sdk/v2/js/payment-widget)
- 선행 조사에서 외화-B Alipay 이용가능, test `uspay` 활성, test 키 일치가 확인됐다. [독립 재현 코드](/Users/sangwopark19/.codex/artifacts/grapit-foreign-payment-2026-09-21/sdk-harness-server.py)는 test gck만 허용하고, 새 주문에서 SDK 호출을 1회로 제한한다. CN과 US에서 모두 같은 오류가 났다. 따라서 앱의 중복 클릭이나 국가 코드 하나만을 원인으로 확정할 근거가 없다. [선행 설정 진단](2026-09-21-payment-merchant-settings-audit.md)

### 미확인

공식 API 오류표의 `INVALID_PAYMENT_METHOD` 설명은 링크페이 등 해당 API 문맥의 ‘유효하지 않은 결제수단’이다. 조사한 공식 SDK·연동·오류 문서에서 현재의 **오류 코드와 영문 메시지 조합**을 Alipay sandbox의 특정 설정이나 중복 요청으로 설명하는 항목을 찾지 못했다. 동일 문자열을 올린 커뮤니티 이용자의 질문은 공급자 원인 설명으로 채택하지 않았다. [Toss API 오류표](https://docs.tosspayments.com/reference/error-codes)

QR 생성 전 실패이므로 테스트 앱을 설치하지 않은 것이 이번 오류의 원인이라고 단정할 수 없다. 웹훅 미등록은 최종 비동기 검증을 막지만, QR 생성 전 오류를 유발했다는 근거는 없다. 가맹점의 sandbox 하위 설정, 공급자 처리, 브라우저 세션 영향은 아직 구분되지 않았다.

### 다음 실행

1. 별도 브라우저 세션에서 동일 test 키·USD·`uspay`·새 주문·단일 호출을 유지해 1회 실행하고, 리다이렉트 직전 실패 응답과 시각을 비밀 제거 형태로 보관한다.
2. QR이 생성되면 공식 테스트 앱으로 승인하고 `pendingUrl` → 웹훅 → 예매·QR 발급 → 취소 웹훅을 연결한다. 앱 설치·로그인 성공 여부는 별도로 확인한다.
3. 같은 오류가 반복되면 현재 재현 자료에 공급자 요청 추적 정보를 추가해 기술지원용 자료를 완성한다. 운영 키로 우회해 원인을 추정하거나 반복 결제를 늘리지 않는다. 문의 발송은 이 조사에서 수행하지 않았다.

## 2. PayPal

### 확인

- Toss의 현재 가이드는 PayPal Developer Dashboard에서 **Testing Tools → Sandbox Accounts → Personal** 계정을 생성하고, 그 계정의 이메일·비밀번호로 결제창에 로그인하도록 안내한다. PayPal은 USD를 사용한다. [Toss PayPal 테스트](https://docs.tosspayments.com/guides/v2/learn/foreign-payment#paypal-테스트)
- PayPal 개발자 등록 시 기본 Personal·Business sandbox 계정이 생긴다. 구매자는 Personal, 판매자는 Business 역할이다. 추가 Personal 생성 시 국가를 선택하며 이메일·비밀번호와 기본 잔액이 제공된다. 문서의 `sb-[random-string]@personal.example.com`은 계정 형식 예시이며 모든 이용자가 공유하는 로그인 계정이 아니다. [PayPal Sandbox accounts](https://developer.paypal.com/sandbox-testing/accounts)
- 조사한 **현재 공식 가이드에서 바로 사용할 수 있는 공개 공용 PayPal 구매자 계정은 확인하지 못했다**. Toss 문서의 중국·동남아 간편결제 공용 계정을 PayPal에 사용하면 안 된다. Toss는 Personal 계정을 직접 준비하라고 명시한다. [Toss FAQ](https://docs.tosspayments.com/resources/faq)
- Toss를 경유한 PayPal은 `successUrl` 복귀 후 Toss 승인 API를 호출하는 동기 흐름이다. Grabit 테스트를 위해 PayPal 판매자 API 키를 새로 발급·교체할 필요가 있다는 요구는 이 문서에서 확인되지 않는다. 구매자 Personal 계정을 먼저 준비하는 것이 현재 확인된 최소 조건이다. [Toss 해외 간편결제](https://docs.tosspayments.com/guides/v2/payment-widget/integration-foreignpay.md)

### 미확인

사용자가 접근 가능한 PayPal 개발자 계정과 Personal Sandbox 계정의 존재·로그인 상태는 이번 공개 자료 조사로 확인하지 않았다. 국가별 구매자 경험, 잔액 부족, 결제 중단·재시도, 승인·취소 결과도 미실행이다. 화면에 PayPal이 노출되고 계약이 표시된 사실만으로 해당 여정이 성공한다고 판정하지 않는다.

### 다음 실행

기존 개발자 계정의 Personal Sandbox를 사용하거나 새 합성 Personal 계정을 준비한다. Grabit의 외화 test 주문에서 로그인 → 결제 복귀 → 서버 승인 → 예매·QR·특전 → 전액 취소를 검증한다. 인증 정보는 브라우저 또는 제한된 로컬 테스트 저장소에서만 취급한다. PayPal 취소에서는 `CANCEL_STATUS_CHANGED`를 완료 조건으로 기다리지 않는다. 해당 이벤트는 비동기 해외 간편결제 전용이며, PayPal·해외 카드 같은 동기 결제에는 발송되지 않는다. [Toss 웹훅 이벤트](https://docs.tosspayments.com/reference/using-api/webhook-events#cancel_status_changed)

## 3. 다른 제품에 영향을 주지 않는 웹훅 시험

### 확인

Toss 웹훅은 MID마다 등록·전송된다. `localhost`를 직접 등록할 수 없으며 외부에서 접근 가능한 주소가 필요하다. 공식 가이드는 ngrok으로 로컬 수신 포트를 연결하는 방법을 제시한다. HTTPS를 권장하며, 수신 후 **10초 안에 HTTP 200**을 반환하도록 안내한다. 실패 시 최대 7회, 최초 전송으로부터 3일 19시간까지 재전송된다. [Toss 웹훅 연결](https://docs.tosspayments.com/guides/v2/webhook)

ngrok의 현재 quickstart에는 계정, authtoken, Agent CLI가 필요하다. 공개 HTTPS URL이 로컬 포트로 전달된다. 웹훅에 대화형 Google 로그인 같은 보호를 적용하면 공급자가 통과할 수 없으므로 웹훅용 인증을 사용해야 한다. 이 조사에서는 CLI 설치나 터널 생성을 하지 않았다. [ngrok quickstart](https://ngrok.com/docs/share-localhost/quickstart)

`PAYMENT_STATUS_CHANGED`에는 Payment, `CANCEL_STATUS_CHANGED`에는 Cancel 객체가 들어온다. 전송 ID·재전송 횟수 헤더를 기록할 수 있다. 공식 서명 헤더의 HMAC 검증 설명은 `payout.changed`·`seller.changed` 전용이므로 결제 이벤트에도 같은 서명이 온다고 가정하면 안 된다. [Toss 웹훅 이벤트](https://docs.tosspayments.com/reference/using-api/webhook-events)

### 현재 소스의 HTTP 응답 계약

| 확인 지점 | 코드 사실 | 판단 |
| --- | --- | --- |
| [controller](../../apps/api/src/modules/payment/payment-webhook.controller.ts) 113–161행 | `@Post('webhook')`, 정상·중복 경로 모두 객체 반환. `@HttpCode(200)`·`@Res()` 없음 | 명시적인 성공 HTTP 200 경로가 없다 |
| [bootstrap](../../apps/api/src/main.ts) 47–92행, [AppModule](../../apps/api/src/app.module.ts) | 전역 filter·pipe·guard가 있고 성공 응답을 200으로 바꾸는 interceptor/middleware 등록 없음 | 이 두 곳에서 기본 상태코드를 덮어쓰지 않는다 |
| 설치된 Nest core `router-execution-context.js` 65–68행, `router-response-controller.js` 37–41행 | HTTP code metadata가 없으면 메서드 기본값을 사용하며 POST 기본값은 201 | 현재 소스의 정상·중복 응답은 201 경로로 계산된다. [Nest 공식 상태코드](https://docs.nestjs.com/v11/controllers#status-code)와 일치한다 |
| [기존 controller 테스트](../../apps/api/src/modules/payment/toss-webhook.controller.spec.ts) 81–84행 이후 | 컨트롤러를 직접 생성해 메서드를 호출한다. `apps/api/test`에서도 webhook URL에 대한 HTTP 통합 검증을 찾지 못함 | 객체 결과 검증이 HTTP 200 보장을 대신하지 못한다 |

이는 현재 코드와 설치된 프레임워크의 정적 확인이다. 이번 조사에서 실제 HTTP 요청을 전송하지 않았고, 운영의 과거 ‘웹훅 성공’ 표본이 어떤 상태코드로 인정됐는지 다시 검증하지 않았다. 구현 단계에서 정상·중복 요청의 HTTP 200과 실패 시 비성공 응답을 실제 HTTP 경계에서 확인해야 한다.

현재 [TossWebhookGuard](../../apps/api/src/modules/payment/toss-webhook.guard.ts)는 테스트 전용 공유 인증값을 header·Bearer·`tossWebhookSecret` query에서 받을 수 있다. controller는 이벤트를 기록하고 PG 조회 결과를 대조한 뒤 상태를 반영한다. 운영 인증값을 테스트에 복제하지 않고 이 확인 경로를 유지한다.

### 권장 최소 구성 — 설계 제안

```text
외화-B / TEST의 새 웹훅 1개
  → 공개 HTTPS 터널
  → 127.0.0.1의 전용 POST 수신기
  → 격리 Grabit API /api/v1/payments/toss/webhook
  → 테스트 DB + Toss test gsk 조회
```

1. 먼저 격리 API에 정상·중복 응답 `200` 검증을 추가한다. 공급자 실패나 DB 반영 실패를 무조건 200으로 덮는 수신기를 만들지 않는다.
2. API 전체를 공개하기보다 한 경로만 전달하는 전용 로컬 포트를 터널에 연결한다. 테스트 전용 인증값·요청 크기 제한을 적용하고 다른 메서드·경로는 차단한다. 인증값과 전체 거래 식별자를 URL·인스펙터·보고서에 노출하지 않도록 로그를 제한한다.
3. `uspay`가 연결된 **외화-B의 test**에 새 이름으로 `PAYMENT_STATUS_CHANGED`, `CANCEL_STATUS_CHANGED`를 등록한다. 외화-B test에는 현재 등록이 없다는 선행 조사 결과를 등록 직전에 다시 확인한다. 기존 국내-A `iconsip`와 모든 live 웹훅은 변경하지 않는다.
4. 로컬 테스트 주문만 처리하도록 확인하고 PG 조회도 test 키로 수행한다. 테스트 수신기에서 출처 인증·실제 주문·금액·통화를 검증하며, 중복·지연 이벤트가 좌석·발권을 반복 변경하지 않는지 시험한다. 전송 ID만으로 모든 업무 중복이 제거된다고 가정하지 않는다.
5. 공급자 전송 이력, 로컬 수신, PG 상태, 예매·QR·취소 상태를 대조한다. PayPal·해외 카드의 취소는 동기 응답과 `PAYMENT_STATUS_CHANGED`, Alipay는 `CANCEL_STATUS_CHANGED`까지 구분한다.
6. 종료 전에 pending 이벤트·거래를 확인하고 이번 시험에서 만든 웹훅 등록만 제거한 뒤 터널을 닫는다. 터널만 먼저 종료하면 이후 이벤트·재시도가 실패할 수 있다.

**국내-A에는 새 수신 URL만 추가해도 기존 `iconsip` 전송을 막을 수 없다.** 공식 등록 단위는 MID·이벤트이므로 별도 URL 추가를 제품 간 완전 격리로 부르지 않는다. 국내 결제의 완전한 테스트 격리가 필요하면 독립 test MID 또는 검증된 별도 라우팅이 추가로 필요하다. 이번 최소 구성은 외화-B의 현재 빈 test 경로를 활용하는 제안이다. [등록 단위](https://docs.tosspayments.com/guides/v2/webhook), [현재 가맹점 상태](2026-09-21-payment-merchant-settings-audit.md)

### 미확인·다음 실행

외부 HTTPS 주소·ngrok 계정/CLI 준비, 외화-B test 등록 성공, 실제 200 응답 시간, 가맹점 웹훅 버전별 payload, 웹훅 도착 전·후 브라우저 복귀 순서, 재전송 중복·지연 동작은 아직 실행하지 않았다. 로컬 수신기를 완성해 HTTP 경계 검증을 통과시킨 뒤 외화 test 경로를 연결하고, 그 결과를 Alipay·PayPal 검증 기록과 함께 남긴다.
