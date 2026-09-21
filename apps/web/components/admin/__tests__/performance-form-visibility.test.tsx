import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceWithDetails } from '@grabit/shared';

import { apiClient } from '@/lib/api-client';
import { useAdminPerformanceDetail } from '@/hooks/use-admin';
import { PerformanceForm } from '../performance-form';
import { useAuthStore } from '@/stores/use-auth-store';

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api-client', () => ({
  ApiClientError: class ApiClientError extends Error {
    statusCode = 500;
  },
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/components/admin/floor-seat-map-editor', () => ({
  findDuplicateFloorKeys: () => [],
  FloorSeatMapEditor: () => <div data-testid="floor-seat-map-editor" />,
}));

vi.mock('@/components/admin/svg-preview', () => ({
  SvgPreview: () => <div data-testid="svg-preview" />,
}));

vi.mock('@/components/admin/casting-manager', () => ({
  CastingManager: () => <div data-testid="casting-manager" />,
}));

vi.mock('@/components/admin/event-publish-confirmation-dialog', () => ({
  EventPublishConfirmationDialog: () => null,
}));

if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper() {
  const queryClient = createQueryClient();

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderWithClient(ui: ReactNode) {
  return render(ui, { wrapper: createWrapper() });
}

const fixturePerformance: PerformanceWithDetails = {
  id: 'perf-visibility-1',
  title: 'Girl Rules Fanmeet',
  genre: 'artist_celebrity',
  subcategory: null,
  venueId: 'venue-1',
  posterUrl: 'https://cdn.example.com/poster.jpg',
  description: '운영자가 오래 편집한 상세정보',
  descriptionVisible: true,
  startDate: '2026-07-18T05:00:00.000Z',
  endDate: '2026-07-18T07:00:00.000Z',
  runtime: '120분',
  ageRating: '전체 관람가',
  status: 'upcoming',
  salesInfo: '운영자가 오래 편집한 판매정보',
  salesInfoVisible: true,
  detailImages: [],
  viewCount: 0,
  createdAt: '2026-05-17T00:00:00.000Z',
  updatedAt: '2026-05-17T00:00:00.000Z',
  venue: {
    id: 'venue-1',
    name: '동해문화예술관 대극장',
    address: '강원도 동해시',
    accessNotes: 'B 게이트 입장',
    transportSummary: '셔틀 운행',
  },
  priceTiers: [
    {
      id: 'tier-vip',
      performanceId: 'perf-visibility-1',
      tierName: 'VIP',
      price: 88000,
      sortOrder: 0,
    },
  ],
  showtimes: [],
  castings: [],
  seatMaps: [],
  bookingPolicy: {
    maxTicketsPerUser: 1,
    allowedPaymentMethods: ['CARD'],
    changePolicyEnabled: false,
    paymentWindowMinutes: 7,
    seatHoldMinutes: 10,
    cancelledSeatHoldMinMinutes: 1,
    cancelledSeatHoldMaxMinutes: 10,
    manualOpenEnabled: true,
  },
  seatMap: null,
};

describe('PerformanceForm copy visibility controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', adminCapabilityBundle: 'operator' } as never });
    vi.mocked(apiClient.get).mockResolvedValue({ locales: [], checks: [], canPublish: false });
    vi.mocked(apiClient.post).mockImplementation(async (path, data) => path.endsWith('/apply')
      ? { id: 'draft-1', revision: 1, performanceId: fixturePerformance.id, appliedAt: '2026-09-21T00:00:00.000Z' }
      : { id: 'draft-1', revision: 1, performanceId: fixturePerformance.id, data: (data as { data: unknown }).data, updatedAt: '2026-09-21T00:00:00.000Z' });
    (apiClient.put as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...fixturePerformance,
    });
  });

  it('renders separate header switches and public/private state chips', () => {
    renderWithClient(
      <PerformanceForm
        mode="edit"
        initialStep="content"
        initialData={fixturePerformance}
        performanceId={fixturePerformance.id}
      />,
    );

    expect(
      screen.getByRole('switch', { name: '상세정보 공개 상태' }),
    ).toBeChecked();
    expect(
      screen.getByRole('switch', { name: '판매정보 공개 상태' }),
    ).toBeChecked();
    expect(screen.getAllByText('공개')).toHaveLength(2);
    expect(screen.getAllByText('사용자 상세 페이지에 표시')).toHaveLength(2);
  });

  it.each([null, undefined])('allows publication of an unchanged ready performance with %s optional fields', async (empty) => {
    useAuthStore.setState({ user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', adminCapabilityBundle: 'approver' } as never });
    vi.mocked(apiClient.get).mockResolvedValue({ locales: [{ locale: 'en', title: true, description: true }], checks: [], canPublish: true });
    renderWithClient(<PerformanceForm mode="edit" initialStep="review" initialData={{ ...fixturePerformance, posterUrl: null,
      venue: { ...fixturePerformance.venue!, address: null, accessNotes: empty, transportSummary: empty },
    }} performanceId={fixturePerformance.id} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '공개 승인' })).toBeEnabled());
  });

  it('submits hidden flags while preserving textarea content', async () => {
    const user = userEvent.setup();

    renderWithClient(
      <PerformanceForm
        mode="edit"
        initialStep="content"
        initialData={fixturePerformance}
        performanceId={fixturePerformance.id}
      />,
    );

    await user.click(
      screen.getByRole('switch', { name: '상세정보 공개 상태' }),
    );
    await user.click(
      screen.getByRole('switch', { name: '판매정보 공개 상태' }),
    );
    await user.click(screen.getByRole('button', { name: /4\s*검수·공개/ }));
    await user.click(screen.getByRole('button', { name: '공연 정보에 반영' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/admin/performance-drafts/draft-1/apply', { expectedRevision: 1 }, { showErrorToast: false });
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/admin/performance-drafts',
      expect.objectContaining({
        data: expect.objectContaining({
        description: '운영자가 오래 편집한 상세정보',
        descriptionVisible: false,
        salesInfo: '운영자가 오래 편집한 판매정보',
        salesInfoVisible: false,
        }),
      }),
      { showErrorToast: false },
    );
  });

  it('lets an operator review the final step before applying anything', async () => {
    const user = userEvent.setup();
    renderWithClient(<PerformanceForm mode="edit" initialStep="content" initialData={fixturePerformance} performanceId={fixturePerformance.id} />);
    await user.click(screen.getByRole('button', { name: '다음 단계' }));
    expect(screen.getByRole('heading', { name: '반영할 내용 확인' })).toBeVisible();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('retains a KST sale opening time when a datetime input includes seconds', async () => {
    const user = userEvent.setup();
    renderWithClient(<PerformanceForm mode="edit" initialStep="seats" initialData={fixturePerformance} performanceId={fixturePerformance.id} />);
    fireEvent.change(screen.getByLabelText('판매 시작 일시'), { target: { value: '2099-11-01T12:00:30' } });
    await user.click(screen.getByRole('button', { name: /4\s*검수·공개/ }));
    await user.click(screen.getByRole('button', { name: '공연 정보에 반영' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/v1/admin/performance-drafts', expect.objectContaining({
      data: expect.objectContaining({ bookingPolicy: expect.objectContaining({ bookingStartsAt: '2099-11-01T03:00:30.000Z' }) }),
    }), { showErrorToast: false }));
  });

  it('creates a new showtime from the visible date and time without an empty persisted identity', async () => {
    const user = userEvent.setup();
    renderWithClient(<PerformanceForm mode="edit" initialStep="seats" initialData={fixturePerformance} performanceId={fixturePerformance.id} />);
    await user.click(screen.getByRole('button', { name: '회차 추가' }));
    fireEvent.change(screen.getByLabelText('회차 1 날짜'), { target: { value: '2099-11-20' } });
    fireEvent.change(screen.getByLabelText('회차 1 시간'), { target: { value: '18:30' } });
    await user.click(screen.getByRole('button', { name: /4\s*검수·공개/ }));
    await user.click(screen.getByRole('button', { name: '공연 정보에 반영' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/v1/admin/performance-drafts', expect.objectContaining({
      data: expect.objectContaining({ showtimes: [{ dateTime: '2099-11-20T18:30:00' }] }),
    }), { showErrorToast: false }));
  });
});

describe('useAdminPerformanceDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...fixturePerformance,
    });
  });

  it('loads admin edit details from the guarded admin endpoint', async () => {
    renderHook(
      () => useAdminPerformanceDetail(fixturePerformance.id),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        `/api/v1/admin/performances/${fixturePerformance.id}`,
      );
    });
  });
});
