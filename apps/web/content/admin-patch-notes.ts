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
