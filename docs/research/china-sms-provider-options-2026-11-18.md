# 중국 전화번호 OTP 대체 경로 조사 — 2026-11-18

공식 자료 조회일: 2026-11-18 (한국시간). 공개 정책과 실제 계정별 발송 허용·단말 수신을 구분한다.

## 판단

**NAVER Cloud SENS를 중국 전용 연동 대상으로 준비한다.** 2026-11-18 사용자가 전달한 공식 고객지원 답변은 중국(+86) 국제 SMS를 별도 신청 없이 이용할 수 있고 OTP 지정 형식을 사용해야 한다고 확인했다. 따라서 초기 조사의 신규 이용 가능 여부 질문에는 답변을 확보했다. 다만 통신사별 실수신 품질은 검증되지 않았으며 안정적인 전달을 보장한다는 답변도 아니다. [SENS 중국 정책](https://guide.ncloud-docs.com/docs/sens-smspolicy), [2026-06-01 장애 정상화 공지](https://www.ncloud.com/support/notice/all/2188)

비교 과정에서 오래된 해외 지원 목록만 보면 잘못 선택할 수 있는 사례를 확인했다. SOLAPI의 과거 요금표에는 중국이 남아 있으나, 더 최근의 공식 공지는 중국 SMS 전면 중단을 명시한다. NHN Cloud도 일반 안내의 OTP 지원 설명과 별개로 중국 상세 등록 요건은 현지 법인을 요구한다. 아래 판단은 상세 국가 정책·후속 공지를 우선했다. [SOLAPI 중단 공지](https://solapi.com/notices/notices-2025-12-10), [NHN 중국 상세 정책](https://nhnnotification.imweb.me/Technology/?bmode=view&idx=17226410&q=YToxOntzOjEyOiJrZXl3b3JkX3R5cGUiO3M6MzoiYWxsIjt9&t=board)

범위: 사용자가 전달한 Twilio 지원 티켓 #30420943 답변을 계기로 조사했다. 중국 현지 법인·명의자·시험 단말은 확보됐다는 증거가 없으며, 사용자는 이번 조사에서 사용할 중국 시험 번호가 없다고 답했다. 이후 승인받아 SENS 비회원 문의를 제출했고 답변을 받았다. 계정 생성·계약·충전·실제 SMS 발송·운영 전환은 수행하지 않았다.

## 국내 사업자 비교

| 사업자 | 공식 자료에서 확인한 중국 경로 | 한국 법인만으로의 적용 판단 | 다음 단계 |
| --- | --- | --- | --- |
| NAVER Cloud SENS | 국가 코드 86 지원, OTP 전용, `〖Verify〗` 자동 서명과 `[{회사명}] verification: {숫자}` 형식 안내. URL 삽입은 사전 경고 없이 차단될 수 있음 | **연동 준비 가능**. 신규 도입 문의에 중국 발송은 별도 신청 없이 가능하다는 답변을 확보. 일반 계정·발신번호 등록은 별도 | 계정·발신번호 설정 및 동의한 단말의 수신·가입 검증 |
| NHN Cloud SMS | 중국 서명·내용 사전 등록 필수, 등록 후에도 차단 가능. 현지 법인 없는 국제기업은 등록 불가 | **현 조건으로 채택 불가**. 중국 현지 법인·사업자등록증과 중국 국적 대표자 요건을 충족한다는 증거 없음 | 해당 자격을 실제 보유한 경우에만 재검토 |
| SOLAPI | 2025-12-05부터 중국 발송 중단, 모든 중국 SMS 실패 처리 공지. 공지 수정일 2026-02-06 | **제외**. 과거 중국 지원·등록 템플릿 안내를 근거로 연동하면 안 됨 | 공급자의 공식 재개 발표가 있을 때만 재검토 |

표 근거: [SENS 정책](https://guide.ncloud-docs.com/docs/sens-smspolicy), [SENS 기업 발신번호 등록](https://www.ncloud.com/support/faq/all/2048), [NHN 상세 가이드](https://nhnnotification.imweb.me/Technology/?bmode=view&idx=17226410&q=YToxOntzOjEyOiJrZXl3b3JkX3R5cGUiO3M6MzoiYWxsIjt9&t=board), [SOLAPI 중단 공지](https://solapi.com/notices/notices-2025-12-10).

### NAVER Cloud SENS

확인된 사실:

- 중국 OTP는 문서상 지원 국가이며 서명이 자동 추가된다. 발신번호는 임의 번호로 변경될 수 있다. 한국 법인이 자기 명의 발신번호를 등록할 때는 사업자등록증과 통신서비스 이용증명원이 필요하며, 일반 서류 등록 심사는 영업일 기준 1~2일로 안내된다. 이는 **중국 발송 승인 소요시간**을 뜻하지 않는다. [중국 정책](https://guide.ncloud-docs.com/docs/sens-smspolicy), [발신번호 등록 FAQ](https://www.ncloud.com/support/faq/all/2048)
- 2026-06-01 15:10~19:35에는 중계사 스팸 신고로 중국 메시지 발송이 제한됐고, 이후 정상화됐다는 공지가 있다. 당시 정상화 사실은 현재 Grabit의 수신 품질을 증명하지 않는다. [장애 정상화 공지](https://www.ncloud.com/support/notice/all/2188)
- API는 `POST /sms/v2/services/{serviceId}/messages`로 메시지를 발송한다. `countryCode` 기본값은 `82`이며 중국 분기에서는 명시적인 `86` 설정이 필요하다. 등록된 `from`, 숫자 수신번호, `content`를 전달하고 HMAC 서명 헤더로 인증한다. SMS 본문은 API 문서상 90byte 이내다. [메시지 발송 API](https://api.ncloud-docs.com/docs/en/sens-sms-send), [API 인증](https://api.ncloud-docs.com/docs/en/sens-overview)
- 공식 정책은 중계사를 통한 해외 통신사 접수 성공과 실제 단말 수신이 다를 수 있다고 설명한다. 과금·API 성공만으로 복구 완료라고 판단할 수 없다. [과금·수신 정책](https://guide.ncloud-docs.com/docs/sens-smspolicy)

미확정 사항:

- China Mobile / China Unicom / China Telecom 각각의 현재 수신 품질과 시험 지원 방법.
- 정확한 회사명 표기(ICONS/Grabit), 공용 서명 처리의 계정별 확인, 요금·비용 한도.
- 공급자 메시지 결과와 실제 단말 수신·OTP 검증·가입의 일치 여부. 공식 답변은 OTP 지정 형식과 별도 중국 신청이 불필요하다는 점을 확인했지만, 질문별 상세 답변과 실수신 증거까지 제공한 것은 아니다.

### NHN Cloud SMS

NHN 공식 문서는 [국가별 상세 가이드](https://nhnnotification.imweb.me/Technology/?bmode=view&idx=17226410&q=YToxOntzOjEyOiJrZXl3b3JkX3R5cGUiO3M6MzoiYWxsIjt9&t=board)를 직접 연결한다. 중국 항목은 현지 법인이 없는 국제기업·홍콩/마카오 기업 등을 등록 불가 대상으로 분류한다. 등록에는 중국 현지 사업자등록증과 해당 대표자의 중국 신분증, 중국어 간체 회사명 서명·본문 등이 필요하다. 미등록 상태로 발송 요청을 해도 수신을 보장하지 않으며 등록 후에도 통신사 필터링 가능성이 있다. [공식 문서의 상세 가이드 연결](https://docs.nhncloud.com/ko/Notification/SMS/ko/international-sending-policy/), [중국 등록 요건](https://nhnnotification.imweb.me/Technology/?bmode=view&idx=17226410&q=YToxOntzOjEyOiJrZXl3b3JkX3R5cGUiO3M6MzoiYWxsIjt9&t=board)

검토한 SMS API는 발송 본문을 받는 전송 API다. `X-Secret-Key`, appKey, 발신번호·수신번호와 본문을 설정하며, 발송 전환율을 보고하는 기능도 있다. 이 API를 Twilio Verify의 코드 생성·검증 API와 같은 것으로 취급하면 안 된다. [SMS API](https://docs.nhncloud.com/en/Notification/SMS/en/api-guide/)

### SOLAPI

과거 해외 발송 문서는 중국용 등록 템플릿을 안내하지만, [2025-12-10 중단 공지](https://solapi.com/notices/notices-2025-12-10)는 2025-12-05 22:00 KST부터 중개업체를 통한 중국 SMS 발송이 불가능해져 중국행 모든 SMS가 실패한다고 명시한다. 현재 공지 목록에서도 해당 공지를 연결한다. 따라서 본 조사에서 대체 경로로 추천하지 않는다. [현재 공지 목록](https://solapi.com/notices)

확인 방법: 공식 공지 목록의 해당 항목을 열고, `solapi.com` 본문에서 제목·작성일 2025-12-10·수정일 2026-02-06 및 “중국으로 발송되는 모든 SMS는 실패 처리됩니다.” 문구를 확인했다. 예전 `solapi.dev` 주소의 콘솔 리다이렉트와 과거 요금표를 현재 지원 근거로 사용하지 않았다. [확인한 공개 본문](https://solapi.com/notices/notices-2025-12-10)

## 글로벌 사업자 검토 결과

| 사업자 | 현재 공식 요건 / 제한 | Grabit 적용 판단 |
| --- | --- | --- |
| Infobip | 2025-12-05부터 중국 generic signature 폐지. 국제 고객도 중국 본토 사업자등록증, 필요한 경우 상표증, 중국인 ID와 중국 휴대폰 필요. 등록 템플릿과 정확히 일치해야 함 | 관리형 OTP는 제공하지만 현 자격으로 즉시 대체할 근거 없음 |
| Alibaba Cloud 국제판 | 2026-09-21 문서상 정책 제한으로 신규 Go China 이용 불가. 기존 사용자는 서명 실명 인증 필요 | 새 계정 개설 후 바로 중국 발송하는 경로로 선정 불가 |
| Tencent Cloud | 2026-09-18 중국 국내 SMS 자격 문서는 중국 본토 회사만 서명 신청 가능. 해외 법인은 국제/홍콩·마카오·대만 SMS용으로 분리 | 한국 법인만으로 본토 SMS를 개통할 수 있다고 볼 근거 없음 |

근거: [Infobip 중국 등록](https://www.infobip.com/docs/essentials/asia-registration/china-sms-registration-and-template-guidelines), [Infobip 관리형 OTP](https://www.infobip.com/docs/2fa-service/using-2fa-api), [Alibaba Go China 신규 제한](https://www.alibabacloud.com/help/en/sms/user-guide/create-sms-signatures), [Tencent 본토 SMS 자격](https://cloud.tencent.com.cn/document/product/382/108274).

Infobip 2FA는 PIN 생성·발송 후 `pinId`로 사용자가 입력한 PIN을 검증하는 관리형 서비스다. API 형태는 Twilio Verify에 가까우나, 이 기능이 중국 발송 등록 요건을 면제하지 않는다. Alibaba에서 한국 사업자 서류로 일반 기업 계정 인증이 가능하다는 설명도 개별 상품의 신규 중국 SMS 중단을 해제하지 않는다. [Infobip 2FA](https://www.infobip.com/docs/2fa-service/using-2fa-api), [Alibaba 계정 인증 범위](https://www.alibabacloud.com/help/en/account/account-verification-overview), [상품별 제한](https://www.alibabacloud.com/help/en/sms/user-guide/create-sms-signatures)

## 현재 구현에 미치는 영향

운영 기준선은 Twilio Verify가 코드 생성·만료·검증을 맡고, 앱이 발송 제한·pending marker·목적별 단회 사용 증명 토큰을 관리한다. SENS/NHN에서 조사한 API는 고객이 작성한 본문을 보내므로, 발송 SDK만 교체하면 OTP 검증이 완성되지 않는다. 이 작업 브랜치에는 중국 전용 SENS 전송과 OTP 상태 관리, 발송 결과 불명 안내를 추가했으며 기본값은 Twilio다. 아래는 공식 전송 API와 서비스 경계를 비교한 **구현 판단**이며 설정·전환 절차는 [운영 runbook](../runbooks/china-sms-sens.md)에 정리했다. [SENS 발송 API](https://api.ncloud-docs.com/docs/en/sens-sms-send), [NHN 발송 API](https://docs.nhncloud.com/en/Notification/SMS/en/api-guide/), [Twilio 클라이언트](../../apps/api/src/modules/sms/twilio-verify-client.ts), [SmsService](../../apps/api/src/modules/sms/sms.service.ts)

- 중국 번호 전용 경로의 OTP 생성·보호 저장·만료·검증 시도 제한·재발송 및 단회 사용 처리가 필요하다.
- 기존 phone verification token의 목적 구분과 단회 claim, 번호·전체 비용 제한을 유지해야 한다.
- 인증 도중 사업자를 전환하면 기존 코드를 잘못 검증할 수 있으므로 발송한 사업자와 인증 상태를 함께 고정해야 한다.
- 공급자 접수·단말 수신·OTP 승인·가입 완료를 구분해 검증해야 한다. 실제 단말 또는 공급자가 제공하는 검증 가능한 시험 경로가 없는 현재 상태에서는 mock API 테스트만으로 중국 복구 완료를 선언할 수 없다.

Twilio 음성 OTP로 즉시 우회하는 안도 사용할 수 없다. Twilio는 중국행 Verify/Authy 음성 OTP API를 2023-07-10부터 차단한다고 공지했다. [Twilio 중국 Voice OTP 차단](https://help.twilio.com/articles/17023450335131-Verify-Voice-OTP-to-China-Blocked)

## 권장 다음 단계

1. 확보한 SENS 답변을 바탕으로 계정·프로젝트·발신번호·인증키를 준비한다. 계정 개설·비용·운영 변경은 별도 승인 범위를 따른다.
2. 중국 전용 공급자와 OTP 상태 관리의 로컬 검증 후 기본 Twilio 경로로 호환 코드를 먼저 배포한다.
3. 동의한 중국 실단말에서 발송→수신→코드 검증→가입을 확인한 뒤 운영 전환한다. 여러 중국 통신사에서 검증하는 것이 바람직하지만 현재 시험번호는 없다.

최초 지원 문의 초안(이후 확장한 내용으로 제출 완료):

> 한국 법인 ICONS가 운영하는 티켓 예매 서비스 Grabit(https://heygrabit.com/)의 가입용 6자리 OTP를 중국 +86 번호에 보내려 합니다. 중국 현지 법인은 확인되지 않은 상태입니다. 2026-11 현재 신규 고객의 중국 OTP 발송을 받고 있는지, 중국 본토 사업자등록증 없이 이용할 수 있는지 확인 부탁드립니다. 문서의 〖Verify〗 자동 서명 및 영문 OTP 템플릿이 현재도 적용되는지, 중국 3대 통신사별 지원 범위, 추가 서명·템플릿 심사와 준비 서류·예상 기간·요금, 실제 수신 검증 지원 방법을 알려주세요. 현재 중국 시험 단말은 없으며 API 접수 성공과 실제 수신 성공을 구분하여 검증하려 합니다.

이 문의는 발송 가능성 검증 단계다. 문의 초안 작성은 외부 발송·계약·지출·보안 설정 변경의 승인으로 취급하지 않는다.

## 비회원 문의 준비 상태

2026-11-18 실제 [서비스 문의 화면](https://www.ncloud.com/support/question/service)에서 로그인 없이 `Application Services > Simple & Easy Notification Service (SENS) > SMS` 분류를 선택할 수 있음을 확인했다. 사용자가 답변 연락처를 제공하고 제출을 승인해 문의를 제출했고, 접수 완료를 확인했다. 이후 사용자가 문의 `W20261118385235`에 대한 답변 `A20261118391085`를 전달했다.

답변은 중국 국제 SMS의 별도 신청 불필요, 임의 발신번호 표시, OTP 지정 문구를 확인했다. 과금 기준인 발송 성공은 중계사를 통한 해외 통신사 요청 성공이며 단말 미수신이어도 과금될 수 있고, SENS API에서 발송 목록·결과를 조회할 수 있다고 안내했다. 계정 생성·계약·결제·SMS 발송 또는 운영 전환은 실행하지 않았다. 연락처 원문은 이 문서에 저장하지 않는다.
