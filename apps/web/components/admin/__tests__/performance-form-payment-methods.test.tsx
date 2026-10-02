import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKOUT_CONFIGURABLE_PAYMENT_METHODS,
  type PerformanceAllowedPaymentMethod,
  type PerformanceWithDetails,
} from '@grabit/shared';

import { apiClient } from '@/lib/api-client';
import { resolvePaymentMethodSelection } from '@/components/booking/toss-payment-widget';
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

function renderForm(allowedPaymentMethods: PerformanceAllowedPaymentMethod[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const performance: PerformanceWithDetails = {
    id: 'perf-payment-methods-1',
    title: 'Girl Rules Fanmeet',
    genre: 'artist_celebrity',
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: 'https://cdn.example.com/poster.jpg',
    description: '상세정보',
    descriptionVisible: true,
    startDate: '2026-07-18T05:00:00.000Z',
    endDate: '2026-07-18T07:00:00.000Z',
    runtime: '120분',
    ageRating: '전체 관람가',
    status: 'upcoming',
    salesInfo: '판매정보',
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
      { id: 'tier-vip', performanceId: 'perf-payment-methods-1', tierName: 'VIP', price: 88000, sortOrder: 0 },
    ],
    showtimes: [],
    castings: [],
    seatMaps: [],
    bookingPolicy: {
      maxTicketsPerUser: 1,
      allowedPaymentMethods,
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
    },
    seatMap: null,
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceForm
        mode="edit"
        initialStep="seats"
        initialData={performance}
        performanceId={performance.id}
      />
    </QueryClientProvider>,
  );
}

async function applyAndReadSavedPaymentMethods(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /4\s*검수·공개/ }));
  await user.click(screen.getByRole('button', { name: '공연 정보에 반영' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/v1/admin/performance-drafts',
    expect.anything(),
    { showErrorToast: false },
  ));
  const draftCall = vi.mocked(apiClient.post).mock.calls
    .find(([path]) => path === '/api/v1/admin/performance-drafts');
  const draft = draftCall?.[1] as {
    data: { bookingPolicy: { allowedPaymentMethods: PerformanceAllowedPaymentMethod[] } };
  };
  return draft.data.bookingPolicy.allowedPaymentMethods;
}

describe('PerformanceForm allowed payment methods (audit #70)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin', adminCapabilityBundle: 'operator' } as never });
    vi.mocked(apiClient.get).mockResolvedValue({ locales: [], checks: [], canPublish: false });
    vi.mocked(apiClient.post).mockImplementation(async (path, data) => path.endsWith('/apply')
      ? { id: 'draft-1', revision: 1, performanceId: 'perf-payment-methods-1', appliedAt: '2026-09-21T00:00:00.000Z' }
      : { id: 'draft-1', revision: 1, performanceId: 'perf-payment-methods-1', data: (data as { data: unknown }).data, updatedAt: '2026-09-21T00:00:00.000Z' });
  });

  it('keeps a saved domestic easy pay (SIMPLE_PAY) when loading and saving the performance', async () => {
    const user = userEvent.setup();
    renderForm(['CARD', 'SIMPLE_PAY']);

    expect(screen.getByRole('checkbox', { name: '국내 간편결제' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '카드 결제(국내/해외)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '계좌이체' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '해외 간편결제' })).not.toBeChecked();

    await expect(applyAndReadSavedPaymentMethods(user)).resolves.toEqual(['CARD', 'SIMPLE_PAY']);
  });

  it('lets an operator allow domestic easy pay for a performance', async () => {
    const user = userEvent.setup();
    renderForm(['CARD']);

    await user.click(screen.getByRole('checkbox', { name: '국내 간편결제' }));

    await expect(applyAndReadSavedPaymentMethods(user)).resolves.toEqual(['CARD', 'SIMPLE_PAY']);
  });

  it('offers exactly the categories checkout can submit to reservation prepare', () => {
    renderForm(['CARD']);
    const widgetCodes = [
      'CARD', 'TRANSFER', 'TOSSPAY', 'NAVERPAY', 'KAKAOPAY', 'ALIPAY', 'ALIPAY_PLUS', 'TRUEMONEY',
      'PAYPAL', '페이팔', 'VISA', 'OVERSEAS_CARD', 'VIRTUAL_ACCOUNT', 'MOBILE_PHONE', 'UNKNOWN',
    ];
    const submittedCategories = new Set(['DEFAULT', 'uspay'].flatMap((variantKey) => widgetCodes
      .map((code) => resolvePaymentMethodSelection(code, variantKey).paymentMethod.method)));

    expect([...submittedCategories].sort()).toEqual([...CHECKOUT_CONFIGURABLE_PAYMENT_METHODS].sort());
    for (const label of ['카드 결제(국내/해외)', '계좌이체', '국내 간편결제', '해외 간편결제']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeInTheDocument();
    }
  });
});
