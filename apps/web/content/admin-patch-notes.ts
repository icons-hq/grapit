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
