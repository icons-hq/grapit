import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { PerformanceCardData, UserProfile } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import HomePage from '../page';

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@/hooks/use-performances', () => ({
  useHomeBanners: () => ({ data: [], isLoading: false }),
  useCatalogPerformances: () => ({ data: { data: [] }, isLoading: false }),
}));
vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({ bookingEnabled: true, isResolved: true }),
}));
vi.mock('@/components/home/banner-carousel', () => ({ BannerCarousel: () => null }));
vi.mock('@/components/home/genre-grid', () => ({ GenreGrid: () => null }));
vi.mock('@/components/home/ticket-shelf', () => ({ TicketShelf: () => null }));
vi.mock('@/components/home/ticket-curation', () => ({ TicketCuration: () => null, VenueShelf: () => null }));
vi.mock('@/components/performance/genre-tabs', () => ({ GenreTabs: () => null }));

const admin = {
  id: 'full-admin-a', role: 'admin', adminCapabilityBundle: 'admin', adminCapabilities: [],
} as unknown as UserProfile;
const draft: PerformanceCardData = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Private rehearsal concert',
  genre: 'artist_celebrity', status: 'upcoming', publishState: 'draft', posterUrl: null,
  startDate: '2027-02-12T15:00:00.000Z', endDate: '2027-02-12T15:00:00.000Z',
  venueName: 'Rehearsal Hall',
};
const get = vi.mocked(apiClient.get);
let client: QueryClient;

function response(data: PerformanceCardData[]) {
  return { data, total: data.length, page: 1, limit: 20, totalPages: 1 };
}

function renderHome() {
  return render(<QueryClientProvider client={client}><HomePage /></QueryClientProvider>);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset();
  get.mockResolvedValue(response([draft]));
  useAuthStore.setState({ user: null, accessToken: null, isInitialized: true });
});
afterEach(() => { client.clear(); useAuthStore.getState().clearAuth(); });

describe('admin private performance discovery from home', () => {
  it('shows a draft to a full admin and links directly to booking from the actual home page', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    get.mockResolvedValue(response([
      draft,
      { ...draft, id: 'published', title: 'Published show', publishState: 'published' },
      { ...draft, id: 'ended', title: 'Ended rehearsal', status: 'ended' },
      { ...draft, id: 'review', title: 'Under review', publishState: 'review' },
      { ...draft, id: 'ready', title: 'Ready to publish', publishState: 'publish_ready' },
    ]));
    renderHome();
    expect(await screen.findByRole('link', { name: draft.title })).toHaveAttribute('href', `/booking/${draft.id}`);
    expect(screen.getByRole('link', { name: `${draft.title} · 구매 테스트` })).toHaveAttribute('href', `/booking/${draft.id}`);
    expect(screen.getAllByText('Rehearsal Hall')[0]).toBeVisible();
    expect(screen.queryByText('Published show')).not.toBeInTheDocument();
    expect(screen.queryByText('Ended rehearsal')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Under review' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ready to publish' })).toBeVisible();
    expect(get).toHaveBeenCalledWith('/api/v1/admin/performances?status=upcoming&publication=unpublished&sort=latest&page=1&limit=20', { showErrorToast: false });
  });

  it.each([
    ['anonymous', null],
    ['buyer', { id: 'buyer', role: 'user' }],
    ['scanner', { ...admin, adminCapabilityBundle: 'scanner' }],
    ['operator', { ...admin, adminCapabilityBundle: 'operator' }],
    ['missing claims', { id: 'unknown', role: 'admin' }],
  ])('does not request or render private performances for %s', async (_label, user) => {
    if (user) useAuthStore.getState().setAuth('test-token', user as UserProfile);
    renderHome();
    await act(async () => {});
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: '관리자 전용 공연' })).not.toBeInTheDocument();
  });

  it('waits for a confirmed session before requesting private content', () => {
    useAuthStore.setState({ user: admin, accessToken: 'test-token', isInitialized: false });
    renderHome();
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
  });

  it('removes private content on logout and never reuses it for another account', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    renderHome();
    await screen.findByRole('link', { name: draft.title });
    act(() => useAuthStore.getState().clearAuth());
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
    get.mockClear();
    act(() => useAuthStore.getState().setAuth('buyer-token', { id: 'buyer', role: 'user' } as UserProfile));
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    get.mockResolvedValue(response([{ ...draft, title: 'Second account draft' }]));
    act(() => useAuthStore.getState().setAuth('second-token', { ...admin, id: 'full-admin-b' }));
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
    await screen.findByRole('link', { name: 'Second account draft' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('offers retry when the authenticated list fails instead of silently hiding the entry', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    get.mockRejectedValueOnce(new Error('Unavailable'));
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent('공연을 불러오지 못했어요.');
    await userEvent.setup().click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByRole('link', { name: draft.title });
  });

  it('leaves the regular home alone when there are no unpublished upcoming shows', async () => {
    useAuthStore.getState().setAuth('test-token', admin);
    get.mockResolvedValue(response([]));
    renderHome();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '관리자 전용 공연' })).not.toBeInTheDocument());
  });
});
