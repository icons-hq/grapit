import '@testing-library/jest-dom/vitest';

import type { PerformanceCardData } from '@grabit/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewSection } from '../new-section';

const fixtures = vi.hoisted(() => ({
  performances: [] as PerformanceCardData[],
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('@/hooks/use-performances', () => ({
  useNewPerformances: () => ({
    data: fixtures.performances,
    isLoading: false,
  }),
}));

vi.mock('@/components/performance/performance-card', () => ({
  PerformanceCard: ({
    performance,
  }: {
    performance: PerformanceCardData;
  }) => (
    <a
      data-testid="new-performance-card"
      href={`/performance/${performance.id}`}
    >
      {performance.title}
    </a>
  ),
}));

function performance(id: string): PerformanceCardData {
  return {
    id,
    title: `Performance ${id}`,
    genre: 'artist_celebrity',
    posterUrl: null,
    status: 'selling',
    startDate: '2026-07-18T05:00:00.000Z',
    endDate: '2026-07-18T07:00:00.000Z',
    venueName: 'Donghae Arts Center',
  };
}

function renderNewSectionWith(count: number) {
  fixtures.performances = Array.from({ length: count }, (_, index) =>
    performance(`performance-${index + 1}`),
  );

  render(<NewSection />);
}

describe('NewSection layout', () => {
  it('centers a single performance card at the normal grid-column width', () => {
    renderNewSectionWith(1);

    const cardWrapper = screen.getByTestId('new-performance-card').parentElement;
    const cardsContainer = cardWrapper?.parentElement;

    expect(cardsContainer).toHaveClass('flex', 'justify-center');
    expect(cardsContainer).not.toHaveClass('grid');
    expect(cardWrapper).toHaveClass(
      'min-w-0',
      'w-[calc((100%_-_0.75rem)/2)]',
      'md:w-[calc((100%_-_4.5rem)/4)]',
    );
  });

  it('keeps the existing grid layout for multiple performance cards', () => {
    renderNewSectionWith(2);

    const cardWrapper = screen.getAllByTestId('new-performance-card')[0]
      .parentElement;
    const cardsContainer = cardWrapper?.parentElement;

    expect(cardsContainer).toHaveClass(
      'grid',
      'grid-cols-2',
      'md:grid-cols-4',
    );
    expect(cardsContainer).not.toHaveClass('flex', 'justify-center');
    expect(cardWrapper).toHaveClass('min-w-0');
    expect(cardWrapper).not.toHaveClass(
      'w-[calc((100%_-_0.75rem)/2)]',
      'md:w-[calc((100%_-_4.5rem)/4)]',
    );
  });
});
