import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PerformanceDraft,
  PerformancePreparation,
  PerformancePreparationStep,
  PerformanceWithDetails,
} from '@grabit/shared';

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

function renderForm(
  performance: PerformanceWithDetails,
  initialStep: PerformancePreparationStep = 'basic',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(
    <PerformanceForm mode="edit" initialStep={initialStep} initialData={performance} performanceId={performance.id} />,
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

/** jsdom has no segmented datetime-local UI, so the browser's badInput report is stubbed. */
function reportBadInput(input: HTMLInputElement, badInput: boolean) {
  Object.defineProperty(input, 'validity', { configurable: true, value: { badInput } });
}

const ELAPSED_START_WARNING = '입력한 판매 시작 시각이 이미 지났습니다. 반영하거나 공개하면 바로 판매가 열립니다.';
const PUBLISHED_START_CHANGE = /공개 중인 공연의 판매 시작 일시가 바뀝니다/;

describe('PerformanceForm publish state from the preparation read', () => {
  // The admin detail API (findById) sends no publishState, like this fixture.
  function mockPreparation(publishState: PerformancePreparation['publishState']) {
    let resolve!: (value: unknown) => void;
    const preparation = new Promise((done) => { resolve = done; });
    vi.mocked(apiClient.get).mockImplementation((path) => (
      path === '/api/v1/admin/performances/perf-status-hint-1/preparation'
        ? preparation
        : Promise.resolve({ locales: [], checks: [], canPublish: false })
    ) as never);
    return () => resolve({ publishState, locales: [], checks: [], canPublish: false });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', adminCapabilityBundle: 'operator' } as never });
  });

  it('does not warn about an elapsed sale start for a public, already selling performance that was only opened', async () => {
    const loadPreparation = mockPreparation('published');
    const performance = performanceFixture('selling', '2026-01-01T00:00:00.000Z');
    expect(performance).not.toHaveProperty('publishState');
    renderForm(performance, 'seats');

    // No flash of the warning while the publish state is still loading.
    expect(screen.queryByText(ELAPSED_START_WARNING)).not.toBeInTheDocument();
    loadPreparation();
    const input = screen.getByLabelText('판매 시작 일시');

    // A changed elapsed start warns, and review names the public schedule change
    // once the preparation reports the performance as published.
    fireEvent.change(input, { target: { value: '2026-01-02T09:00' } });
    expect(screen.getByText(ELAPSED_START_WARNING)).toBeInTheDocument();
    expect(await screen.findByText(PUBLISHED_START_CHANGE)).toBeInTheDocument();

    // Back to the stored start: opening a public, selling performance warns about nothing.
    fireEvent.change(input, { target: { value: '2026-01-01T09:00' } });
    expect(screen.queryByText(ELAPSED_START_WARNING)).not.toBeInTheDocument();
    expect(screen.queryByText(PUBLISHED_START_CHANGE)).not.toBeInTheDocument();
  });

  it('still warns about an elapsed sale start on an unpublished performance once the state is known', async () => {
    const loadPreparation = mockPreparation('draft');
    renderForm(performanceFixture('selling', '2026-01-01T00:00:00.000Z'), 'seats');

    expect(screen.queryByText(ELAPSED_START_WARNING)).not.toBeInTheDocument();
    loadPreparation();
    expect(await screen.findByText(ELAPSED_START_WARNING)).toBeInTheDocument();
  });

  it('warns in review when the sale start of a public performance changes', async () => {
    const loadPreparation = mockPreparation('published');
    renderForm(performanceFixture('selling', '2026-01-01T00:00:00.000Z'), 'seats');
    loadPreparation();
    await act(async () => {});

    fireEvent.change(screen.getByLabelText('판매 시작 일시'), { target: { value: '2099-02-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /4\s*검수·공개/ }));

    expect(await screen.findByText(PUBLISHED_START_CHANGE)).toHaveTextContent(
      '2026-01-01 09:00 KST → 2099-02-01 10:00 KST',
    );
  });
});

describe('PerformanceForm unfinished sale start summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', adminCapabilityBundle: 'operator' } as never });
    vi.mocked(apiClient.get).mockResolvedValue({ locales: [], checks: [], canPublish: false });
  });

  it('lists one operator message instead of the schema ISO message when only the date was typed', async () => {
    const performance = {
      ...performanceFixture('upcoming', null),
      priceTiers: [{ id: 'tier-1', performanceId: 'perf-status-hint-1', tierName: 'VIP', price: 88000, sortOrder: 0 }],
    };
    renderForm(performance, 'seats');
    const input = screen.getByLabelText('판매 시작 일시') as HTMLInputElement;

    // Typing only the date into an empty input: Chromium keeps the value '' with
    // validity.badInput and sends no input event; leaving the input commits it.
    fireEvent.focus(input);
    reportBadInput(input, true);
    fireEvent.keyDown(input, { key: '2' });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: /4\s*검수·공개/ }));
    fireEvent.click(screen.getByRole('button', { name: '공연 정보에 반영' }));

    const summary = (await screen.findByText(/입력이 필요한 단계/)).closest('div')!;
    expect(summary).not.toHaveTextContent('ISO datetime');
    expect(within(summary).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['판매 시작 일시를 끝까지 입력하거나 모두 지워주세요']);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
