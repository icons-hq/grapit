# 일반 고객 직접 조작 진단 — 2026-09-21

설계 확정 전에 국내 신규 고객과 싱가포르 영어 고객을 가정해 가입, 탐색, 좌석 선택, 결제, 티켓 조회, 취소, 계정 설정을 실제 브라우저에서 조작했다. **현대카드 Toss 테스트 승인 → 사이트 복귀 → 2석 예매 확정 → 좌석별 QR → 전체 취소 → PG 취소 완료까지 확인했다.** 실금전 거래나 운영 데이터 변경은 없었다.

전체 고객 검증은 아직 완료가 아니다. 해외 승인 성공, 실제 모바일 앱 전환, 실메일/SMS 도달, 소셜 로그인, 비밀번호 변경·탈퇴 최종 제출은 남아 있다. [설계 전에 일반 고객의 전체 예매·결제·취소 여정을 직접 검증한다](https://github.com/icons-hq/grapit/issues/214)는 열린 상태로 유지한다.

## 검증 조건

- 기준 코드: `9a6ca20a8a19ac302b69bf459cc64605cb5dd961`.
- 격리 worktree: `/Users/sangwopark19/.codex/worktrees/grapit-customer-journey/grapit`.
- 새 PostgreSQL `127.0.0.1:55432/grabit_journey`, Valkey `127.0.0.1:56379`, API 8080, 웹 3000. 기존 운영 DB를 복사하거나 수정하지 않았다.
- 저장소 seed 공연에 미래 회차, 판매 허용, 4매 한도, 좌석별 포함 포토카드를 설정했다. seed의 오래된 공연 설명·포스터·층 이름은 운영 콘텐츠 평가에서 제외했다. 기존 좌석 자료를 사용하는 경로이며, 운영의 모든 신규 레이아웃/재오픈 정책을 대표하지 않는다.
- 일반 사용자 UI로 만든 합성 계정 2개. 국내 고객은 동행 2매, 해외 고객은 SG 국가·+65 번호·영어 화면·1매를 가정했다. 페르소나는 검증 시나리오이며 실제 고객 인터뷰 결과가 아니다.
- 이메일은 개발 발송 대역에서 실제 생성된 인증번호를 기록해 사용했고 SMS는 기존 개발 대역을 사용했다. OTP 생성·오답·재발송·검증은 실제 앱 로직, 외부 도달은 대역이다.
- Toss는 가맹점 `test_` 키로 실제 SDK와 테스트 PG를 호출했다. 현대카드 소유자 인증은 사용자가 직접 했고, 이후 결제 완료 버튼과 취소는 에이전트가 조작했다.
- Chrome과 앱 내 브라우저 사용. 데스크톱 및 390×844 요청 뷰포트로 검증했다. Chrome 확대율 때문에 일부 실제 CSS 뷰포트는 354×767이었다. 실기기·모바일 UA·은행/지갑 앱 전환 검증으로 간주하지 않는다.
- 로컬 Next 개발 서버의 이중 rewrite가 언어를 한국어로 덮는 현상은 임시 테스트 보정으로 우회했다. 컴파일된 개발 메일 대역에는 로컬 수신함 기록을 추가했다. 제품 수정으로 제출하지 않는다.

## 결제·환불 교차 검증

| 항목 | 실제 확인 |
| --- | --- |
| 결제 금액 | 좌석 760,000원 + 예매 수수료 4,000원 = 764,000원 |
| Toss 승인 조회 | `DONE`, totalAmount 764000, balanceAmount 764000 |
| 앱 승인 상태 | 예매 CONFIRMED, 결제 DONE, Ticket Item 2개 활성, QR 2개, 포함 특전 2개 |
| 취소 미리보기 | 전체 취소, 환불 764,000원, 취소 수수료 0원, 예매 수수료 4,000원 환불 |
| Toss 취소 조회 | `CANCELED`, balanceAmount 0, cancelAmount 764000, cancelStatus `DONE` |
| 앱 취소 상태 | 예매 CANCELLED, 결제 CANCELED, Ticket Item 2개 cancelled, QR 2개 revoked, 특전 2개 inactive |
| 좌석 상태 | 취소된 두 좌석의 inventory가 available. 이번 경로의 reopenState는 not_required |
| 중복 거래 여부 | 승인된 결제 레코드는 1건. 취소 뒤 결제 복귀 URL 재방문으로 발권·결제가 재활성화되지 않음 |

PG 취소 완료와 카드 명세서 반영은 서로 다른 단계다. 위 결과는 테스트 PG 취소 완료를 뜻하며 실제 카드 명세서 입금까지 확인했다는 뜻이 아니다.

[승인 조회 근거](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/provider-before-cancel.json) · [취소 조회 근거](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/provider-after-cancel.json)

## 우선 반영할 문제

### F1 · P1 · PG 취소 완료가 고객 환불 진행 상태에 반영되지 않는다

전체 취소 후 다시 로그인해 상세를 열어도 현재 단계가 ‘처리 중/환불 요청됨’이다. 동시에 같은 화면에는 ‘결제사 취소 완료’ 시각이 존재한다. 고객은 다시 문의하거나 취소가 안 됐다고 판단할 수 있다.

- 재현: 테스트 승인 → 전체 취소 → PG 상태 조회 → 새 로그인 → 취소 예매 상세.
- 코드: [reservation.service.ts:1525](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.ts#L1525)는 CANCELLED를 REQUESTED로 고정한다. [1785행](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.ts#L1785)은 좌석 재오픈 상태로 환불 상태를 판단한다.
- 개편 검증 조건: PG 처리 상태, 금융기관 반영 안내, 좌석 재판매 상태를 독립적으로 표현한다. 재로그인/새로고침에도 동일한 취소 완료 상태를 보여야 한다.
- [실제 모바일 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/51-refund-still-processing.jpg)

### F2 · P1 · 취소 성공 뒤 최종 확인창이 닫히지 않는다

취소를 실행한 뒤 뒤쪽 예매는 취소완료로 바뀌지만 ‘마지막 확인’ 창과 취소 버튼이 남는다. 직접 ‘이전으로 → 닫기’를 눌러야 빠져나왔다. 반복 취소 클릭을 유도할 수 있으나 중복 환불이 발생했다고 확인한 것은 아니다.

- 코드: [cancel-confirm-modal.tsx:87](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/reservation/cancel-confirm-modal.tsx#L87)의 확인 동작과 [상세 페이지:27](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/app/mypage/reservations/%5Bid%5D/page.tsx#L27)에 성공 후 모달 닫기 처리가 없다.
- 개편 검증 조건: 성공 시 창을 닫고 취소된 상세로 이동한다. 요청 중 중복 동작을 막고 실패 시에만 재시도를 제공한다.
- [취소 후 남은 확인창](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/33-cancelled-qr-invalid.jpg)

### F3 · P1 · 예매 중 회원가입을 마치면 원래 공연으로 돌아오지 않는다

공연에서 예매 버튼 → 로그인 필요 → 가입 → 휴대폰·이메일 인증을 완료했지만 비로그인 홈으로 이동했다. 다시 로그인하고 공연을 검색해야 했다. 기존 계정의 로그인 returnTo는 정상 동작했다.

- 코드: [email-verification-status.tsx:76](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/auth/email-verification-status.tsx#L76)는 인증 완료 시 홈으로 이동한다.
- 개편 검증 조건: 가입·인증 전 과정에서 안전한 returnTo를 보존하고 원래 예매로 안내한다. 인증 후 추가 로그인이 필요하면 이를 명확히 알린다.
- [가입 후 복귀 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/07-after-signup-lost-booking.jpg)

### F4 · P1 · 영어 고객의 핵심 업무가 한국어로 바뀐다

영어 검색과 번역된 공연 제목 검색은 정상이다. 하지만 영어 가입의 필드 오류, 예매 날짜·회차·좌석·주문 요약, 프로필 폼, 약관/개인정보 본문은 한국어가 남아 있다. `/en/mypage`에서 Settings/Ticket wallet을 누르면 `/mypage?...`로 이동해 언어 접두사도 사라진다. 앱 내 브라우저에서도 재현돼 Chrome 번역 확장 프로그램 영향과 구분된다.

- 코드: [mypage/page.tsx:147](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/app/mypage/page.tsx#L147)의 비지역화 경로, [auth.schema.ts:10](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/packages/shared/src/schemas/auth.schema.ts#L10)의 한국어 검증 메시지, `profile-form.tsx`·`date-picker.tsx`·`order-summary.tsx`의 표시 문구.
- 개편 검증 조건: 시작 언어를 가입부터 환불·계정 설정까지 유지한다. 서버 검증 오류와 정책 본문도 같은 언어로 이해할 수 있어야 한다.
- [모바일 예매](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/43-english-mobile-booking-korean.jpg) · [영어 설정](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/39-english-settings-korean-form.jpg) · [영어 경로의 개인정보 본문](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/48-english-privacy-korean.jpg)

### F5 · P1 · 결제 직전 공연 시간이 UTC 원문으로 표시된다

공연 상세의 11:58 KST가 주문 요약에서는 `2026-11-20T02:58:07.592Z`로 나온다. 시간대와 형식을 이해하지 못하면 다른 공연 시간으로 오인할 수 있다.

- 코드: [order-summary.tsx:50](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/booking/order-summary.tsx#L50)의 showDateTime 원문 렌더링.
- 개편 검증 조건: 상세·좌석 선택·주문·완료·티켓에 동일한 공연 기준 시간대와 날짜를 사용하고 해외 고객의 현지 시간은 구분해서 표시한다.
- [결제 요약 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/14-checkout-summary.jpg)

### F6 · P2 · 취소된 티켓에도 이메일 발송 버튼이 활성화된다

새로 로그인한 취소 예매 상세에서 ‘티켓 이메일 보내기’를 누르면 HTTP 404 / ‘QR 티켓을 찾을 수 없습니다’가 나온다. 서버가 취소된 티켓 발송을 거절하는 것은 정상이며, 고객에게 불가능한 동작을 제시하는 화면이 문제다. 같은 영역의 ‘공연 24시간 전에 다시 발송’ 안내도 취소 상태에 맞지 않는다.

- 코드: [reservation-detail.tsx:1056](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/reservation/reservation-detail.tsx#L1056)는 이메일 패널에 취소 상태를 전달하지 않는다. 서버 `findTicketEmailContext`는 CONFIRMED/DONE/active를 요구한다.
- 개편 검증 조건: 취소 상태에서는 발송 동작과 예정 안내를 숨기거나 불가 사유를 명확히 표시한다.
- [버튼 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/49-cancelled-email-404.jpg) · [404 응답 근거](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/cancelled-email-network.json)

### F7 · P2 · 결제 중단·취소 후 다음 행동 안내가 실제 상태와 맞지 않는다

국내 카드 인증을 취소하면 본문은 ‘결제하기’를 안내하지만 실제 행동은 ‘좌석 다시 선택하기’뿐이다. 이미 전체 취소한 예매의 과거 결제 복귀 URL로 돌아가면 ‘결제 확인 실패’와 취소 사유 ‘일정 변경’을 오류 원인처럼 보여준다. QR 재활성화는 일어나지 않았다.

- 코드: [complete/page.tsx:416](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/app/booking/%5BperformanceId%5D/complete/page.tsx#L416)는 취소 사유를 결제 확인 실패 본문으로 사용한다.
- 개편 검증 조건: 인증 중단, 결제 실패, 확인 중, 기한 만료, 취소 완료를 구분한다. 표시하는 버튼으로 안내한 다음 행동을 실제 수행할 수 있어야 한다.
- [카드 인증 중단 후 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/26-card-auth-cancel-return.jpg)

### F8 · P3 · 가입일을 모른다는 표시와 이용 기간이 동시에 나온다

신규 계정의 created_at이 존재하는데 ‘가입일 확인 필요/Join date unavailable’ 옆에 ‘1일째/Using for 1 days’가 표시된다.

- 코드: [mypage/page.tsx:344](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/app/mypage/page.tsx#L344)가 정상 기간 값의 라벨에도 accountAgeUnknown을 사용한다.
- [계정 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/20-account-hub.jpg)

## 원인 확정 전인 항목과 설계 판단

| 항목 | 확인된 사실 | 추가 확인 / 판단 |
| --- | --- | --- |
| Alipay 승인 진입 실패 | 가맹점 테스트 uspay 위젯에서 Alipay 선택·필수 동의 후 첫 요청과 재시도 모두 `Payment has already been requested`로 끝남. 인증창·승인·QR에 도달하지 않음 | 깨끗한 브라우저 프로필과 가맹점 테스트 설정으로 요청/응답을 다시 수집해 SDK·설정·앱 원인을 분리해야 함. 아직 서비스 결함으로 원인 단정하지 않음 |
| 실패 재선택 후 대기 예매 증가 | 같은 해외 계정·회차·좌석 1개에 PENDING_PAYMENT 예매가 2건 남음. 두 주문의 결제 레코드는 없음. 만료 후 두 주문 모두 FAILED, 전체 활성 대기 예매 0건 확인 | 실패 복구에서 기존 주문을 재개할지 종료 후 새 주문을 만들지 결정. 중복 승인 발생 증거는 없으며 만료 회수와 늦은 승인 방어를 후속 검증 |
| SVG 표시 | 현재 seed CSS 클래스 기반 SVG가 정화 과정에서 style을 잃어 검은 면·큰 글자 겹침이 발생 | 실제 운영 업로드 자산으로 재현 범위를 확인. 위험한 SVG를 허용하는 대신 허용 속성 인라인화·업로드 검수 계약을 검토 |
| 두 개의 시간 제한 | 좌석 점유와 결제 마감이 각각 표시되고 결제 2분 이하에 버튼이 비활성화됨. 결제 분기 요청 후 마감이 연장되는 경우 관찰 | 고객에게 약속하는 단일 마감, 연장 조건, 인증 중 만료를 결제 계약으로 명시 |
| 고객 부분 취소 | 현재 고객 UI는 ‘전체 취소만 가능’을 명시. 2매 중 1매 취소 UI가 없음 | 미실행 버그로 세지 않음. 개편에서 좌석 단위 부분 취소를 제공할지 정책 결정 후 브라우저 검증 추가 |
| 지원 | 영어 FAQ 3개와 문의 이메일 제공. 공지는 출시 준비 문구 | 고객이 주문번호를 직접 전달해야 하는 방식과 상담 이력 제공 범위 결정. 실제 문의는 발송하지 않음 |

[Alipay 실패 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/46-alipay-failure-desktop.jpg) · [고객지원 화면](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/47-english-support.jpg)

## 고객 기능별 수행 범위

| 고객 흐름 | 수행 결과 |
| --- | --- |
| 첫 방문, 공연 상세, 공연명 검색, 분류 필터 | 직접 조작. 영어 번역 제목과 한국어 제목 모두 목표 공연 1건 확인. 모바일 홈과 하단 검색 진입 존재 |
| 가입, 필수/선택 동의, 잘못된 입력 | 두 일반 계정 직접 가입. 국내 마케팅 거부, 해외 계정은 이후 설정에서 변경 |
| 휴대폰/이메일 인증 | SMS 오답→개발 정답, 이메일 오답→재전송→실제 생성 코드 인증. 외부 발송 도달 미검증 |
| 로그인, 비밀번호 오답, 로그아웃, 재로그인 | 직접 검증. 기존 로그인 returnTo 복귀 정상 |
| 날짜/회차, 좌석 선택·해제, 확대·전체 보기, 동행 예매 | 직접 조작. 2석 금액 및 별도 세션의 기존 선택 복원 확인 |
| 예매자 정보, 약관, 결제수단 전환 | 직접 조작. 국내/해외 PG 위젯 및 해외 추가 동의 확인 |
| 국내 결제 성공·사이트 복귀·QR | 현대카드 Toss 테스트 승인 성공. QR 2개와 특전 확인 |
| 승인 후 조회 실패 복구 | 테스트 특전의 언어 필드 누락으로 500을 유발했으나 데이터 보정 후 ‘상태 다시 확인’으로 같은 결제 1건을 복구. 인위적인 fixture 오류이며 제품 결함으로 세지 않음 |
| 국내 인증 취소, 새로고침, 결제 계속하기 | 직접 조작. 기존 대기 예매의 결제 계속하기 확인. 이전 대기 주문은 만료 처리 후 FAILED. 만료된 상세에서 새 예매 안내와 QR 미발급 확인 |
| 티켓 지갑·상태 필터·상세·이메일 | 직접 조작. 활성 티켓 이메일은 개발 발송 성공. 취소 티켓 버튼은 404 |
| 전체 취소·QR 무효화·특전 비활성 | 실제 테스트 PG 취소와 DB 대조 완료 |
| 취소 후 뒤로가기·재로그인 | 원 결제 URL이 부정확한 오류 문구를 보이지만 거래/QR 재활성화 없음 |
| 해외 결제 | Alipay 최초/재시도 실패 및 독립 SDK 1회 호출 실패 재현. 후속 실행에서 해외 VISA의 USD 승인·사이트 복귀·QR·전체 취소 성공. PayPal 승인 성공 미검증 |
| 프로필 이름·선호 언어·마케팅 | 직접 변경·저장 후 DB 일치 확인. 탭 전환의 언어 손실 발견 |
| 비밀번호 재설정 | 이메일 요청 성공·개발 링크 생성까지. 새 인증정보 입력/확정 미실행 |
| 탈퇴 | 안내·확인 체크·버튼 활성화·체크 해제까지. 영구 탈퇴 최종 제출 미실행 |
| 약관·개인정보·고객지원 | 읽기·링크 진입 검증. 영어 경로의 한국어 본문 확인 |

## 제외 및 남은 검증 조건

1. 앱 내 브라우저의 Toss `ERR_BLOCKED_BY_CLIENT`, Chrome 확장 프로그램 팝업/자동 번역, 카드사 combobox `selectOption` 조작 오류, 일부 스크린샷 축척 오류는 도구·환경 영향으로 분리했다. 실제 카드사 메뉴를 네이티브로 조작하면 국내 카드 인증에 정상 진입했다. 위젯 로딩 실패 시 재시도 UX 부재는 별도로 개선할 수 있다.
2. 특전 fixture에 th/zh-CN displayCopy가 빠진 오류와 로컬 개발 서버 locale rewrite 오류는 이번 테스트 환경 문제다. 처음의 ‘영어 제목 검색 0건’ 주장은 철회한다. 운영 공개 영어 검색은 브라우저에서 영어 표시를 확인했고 보정 뒤 로컬 검색도 통과했다.
3. 후속 가맹점 조사에서 실제 키 연결을 확인하고 해외 카드 테스트를 완료했다. PayPal은 테스트 서버에서 비활성이며 승인 미검증이다. Alipay는 독립 SDK에서도 같은 오류가 재현됐고, 외화 테스트 MID에는 웹훅이 없다. 인증 진입과 테스트 웹훅 수신을 해결한 뒤 비동기 승인·취소를 수행해야 한다. 실키로 우회하지 않았다.
4. iOS Safari/Android Chrome, 모바일 지갑/은행 앱 이동, 네트워크 단절, 실제 SMS·메일 도달, 소셜 OAuth, 여러 고객의 동시 좌석 경쟁과 운영 레이아웃별 재오픈은 이번 브라우저 실행으로 보장하지 않는다.
5. 비밀번호 변경은 브라우저 도구 정책상 사용자의 직접 입력·제출이 필요하다. 영구 탈퇴 최종 실행도 실행 시점 확인이 필요해 이번에는 진입 절차까지만 검증했다. 동작 실패로 분류하지 않는다.
6. 과거 진단의 2,145개 자동 테스트 결과를 이번 수동 여정 결과와 합산하지 않는다. 이번 실행은 API/shared 빌드, 새 DB migration/seed, 실제 브라우저 조작 및 PG/DB readback으로 검증했다.

## 다음 실행 순서

- **설계 확정 전, 현재 단계:** F1–F10과 미해결 해외 결제를 구매자·결제·취소 설계의 입력으로 반영한다. 실제 가맹점 설정은 후속 보고서로 확보했다. 테스트 웹훅 분리·Alipay/PayPal과 실기기 검증을 남은 선행 검증으로 유지한다.
- **개편 구현 중:** 위 각 문제의 검증 조건을 구현 과제의 완료 조건으로 넣고 수정된 흐름마다 동일 고객 시나리오를 실제 브라우저로 반복한다. 화면만 바꾸고 서버 상태 대조를 생략하지 않는다.
- **운영 전환 전:** 별도 승인된 소액 실결제·실환불, 실제 메일/SMS 및 모바일 기기 검증을 실행한다. 테스트 PG 결과를 운영 PG·가맹점 준비 완료로 간주하지 않는다.

## 증거 위치

- [53개 단계의 시간·URL·뷰포트 기록](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/steps.json)
- [증거 파일 목록과 해시](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/evidence-manifest.json)
- 원본 이미지와 DOM은 `/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21`에 보관했다. 합성 계정·테스트 QR이 포함된 내부 검증 자료이며 공개 이슈에는 원본 QR·거래 식별자·자격 증명을 올리지 않는다.
- 23·45번은 축척 오류, 24·25번은 로컬 locale 보정 전, 28·41번은 화면 시점/스크롤 한계가 있어 최종 시각 증거에서 제외했다. 29번은 fixture 오류, 35번의 성공 문구는 이전 발송 상태가 남은 것으로 49번 새 로그인 404 검증으로 정정했다.

Toss 테스트 환경과 국내 카드 인증 방식 참고: [테스트 안내](https://docs.tosspayments.com/blog/how-to-test-toss-payments), [테스트/라이브 환경](https://docs.tosspayments.com/guides/v2/get-started/environment). 이번 성공 판정은 문서의 설명이 아니라 위 실제 테스트 PG 응답을 기준으로 했다.

## 종료 상태

- 13:08 KST 최종 readback: 취소 예매 1건, 만료 실패 3건, 대기 0건. 결제는 CANCELED 1건뿐이다. [최종 DB 대조](/Users/sangwopark19/.codex/artifacts/grapit-customer-journey-2026-09-21/final-local-state.json).
- 테스트 API/웹/워커와 두 테스트 컨테이너를 종료했다. 별도 DB 데이터는 재현용으로 보관한다.
- 임시 locale 보정과 컴파일된 개발 메일 기록 변경을 복원했다. 제품 코드는 수정·커밋·배포하지 않았다.
- 테스트 탭을 닫고 뷰포트 설정을 복원했다. 기존 사용자 탭을 유지했다.
- [고객 여정 검증 실행 기록](https://github.com/icons-hq/grapit/issues/214#issuecomment-5755267744)과 [가맹점 설정 확인 입력](https://github.com/icons-hq/grapit/issues/213#issuecomment-5755269644)에 반영했다. 해외/실기기 검증이 남아 검증 작업은 OPEN이다.

## 후속 진단: 결제 복귀와 청구 통화

2026-09-21 다음 단계에서 F9(전체 페이지 복귀 후 대기 예매 중복)의 클라이언트 원인을 4가지 조건으로 재현했다. F10(KRW 청구 안내와 USD 서버 견적 불일치)도 추가했다. [후속 진단 자료](/Users/sangwopark19/.codex/artifacts/grapit-foreign-payment-2026-09-21/README.md)와 [검증 작업의 후속 기록](https://github.com/icons-hq/grapit/issues/214#issuecomment-5755586278)을 함께 읽는다.

사용자의 Toss 로그인 완료 후 [실제 가맹점 설정 조사](2026-09-21-payment-merchant-settings-audit.md)를 마쳤다. 운영·테스트 키와 위젯 연결, USD 계약, API 버전, 운영 웹훅 인증을 대조했다. 국내 테스트 웹훅은 다른 제품을 향하고 외화 테스트 웹훅은 없는 상태다.

Grabit과 분리한 공식 SDK에서 새 주문·1회 호출로 Alipay `INVALID_PAYMENT_METHOD / Payment has already been requested.`를 CN/US 조건 모두 재현했다. 공급자 내부 원인은 아직 미확정이며 앱의 F9와 분리한다.

후속 해외 VISA 고객 여정은 **USD 259.76 승인 → 예매 확정 → 좌석 QR·특전 → 전체 취소·잔액 0**까지 실제 브라우저와 PG/DB 대조를 완료했다. QR은 취소 후 revoked, 특전은 inactive다. Grabit 주문 금액은 382,000 KRW로 보관하고 실제 USD 청구 스냅샷은 별도 저장한다. F10은 결제 전·완료·환불 화면에서 실제 청구 통화·금액을 명확히 표시하는 요구로 보강한다. F1·F2도 해외 카드에서 재현했다. 고객 여정 전체는 미완료이므로 검증 작업은 OPEN으로 유지한다.

14:42 KST 최종 상태는 취소 예매 2건·실패 3건·대기 0건, 결제 2건 모두 CANCELED, QR 3개 모두 revoked, 좌석 재고 3개 모두 available이다. 테스트 서버·컨테이너·이번 검증용 탭을 종료했다. [최종 DB 대조](/Users/sangwopark19/.codex/artifacts/grapit-foreign-payment-2026-09-21/final-local-state.json) · [추가 실행 기록](https://github.com/icons-hq/grapit/issues/214#issuecomment-5755915477).
