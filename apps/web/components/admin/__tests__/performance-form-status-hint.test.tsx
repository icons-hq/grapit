import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceWithDetails } from '@grabit/shared';

import { apiClient } from '@/lib/api-client';
import { PerformanceForm } from '../performance-form';
import { useAuthStore } from '@/stores/use-auth-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

function renderForm(performance: PerformanceWithDetails) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(
    <PerformanceForm mode="edit" initialStep="basic" initialData={performance} performanceId={performance.id} />,
    { wrapper: Wrapper },
  );
}

function performanceFixture(
  status: PerformanceWithDetails['status'],
  bookingStartsAt: string | null,
): PerformanceWithDetails {
  return {
    id: 'perf-status-hint-1',
    title: 'Girl Rules Fanmeet',
    genre: 'artist_celebrity',
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: null,
    description: null,
    descriptionVisible: true,
    startDate: '2099-07-18T05:00:00.000Z',
    endDate: '2099-07-18T07:00:00.000Z',
    runtime: '120분',
    ageRating: '전체 관람가',
    status,
    salesInfo: null,
    salesInfoVisible: true,
    detailImages: [],
    viewCount: 0,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    venue: { id: 'venue-1', name: '동해문화예술관 대극장', address: null },
    priceTiers: [],
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
      bookingStartsAt,
    },
    seatMap: null,
  };
}

const HINT = /공개 화면에는 '판매 중'으로 표시됩니다/;

describe('PerformanceForm stored sale status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', adminCapabilityBundle: 'operator' } as never });
    vi.mocked(apiClient.get).mockResolvedValue({ locales: [], checks: [], canPublish: false });
  });

  it('keeps the stored upcoming status and explains the derived public status after the booking start', () => {
    renderForm(performanceFixture('upcoming', '2026-01-01T00:00:00.000Z'));

    expect(screen.getByRole('combobox', { name: '판매 상태' })).toHaveTextContent('판매 예정');
    expect(screen.getByRole('note')).toHaveTextContent(HINT);
  });

  it('shows no hint before the booking start or for an explicitly selling event', () => {
    const { unmount } = renderForm(performanceFixture('upcoming', '2099-01-01T00:00:00.000Z'));
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    unmount();

    renderForm(performanceFixture('selling', '2026-01-01T00:00:00.000Z'));
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});
