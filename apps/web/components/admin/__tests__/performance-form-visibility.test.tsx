import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceWithDetails } from '@grabit/shared';

import { apiClient } from '@/lib/api-client';
import { useAdminPerformanceDetail } from '@/hooks/use-admin';
import { PerformanceForm } from '../performance-form';

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

vi.mock('@/components/admin/showtime-manager', () => ({
  ShowtimeManager: () => <div data-testid="showtime-manager" />,
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
    (apiClient.put as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...fixturePerformance,
    });
  });

  it('renders separate header switches and public/private state chips', () => {
    renderWithClient(
      <PerformanceForm
        mode="edit"
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

  it('submits hidden flags while preserving textarea content', async () => {
    const user = userEvent.setup();

    renderWithClient(
      <PerformanceForm
        mode="edit"
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
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalled();
    });

    expect(apiClient.put).toHaveBeenCalledWith(
      `/api/v1/admin/performances/${fixturePerformance.id}`,
      expect.objectContaining({
        description: '운영자가 오래 편집한 상세정보',
        descriptionVisible: false,
        salesInfo: '운영자가 오래 편집한 판매정보',
        salesInfoVisible: false,
      }),
      { showErrorToast: false },
    );
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
