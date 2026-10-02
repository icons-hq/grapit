import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsentAuditPage, ConsentAuditRow } from '@grabit/shared';

import AdminConsentAuditPage from '../page';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mocks.get },
}));

function row(index: number): ConsentAuditRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    itemKey: 'privacy',
    version: '2026-05-11',
    language: 'ko',
    maskedUser: { id: `user-${index}`, email: `u${index}***@example.com`, phone: '+82********78' },
    maskedIp: '203.0.113.0',
    timestamp: `2026-09-30T0${index}:00:00.000Z`,
    sourceFlow: 'signup',
    accepted: true,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminConsentAuditPage />
    </QueryClientProvider>,
  );
}

describe('AdminConsentAuditPage', () => {
  beforeEach(() => {
    mocks.get.mockReset();
  });

  it('loads bounded pages and follows the server cursor for older rows', async () => {
    const firstPage: ConsentAuditPage = {
      items: [row(1), row(2)],
      nextCursor: 'cursor-after-2',
      defaultWindowFrom: '2026-09-23T00:00:00.000Z',
    };
    const lastPage: ConsentAuditPage = {
      items: [row(3)],
      nextCursor: null,
      defaultWindowFrom: '2026-09-23T00:00:00.000Z',
    };
    mocks.get.mockImplementation(async (path: string) =>
      path.includes('cursor=') ? lastPage : firstPage,
    );
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByText('u1***@example.com')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/admin/consent-audit');
    expect(screen.getByRole('status')).toHaveTextContent('최근 7일');

    await user.click(screen.getByRole('button', { name: '더 보기' }));

    expect(await screen.findByText('u3***@example.com')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenLastCalledWith('/api/v1/admin/consent-audit?cursor=cursor-after-2');
    expect(screen.getByText('u1***@example.com')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
    });
  });

  it('sends a user lookup without the default window notice', async () => {
    mocks.get.mockResolvedValue({ items: [row(1)], nextCursor: null, defaultWindowFrom: null });
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('u1***@example.com');
    await user.type(screen.getByLabelText('사용자 ID 또는 이메일'), 'fan@example.com');
    await user.click(screen.getByRole('button', { name: '조회' }));

    await waitFor(() => {
      expect(mocks.get).toHaveBeenLastCalledWith('/api/v1/admin/consent-audit?email=fan%40example.com');
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });
});
