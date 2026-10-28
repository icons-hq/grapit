import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Banner } from '@grabit/shared';
import { BannerCarousel } from '../banner-carousel';

vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    priority: _priority,
    loading: _loading,
  }: {
    alt: string;
    fill?: boolean;
    priority?: boolean;
    loading?: string;
    [key: string]: unknown;
  }) => <span aria-label={alt} role="img" />,
}));

vi.mock('swiper/react', () => ({
  Swiper: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  SwiperSlide: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('swiper/modules', () => ({
  Autoplay: {},
  A11y: {},
  Keyboard: {},
  Pagination: {},
}));

function banner(): Banner {
  return {
    id: 'banner-1',
    imageUrl: 'https://r2.example.com/banners/mobile.jpg',
    linkUrl: null,
    placement: 'home_hero',
    deviceTarget: 'mobile',
    status: 'active',
    startsAt: null,
    endsAt: null,
    sortOrder: 0,
    isActive: true,
  };
}

describe('BannerCarousel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  });
  it.each(['en', 'th', 'zh-CN'] as const)('keeps %s when following a stored absolute Grabit promotion link', (locale) => {
    render(<BannerCarousel locale={locale} banners={[{...banner(), linkUrl: 'https://heygrabit.com/performance/event?campaign=fall#detail-copy'}]} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe(`/${locale}/performance/event?campaign=fall#detail-copy`);
  });

  it('normalizes the canonical www origin and an existing language prefix', () => {
    render(<BannerCarousel locale="ko" banners={[{...banner(), linkUrl: 'https://www.heygrabit.com/en/performance/event'}]} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/performance/event');
  });

  it('keeps local path navigation and preserves its query and fragment', () => {
    render(<BannerCarousel locale="en" banners={[{...banner(), linkUrl: '/th/performance/event?campaign=fall#details'}]} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/en/performance/event?campaign=fall#details');
  });

  it.each(['https://partner.example/performance/event', 'https://heygrabit.com.partner.example/event', 'https://api.heygrabit.com/api/v1/health'])(
    'preserves an external destination %s', (linkUrl) => {
      render(<BannerCarousel locale="en" banners={[{...banner(), linkUrl}]} />);
      expect(screen.getByRole('link').getAttribute('href')).toBe(linkUrl);
    },
  );

  it('renders the source artwork with a labelled promotion region', () => {
    render(<BannerCarousel banners={[banner()]} />);
    expect(screen.getByRole('region', { name: '공연 소식' })).toBeDefined();
    expect(screen.getByRole('img', { name: '공연 소식' })).toBeDefined();
  });

  it('does not turn an unsafe banner URL into an actionable link', () => {
    render(<BannerCarousel banners={[{ ...banner(), linkUrl: 'javascript:alert(1)' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
