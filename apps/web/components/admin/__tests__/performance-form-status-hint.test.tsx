import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceDraft, PerformanceWithDetails } from '@grabit/shared';

import { apiClient } from '@/lib/api-client';
import { PerformanceForm } from '../performance-form';
import { useAuthStore } from '@/stores/use-auth-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
const PENDING_HINT = '판매 시작 일시 전까지 공개 화면에는 판매 예정으로 표시되고 예매가 열리지 않습니다.';

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

  it.each(['selling', 'closing_soon'] as const)(
    'explains that a %s event with a future booking start stays upcoming on public pages (audit #170)',
    (status) => {
      renderForm(performanceFixture(status, '2099-01-01T00:00:00.000Z'));

      expect(screen.getByRole('note')).toHaveTextContent(PENDING_HINT);
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    },
  );

  it('shows no pending-sale hint once the start passed, without a start, or for an upcoming event', () => {
    for (const [status, bookingStartsAt] of [
      ['selling', '2026-01-01T00:00:00.000Z'],
      ['selling', null],
      ['upcoming', '2099-01-01T00:00:00.000Z'],
    ] as const) {
      const { unmount } = renderForm(performanceFixture(status, bookingStartsAt));
      expect(screen.queryByText(PENDING_HINT), `${status} ${bookingStartsAt}`).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('PerformanceForm legacy draft payment methods (audit #70)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', adminCapabilityBundle: 'operator' } as never });
    vi.mocked(apiClient.get).mockResolvedValue({ locales: [], checks: [], canPublish: false });
  });

  it('drops methods the server no longer stores when a draft is reopened so it can be saved again', async () => {
    const performance = performanceFixture('upcoming', null);
    const draft: PerformanceDraft = {
      id: 'draft-legacy-1', performanceId: performance.id, title: performance.title, step: 'basic', revision: 3,
      baseUpdatedAt: performance.updatedAt, appliedAt: null, updatedAt: '2026-05-17T00:00:00.000Z',
      data: { title: performance.title, bookingPolicy: { ...performance.bookingPolicy,
        allowedPaymentMethods: ['VIRTUAL_ACCOUNT', 'CARD', 'MOBILE_PHONE'] } },
    };
    vi.mocked(apiClient.put).mockResolvedValue({ ...draft, revision: 4 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PerformanceForm mode="edit" initialStep="basic" initialDraft={draft} performanceId={performance.id} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '초안 저장' }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
    const [, body] = vi.mocked(apiClient.put).mock.calls[0]!;
    expect((body as { data: { bookingPolicy: { allowedPaymentMethods: string[] } } }).data.bookingPolicy.allowedPaymentMethods)
      .toEqual(['CARD']);
  });
});
