import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceSeatMapInput } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { VenueLayoutLibrary } from '../venue-layout-library';

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const seatMaps: PerformanceSeatMapInput[] = [{ floorKey: '1F', floorLabel: '1층', sortOrder: 0,
  svgUrl: 'https://example.test/one.svg', totalSeats: 1,
  seatConfig: { tiers: [{ tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1'] }],
    sections: [{ sectionKey: 'A', label: '중앙', seatIds: ['A-1'] }] } }];
const layout = { id: 'layout-one', venueName: '검증 공연장', layoutName: '정면 무대', version: 1,
  floorCount: 1, totalSeats: 1, seatMaps: seatMaps.map((floor) => ({ ...floor, venueLayoutId: 'layout-one' })) };
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('VenueLayoutLibrary', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('loads the chosen version and saves a new version without editing the old resource', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (path) => path.includes('?') ? [layout] : layout);
    vi.mocked(apiClient.post).mockResolvedValue({ ...layout, id: 'layout-two', version: 2,
      seatMaps: seatMaps.map((floor) => ({ ...floor, venueLayoutId: 'layout-two' })) });
    const apply = vi.fn(); const user = userEvent.setup();
    render(<VenueLayoutLibrary venueName="검증 공연장" seatMaps={seatMaps} onApply={apply} />, { wrapper: wrapper() });
    await user.selectOptions(screen.getByRole('combobox'), (await screen.findByRole('option', { name: /정면 무대.*v1/ })).getAttribute('value')!);
    expect(apiClient.get).toHaveBeenCalledWith(`/api/v1/admin/venue-layouts?${new URLSearchParams({ venueName: '검증 공연장' })}`);
    await user.click(screen.getByRole('button', { name: '템플릿 불러오기' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(layout.seatMaps));
    await user.click(screen.getByRole('button', { name: '현재 좌석도를 새 버전으로 저장' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/v1/admin/venue-layouts', {
      venueName: '검증 공연장', layoutName: '정면 무대', seatMaps,
    }));
    await waitFor(() => expect(apply.mock.lastCall?.[0][0].venueLayoutId).toBe('layout-two'));
  });

  it('ignores a load response after the operator has changed venues', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.get).mockImplementation(async (path) => path.includes('?') ? [layout] : new Promise((resolve) => { finish = resolve; }));
    const apply = vi.fn(); const user = userEvent.setup();
    const view = render(<VenueLayoutLibrary venueName="검증 공연장" seatMaps={seatMaps} onApply={apply} />, { wrapper: wrapper() });
    await screen.findByRole('option', { name: /정면 무대.*v1/ });
    await user.selectOptions(screen.getByRole('combobox'), 'layout-one');
    await user.click(screen.getByRole('button', { name: '템플릿 불러오기' }));
    view.rerender(<VenueLayoutLibrary venueName="다른 공연장" seatMaps={seatMaps} onApply={apply} />);
    finish(layout);
    await waitFor(() => expect(screen.getByRole('button', { name: '템플릿 불러오기' }).hasAttribute('disabled')).toBe(false));
    expect(apply).not.toHaveBeenCalled();
  });
});
