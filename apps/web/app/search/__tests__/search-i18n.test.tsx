import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let searchParams = new URLSearchParams();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/en/search',
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/use-search', () => ({
  useSearch: () => ({
    data: {
      data: [],
      total: 0,
      page: 1,
      totalPages: 1,
    },
    isLoading: false,
    isError: false,
  }),
}));

import SearchPage from '../page';

describe('search i18n visible copy', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
  });

  it('renders the localized prompt when no query is present', () => {
    render(<SearchPage />);

    expect(screen.getByRole('heading', { name: 'Search for shows' })).toBeDefined();
    expect(screen.getByText('Search shows or artists')).toBeDefined();
  });

  it('renders localized result, toggle, and empty-state copy', () => {
    searchParams = new URLSearchParams('q=girl');

    render(<SearchPage />);

    expect(screen.getByRole('heading', { name: "Results for 'girl'" })).toBeDefined();
    expect(screen.getByText('0 results')).toBeDefined();
    expect(screen.getByText('Include ended shows')).toBeDefined();
    expect(screen.getByRole('button', { name: 'All categories' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Artist/Celebrity' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'IP Popup' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'No results found' })).toBeDefined();
  });
});
