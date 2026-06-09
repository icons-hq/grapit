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
});

describe('latestAdminPatchNotes', () => {
  it('returns the requested number of latest notes without mutating the catalog', () => {
    const before = [...adminPatchNotes];

    expect(latestAdminPatchNotes(1)).toEqual([adminPatchNotes[0]]);
    expect(adminPatchNotes).toEqual(before);
  });
});
