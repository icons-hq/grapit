import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import HomePage from '../page';

const mocks = vi.hoisted(() => ({
  bookingEnabled: true, failed: false, loading: false, refetch: vi.fn(), queries: vi.fn(),
}));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/components/home/ticket-curation', () => ({ TicketCuration: () => null, VenueShelf: () => null }));
vi.mock('@/components/home/banner-carousel', () => ({ BannerCarousel: () => null }));
vi.mock('@/hooks/use-performances', () => ({
  useHomeBanners: () => ({ data: [], isLoading: false }),
  useCatalogPerformances: (options: unknown) => {
    mocks.queries(options);
    return {
      data: { data: [{ id: 'performance', title: 'Girl Rules Fanmeet', genre: 'artist_celebrity', status: 'selling', posterUrl: null,
        venueName: 'Donghae Arts Center', startDate: '2026-11-20T00:00:00Z', endDate: '2026-11-20T00:00:00Z', minPrice: 50000 }], total: 1, page: 1, totalPages: 1 },
      isLoading: mocks.loading, isError: mocks.failed, refetch: mocks.refetch,
    };
  },
}));
vi.mock('@/hooks/use-runtime-flags', () => ({ useRuntimeFlags: () => ({ bookingEnabled: mocks.bookingEnabled, isResolved: true }) }));

describe('Buyer ticket discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.bookingEnabled = true; mocks.failed = false; mocks.loading = false;
    vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); unobserve = vi.fn(); });
  });

  it('renders localized shelves from the catalog and links to the ticket wallet', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'Grabit Tickets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Opening soon' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Popular by genre' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Girl Rules Fanmeet' })).toHaveLength(3);
    expect(screen.getByText('From KRW 50,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My tickets' })).toHaveAttribute('href', '/en/mypage?tab=wallet');
    expect(mocks.queries).toHaveBeenCalledWith(expect.objectContaining({status:'upcoming',sort:'opening'}));
    expect(mocks.queries).toHaveBeenCalledWith(expect.objectContaining({genre:undefined,sort:'popular'}));
  });

  it('requests the selected genre instead of filtering a single page of mixed data', async () => {
    render(<HomePage />);
    await userEvent.setup().click(screen.getByRole('radio', {name:'Concert'}));
    expect(mocks.queries).toHaveBeenLastCalledWith(expect.objectContaining({sort:'latest'}));
    expect(mocks.queries).toHaveBeenCalledWith(expect.objectContaining({genre:'concert',sort:'popular'}));
    expect(screen.getAllByRole('link', {name:'View all'}).some((link) => link.getAttribute('href') === '/en/ranking?genre=concert')).toBe(true);
  });

  it('keeps loading failures distinct from an empty catalog and offers retry', async () => {
    mocks.failed = true;
    render(<HomePage />);
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.queryByText('No shows here yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', {name:'Girl Rules Fanmeet'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getAllByRole('button',{name:'Try again'})[0]!);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the booking gate effective on every home card', () => {
    mocks.bookingEnabled = false;
    render(<HomePage />);
    expect(screen.queryByLabelText('Status: On sale')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Status: Coming soon')).toHaveLength(3);
  });
});
