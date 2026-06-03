import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

const runtimeFlagsMock = vi.hoisted(() => ({
  bookingEnabled: true,
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('swiper/react', () => ({
  Swiper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SwiperSlide: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('swiper/modules', () => ({
  FreeMode: {},
}));

vi.mock('@/hooks/use-performances', () => ({
  useHomeBanners: () => ({ data: [], isLoading: false }),
  useHotPerformances: () => ({
    data: [createPerformance('hot-performance')],
    isLoading: false,
  }),
  useNewPerformances: () => ({
    data: [createPerformance('new-performance')],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: runtimeFlagsMock.bookingEnabled,
  }),
}));

import HomePage from '../page';

function createPerformance(id: string) {
  return {
    id,
    title: 'Girl Rules Fanmeet',
    status: 'selling',
    posterUrl: null,
    venueName: 'Donghae Arts Center',
    startDate: '2026-07-04T09:00:00.000Z',
    endDate: '2026-07-04T11:00:00.000Z',
  };
}

describe('home i18n visible copy', () => {
  beforeEach(() => {
    runtimeFlagsMock.bookingEnabled = true;
  });

  it('renders canary-visible home copy from the active locale', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('link', { name: 'Search shows' }).getAttribute('href'),
    ).toBe('/en/search');
    expect(screen.getByText('Search shows or artists')).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Browse by category' })
        .getAttribute('href'),
    ).toBe('/en/genre/artist_celebrity');
    expect(screen.getByText('Search fanmeet and popup events or browse by category.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'HOT' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'New' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Browse by category' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Artist' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'IP Popup' })).toBeNull();
  });

  it('does not render on-sale badges while booking is disabled', () => {
    runtimeFlagsMock.bookingEnabled = false;

    render(<HomePage />);

    expect(screen.queryByText('On sale')).toBeNull();
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
  });
});
