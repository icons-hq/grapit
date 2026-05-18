import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { AdminUserManagement } from '../admin-user-management';
import { apiClient } from '@/lib/api-client';
import type {
  AdminUserDetail,
  AdminUserListItem,
} from '@/hooks/use-admin-users';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mocks.apiGet,
    patch: mocks.apiPatch,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const listUser: AdminUserListItem = {
  id: 'user-fan-1',
  name: '박팬',
  maskedEmail: 'pa***@example.com',
  maskedPhone: '+82********78',
  role: 'admin',
  preferredLocale: 'ko',
  country: 'KR',
  marketingConsent: true,
  adminCapabilityBundle: 'admin',
  adminCapabilities: [
    'event.write',
    'event.publish',
    'support.manage',
    'support.escalate',
    'reservations.export_raw',
    'seat.disable',
    'seat.reactivate',
    'seat.manual_open',
    'banner.manage',
    'audit.read',
    'security.manage',
  ],
  verification: {
    email: true,
    phone: false,
  },
  reservations: {
    total: 3,
    pendingPayment: 1,
    confirmed: 2,
    cancelled: 0,
    totalAmount: 240000,
  },
  support: {
    openThreads: 1,
    totalThreads: 2,
    latestThreadAt: '2026-05-17T03:00:00.000Z',
    latestSubject: '좌석 위치 문의',
  },
  audit: {
    lastActionAt: '2026-05-17T02:00:00.000Z',
    lastAction: 'security.permission.update',
  },
  createdAt: '2026-05-01T00:00:00.000Z',
  lastActivityAt: '2026-05-17T04:00:00.000Z',
};

const secondPageUser: AdminUserListItem = {
  ...listUser,
  id: 'user-fan-2',
  name: '이페이지',
  maskedEmail: 'se***@example.com',
  maskedPhone: '+82********99',
  role: 'user',
  adminCapabilityBundle: null,
  adminCapabilities: [],
  reservations: {
    total: 1,
    pendingPayment: 0,
    confirmed: 1,
    cancelled: 0,
    totalAmount: 120000,
  },
};

const detailUser: AdminUserDetail = {
  ...listUser,
  email: 'parkfan@example.com',
  phone: '+821012345678',
  gender: 'unspecified',
  birthDate: '1995-01-01',
  accountStatus: 'active',
  lastLoginAt: '2026-05-17T04:00:00.000Z',
  recentReservations: [
    {
      id: 'reservation-1',
      reservationNumber: 'R-20260517-001',
      performanceTitle: '걸룰스 팬미팅',
      status: 'CONFIRMED',
      totalAmount: 120000,
      createdAt: '2026-05-17T01:00:00.000Z',
      showDateTime: '2026-06-01T10:00:00.000Z',
    },
  ],
  supportThreads: [
    {
      id: 'support-1',
      subject: '좌석 위치 문의',
      status: 'open',
      category: 'seat',
      lastMessageAt: '2026-05-17T03:00:00.000Z',
      createdAt: '2026-05-17T02:40:00.000Z',
    },
  ],
  recentAuditEvents: [
    {
      id: 'audit-1',
      actorUserId: 'admin-1',
      action: 'security.permission.update',
      status: 'success',
      reason: '운영 담당자 권한 조정',
      changedFields: ['adminCapabilities'],
      ipAddress: '203.0.113.0',
      createdAt: '2026-05-17T02:00:00.000Z',
    },
  ],
};

const secondPageDetailUser: AdminUserDetail = {
  ...detailUser,
  ...secondPageUser,
  email: 'secondfan@example.com',
  phone: '+821099999999',
  recentReservations: [
    {
      id: 'reservation-2',
      reservationNumber: 'R-20260517-002',
      performanceTitle: '두번째 페이지 공연',
      status: 'CONFIRMED',
      totalAmount: 120000,
      createdAt: '2026-05-17T01:00:00.000Z',
      showDateTime: '2026-06-01T10:00:00.000Z',
    },
  ],
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(ui: ReactNode, queryClient = createQueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
  return { queryClient };
}

function mockSuccessfulApi() {
  mocks.apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/users?')) {
      const url = new URL(path, 'http://localhost');
      const page = Number(url.searchParams.get('page') ?? 1);
      const search = url.searchParams.get('search');
      const items = page === 2 || search === 'reset' ? [secondPageUser] : [listUser];
      return Promise.resolve({
        items,
        total: search === 'reset' ? 1 : 50,
        page,
        limit: 25,
        totalPages: search === 'reset' ? 1 : 2,
      });
    }
    if (path === '/api/v1/admin/users/user-fan-1') {
      return Promise.resolve(detailUser);
    }
    if (path === '/api/v1/admin/users/user-fan-2') {
      return Promise.resolve(secondPageDetailUser);
    }
    return Promise.reject(new Error(`Unhandled GET ${path}`));
  });
}

