import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { AdminUserManagement } from '../admin-user-management';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import type {
  AdminUserDetail,
  AdminUserListItem,
} from '@/hooks/use-admin-users';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiRaw: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mocks.apiGet,
    patch: mocks.apiPatch,
    post: mocks.apiPost,
    raw: mocks.apiRaw,
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
  accountStatus: 'active',
  withdrawnAt: null,
  withdrawalReason: null,
  withdrawalSource: null,
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

const userStats = {
  total: 50,
  active: 48,
  withdrawn: 2,
  merged: 0,
  verification: {
    emailVerified: 40,
    phoneVerified: 35,
    fullyVerified: 32,
  },
  marketing: {
    consented: 21,
    notConsented: 29,
  },
  countries: [
    { value: 'KR', count: 30, ratio: 0.6 },
    { value: 'TH', count: 20, ratio: 0.4 },
  ],
  locales: [
    { value: 'ko', count: 34, ratio: 0.68 },
    { value: 'th', count: 16, ratio: 0.32 },
  ],
  signupTrend: [
    { date: '2026-05-17', count: 2 },
    { date: '2026-05-18', count: 3 },
  ],
  generatedAt: '2026-05-18T00:00:00.000Z',
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

/** API-shaped list item + detail for one admin account (as the server sends it). */
function mockApiAdminAccount(access: {
  id: string;
  name: string;
  adminCapabilityBundle: string | null;
  adminCapabilities: string[];
  adminSuperuser?: boolean;
  effectiveAdminCapabilities?: string[];
}) {
  const item = {
    id: access.id,
    maskedEmail: 'ad***@example.com',
    name: access.name,
    maskedPhone: '+82******5678',
    role: 'admin',
    country: 'KR',
    preferredLocale: 'ko',
    marketingConsent: false,
    adminCapabilityBundle: access.adminCapabilityBundle,
    adminCapabilities: access.adminCapabilities,
    ...(access.adminSuperuser === undefined
      ? {}
      : {
          adminSuperuser: access.adminSuperuser,
          effectiveAdminCapabilities: access.effectiveAdminCapabilities ?? [],
        }),
    accountStatus: 'active',
    withdrawnAt: null,
    withdrawalReason: null,
    withdrawalSource: null,
    verificationState: { emailVerified: true, phoneVerified: true },
    reservationSummary: {
      total: 0,
      statuses: { pendingPayment: 0, confirmed: 0, cancelled: 0, failed: 0 },
      lastReservationAt: null,
    },
    lastActivityAt: null,
    createdAt: '2026-06-29T00:00:00.000Z',
  };
  mocks.apiGet.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/users/stats') return Promise.resolve(userStats);
    if (path.startsWith('/api/v1/admin/users?')) {
      return Promise.resolve({ items: [item], total: 1, page: 1, limit: 25, totalPages: 1 });
    }
    if (path === `/api/v1/admin/users/${access.id}`) {
      return Promise.resolve({
        ...item,
        account: { birthDate: '1990-01-01', gender: 'unspecified', updatedAt: null },
        recentReservations: [],
        supportThreads: { total: 0, open: 0, escalated: 0, recentThreads: [] },
        recentAuditEvents: [],
      });
    }
    return Promise.reject(new Error(`Unhandled GET ${path}`));
  });
}

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
    if (path === '/api/v1/admin/users/stats') {
      return Promise.resolve(userStats);
    }
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
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:http://localhost/user-export'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
  });

  beforeEach(() => {
    useAuthStore.setState({ user: null });
    mocks.apiGet.mockReset();
    mocks.apiPatch.mockReset();
    mocks.apiPost.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    // The CSV download goes through the session-refreshing raw client.
    mocks.apiRaw.mockReset().mockImplementation(async () =>
      new Response('"id","email"\n"user-1","fan@example.com"', {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="user-export-raw-2026-05-18.csv"',
        },
      }),
    );
    mockSuccessfulApi();
  });

  it('renders user statistics and downloads raw user CSV with a reason', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('회원 데이터 통계')).toBeInTheDocument();
    expect(await screen.findByText('총 가입자')).toBeInTheDocument();
    expect(screen.getByText('50명')).toBeInTheDocument();
    expect(screen.getByText('KR')).toBeInTheDocument();
    expect(screen.getByText('30명 · 60.0%')).toBeInTheDocument();
    expect(screen.getByText('최근 14일 가입 추이')).toBeInTheDocument();

    await user.click(screen.getByText('회원 통계·전체 명단 내려받기'));
    await user.click(screen.getByRole('button', { name: '회원 원본 CSV 다운로드' }));
    await user.type(
      await screen.findByLabelText('회원 CSV 다운로드 사유'),
      '회원 운영 데이터 대조',
    );
    await user.click(screen.getByRole('button', { name: 'CSV 다운로드 확정' }));

    await waitFor(() => {
      expect(mocks.apiRaw).toHaveBeenCalledWith(
        'POST',
        '/api/v1/admin/users/export',
        { reason: '회원 운영 데이터 대조' },
        { showErrorToast: false },
      );
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      '회원 원본 CSV 다운로드를 시작했습니다.',
    );
  });

  it('renders merged user stats as a separate inactive account bucket', async () => {
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/users/stats') {
        return Promise.resolve({
          ...userStats,
          active: 45,
          withdrawn: 2,
          merged: 3,
        });
      }
      if (path.startsWith('/api/v1/admin/users?')) {
        return Promise.resolve({
          items: [listUser],
          total: 50,
          page: 1,
          limit: 25,
          totalPages: 2,
        });
      }
      if (path === '/api/v1/admin/users/user-fan-1') {
        return Promise.resolve(detailUser);
      }
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('병합 계정')).toBeInTheDocument();
    expect(screen.getByText('3 / 50명')).toBeInTheDocument();
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
    expect(screen.getByText('예매 내역')).toBeInTheDocument();
    expect(screen.getByText('걸룰스 팬미팅')).toBeInTheDocument();
    expect(screen.getByText('고객 문의 내역')).toBeInTheDocument();
    expect(screen.getByText('좌석 위치 문의')).toBeInTheDocument();
    expect(screen.getByText('활동 기록 (개인정보 보호)')).toBeInTheDocument();
    expect(screen.getByText(/masked IP 203\.0\.113\.0/)).toBeInTheDocument();
    expect(screen.queryByText('203.0.113.123')).not.toBeInTheDocument();
  });

  it('renders merged account status from API detail responses', async () => {
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/users/stats') {
        return Promise.resolve(userStats);
      }
      if (path.startsWith('/api/v1/admin/users?')) {
        return Promise.resolve({
          items: [
            {
              id: 'user-merged-1',
              maskedEmail: 'm***@example.com',
              name: 'Merged User',
              maskedPhone: '+82******5678',
              role: 'user',
              country: 'KR',
              preferredLocale: 'ko',
              marketingConsent: false,
              adminCapabilityBundle: null,
              adminCapabilities: [],
              accountStatus: 'merged',
              withdrawnAt: null,
              withdrawalReason: 'merged into user-target-1',
              withdrawalSource: 'admin',
              verificationState: {
                emailVerified: true,
                phoneVerified: true,
              },
              reservationSummary: {
                total: 0,
                statuses: {
                  pendingPayment: 0,
                  confirmed: 0,
                  cancelled: 0,
                  failed: 0,
                },
                lastReservationAt: null,
              },
              lastActivityAt: null,
              createdAt: '2026-06-29T00:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }
      if (path === '/api/v1/admin/users/user-merged-1') {
        return Promise.resolve({
          id: 'user-merged-1',
          maskedEmail: 'm***@example.com',
          name: 'Merged User',
          maskedPhone: '+82******5678',
          role: 'user',
          country: 'KR',
          preferredLocale: 'ko',
          marketingConsent: false,
          adminCapabilityBundle: null,
          adminCapabilities: [],
          accountStatus: 'merged',
          withdrawnAt: null,
          withdrawalReason: 'merged into user-target-1',
          withdrawalSource: 'admin',
          verificationState: {
            emailVerified: true,
            phoneVerified: true,
          },
          reservationSummary: {
            total: 0,
            statuses: {
              pendingPayment: 0,
              confirmed: 0,
              cancelled: 0,
              failed: 0,
            },
            lastReservationAt: null,
          },
          lastActivityAt: null,
          createdAt: '2026-06-29T00:00:00.000Z',
          account: {
            birthDate: '1995-01-01',
            gender: 'unspecified',
            updatedAt: null,
          },
          recentReservations: [],
          supportThreads: {
            total: 0,
            open: 0,
            escalated: 0,
            recentThreads: [],
          },
          recentAuditEvents: [],
        });
      }
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('Merged User')).toBeInTheDocument();
    const mergedRow = await screen.findByRole('button', {
      name: 'Merged User 회원 상세 보기',
    });
    expect(within(mergedRow).getByText('병합됨')).toBeInTheDocument();
    expect(await screen.findAllByText('병합됨')).toHaveLength(3);
  });

  it('shows a legacy role-only superuser as a full admin with its current effective access', async () => {
    mockApiAdminAccount({
      id: 'legacy-admin',
      name: 'Legacy Admin',
      adminCapabilityBundle: null,
      adminCapabilities: [],
      adminSuperuser: true,
      effectiveAdminCapabilities: ['reservations.read', 'security.manage'],
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-access-badge')).toHaveTextContent('전체 관리자(legacy)');
    expect(screen.getByTestId('admin-user-current-permissions')).toHaveTextContent(
      '현재 실효 권한: 전체 관리자 (모든 권한, 권한 묶음 없는 legacy 관리자)',
    );
    // The edit summary still describes the unsaved selection separately.
    expect(screen.getByTestId('admin-user-effective-permissions')).toHaveTextContent(
      '적용될 권한: 권한 묶음을 선택하세요',
    );
  });

  it('falls back to the legacy superuser rule when the API sends no resolved access', async () => {
    mockApiAdminAccount({
      id: 'legacy-admin',
      name: 'Legacy Admin',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-access-badge')).toHaveTextContent('전체 관리자(legacy)');
  });

  it('trusts the server when an unknown stored bundle resolves to no access (u12)', async () => {
    // The API normalises an unknown bundle to null; re-resolving it here would
    // read as the legacy superuser fallback.
    mockApiAdminAccount({
      id: 'unknown-bundle-admin',
      name: 'Unknown Bundle Admin',
      adminCapabilityBundle: null,
      adminCapabilities: [],
      adminSuperuser: false,
      effectiveAdminCapabilities: [],
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-user-access-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-user-current-permissions')).toHaveTextContent('현재 실효 권한: 없음');
    expect(screen.queryByText('전체 관리자(legacy)')).not.toBeInTheDocument();
  });

  it('disables permission and withdrawal controls for merged accounts', async () => {
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/users/stats') {
        return Promise.resolve(userStats);
      }
      if (path.startsWith('/api/v1/admin/users?')) {
        return Promise.resolve({
          items: [
            {
              ...listUser,
              id: 'user-merged-1',
              name: 'Merged User',
              role: 'user',
              adminCapabilityBundle: null,
              adminCapabilities: [],
              accountStatus: 'merged',
              withdrawnAt: null,
              withdrawalReason: 'merged into user-target-1',
              withdrawalSource: 'admin',
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }
      if (path === '/api/v1/admin/users/user-merged-1') {
        return Promise.resolve({
          ...detailUser,
          id: 'user-merged-1',
          name: 'Merged User',
          role: 'user',
          adminCapabilityBundle: null,
          adminCapabilities: [],
          accountStatus: 'merged',
          withdrawnAt: null,
          withdrawalReason: 'merged into user-target-1',
          withdrawalSource: 'admin',
        });
      }
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('Merged User')).toBeInTheDocument();
    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Capability bundle' })).toBeDisabled();
    const capabilityFieldset = screen.getByText('세부 권한').closest('fieldset');
    expect(capabilityFieldset).not.toBeNull();
    for (const checkbox of within(capabilityFieldset as HTMLElement).getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled();
    }
    expect(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' })).toBeDisabled();
    expect(screen.getByLabelText('권한 변경 사유')).toBeDisabled();
    expect(screen.getByRole('button', { name: '권한 변경 검토' })).toBeDisabled();

    expect(screen.getByLabelText('탈퇴 처리 사유')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '회원 탈퇴 처리 확인' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '탈퇴 처리' })).toBeDisabled();
    expect(mocks.apiPatch).not.toHaveBeenCalled();
    expect(mocks.apiPost).not.toHaveBeenCalled();
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
    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();

    // Narrowing requires a non-admin bundle; the admin bundle is superuser.
    await user.click(screen.getByRole('combobox', { name: 'Capability bundle' }));
    await user.click(await screen.findByRole('option', { name: '운영자' }));
    await user.click(screen.getByRole('checkbox', { name: '배너 관리' }));

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
          adminCapabilityBundle: 'operator',
          adminCapabilities: [
            'event.write',
            'support.manage',
            'support.escalate',
            'reservations.read',
            'seat.disable',
            'seat.reactivate',
            'seat.manual_open',
          ],
          reason: '보안 담당자 교체로 권한을 회수합니다.',
          confirmed: true,
        }),
        { showErrorToast: false },
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

  it('lets full admins assign scanner-only bundle without settlement or raw export capabilities', async () => {
    const user = userEvent.setup();
    mocks.apiPatch.mockResolvedValueOnce({
      ...detailUser,
      adminCapabilityBundle: 'scanner',
      adminCapabilities: [
        'field.scan.verify',
        'field.scan.consume',
        'field.scan.sync',
        'field.benefits.redeem',
      ],
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Capability bundle' }));
    await user.click(await screen.findByRole('option', { name: '스캐너' }));

    expect(screen.getByText('검표 확인')).toBeInTheDocument();
    expect(screen.getByText('입장 처리')).toBeInTheDocument();
    expect(screen.getByText('보류 스캔 동기화')).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('권한 변경 사유'),
      '행사 당일 현장 검표 전용 계정으로 전환합니다.',
    );
    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
    await user.click(screen.getByRole('button', { name: '권한 변경 검토' }));
    await user.click(await screen.findByRole('button', { name: '변경 확정' }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/users/user-fan-1/permissions',
        expect.objectContaining({
          role: 'admin',
          adminCapabilityBundle: 'scanner',
          adminCapabilities: [
            'field.scan.verify',
            'field.scan.consume',
            'field.scan.sync',
        'field.benefits.redeem',
          ],
          confirmed: true,
        }),
        { showErrorToast: false },
      );
    });

    const payload = (apiClient.patch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(payload.adminCapabilities).not.toContain('settlement.export');
    expect(payload.adminCapabilities).not.toContain('reservations.export_raw');
    expect(payload.adminCapabilities).not.toContain('security.manage');
    expect(payload.adminCapabilities).not.toContain('event.write');
    expect(payload.adminCapabilities).not.toContain('banner.manage');
  });

  it('shows an actionable mutation error without clearing the current detail view', async () => {
    const user = userEvent.setup();
    mocks.apiPatch.mockRejectedValueOnce(new Error('Forbidden'));

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('예매 내역')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Capability bundle' }));
    await user.click(await screen.findByRole('option', { name: '운영자' }));
    await user.type(screen.getByLabelText('권한 변경 사유'), '권한 회수 테스트');
    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
    await user.click(screen.getByRole('button', { name: '권한 변경 검토' }));
    await user.click(await screen.findByRole('button', { name: '변경 확정' }));

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('권한 변경에 실패했습니다. 현재 상세 화면은 유지됩니다.'),
    ).toBeInTheDocument();
    expect(within(alert).getByText('Forbidden')).toBeInTheDocument();
    expect(screen.getByText('걸룰스 팬미팅')).toBeInTheDocument();
  });

  it('reports a rejected permission change once as a toast plus the inline alert', async () => {
    const user = userEvent.setup();
    // The API client toasts on its own unless showErrorToast is false; the mock
    // stands in for it, so the request options are asserted below.
    mocks.apiPatch.mockRejectedValueOnce(Object.assign(
      new Error('본인이 보유하지 않은 권한은 부여하거나 변경할 수 없습니다: banner.manage'),
      { statusCode: 403 },
    ));

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Capability bundle' }));
    await user.click(await screen.findByRole('option', { name: '운영자' }));
    await user.type(screen.getByLabelText('권한 변경 사유'), '위임 권한 확인');
    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
    await user.click(screen.getByRole('button', { name: '권한 변경 검토' }));
    await user.click(await screen.findByRole('button', { name: '변경 확정' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('본인이 보유하지 않은 권한은 부여하거나 변경할 수 없습니다: banner.manage');
    expect(mocks.apiPatch).toHaveBeenCalledWith(
      '/api/v1/admin/users/user-fan-1/permissions',
      expect.anything(),
      { showErrorToast: false },
    );
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(
      '본인이 보유하지 않은 권한은 부여하거나 변경할 수 없습니다: banner.manage',
    );
  });

  describe('delegated security admin (audit #120)', () => {
    beforeEach(() => {
      useAuthStore.setState({
        user: {
          id: 'actor-delegated-1',
          role: 'admin',
          adminCapabilityBundle: null,
          adminCapabilities: ['security.manage', 'event.write', 'banner.manage'],
        } as never,
      });
    });

    it('locks editing a full admin the actor cannot change', async () => {
      renderWithClient(<AdminUserManagement />);

      expect(await screen.findByTestId('admin-user-delegation-locked')).toHaveTextContent(
        '내 권한 밖의 권한(전체 관리자 포함)을 가지고 있어 변경할 수 없습니다',
      );
      expect(screen.getByRole('combobox', { name: 'Role' })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'Capability bundle' })).toBeDisabled();
      expect(screen.getByLabelText('권한 변경 사유')).toBeDisabled();
      expect(screen.getByRole('button', { name: '권한 변경 검토' })).toBeDisabled();
    });

    it('offers only what the actor holds when granting access to a general member', async () => {
      const user = userEvent.setup();
      renderWithClient(<AdminUserManagement />);
      await user.type(await screen.findByLabelText('회원 검색어'), 'reset');
      await user.click(screen.getByRole('button', { name: '검색' }));
      expect(await screen.findByText('secondfan@example.com')).toBeInTheDocument();
      expect(screen.queryByTestId('admin-user-delegation-locked')).not.toBeInTheDocument();

      await user.click(screen.getByRole('combobox', { name: 'Role' }));
      await user.click(await screen.findByRole('option', { name: '관리자' }));
      await user.click(screen.getByRole('combobox', { name: 'Capability bundle' }));
      expect(await screen.findByRole('option', { name: '전체 관리자 (위임 불가)' }))
        .toHaveAttribute('aria-disabled', 'true');
      await user.click(screen.getByRole('option', { name: '운영자' }));

      // The operator bundle's defaults are narrowed to the actor's own capabilities.
      expect(screen.getByRole('checkbox', { name: '공연 편집' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: '배너 관리' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: '좌석 비활성화' })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: '좌석 비활성화' })).toBeDisabled();
      expect(screen.getAllByText('내 권한 밖이라 위임할 수 없습니다').length).toBeGreaterThan(0);

      await user.type(screen.getByLabelText('권한 변경 사유'), '배너 담당자 지정');
      await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
      await user.click(screen.getByRole('button', { name: '권한 변경 검토' }));
      await user.click(await screen.findByRole('button', { name: '변경 확정' }));

      await waitFor(() => {
        expect(mocks.apiPatch).toHaveBeenCalledWith(
          '/api/v1/admin/users/user-fan-2/permissions',
          expect.objectContaining({
            role: 'admin',
            adminCapabilityBundle: 'operator',
            adminCapabilities: ['event.write', 'banner.manage'],
          }),
          { showErrorToast: false },
        );
      });
    });
  });

  it('shows the admin bundle as effective superuser access and locks capability narrowing', async () => {
    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    // The stored list omits refund/settlement, but the admin bundle grants them.
    expect(screen.getByTestId('admin-user-effective-permissions')).toHaveTextContent(
      '적용될 권한: 전체 관리자 (모든 권한)',
    );
    const capabilityFieldset = screen.getByText('세부 권한').closest('fieldset');
    const checkboxes = within(capabilityFieldset as HTMLElement).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(20);
    for (const checkbox of checkboxes) {
      expect(checkbox).toBeChecked();
      expect(checkbox).toBeDisabled();
    }
    expect(screen.getByRole('checkbox', { name: '관리자 환불 처리' })).toBeChecked();
    expect(
      screen.getByText(/전체 관리자 묶음은 모든 권한을 가지므로 세부 권한을 줄일 수 없습니다/),
    ).toBeInTheDocument();
  });

  it('sends the canonical empty capability list when granting the admin bundle', async () => {
    const user = userEvent.setup();
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/users/stats') return Promise.resolve(userStats);
      if (path.startsWith('/api/v1/admin/users?')) {
        return Promise.resolve({ items: [listUser], total: 1, page: 1, limit: 25, totalPages: 1 });
      }
      if (path === '/api/v1/admin/users/user-fan-1') {
        return Promise.resolve({
          ...detailUser,
          adminCapabilityBundle: 'operator',
          adminCapabilities: ['support.manage'],
        });
      }
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    });
    mocks.apiPatch.mockResolvedValueOnce(detailUser);

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('적용될 권한: 운영자 묶음 · 1개')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Capability bundle' }));
    await user.click(await screen.findByRole('option', { name: '전체 관리자' }));
    await user.type(screen.getByLabelText('권한 변경 사유'), '보안 책임자 지정');
    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
    await user.click(screen.getByRole('button', { name: '권한 변경 검토' }));
    await user.click(await screen.findByRole('button', { name: '변경 확정' }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/users/user-fan-1/permissions',
        expect.objectContaining({
          role: 'admin',
          adminCapabilityBundle: 'admin',
          adminCapabilities: [],
        }),
        { showErrorToast: false },
      );
    });
  });

  it('revokes admin access in one step when only the role is changed to a general member', async () => {
    const user = userEvent.setup();
    mocks.apiPatch.mockResolvedValueOnce({
      ...detailUser,
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: '일반 회원' }));

    expect(screen.getByRole('combobox', { name: 'Capability bundle' })).toBeDisabled();
    expect(screen.getByTestId('admin-user-effective-permissions')).toHaveTextContent(
      '적용될 권한: 없음 (일반 회원)',
    );

    await user.type(screen.getByLabelText('권한 변경 사유'), '계정 탈취 의심으로 긴급 회수');
    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));
    await user.click(screen.getByRole('button', { name: '권한 변경 검토' }));
    await user.click(await screen.findByRole('button', { name: '변경 확정' }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/users/user-fan-1/permissions',
        {
          role: 'user',
          adminCapabilityBundle: null,
          adminCapabilities: [],
          reason: '계정 탈취 의심으로 긴급 회수',
          confirmed: true,
        },
        { showErrorToast: false },
      );
    });
  });

  it('blocks saving a non-admin bundle with every capability unchecked', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('관리자 역할·권한 설정')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Capability bundle' }));
    await user.click(await screen.findByRole('option', { name: '스캐너' }));
    for (const name of ['검표 확인', '입장 처리', '보류 스캔 동기화', '현장 특전 지급']) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    await user.type(screen.getByLabelText('권한 변경 사유'), '권한 정리');
    await user.click(screen.getByRole('checkbox', { name: '권한 변경 영향 확인' }));

    expect(screen.getByTestId('admin-user-permission-validation')).toHaveTextContent(
      '세부 권한을 1개 이상 선택하세요',
    );
    expect(screen.getByRole('button', { name: '권한 변경 검토' })).toBeDisabled();
    expect(mocks.apiPatch).not.toHaveBeenCalled();
  });

  it('shows why an admin withdrawal was blocked by active reservations', async () => {
    const user = userEvent.setup();
    const blockedError = Object.assign(
      new Error(
        '진행 중인 예매가 있어 탈퇴 처리할 수 없습니다 (관람 예정 확정 예매 2건). 예매를 취소·환불하거나 결제가 정리된 뒤 다시 시도하세요',
      ),
      {
        statusCode: 409,
        data: {
          blockers: [
            { key: 'upcoming_confirmed_reservations', label: '관람 예정 확정 예매', count: 2 },
          ],
        },
      },
    );
    mocks.apiPost.mockRejectedValueOnce(blockedError);

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('계정 상태 관리')).toBeInTheDocument();
    await user.type(screen.getByLabelText('탈퇴 처리 사유'), '사용자 요청');
    await user.click(screen.getByRole('checkbox', { name: '회원 탈퇴 처리 확인' }));
    await user.click(screen.getByRole('button', { name: '탈퇴 처리' }));
    await user.click(await screen.findByRole('button', { name: '탈퇴 처리 확정' }));

    expect(
      await screen.findByText(/탈퇴 처리 실패: 진행 중인 예매가 있어 탈퇴 처리할 수 없습니다/),
    ).toBeInTheDocument();
    expect(screen.getByText('탈퇴 차단: 관람 예정 확정 예매 2건')).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith('회원 탈퇴 처리에 실패했습니다.');
  });

  it('withdraws a user with reason and explicit confirmation', async () => {
    const user = userEvent.setup();
    mocks.apiPost.mockResolvedValueOnce({
      ...detailUser,
      accountStatus: 'withdrawn',
      withdrawnAt: '2026-05-18T00:00:00.000Z',
      withdrawalReason: '사용자 요청',
      withdrawalSource: 'admin',
    });
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithClient(<AdminUserManagement />, queryClient);

    expect(await screen.findByText('계정 상태 관리')).toBeInTheDocument();
    const submitButton = screen.getByRole('button', { name: '탈퇴 처리' });
    expect(submitButton).toBeDisabled();

    await user.type(screen.getByLabelText('탈퇴 처리 사유'), '사용자 요청');
    await user.click(screen.getByRole('checkbox', { name: '회원 탈퇴 처리 확인' }));
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    await user.click(await screen.findByRole('button', { name: '탈퇴 처리 확정' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/users/user-fan-1/withdrawal',
        { reason: '사용자 요청', confirmed: true },
      );
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'users'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'audit'],
      });
    });
  });

  it('disables the open withdrawal confirmation when the selected user becomes inactive after refetch', async () => {
    const user = userEvent.setup();
    let detailResponse: AdminUserDetail = detailUser;
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/users/stats') {
        return Promise.resolve(userStats);
      }
      if (path.startsWith('/api/v1/admin/users?')) {
        return Promise.resolve({
          items: [listUser],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }
      if (path === '/api/v1/admin/users/user-fan-1') {
        return Promise.resolve(detailResponse);
      }
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    });
    const queryClient = createQueryClient();

    renderWithClient(<AdminUserManagement />, queryClient);

    expect(await screen.findByText('계정 상태 관리')).toBeInTheDocument();
    await user.type(screen.getByLabelText('탈퇴 처리 사유'), '사용자 요청');
    await user.click(screen.getByRole('checkbox', { name: '회원 탈퇴 처리 확인' }));
    await user.click(screen.getByRole('button', { name: '탈퇴 처리' }));

    const confirmButton = await screen.findByRole('button', { name: '탈퇴 처리 확정' });
    expect(confirmButton).toBeEnabled();

    detailResponse = {
      ...detailUser,
      accountStatus: 'merged',
      withdrawalReason: 'merged into user-target-1',
      withdrawalSource: 'admin',
    };
    await queryClient.invalidateQueries({
      queryKey: ['admin', 'users', 'detail', 'user-fan-1'],
    });

    await waitFor(() => {
      expect(screen.getAllByText('병합됨').length).toBeGreaterThan(0);
    });
    expect(confirmButton).toBeDisabled();

    await user.click(confirmButton);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows hard-delete blocker categories returned by the API', async () => {
    const user = userEvent.setup();
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/users/stats') {
        return Promise.resolve(userStats);
      }
      if (path.startsWith('/api/v1/admin/users?')) {
        return Promise.resolve({
          items: [{ ...listUser, accountStatus: 'withdrawn' }],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }
      if (path === '/api/v1/admin/users/user-fan-1') {
        return Promise.resolve({
          ...detailUser,
          accountStatus: 'withdrawn',
          withdrawnAt: '2026-05-18T00:00:00.000Z',
          withdrawalReason: '사용자 요청',
          withdrawalSource: 'admin',
        });
      }
      return Promise.reject(new Error(`Unhandled GET ${path}`));
    });
    mocks.apiPost.mockRejectedValueOnce({
      response: {
        data: {
          blockers: [
            { key: 'reservations', label: '예매 이력', count: 2 },
            { key: 'admin_audit_logs', label: '관리자 감사 로그', count: 1 },
          ],
        },
      },
    });

    renderWithClient(<AdminUserManagement />);

    expect(await screen.findByText('계정 상태 관리')).toBeInTheDocument();
    await user.type(screen.getByLabelText('DB 완전 삭제 사유'), '테스트 데이터 정리');
    await user.click(screen.getByRole('checkbox', { name: '회원 DB 완전 삭제 확인' }));
    await user.click(screen.getByRole('button', { name: 'DB에서 완전 삭제' }));
    await user.click(await screen.findByRole('button', { name: 'DB 삭제 확정' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/users/user-fan-1/hard-delete',
        { reason: '테스트 데이터 정리', confirmed: true },
      );
    });
    expect(await screen.findByText(
      '삭제 차단: 예매 이력 2건, 관리자 감사 로그 1건',
    )).toBeInTheDocument();
  });
});
