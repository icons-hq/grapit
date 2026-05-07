import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

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
  it('renders canary-visible home copy from the active locale', () => {
    render(<HomePage />);

    expect(screen.getByText('Search fanmeet and popup events or browse by category.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'HOT' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Newly opened' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Browse by category' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Artist/Celebrity' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'IP Popup' })).toBeDefined();
  });
});
