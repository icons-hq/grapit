import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

let searchParams = new URLSearchParams();
const replaceMock = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
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
    replaceMock.mockClear();
  });

  it('renders the localized prompt and a usable search input when no query is present', () => {
    render(<SearchPage />);

    expect(screen.getByRole('searchbox', { name: 'Search shows' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Search for shows' })).toBeDefined();
    expect(screen.getByText('Search shows or artists')).toBeDefined();
  });

  it('submits a non-empty query and removes stale page params', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams('page=3&ended=true');

    render(<SearchPage />);

    await user.type(screen.getByRole('searchbox', { name: 'Search shows' }), 'girl rules');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(replaceMock).toHaveBeenCalledWith('/en/search?ended=true&q=girl+rules');
  });

  it('renders localized result, toggle, and empty-state copy', () => {
    searchParams = new URLSearchParams('q=girl');

    render(<SearchPage />);

    expect(screen.getByRole('searchbox', { name: 'Search shows' })).toHaveValue('girl');
    expect(screen.getByRole('heading', { name: "Results for 'girl'" })).toBeDefined();
    expect(screen.getByText('0 results')).toBeDefined();
    expect(screen.getByText('Include ended shows')).toBeDefined();
    expect(screen.getByRole('button', { name: 'All categories' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Artist' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'IP Popup' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'No results found' })).toBeDefined();
  });
});
