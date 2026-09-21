export type AdminPatchNoteCategory = 'feature' | 'patch' | 'ops';

export interface AdminPatchNote {
  id: string;
  prNumber: number;
  title: string;
  summary: string;
  highlights: readonly string[];
  category: AdminPatchNoteCategory;
  date: string;
  githubUrl: string;
  evidence: readonly string[];
}

const notes = [
  {
    id: 'pr-229-finance-evidence-ledger',
    prNumber: 229,
    title: '원금·환불·통화·조회 기준을 구분한 정산 원장',
    summary:
      '공연·회차와 기간·기준 시각을 선택해 원 주문, 확정·처리 중 환불, 남은 티켓과 PG 정산 자료를 대조합니다.',
    highlights: [
      'KRW와 USD 청구·취소 기록 및 정산 지급일을 별도로 표시',
      '조회 전·연결 대기·실패·0건·증거 누락을 구분하고 과거 취소 견적 보존',
      '결제·좌석·PG 거래 단위 CSV에 같은 기준과 통화·시각을 기록',
      '개인 연락처 없는 재무 export와 감사 기록, 은행 입금·마감 미확인 안내',
    ],
    category: 'feature',
    date: '2026-09-22',
    githubUrl: 'https://github.com/icons-hq/grapit/pull/229',
    evidence: [
      '22 PostgreSQL HTTP finance regressions and 11 UI query-state checks',
      'Actual desktop/mobile CSV download, independent money reconciliation and export audit readback',
      'API/Web/shared tests, production build and Standards/Spec review',
    ],
  },
  {
    id: 'pr-228-seat-level-field-operations',
    prNumber: 228,
    title: '좌석별 입장과 현장 특전 지급 개선',
    summary:
      '회차와 좌석을 확인해 한 좌석씩 입장 처리하고, 연결이 끊겼을 때의 대기 기록과 재접속 결과를 구분합니다.',
    highlights: [
      '한 예매의 다른 좌석과 구매자의 QR 조회를 유지하는 좌석별 입장 처리',
      '중복·동시 입장 요청과 오프라인 재전송의 결과 일치 및 충돌 안내',
      '입장과 특전 지급 권한 분리, 중복 지급 방지와 지급 후 설정 보호',
      '위조·만료·취소 QR과 일시적인 서버 오류를 구분한 현장 안내',
    ],
    category: 'feature',
    date: '2026-09-22',
    githubUrl: 'https://github.com/icons-hq/grapit/pull/228',
    evidence: [
      '24 PostgreSQL HTTP regressions including concurrent admission and benefit redemption',
      'Mobile browser offline/reconnect conflicts and buyer QR retention readback',
      'Shared/Web/API validation, production build and Standards/Spec review',
    ],
  },
  {
    id: 'pr-227-performance-preparation-and-support',
    prNumber: 227,
    title: '공연 준비·판매·고객 대응 흐름 통합',
    summary:
      '공연과 회차를 선택해 초안 작성부터 검수·공개, 예매 확인·문의 처리·특전 운영까지 이어서 진행할 수 있습니다.',
    highlights: [
      '단계별 작성과 초안 저장·재개, 누락 항목 안내 및 최신 상태에 대한 공개 승인',
      '판매된 좌석·가격·공연장 보호와 오래된 편집·번역 승인 충돌 방지',
      '고객 문의에서 원 결제 통화·환불·좌석·특전·이메일 기록을 함께 확인',
      '특전 테스트와 실제 반영 구분, 이름 수정 후 기존 권리·외국어 안내 유지',
      '운영·승인·재무·현장 역할별 메뉴와 API 권한 일치',
    ],
    category: 'feature',
    date: '2026-09-22',
    githubUrl: 'https://github.com/icons-hq/grapit/pull/227',
    evidence: [
      'API 1300 / Web 756 / shared 148 tests; PostgreSQL HTTP regressions',
      'Role-based desktop/mobile browser QA and entitlement readback',
      'API/Web production build and Standards/Spec review',
    ],
  },
  {
    id: 'pr-226-seat-cancellation-and-refunds',
    prNumber: 226,
    title: '좌석별 취소와 환불 상태·금액 안내',
    summary:
      '고객이 선택한 좌석의 환불액과 남을 티켓을 확인해 취소하고, 남은 QR과 원거래 금액을 유지하도록 개선했습니다.',
    highlights: [
      '취소할 좌석·수수료·원화와 결제 통화 환불액·남는 티켓을 함께 확인',
      '거절·응답 유실·지연 알림에서도 같은 취소 요청의 결과와 권리를 보존',
      '환불 처리 단계와 좌석 재판매 대기를 구분하고 마지막 좌석의 수수료 유지',
      '활성 티켓이 없는 예매의 이메일 재발송 숨김과 모바일 취소 확인 개선',
    ],
    category: 'feature',
    date: '2026-09-21',
    githubUrl: 'https://github.com/icons-hq/grapit/pull/226',
    evidence: [
      'API/Web/shared unit tests and PostgreSQL transaction regressions',
      'Desktop/mobile browser QA with isolated provider simulator',
      'Standards and Spec review; API/Web build',
    ],
  },
  {
    id: 'pr-196-partial-cancellation-reconciliation',
    prNumber: 196,
    title: '부분취소 예매 조회 복원과 대조 기준 정정',
    summary:
      '과거 일부 티켓 취소 4건의 결제 상태를 기존 계약으로 복원하고, 남은 티켓의 QR·명단·매출이 유지되는지 함께 검증했습니다.',
    highlights: [
      'PG 상태명을 그대로 적용했던 4건을 정정하고 남은 7개 티켓의 조회 조건 복원',
      '부분 티켓 취소와 전체 예매 취소의 대조 기준을 구분하고 실제 DB 회귀 추가',
      'PG 정산 매출과 유효 티켓 매출 차액을 표시해 취소·별도 송금 기록 확인 안내',
      '전액취소 4건 및 기본 특전 13개 복구 유지, 기존 실행 증거와 정정 이력 보관',
    ],
    category: 'ops',
    date: '2026-09-18',
    githubUrl: 'https://github.com/icons-hq/grapit/pull/196',
    evidence: [
      'PostgreSQL partial cancellation / QR / manifest / revenue regression',
      'Scoped state restoration and protected row hashes',
      'Read-only provider verification and production admin totals',
    ],
  },
  {
    id: 'pr-195-server-payment-deadline-display',
    prNumber: 195,
    title: '결제 기한과 좌석 타이머 표시 일치',
    summary:
      '서버가 확정한 결제 가능 시간을 결제창을 열기 전부터 적용하고, 좌석 선택으로 돌아가도 동일한 남은 시간을 표시하도록 수정했습니다.',
    highlights: [
      '서버 기한이 기존 좌석 선택 시간보다 짧을 때도 모든 화면 타이머에 반영',
      '예매 준비 응답 직후 결제 기한을 갱신하고 결제 처리 중 연장된 시간도 유지',
    ],
    category: 'patch',
    date: '2026-09-18',
    githubUrl: 'https://github.com/icons-hq/grapit/pull/195',
    evidence: [
      'Shorter deadline and pre-widget timing regression tests',
      'Web typecheck and unit tests',
    ],
  },
  {
    id: 'pr-193-show-relaunch-reliability',
    prNumber: 193,
    title: '공연 예매·결제·특전 안정성 개선',
    summary:
      '중복 승인과 늦은 취소로 인한 좌석·발권 오류를 방지하고, 기본 특전 생성과 결제 기한을 일관되게 처리하도록 개선했습니다.',
    highlights: [
      '현재 유효한 티켓이 있는 좌석은 과거 예약 취소나 관리자 오픈으로 다시 판매되지 않도록 보호',
      '중복·역순 결제 알림과 보상 취소 중 재발권을 방지하고 공연별 매수 제한을 일관되게 적용',
      '기본 특전 누락·중복을 방지하고 검토한 누락 대상만 복구할 수 있는 운영 절차 추가',
      '환불 안내에서 결제사 취소 완료와 금융기관 반영을 구분하고 소셜 로그인 복귀 안내를 네 언어로 제공',
    ],
    category: 'patch',
    date: '2026-09-18',
    githubUrl: 'https://github.com/icons-hq/grapit/pull/193',
    evidence: [
      'API/Web/Shared/edge unit tests',
      'PostgreSQL/Valkey integration tests',
      'Desktop/mobile render and browser E2E',
      'Typecheck, API build and code review',
    ],
  },
  {
    id: 'pr-182-active-ticket-manifest-export',
    prNumber: 182,
    title: '회차 구매자 명단 CSV 추가',
    summary:
      '예매 관리 화면에서 선택한 공연/회차의 유효 티켓 구매자 명단을 좌석 등급과 좌석 순서로 내려받을 수 있도록 CSV 내보내기를 추가했습니다.',
    highlights: [
      '회차를 선택한 경우에만 회차 구매자 명단 CSV 버튼 활성화',
      'CONFIRMED 예약과 active ticket item만 포함하도록 서버에서 조건 강제',
      'Tier, Seat, Ticket Seat Number, Floor, Row, Number와 구매자 연락처, 입장 상태를 단일 CSV에 포함',
      'CSV 사유 입력, audit 기록, UTF-8 BOM, formula neutralization은 기존 예약자 export 흐름 재사용',
    ],
    category: 'feature',
    date: '2026-06-30',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/182',
    evidence: [
      'Shared admin operations schema Vitest',
      'API admin booking service/controller Vitest',
      'Web reservation export panel/dashboard Vitest',
      'Shared build/typecheck',
      'API/Web/Shared typecheck',
      'git diff --check',
    ],
  },
  {
    id: 'pr-180-ledgered-social-account-merge',
    prNumber: 180,
    title: '소셜 계정 병합 운영 도구 추가',
    summary:
      '휴대폰 인증, 생년월일, 정규화된 이름이 일치하는 소셜 로그인은 기존 계정에 연결하고, 기존 중복 계정은 복구 원장과 보호된 리포트를 남기며 병합할 수 있도록 운영 명령을 추가했습니다.',
    highlights: [
      '새 소셜 로그인은 휴대폰/생년월일/이름이 정확히 하나의 활성 계정과 일치할 때 기존 계정에 연결',
      'safe group 자동 병합과 수동 allowlist 병합을 분리',
      'source 계정의 진행 중 결제 예약은 자동/수동 병합에서 차단',
      'source 계정은 merged 상태로 보존하고 refresh token은 폐기',
      '병합 batch와 최소 row 변경 내역을 DB ledger와 protected JSON report에 기록',
    ],
    category: 'ops',
    date: '2026-06-29',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/180',
    evidence: [
      'Shared admin schema Vitest',
      'API auth/account-merge Vitest',
      'API schema contract Vitest',
      'API build/typecheck',
      'Web admin user management Vitest',
      'git diff --check',
    ],
  },
  {
    id: 'pr-177-benefit-export-qr-seat-highlight',
    prNumber: 177,
    title: '혜택 CSV와 QR 좌석 강조 확장',
    summary:
      '혜택 run/entitlement CSV에 티켓 좌석번호와 고객 연락처/이름/이메일을 추가하고, 예매 상세와 QR 티켓 좌석 텍스트에 좌석 등급색 강조를 적용했습니다.',
    highlights: [
      '혜택 run/entitlement CSV에 좌석번호와 고객 연락처/이름/이메일 컬럼 추가',
      '예매 상세 API와 shared ticket contract에 좌석 등급색 tierColor 추가',
      '구매 완료와 예매 상세 QR 좌석 텍스트에 등급색 배경 강조 적용',
      'CSV 생성 시점에만 고객 정보를 hydrate하고 run summary/audit metadata에는 PII를 저장하지 않도록 유지',
    ],
    category: 'feature',
    date: '2026-06-22',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/177',
    evidence: [
      'Shared benefit/ticket/booking schema tests',
      'API benefit runner/reservation tests',
      'Web booking/reservation QR tests',
      'Shared build/typecheck',
      'API/Web typecheck',
      'Web lint',
      'git diff --check',
    ],
  },
  {
    id: 'pr-176-admin-booking-detail-payment-join',
    prNumber: 176,
    title: '관리자 예매 상세 500 오류 수정',
    summary:
      'provider expiry 여부를 계산하는 관리자 예매 상세 쿼리에 payments join을 추가하고, ticket item이 아직 없는 예매는 reservation_seats를 seats 응답에만 fallback으로 내려주도록 수정했습니다.',
    highlights: [
      'payments.tossOrderId 참조 경로에 맞춰 상세 쿼리 left join과 payment select mapping 추가',
      'ticket_items 미생성 예매의 좌석 fallback source를 seats 응답으로 제한',
      'stale mock 제거와 join/query count, fallback source, null payment regression 검증 추가',
    ],
    category: 'patch',
    date: '2026-06-22',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/176',
    evidence: [
      'API admin booking service Vitest',
      'API typecheck',
      'API test suite',
      'API lint',
      'Subagent code review',
      'git diff --check',
    ],
  },
  {
    id: 'pr-175-admin-payment-failure-buckets',
    prNumber: 175,
    title: '관리자 결제 실패 분류 표시',
    summary:
      'local 결제기한 만료, provider 만료, 결제 중단, 승인 전 취소, 보상 취소를 Payment Failure Bucket으로 정규화해 관리자 대시보드, 목록, 상세에서 구분하도록 개선했습니다.',
    highlights: [
      'shared contract/API 응답에 paymentFailureBucket과 bucket별 count 추가',
      '관리자 예매 대시보드, 목록, 상세 모달에 실패/만료 분류 라벨과 통계 표시',
      'local 실패 이후 도착한 terminal provider webhook을 diagnostic/payment progress로 기록',
      'unreconciled_provider_expired는 실제 terminal EXPIRED webhook이 확인된 경우에만 분류',
    ],
    category: 'feature',
    date: '2026-06-22',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/175',
    evidence: [
      'Shared booking schema Vitest',
      'API admin/payment/webhook Vitest',
      'Web admin booking dashboard Vitest',
      'API/Web/Shared typecheck',
      'API lint/test',
      'pnpm test',
      'git diff --check',
    ],
  },
  {
    id: 'pr-174-admin-benefit-showtime-select',
    prNumber: 174,
    title: '혜택 관리 회차 선택 UI 추가',
    summary:
      '혜택 관리 화면에서 회차 ID 직접 입력을 제거하고, 공연 선택 후 해당 공연의 회차를 선택해 기존 혜택 설정/실행/export API를 사용할 수 있도록 개선했습니다.',
    highlights: [
      '공연 목록/상세 조회 흐름을 재사용해 공연과 회차 선택 UI 제공',
      '선택한 showtimeId로 기존 혜택 설정, test/live 실행, export API 호출 유지',
      '회차 ID 수동 입력으로 인한 운영 실수를 줄이도록 admin benefit manager 테스트 보강',
    ],
    category: 'feature',
    date: '2026-06-19',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/174',
    evidence: [
      'Web admin benefit manager Vitest',
      'Web admin booking dashboard Vitest',
      'Web typecheck',
      'git diff --check',
    ],
  },
  {
    id: 'pr-173-ticket-benefit-operations',
    prNumber: 173,
    title: '티켓 베네핏 운영 기능 추가',
    summary:
      '회차별 ALL/한정 혜택을 설정하고 test/live 실행, CSV export, rollback, 현장 사용 처리를 관리할 수 있도록 티켓 베네핏 운영 흐름을 추가했습니다.',
    highlights: [
      'ALL 혜택과 한정 혜택 설정을 분리하고 관리자 test/live run 이력을 기록',
      'live run은 한정 혜택을 ticket item 단위로 재적용하고, ALL 혜택은 신규 예매 티켓에도 자동 적용',
      '6:1과 polaroid는 구매자 단위로 동시 당첨되지 않도록 상호 배제',
      '구매자 QR/예매 상세와 현장 스캐너에서 베네핏 표시 및 사용 처리 지원',
    ],
    category: 'feature',
    date: '2026-06-19',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/173',
    evidence: [
      'Shared benefit schema Vitest',
      'API benefit runner/admin/field Vitest',
      'Web buyer/scanner/admin benefit Vitest',
      'API/Web/Shared typecheck',
      'pnpm lint',
      'git diff --check',
    ],
  },
  {
    id: 'pr-172-payment-failure-guidance-i18n',
    prNumber: 172,
    title: '고객 결제 실패 사유 다국어 안내',
    summary:
      '결제 실패 직후와 마이페이지 예매 상세에서 카드 할부 미지원, 결제 시간 만료, 결제 중단/취소 사유를 현재 언어에 맞는 안내로 확인할 수 있도록 개선했습니다.',
    highlights: [
      'Toss failUrl의 결제 실패 코드를 고객용 다국어 안내로 매핑',
      '마이페이지 예매 상세의 결제 실패 카드에 실패 사유 영역 추가',
      '할부 미지원 오류는 일시불 또는 다른 카드 재시도 안내로 표시',
      'DB 진단 메시지는 내부 문구로 취급해 고객 화면의 결제사 응답 보조문구로 노출하지 않도록 정리',
    ],
    category: 'patch',
    date: '2026-06-16',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/172',
    evidence: [
      'Shared booking schema Vitest',
      'API reservation/admin booking Vitest',
      'Web payment failure guidance Vitest',
      'Web reservation/messages Vitest',
      'API/Web/Shared typecheck',
      'Subagent code review',
      'git diff --check',
    ],
  },
  {
    id: 'pr-168-admin-payment-failure-breakdown',
    prNumber: 168,
    title: '관리자 결제 실패/만료 집계 분리',
    summary:
      '예매 관리 대시보드의 결제 실패 집계에서 결제기한 만료와 결제 중단/취소를 분리해 최근 실패 증가 원인을 더 빠르게 구분할 수 있도록 개선했습니다.',
    highlights: [
      '결제 실패/만료 KPI를 추가해 기존 실패 합계를 별도 카드로 표시',
      '만료와 중단/취소 건수를 카드 하단 breakdown으로 표시',
      'payment status와 failure diagnostic code를 함께 사용해 운영 집계 정확도 보강',
      'shared booking stats contract에 expiredPaymentCount와 abortedPaymentCount 추가',
    ],
    category: 'patch',
    date: '2026-06-12',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/168',
    evidence: [
      'Shared booking schema Vitest',
      'API admin booking Vitest',
      'Web admin booking dashboard Vitest',
      'API/Web typecheck',
      'Browser admin route smoke',
      'git diff --check',
    ],
  },
  {
    id: 'pr-167-booking-auth-queue-immediate',
    prNumber: 167,
    title: '예매 진입 로그인 및 즉시 입장 흐름 수정',
    summary:
      '비로그인 사용자가 예매 진입 시 대기열 화면을 보지 않고 로그인으로 이동하고, 대기 인원이 없는 예매는 admission cookie를 유지한 채 즉시 좌석 선택 화면으로 진입하도록 수정했습니다.',
    highlights: [
      '비로그인 예매 진입을 /auth returnTo 흐름으로 연결',
      '즉시 ADMITTED queue snapshot은 대기 화면 없이 booking page로 진입',
      'queue reconcile lock을 token 기반 Lua compare-delete로 즉시 해제',
      '좌석 잠금, 예약 준비, 결제 확인 AdmissionGuard 계약은 유지',
    ],
    category: 'patch',
    date: '2026-06-10',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/167',
    evidence: [
      'Web targeted Vitest',
      'API queue Vitest',
      'API/Web typecheck',
      'Booking queue/floor Playwright E2E',
      'git diff --check',
    ],
  },
  {
    id: 'pr-163-payment-processing-grace',
    prNumber: 163,
    title: '결제 처리 grace window 적용',
    summary:
      'Toss 결제창이나 카드사 앱 인증에 진입한 예매가 기존 7분 결제 대기시간 때문에 조기 실패 처리되지 않도록 결제 처리 grace를 적용했습니다.',
    highlights: [
      '초기 7분 예매 준비 window는 유지하고 결제 branch 진입 시 최대 15분 cap 안에서 deadline 연장',
      '결제 deadline, admission active window, reentry grace, Redis seat lock TTL을 같은 기준으로 연장',
      'branch 응답과 failUrl 복귀 흐름에 연장된 paymentDeadlineAt을 반영',
      'Redis lock 연장 실패 시 guarded DB update를 복구해 worker/status race를 방지',
    ],
    category: 'patch',
    date: '2026-06-09',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/163',
    evidence: [
      'API targeted Vitest',
      'Web targeted Vitest',
      'API/Web typecheck',
      'Subagent code review',
      'git diff --check',
    ],
  },
  {
    id: 'pr-161-admin-booking-payment-management',
    prNumber: 161,
    title: '관리자 예매/결제 진단 및 일일 매출 통계 개선',
    summary:
      '실패/만료/취소 사유와 결제수단 attribution을 보강하고, KST 일일 예매·취소·매출 통계를 관리자 화면과 CSV에 추가했습니다.',
    highlights: [
      '예매 관리 등급별 좌석통계를 평균단가 기준으로 정렬',
      '결제 실패 진단 코드, 사유, 진단 출처를 관리자 UI에 표시',
      '결제수단 누락 건도 결제수단 확인 필요 상태로 안정적으로 표시',
      '대시보드에 KST 일일 예매, 취소, 총매출, 취소 차감, 순매출 추가',
      '실패/만료/취소 고객 CSV에 marketing consent 컬럼 추가',
    ],
    category: 'feature',
    date: '2026-06-09',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/161',
    evidence: [
      'API/Web/Shared typecheck',
      'API unit/integration tests',
      'Web Vitest',
      'git diff --check',
    ],
  },
] as const satisfies readonly AdminPatchNote[];

export const adminPatchNotes = [...notes].sort(comparePatchNotes);

export function latestAdminPatchNotes(limit: number): AdminPatchNote[] {
  return adminPatchNotes.slice(0, limit);
}

function comparePatchNotes(a: AdminPatchNote, b: AdminPatchNote): number {
  const byDate = b.date.localeCompare(a.date);

  if (byDate !== 0) {
    return byDate;
  }

  return b.prNumber - a.prNumber;
}
