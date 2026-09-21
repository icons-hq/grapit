# Grabit 개편 디자인 기준

## 목적과 실제 입력

우리 팀이 운영하는 공연의 구매·티켓·현장·정산 업무를 완성한다. 가입 전 첫 방문자, 국내 카드 이용자, 영어를 쓰는 해외 구매자, 공연 준비 운영자, 현장 스태프를 기준으로 정상 진행과 실패 후 복귀를 함께 설계한다. 외부 주최자 입점은 포함하지 않는다.

기존 React/Next.js 라우트, Pretendard, 보라색 primary token, shadcn 기본 컴포넌트를 유지한다. 공연 포스터·제목·날짜·금액·좌석·준비 상태는 실제 API에서 가져온다. 그림의 임의 데이터는 상품 정보로 사용하지 않는다.

## 이미지 참고와 구현 경계

- `concepts/buyer-home-v1.png`: 공연을 탐색하고 공연 일정과 예매 행동을 쉽게 찾는 첫 방문 화면.
- `concepts/buyer-checkout-v2.png`: 흰 배경, 큰 확인 제목, 왼쪽 공연/좌석/예매자/동의, 오른쪽 결제 금액/수단. 생성물의 저장 카드번호는 채택하지 않는다.
- `concepts/admin-preparation-v1.png`: 공연 맥락과 준비 단계별 상태/누락/다음 행동.
- `concepts/field-mobile-states-v1.png`: 한 좌석의 입장·특전·중복·통신 장애 상태를 구분하는 모바일 현장 화면.

첫 번째 결제 이미지의 투명 배경 오류는 거절하고 두 번째 이미지를 선택했다. 최종 제품에서는 실제 Toss 위젯의 UI와 필요한 동의를 보존하므로 위젯 내부 스타일이나 높이가 시안과 다를 수 있다. 생성 시안의 가상 업무 상태는 서버 결과로만 대체한다.

## 재사용할 시안 프롬프트

아래는 채택한 이미지에서 확정한 구현 방향을 재현하기 위한 기준이다. 이전 도구 호출 문구의 그대로인 사본은 아니다.

> Create a polished, realistic Grabit event-ticket product screen. Use a white background, slate text, generous but purposeful spacing, thin dividers, and a restrained violet primary action. Avoid repeated small cards. Korean labels must remain legible, with layouts that tolerate English, Thai and Simplified Chinese. Use actual supplied event assets and treat example numbers as placeholders. On checkout, clearly separate KRW order value from the fixed provider charge currency and amount. Use a two-column desktop layout and a single-column mobile layout with a visible payment action. Include clear loading, recovery, expired and error states. Do not invent stored card details, approval statuses, availability or financial evidence. Admin screens keep a selected performance and showtime context and link each readiness gap to its next action. Field screens operate on one seat and distinguish admission, benefit redemption and unsynced offline work.

## 실제 화면에서 확인할 항목

제목·본문 위계, 열 전환, 금액/통화, 실제 포스터 대체 상태, 버튼/체크박스, 긴 다국어 안내, 키보드 순서, 오류·만료·재시도, 실제 PG·서버와의 일치를 확인한다. DOM과 회귀 테스트만으로 시각적 완료를 선언하지 않는다. 검증 기록과 선택 시안/최신 viewport 캡처를 함께 비교한다.
