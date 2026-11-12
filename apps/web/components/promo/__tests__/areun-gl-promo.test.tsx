import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: ({ alt, fill: _fill, ...props }: { alt: string; fill?: boolean; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={String(props.src)} />
  ),
}));

import { AreunGlPerformancePromo, AreunGlPromoCard } from '../areun-gl-promo';

// Display tests run inside the campaign window so they keep passing after it ends.
const DURING_CAMPAIGN = new Date('2026-11-20T12:00:00+09:00');
const CAMPAIGN_END = new Date('2027-02-14T00:00:00+09:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(DURING_CAMPAIGN);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AreunGlPromoCard', () => {
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

  it('renders nothing once the campaign ends', () => {
    vi.setSystemTime(CAMPAIGN_END);

    const { container } = render(<AreunGlPromoCard placement="home_banner" locale="ko" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AreunGlPerformancePromo', () => {
  it('shows the card for a fan-meeting booking', () => {
    render(<AreunGlPerformancePromo genre="artist_celebrity" placement="reservation_detail" locale="ko" />);

    const link = screen.getByRole('link');
    expect(new URL(link.getAttribute('href') ?? '').searchParams.get('utm_medium')).toBe('reservation_detail');
  });

  it.each([['musical'], [undefined], [null]])('stays hidden for genre %s', (genre) => {
    const { container } = render(
      <AreunGlPerformancePromo genre={genre} placement="booking_complete" locale="ko" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden for a fan-meeting booking after the campaign ends', () => {
    vi.setSystemTime(CAMPAIGN_END);

    const { container } = render(
      <AreunGlPerformancePromo genre="artist_celebrity" placement="booking_complete" locale="ko" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
