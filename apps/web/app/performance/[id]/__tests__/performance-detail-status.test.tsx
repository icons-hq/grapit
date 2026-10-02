import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { PerformanceWithDetails } from '@grabit/shared';
import {
  recordServerTimeSample,
  resetServerClockForTests,
} from '@/lib/server-clock';
import PerformanceDetailPage from '../page';

const localeMock = vi.hoisted(() => ({ activeLocale: 'ko' }));
const detailMock = vi.hoisted(() => ({ performance: null as unknown, isLoading: false }));

vi.mock('next-intl', () => ({ useLocale: () => localeMock.activeLocale }));
vi.mock('@/hooks/use-performances', () => ({
  usePerformanceDetail: () => ({ data: detailMock.performance, isLoading: detailMock.isLoading, isError: false }),
}));
vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: true,
    locale: localeMock.activeLocale,
    isLoading: false,
    isResolved: true,
    bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
  }),
}));
vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => <img alt={alt} {...props} />,
}));

const NOW = Date.parse('2026-09-20T10:59:00.000Z');
const OPEN = '2026-09-20T11:00:00.000Z';

function performance(overrides: Partial<PerformanceWithDetails> & { bookingStartsAt?: string | null }): PerformanceWithDetails {
  const { bookingStartsAt = null, ...rest } = overrides;
  return {
    id: 'perf-1',
    title: 'Girl Rules Fanmeet',
    genre: 'artist_celebrity',
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: null,
    description: null,
    descriptionVisible: true,
    // Performance period 2026-10-01 ~ 2026-10-05 stored as KST midnight.
    startDate: '2026-09-30T15:00:00.000Z',
    endDate: '2026-10-04T15:00:00.000Z',
    runtime: null,
    ageRating: 'All ages',
    status: 'upcoming',
    salesInfo: null,
    salesInfoVisible: true,
    detailImages: [],
    viewCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    venue: { id: 'venue-1', name: 'Hall', address: null },
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
    ...rest,
  };
}

function detailTree() {
  const params = Promise.resolve({ id: 'perf-1' }) as Promise<{ id: string }> & {
    status: 'fulfilled';
    value: { id: string };
  };
  params.status = 'fulfilled';
  params.value = { id: 'perf-1' };
  return (
    <Suspense fallback={<div>loading</div>}>
      <PerformanceDetailPage params={params} />
    </Suspense>
  );
}

function renderDetail() {
  return render(detailTree());
}

describe('PerformanceDetailPage sale status display', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localeMock.activeLocale = 'ko';
    detailMock.isLoading = false;
  });

  afterEach(() => {
    resetServerClockForTests();
    vi.useRealTimers();
  });

  it('flips the badge and schedule together with the booking CTA at the booking start', () => {
    detailMock.performance = performance({ status: 'upcoming', bookingStartsAt: OPEN });
    renderDetail();

    expect(screen.getByLabelText('상태: 오픈예정')).toBeDefined();
    expect(screen.queryByText(/KST/)).toBeNull();
    expect(screen.queryByRole('link', { name: '예매하기' })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getAllByRole('link', { name: '예매하기' })).not.toHaveLength(0);
    expect(screen.getByLabelText('상태: 오픈')).toBeDefined();
    expect(screen.queryByLabelText('상태: 오픈예정')).toBeNull();
    expect(screen.getByText(/KST$/).textContent).toContain('2026. 10. 1.');
  });

  it('keeps the badge, schedule and booking CTA on one verdict when the response lands after the start', () => {
    // Mounted before the opening second; the detail response arrives two seconds after it.
    detailMock.performance = undefined;
    detailMock.isLoading = true;
    const view = renderDetail();

    vi.setSystemTime(Date.parse(OPEN) + 2_000);
    // The API already reports the effective status once the booking start passed.
    detailMock.performance = performance({ status: 'selling', bookingStartsAt: OPEN });
    detailMock.isLoading = false;
    view.rerender(detailTree());
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // The CTA verdict belongs to useBookingAvailability (server clock, #35/#97).
    // Whatever it decides, badge and schedule must agree with it.
    const ctaOpen = screen.queryAllByRole('link', { name: '예매하기' }).length > 0;
    expect(screen.queryByLabelText('상태: 오픈예정') === null).toBe(ctaOpen);
    expect(screen.queryByText(/KST$/) !== null).toBe(ctaOpen);
  });

  it('follows the server-clock verdict of the booking CTA when the device clock is slow', () => {
    // Device clock reads one minute before the start; the server is 30 seconds past it.
    recordServerTimeSample({
      serverNowMs: Date.parse(OPEN) + 30_000,
      requestStartedAtMs: Date.now() - 50,
      responseReceivedAtMs: Date.now() + 50,
    });
    detailMock.performance = performance({ status: 'upcoming', bookingStartsAt: OPEN });
    renderDetail();

    expect(screen.getAllByRole('link', { name: '예매하기' })).not.toHaveLength(0);
    expect(screen.getByLabelText('상태: 오픈')).toBeDefined();
    expect(screen.queryByLabelText('상태: 오픈예정')).toBeNull();
    expect(screen.getByText(/KST$/).textContent).toContain('2026. 10. 1.');
  });

  it('keeps a selling performance with a future booking start in the upcoming state', () => {
    detailMock.performance = performance({ status: 'selling', bookingStartsAt: OPEN });
    renderDetail();

    expect(screen.getByLabelText('상태: 오픈예정')).toBeDefined();
    expect(screen.queryByLabelText('상태: 오픈')).toBeNull();
    expect(screen.queryByRole('link', { name: '예매하기' })).toBeNull();
  });

  it('shows the performance period as KST calendar dates without a converted local day', () => {
    localeMock.activeLocale = 'th';
    detailMock.performance = performance({ status: 'selling' });
    renderDetail();

    const period = screen.getByText(/KST$/);
    expect(period.tagName).toBe('TIME');
    expect(period.getAttribute('datetime')).toBe('2026-10-01');
    expect(period.textContent).toContain('1 ต.ค. 2026');
    expect(period.textContent).toContain('5 ต.ค. 2026');
    expect(period.textContent).not.toContain('2569');
    expect(period.textContent).not.toContain('00:00');
    expect(screen.queryByText(/เวลาท้องถิ่น|local time/i)).toBeNull();
  });
});
