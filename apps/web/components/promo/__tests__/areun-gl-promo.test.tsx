import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: apiGet },
}));

vi.mock('next/image', () => ({
  default: ({ alt, fill: _fill, ...props }: { alt: string; fill?: boolean; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={String(props.src)} />
  ),
}));

import { AreunGlPerformancePromo, AreunGlPromoCard } from '../areun-gl-promo';

const performanceId = '575e8ff0-cd16-4c00-9edc-d72f54bffa9d';

function withQueryClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AreunGlPromoCard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('links to Areun GL in a new tab with sponsored attribution and placement UTM', () => {
    render(<AreunGlPromoCard placement="home_banner" locale="ko" />);

    const region = screen.getByRole('complementary', { name: '광고' });
    const link = screen.getByRole('link');
    expect(region).toContainElement(link);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'sponsored noopener');

    const href = new URL(link.getAttribute('href') ?? '');
    expect(`${href.origin}${href.pathname}`).toBe('https://areun.ai/gl');
    expect(href.searchParams.get('utm_source')).toBe('grabit');
    expect(href.searchParams.get('utm_medium')).toBe('home_banner');
    expect(href.searchParams.get('utm_campaign')).toBe('girlrules-fanmeeting-2026-11');
    expect(href.searchParams.get('utm_content')).toBe('ko');

    expect(link).toHaveTextContent('팬미팅 기다리는 동안, GL 서사에 과몰입');
    expect(link).toHaveTextContent('GL 8작 보러 가기');
    expect(link).toHaveTextContent('새 창에서 열림');
  });

  it('uses English copy and utm_content=en outside Korean screens', () => {
    render(<AreunGlPromoCard placement="booking_complete" locale="th" />);

    const link = screen.getByRole('link');
    expect(screen.getByRole('complementary', { name: 'Advertisement' })).toHaveAttribute('lang', 'en');
    expect(link).toHaveTextContent('Fan meeting countdown? Get lost in a GL story');
    expect(link).toHaveTextContent('Areun is available in Korean.');
    expect(new URL(link.getAttribute('href') ?? '').searchParams.get('utm_content')).toBe('en');
  });

  it('renders nothing after the campaign ends', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-14T00:00:00+09:00'));

    const { container } = render(<AreunGlPromoCard placement="home_banner" locale="ko" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AreunGlPerformancePromo', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('shows the card for a fan-meeting booking', async () => {
    apiGet.mockResolvedValue({ genre: 'artist_celebrity' });

    render(withQueryClient(
      <AreunGlPerformancePromo performanceId={performanceId} placement="reservation_detail" locale="ko" />,
    ));

    const link = await screen.findByRole('link');
    expect(new URL(link.getAttribute('href') ?? '').searchParams.get('utm_medium')).toBe('reservation_detail');
    expect(apiGet).toHaveBeenCalledWith(`/api/v1/performances/${performanceId}`, { showErrorToast: false });
  });

  it('stays hidden for other genres', async () => {
    apiGet.mockResolvedValue({ genre: 'musical' });

    const { container } = render(withQueryClient(
      <AreunGlPerformancePromo performanceId={performanceId} placement="booking_complete" locale="ko" />,
    ));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden when the genre lookup fails', async () => {
    apiGet.mockRejectedValue(new Error('unavailable'));

    const { container } = render(withQueryClient(
      <AreunGlPerformancePromo performanceId={performanceId} placement="booking_complete" locale="ko" />,
    ));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('does not look up the performance without an id', () => {
    const { container } = render(withQueryClient(
      <AreunGlPerformancePromo performanceId={undefined} placement="booking_complete" locale="ko" />,
    ));

    expect(apiGet).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
