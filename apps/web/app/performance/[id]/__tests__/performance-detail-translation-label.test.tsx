import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { PerformanceWithDetails } from '@grabit/shared';
import PerformanceDetailPage from '../page';

const { performanceDetailMock } = vi.hoisted(() => ({
  performanceDetailMock: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('@/hooks/use-performances', () => ({
  usePerformanceDetail: () => ({
    data: performanceDetailMock(),
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: true,
    isLoading: false,
    bookingDisabledMessage: 'Ticket booking opens in late May',
  }),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt: string;
    [key: string]: unknown;
  }) => <img alt={alt} {...props} />,
}));

function createPerformanceDetail(
  overrides: Record<string, unknown> = {},
): PerformanceWithDetails & Record<string, unknown> {
  return {
    id: 'perf-translation-label',
    title: 'Girl Rules Fanmeet',
    genre: 'concert',
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: null,
    description: 'Translated description',
    startDate: '2026-07-04T09:00:00.000Z',
    endDate: '2026-07-04T12:00:00.000Z',
    runtime: '120분',
    ageRating: '만 7세 이상',
    status: 'selling',
    salesInfo: 'Translated sales info',
    viewCount: 10,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    venue: {
      id: 'venue-1',
      name: 'Bangkok Hall',
      address: null,
    },
    priceTiers: [],
    showtimes: [],
    castings: [],
    seatMap: null,
    ...overrides,
  };
}

function fulfilledParams(id: string) {
  const params = Promise.resolve({ id }) as Promise<{ id: string }> & {
    status: 'fulfilled';
    value: { id: string };
  };
  params.status = 'fulfilled';
  params.value = { id };
  return params;
}

function renderPage() {
  render(
    <Suspense fallback={null}>
      <PerformanceDetailPage params={fulfilledParams('perf-translation-label')} />
    </Suspense>,
  );
}

describe('PerformanceDetailPage automatic translation label', () => {
  it.each([
    [{ automaticTranslationLabel: true }],
    [{ isMachineTranslated: true }],
    [{ translatedBy: 'deepl' }],
    [{ titleTranslation: { automaticTranslationLabel: true } }],
    [{ descriptionTranslation: { isMachineTranslated: true } }],
    [{ salesInfoTranslation: { translatedBy: 'deepl' } }],
  ])('shows the label when translated metadata is present: %j', async (metadata) => {
    performanceDetailMock.mockReturnValue(createPerformanceDetail(metadata));

    renderPage();

    expect(await screen.findByText('자동 번역 검수본')).toBeInTheDocument();
    expect(screen.getByText('Reviewed machine translation')).toBeInTheDocument();
  });

  it('does not show the label for canonical Korean-only content', () => {
    performanceDetailMock.mockReturnValue(createPerformanceDetail());

    renderPage();

    expect(screen.queryByText('자동 번역 검수본')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Reviewed machine translation'),
    ).not.toBeInTheDocument();
  });
});
