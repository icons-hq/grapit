import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import {
  AdminPatchNotesList,
  AdminPatchNotesPreview,
} from '../admin-patch-notes';
import { adminPatchNotes } from '@/content/admin-patch-notes';

describe('AdminPatchNotesPreview', () => {
  it('shows recent PR patch notes on the dashboard with a full list link', () => {
    render(<AdminPatchNotesPreview notes={adminPatchNotes} limit={3} />);

    expect(
      screen.getByRole('heading', { name: '최근 패치노트' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '패치노트 전체 보기' }),
    ).toHaveAttribute('href', '/admin/patch-notes');

    const article = screen.getByRole('article', {
      name: 'PR #168 관리자 결제 실패/만료 집계 분리',
    });

    expect(within(article).getByText('PR #168')).toBeInTheDocument();
    expect(
      within(article).getByText('관리자 결제 실패/만료 집계 분리'),
    ).toBeInTheDocument();
    expect(within(article).getByText(/결제기한 만료/)).toBeInTheDocument();
    expect(within(article).getByText(/결제 실패\/만료 KPI/)).toBeInTheDocument();
    expect(within(article).getByText(/Shared booking schema Vitest/)).toBeInTheDocument();
  });
});

describe('AdminPatchNotesList', () => {
  it('renders every patch note with GitHub PR links and verification evidence', () => {
    render(<AdminPatchNotesList notes={adminPatchNotes} />);

    const article = screen.getByRole('article', {
      name: 'PR #161 관리자 예매/결제 진단 및 일일 매출 통계 개선',
    });

    expect(
      within(article).getByRole('link', { name: 'GitHub PR 열기' }),
    ).toHaveAttribute('href', 'https://github.com/sangwopark19/grapit/pull/161');
    expect(within(article).getByText('검증')).toBeInTheDocument();
    expect(within(article).getByText(/Web Vitest/)).toBeInTheDocument();
  });
});
