import { describe, expect, it } from 'vitest';

import {
  buildAdminPatchNote,
  mergeAdminPatchNote,
} from '../../../../scripts/admin-patch-note-generator.mjs';

describe('admin patch note generator', () => {
  it('builds an admin patch note from PR metadata sections', () => {
    const note = buildAdminPatchNote({
      number: 163,
      title: 'fix: add payment processing grace',
      html_url: 'https://github.com/sangwopark19/grapit/pull/163',
      merged_at: '2026-06-10T02:30:00Z',
      labels: [{ name: 'payments' }],
      body: `
## 관리자 패치노트

### 패치노트 요약

Toss 결제창 진입 후 결제 처리 grace를 적용해 조기 만료를 줄였습니다.

### 패치노트 하이라이트

- 결제 branch 시 결제 deadline을 최대 15분 cap 안에서 연장
- 결제창 복귀 시 연장된 deadline을 화면 상태에 반영

### 패치노트 검증

- API targeted Vitest
- Web targeted Vitest
`,
    });

    expect(note).toEqual({
      id: 'pr-163-add-payment-processing-grace',
      prNumber: 163,
      title: 'add payment processing grace',
      summary:
        'Toss 결제창 진입 후 결제 처리 grace를 적용해 조기 만료를 줄였습니다.',
      highlights: [
        '결제 branch 시 결제 deadline을 최대 15분 cap 안에서 연장',
        '결제창 복귀 시 연장된 deadline을 화면 상태에 반영',
      ],
      category: 'patch',
      date: '2026-06-10',
      githubUrl: 'https://github.com/sangwopark19/grapit/pull/163',
      evidence: ['API targeted Vitest', 'Web targeted Vitest'],
    });
  });

  it('skips PRs without complete patch note sections', () => {
    const note = buildAdminPatchNote({
      number: 164,
      title: 'chore: update internal docs',
      html_url: 'https://github.com/sangwopark19/grapit/pull/164',
      merged_at: '2026-06-10T02:30:00Z',
      labels: [],
      body: '## 관리자 패치노트\n\n- [ ] 노출하지 않는 변경이면 이유를 적었습니다: 내부 문서 정리',
    });

    expect(note).toBeNull();
  });

  it('upserts by PR number and keeps newest notes first', () => {
    const merged = mergeAdminPatchNote(
      [
        {
          id: 'pr-161-admin-booking-payment-management',
          prNumber: 161,
          title: '관리자 예매/결제 진단 및 일일 매출 통계 개선',
          summary: 'summary',
          highlights: ['highlight'],
          category: 'feature',
          date: '2026-06-09',
          githubUrl: 'https://github.com/sangwopark19/grapit/pull/161',
          evidence: ['test'],
        },
        {
          id: 'pr-163-old',
          prNumber: 163,
          title: 'old',
          summary: 'old',
          highlights: ['old'],
          category: 'feature',
          date: '2026-06-09',
          githubUrl: 'https://github.com/sangwopark19/grapit/pull/163',
          evidence: ['old'],
        },
      ],
      {
        id: 'pr-163-add-payment-processing-grace',
        prNumber: 163,
        title: 'add payment processing grace',
        summary: 'summary',
        highlights: ['highlight'],
        category: 'patch',
        date: '2026-06-10',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/163',
        evidence: ['test'],
      },
    );

    expect(merged.map((note) => note.prNumber)).toEqual([163, 161]);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        title: 'add payment processing grace',
        category: 'patch',
      }),
    );
  });
});
