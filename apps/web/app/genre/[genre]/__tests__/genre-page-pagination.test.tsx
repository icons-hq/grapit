import { Suspense } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import GenrePage from '../page';

let searchParams = new URLSearchParams('page=2');
const replaceMock = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/en/genre/artist_celebrity',
  useSearchParams: () => searchParams,
  notFound: vi.fn(),
}));

vi.mock('@/hooks/use-performances', () => ({
  usePerformances: () => ({
    data: {
      data: [],
      total: 30,
      page: 2,
      totalPages: 3,
    },
    isLoading: false,
    isError: false,
  }),
}));

describe('GenrePage pagination i18n', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams('page=2');
    replaceMock.mockClear();
  });

  it('renders localized pagination aria labels for non-Korean locales', async () => {
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <GenrePage params={Promise.resolve({ genre: 'artist_celebrity' })} />
        </Suspense>,
      );
    });

    expect(
      await screen.findByRole('navigation', { name: 'Search results pages' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Previous page')).toBeInTheDocument();
    expect(screen.getByLabelText('Next page')).toBeInTheDocument();
  });
});
