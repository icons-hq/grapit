# 좌석별 입장·특전 검증

Issue #220. 2026-09-22 사용자 자율 위임에 따른 구현이며 과거 입장·지급 결과와 기존 구매 권리는 변경하지 않는다.

## 계약과 검증 경계

- 한 QR은 해당 Ticket Item만 입장시킨다. 취소와 같은 reservation/payment/item 잠금 경계에서 상태를 다시 확인하고 QR을 갱신한다. 재시도는 같은 device attempt 영수증을 반환한다.
- 특전 지급은 별도 API capability·원장을 사용한다. scanner bundle은 두 업무를 포함하지만 custom entry-only 권한에는 지급을 허용하지 않는다. 지급과 설정/실제 배정은 같은 회차 잠금을 공유한다.
- signed QR의 취소/취소 대기/만료와 서명 불일치를 구분한다. 과거 일괄 입장 시각을 유지하고 새 성공 이력을 만들지 않는다. 구매자 QR 조회는 입장 후에도 유지한다.
- 대기 기록은 직원·회차로 나누고 재연결 오류는 대기를 유지한다. 다른 요청의 선입장은 충돌로 표시한다. 같은 성공 요청의 응답 유실은 원 영수증으로 복구한다. 완료된 로컬 기록의 QR 원문은 제거한다.
- 실제 HTTP guard/pipe, 실제 QR signature, 실제 PostgreSQL transaction/row lock을 함께 검증한다. DB query chain을 흉내 내던 field consume/redemption 단위 테스트는 해당 HTTP/DB 계약 테스트로 옮겼다. 별도 단위 테스트는 의존 서비스 실패와 민감 출력 경계를 유지한다.

## 실행 증거

- 실제 HTTP/PostgreSQL 최초 8개가 계정 일괄 입장·재시도 500·잘못된 QR 상태·권한 결합에서 실패했다. 수정 후 통과했으며 회차 선택·이전 입장·권리 보존·거절 재시도·실제 잠금 경쟁을 추가해 24개 통과했다.
- 기존 결제·취소·QR 회귀와 함께 실행한 PostgreSQL 81개 통과(마지막 회차 조회 계약 추가 전). API 전체 1,276개, shared 148개 통과. Web 전체의 옛 scanner 권한 기대값 1건을 갱신한 뒤 관련 59개, 추가 store 경쟁 23개를 통과했다.
- 모바일 390×844, 합성 scanner 계정으로 QR 내용을 직접 입력하여 A-1만 입장 처리했다. DB는 A-1 entered/A-2 not_entered, 두 QR active, 특전 지급 0건이었다.
- A-1 포스터를 별도 버튼으로 사용 처리한 뒤 지급 1건, A-2 미입장/미지급을 확인했다.
- A-2 QR 확인 후 첫 IAB 탭에 네트워크 단절을 재현했다. 특전 버튼이 없어지고 입장은 동기화 대기 1건으로 남았다. 두 번째 IAB 탭의 별도 요청이 A-2를 입장시킨 뒤 첫 탭 연결을 복구·동기화했다. UI는 대기 0/충돌 1, DB는 online success 2건과 offline already_used/rejected 1건이었다.
- 이 재현은 서로 다른 요청을 보낸 두 브라우저 탭이다. 실제 휴대폰 2대나 물리적 회선 검증으로 기록하지 않는다. 탭의 네트워크 설정은 즉시 복구했다.
- 지급 후 관리자 혜택 화면에서도 A-1 포스터 지급 완료 1건과 결과 고정 시각을 확인했다. 설정 저장·라이브 적용·되돌리기가 비활성이고, 조회와 테스트 기록은 유지됐다.
- 원장 fixture는 기존 운영 QA의 격리 합성 주문 1건/2석/포스터 2개/한정 카드 1개를 사용했다. 외부 PG 거래·고객 이메일·실물 지급은 하지 않았다.

증거: 저장소 밖 `grapit-revamp-autonomy-2026-09-21/browser/61-*` 이후와 `tests/field-*`. QR/계정 자격 증명은 비공개 artifact에만 보관하며 PR·문서·화면 증거에 원문을 싣지 않는다.

## 검토 수정

Standards/Spec에서 확인한 요청 회차 영수증 결합, 실제 JWT 서명 오류 분류, 늦은 동기화의 확정→대기 역전, 입장/특전의 회차 FK 잠금 순환을 실제 실패로 재현해 수정했다. 서명/만료/교착 및 요청 회차 경계는 실제 HTTP/PostgreSQL, 늦은 응답은 저장 상태 전이로 검증한다. 특전의 요청 회차를 보존하는 nullable column migration `0037` 적용 전후 격리 예매 13/결제 7/원금 1,944,000원/Ticket Item 12/QR 12가 동일했다.

최종 고정 증분 재검토는 Standards 0건, Spec 0건이었다. API build/typecheck, Web typecheck/production build, API/Web lint 오류 0건을 확인했다.

## 남은 확인

실제 휴대폰 카메라·현장 회선·실물 재고/담당자 인수는 #214의 별도 gate다. 이 코드 및 브라우저 검증은 그 gate를 대신하지 않는다. 운영 전환에서는 [좌석별 현장 절차](../runbooks/seat-level-field-operations.md)와 [실물 인수 대장](../runbooks/benefit-physical-handoff.md)을 사용한다.