describe('AdminUserManagement', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      configurable: true,
    });
  });

  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPatch.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mockSuccessfulApi();
  });

  it('renders search, verification filters, user detail, reservation, CS, and masked audit context', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('박팬')).toBeInTheDocument();
    expect(screen.getByLabelText('회원 검색어')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '인증 필터' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('회원 검색어'), 'fan');
    await user.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/v1/admin/users?search=fan&page=1&limit=25',
      );
    });

    expect(screen.getByText('parkfan@example.com')).toBeInTheDocument();
    expect(screen.getByText('예매 컨텍스트')).toBeInTheDocument();
    expect(screen.getByText('걸룰스 팬미팅')).toBeInTheDocument();
    expect(screen.getByText('CS 컨텍스트')).toBeInTheDocument();
    expect(screen.getByText('좌석 위치 문의')).toBeInTheDocument();
    expect(screen.getByText('Masked audit 컨텍스트')).toBeInTheDocument();
    expect(screen.getByText(/masked IP 203\.0\.113\.0/)).toBeInTheDocument();
    expect(screen.queryByText('203.0.113.123')).not.toBeInTheDocument();
  });

  it('pages through multi-page user lists and replaces stale detail context', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('박팬')).toBeInTheDocument();
    expect(await screen.findByText('parkfan@example.com')).toBeInTheDocument();
    expect(screen.getByText('총 50명 · 1/2 페이지')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/v1/admin/users?page=2&limit=25',
      );
    });
    expect(await screen.findByRole('button', { name: '이페이지 회원 상세 보기' })).toBeInTheDocument();
    expect(await screen.findByText('secondfan@example.com')).toBeInTheDocument();
    expect(screen.queryByText('parkfan@example.com')).not.toBeInTheDocument();
  });

  it('resets the selected detail when a new search changes the visible list', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminUserManagement />);

    await user.click(await screen.findByRole('button', { name: '박팬 회원 상세 보기' }));
    expect(await screen.findByText('parkfan@example.com')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('회원 검색어'));
    await user.type(screen.getByLabelText('회원 검색어'), 'reset');
    await user.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/v1/admin/users?search=reset&page=1&limit=25',
      );
    });
    expect(await screen.findByRole('button', { name: '이페이지 회원 상세 보기' })).toBeInTheDocument();
    expect(await screen.findByText('secondfan@example.com')).toBeInTheDocument();
    expect(screen.queryByText('parkfan@example.com')).not.toBeInTheDocument();
  });

  it('requires reason and explicit confirmation before sending confirmed permission updates', async () => {
    const user = userEvent.setup();
    mocks.apiPatch.mockResolvedValueOnce({
      ...detailUser,
      adminCapabilities: detailUser.adminCapabilities.filter(
        (capability) => capability !== 'security.manage',
      ),
    });
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithClient(<AdminUserManagement />, queryClient);

    expect(await screen.findByText('박팬')).toBeInTheDocument();

    const securityCapability = await screen.findByRole('checkbox', {
      name: '보안 권한 관리',
    });
    await user.click(securityCapability);

    const submitButton = screen.getByRole('button', {
      name: '권한 변경 검토',
    });
    expect(submitButton).toBeDisabled();

    await user.type(
      screen.getByLabelText('권한 변경 사유'),
      '보안 담당자 교체로 권한을 회수합니다.',
    );
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    await user.click(
      await screen.findByRole('button', { name: '변경 확정' }),
    );

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/users/user-fan-1/permissions',
        expect.objectContaining({
          role: 'admin',
          adminCapabilityBundle: 'admin',
          reason: '보안 담당자 교체로 권한을 회수합니다.',
          confirmed: true,
        }),
      );
    });
    expect(
      (apiClient.patch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
        .adminCapabilities,
    ).not.toContain('security.manage');
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'users'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'audit'],
      });
    });
  });

  it('shows an actionable mutation error without clearing the current detail view', async () => {
    const user = userEvent.setup();
    mocks.apiPatch.mockRejectedValueOnce(new Error('Forbidden'));

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('예매 컨텍스트')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '보안 권한 관리' }));
    await user.type(screen.getByLabelText('권한 변경 사유'), '권한 회수 테스트');
    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
    await user.click(screen.getByRole('button', { name: '권한 변경 검토' }));
    await user.click(await screen.findByRole('button', { name: '변경 확정' }));

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('권한 변경에 실패했습니다. 현재 상세 화면은 유지됩니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText('걸룰스 팬미팅')).toBeInTheDocument();
  });
});
