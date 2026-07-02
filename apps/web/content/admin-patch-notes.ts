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
    id: 'pr-183-full-reservation-cancellation-fees',
    prNumber: 183,
    title: '전체예매 취소 수수료 정책 적용',
    summary:
      '구매자와 관리자 전체예매 취소에 티켓별 취소 수수료 견적을 적용하고, Toss 부분취소 완료 판정과 관리자 환불 권한을 production 적용 전 강화했습니다.',
    highlights: [
      '티켓별 취소 수수료와 서비스 수수료 환불 여부를 quote로 저장해 retry와 webhook에서 재사용',
      'cancelRequestId 없는 provider 부분취소는 요청 시점 이후 완료 거래만 매칭하도록 강화',
      'cancellation_pending 티켓이 남은 예약은 전체예매 취소 전에 수동 reconciliation 대상으로 차단',
      '관리자 환불 preview와 실행을 refund.admin_refund capability로 제한하고 refetch 중 확인 버튼 비활성화',
    ],
    category: 'feature',
    date: '2026-07-02',
    githubUrl: 'https://github.com/sangwopark19/grapit/pull/183',
    evidence: [
      'API refund/payment/webhook/retry/finalizer/admin Vitest',
      'Shared admin and booking schema Vitest',
      'Web admin booking and patch-note Vitest',
      'API/Web/Shared typecheck',
      'pnpm lint',
      'git diff --check',
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
      'Tier, Seat, Floor, Row, Number와 구매자 연락처, 입장 상태를 단일 CSV에 포함',
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
