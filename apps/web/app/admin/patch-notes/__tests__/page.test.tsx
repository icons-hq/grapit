import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import AdminPatchNotesPage from '../page';

describe('AdminPatchNotesPage', () => {
  it('shows the admin patch note archive', () => {
    render(<AdminPatchNotesPage />);

    expect(
      screen.getByRole('heading', { name: '패치노트' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('관리자 예매/결제 진단 및 일일 매출 통계 개선'),
    ).toBeInTheDocument();
    const currentNote = screen.getByLabelText(
      'PR #161 관리자 예매/결제 진단 및 일일 매출 통계 개선',
    );

    expect(
      within(currentNote).getByRole('link', { name: 'GitHub PR 열기' }),
    ).toHaveAttribute('href', 'https://github.com/sangwopark19/grapit/pull/161');
  });
});
