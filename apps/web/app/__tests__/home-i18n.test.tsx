import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import HomePage from '../page';

const mocks = vi.hoisted(() => ({
  bookingEnabled: true, failed: false, loading: false,
  search: '', push: vi.fn(), replace: vi.fn(), refetch: vi.fn(),
}));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/hooks/use-performances', () => ({
  useHomeBanners: () => ({ data: [], isLoading: false }),
  useBrowsePerformances: () => ({
    data: { data: [{ id: 'performance', title: 'Girl Rules Fanmeet', status: 'selling', posterUrl: null,
      venueName: 'Donghae Arts Center', startDate: '2026-11-20T00:00:00Z', endDate: '2026-11-20T00:00:00Z', minPrice: 50000 }], total: 1, page: 1, totalPages: 1 },
    isLoading: mocks.loading, isError: mocks.failed, refetch: mocks.refetch,
  }),
}));
vi.mock('@/hooks/use-runtime-flags', () => ({ useRuntimeFlags: () => ({ bookingEnabled: mocks.bookingEnabled }) }));

describe('Buyer event discovery', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.bookingEnabled = true; mocks.failed = false; mocks.loading = false; mocks.search = ''; });

  it('shows the real event, date, price and a direct path to the ticket wallet', async () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'Find your next live experience' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Browse events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Girl Rules Fanmeet' })).toBeInTheDocument();
    expect(screen.getByText('From KRW 50,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My tickets' })).toHaveAttribute('href', '/en/mypage?tab=wallet');
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search events or artists' }), 'Girl Rules{Enter}');
    expect(mocks.push).toHaveBeenCalledWith('/en/search?q=Girl%20Rules');
  });

  it('keeps locale and resets pagination when selecting an event status', async () => {
    mocks.search = 'page=3';
    render(<HomePage />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Past events' }));
    expect(mocks.replace).toHaveBeenCalledWith('/en?status=ended', { scroll: false });
  });

  it('distinguishes a loading error from an empty catalog and allows retry', async () => {
    mocks.failed = true;
    render(<HomePage />);
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load events');
    expect(screen.queryByText('No events match this filter.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Girl Rules Fanmeet' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('does not claim bookings are open while the service has disabled booking', () => {
    mocks.bookingEnabled = false;
    render(<HomePage />);
    expect(screen.queryByLabelText('Status: On sale')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Status: Coming soon')).not.toHaveLength(0);
  });
});
