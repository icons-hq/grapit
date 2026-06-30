import { describe, expect, it } from 'vitest';

import { adminPatchNotes, latestAdminPatchNotes } from '../admin-patch-notes';

describe('adminPatchNotes', () => {
  it('keeps curated PR patch notes valid and newest first', () => {
    expect(adminPatchNotes.length).toBeGreaterThan(0);

    const seenIds = new Set<string>();

    for (const note of adminPatchNotes) {
      expect(note.id).toMatch(/^pr-\d+-/);
      expect(seenIds.has(note.id)).toBe(false);
      seenIds.add(note.id);

      expect(note.title.trim()).not.toBe('');
      expect(note.summary.trim()).not.toBe('');
      expect(note.highlights.length).toBeGreaterThan(0);
      expect(note.evidence.length).toBeGreaterThan(0);
      expect(note.githubUrl).toMatch(
        /^https:\/\/github\.com\/sangwopark19\/grapit\/pull\/\d+$/,
      );
    }

    const sortKeys = adminPatchNotes.map(
      (note) => `${note.date}:${String(note.prNumber).padStart(8, '0')}`,
    );
    expect(sortKeys).toEqual([...sortKeys].sort().reverse());
  });

  it('registers the current admin booking and payment management PR', () => {
    const note = adminPatchNotes.find((entry) => entry.prNumber === 161);

    expect(note).toEqual(
      expect.objectContaining({
        title: '관리자 예매/결제 진단 및 일일 매출 통계 개선',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/161',
      }),
    );
    expect(note?.summary).toContain('실패/만료/취소 사유');
    expect(note?.summary).toContain('KST 일일 예매·취소·매출 통계');
    expect(note?.highlights).toEqual(
      expect.arrayContaining([
        expect.stringContaining('좌석통계'),
        expect.stringContaining('실패 진단'),
        expect.stringContaining('marketing consent'),
      ]),
    );
  });

  it('registers the active ticket manifest export PR', () => {
    const note = adminPatchNotes.find((entry) => entry.prNumber === 182);

    expect(note).toEqual(
      expect.objectContaining({
        category: 'feature',
        title: '회차 구매자 명단 CSV 추가',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/182',
      }),
    );
    expect(note?.summary).toContain('유효 티켓 구매자 명단');
    expect(note?.highlights).toEqual(
      expect.arrayContaining([
        expect.stringContaining('회차 구매자 명단 CSV 버튼'),
        expect.stringContaining('active ticket item'),
        expect.stringContaining('formula neutralization'),
      ]),
    );
  });

  it('registers the ticket benefit operations PR', () => {
    const note = adminPatchNotes.find((entry) => entry.prNumber === 173);

    expect(note).toEqual(
      expect.objectContaining({
        category: 'feature',
        title: '티켓 베네핏 운영 기능 추가',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/173',
      }),
    );
    expect(note?.summary).toContain('ALL/한정 혜택');
    expect(note?.summary).toContain('rollback');
    expect(note?.highlights).toEqual(
      expect.arrayContaining([
        expect.stringContaining('test/live run'),
        expect.stringContaining('ticket item'),
        expect.stringContaining('6:1과 polaroid'),
      ]),
    );
  });

  it('registers the recent backfilled PR patch notes', () => {
    const notesByPr = new Map(
      adminPatchNotes.map((entry) => [entry.prNumber, entry]),
    );

    expect([...notesByPr.keys()]).toEqual(
      expect.arrayContaining([174, 175, 176, 177]),
    );
    expect(notesByPr.get(177)).toEqual(
      expect.objectContaining({
        category: 'feature',
        title: '혜택 CSV와 QR 좌석 강조 확장',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/177',
      }),
    );
    expect(notesByPr.get(177)?.summary).toContain('QR 티켓 좌석 텍스트');
    expect(notesByPr.get(177)?.highlights).toEqual(
      expect.arrayContaining([
        expect.stringContaining('좌석번호'),
        expect.stringContaining('tierColor'),
        expect.stringContaining('PII'),
      ]),
    );

    expect(notesByPr.get(176)).toEqual(
      expect.objectContaining({
        category: 'patch',
        title: '관리자 예매 상세 500 오류 수정',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/176',
      }),
    );
    expect(notesByPr.get(175)).toEqual(
      expect.objectContaining({
        category: 'feature',
        title: '관리자 결제 실패 분류 표시',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/175',
      }),
    );
    expect(notesByPr.get(174)).toEqual(
      expect.objectContaining({
        category: 'feature',
        title: '혜택 관리 회차 선택 UI 추가',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/174',
      }),
    );
  });

  it('registers the payment failure breakdown PR', () => {
    const note = adminPatchNotes.find((entry) => entry.prNumber === 168);

    expect(note).toEqual(
      expect.objectContaining({
        category: 'patch',
        title: '관리자 결제 실패/만료 집계 분리',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/168',
      }),
    );
    expect(note?.summary).toContain('결제기한 만료');
    expect(note?.summary).toContain('결제 중단/취소');
    expect(note?.highlights).toEqual(
      expect.arrayContaining([
        expect.stringContaining('결제 실패/만료 KPI'),
        expect.stringContaining('failure diagnostic code'),
        expect.stringContaining('abortedPaymentCount'),
      ]),
    );
  });

  it('registers the customer payment failure guidance PR', () => {
    const note = adminPatchNotes.find((entry) => entry.prNumber === 172);

    expect(note).toEqual(
      expect.objectContaining({
        category: 'patch',
        title: '고객 결제 실패 사유 다국어 안내',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/172',
      }),
    );
    expect(note?.summary).toContain('결제 실패 직후');
    expect(note?.summary).toContain('현재 언어');
    expect(note?.highlights).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Toss failUrl'),
        expect.stringContaining('할부 미지원'),
        expect.stringContaining('DB 진단 메시지'),
      ]),
    );
  });

  it('registers the payment processing grace PR', () => {
    const note = adminPatchNotes.find((entry) => entry.prNumber === 163);

    expect(note).toEqual(
      expect.objectContaining({
        category: 'patch',
        title: '결제 처리 grace window 적용',
        githubUrl: 'https://github.com/sangwopark19/grapit/pull/163',
      }),
    );
    expect(note?.summary).toContain('Toss 결제창');
    expect(note?.summary).toContain('조기 실패 처리');
    expect(note?.highlights).toEqual(
      expect.arrayContaining([
        expect.stringContaining('최대 15분 cap'),
        expect.stringContaining('Redis seat lock TTL'),
        expect.stringContaining('failUrl'),
      ]),
    );
    expect(note?.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining('API targeted Vitest'),
        expect.stringContaining('Subagent code review'),
      ]),
    );
  });
});

describe('latestAdminPatchNotes', () => {
  it('returns the requested number of latest notes without mutating the catalog', () => {
    const before = [...adminPatchNotes];

    expect(latestAdminPatchNotes(1)).toEqual([adminPatchNotes[0]]);
    expect(adminPatchNotes).toEqual(before);
  });
});
