import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
  it('uses the 1290 x 600 mobile ratio and preserves desktop height', () => {
    const { container } = render(<BannerCarousel banners={[banner()]} />);

    const carousel = container.querySelector('.aspect-\\[1290\\/600\\]');
    expect(carousel?.className).toContain('aspect-[1290/600]');
    expect(carousel?.className).toContain('md:h-[400px]');
    expect(screen.getByRole('img', { name: '프로모션 배너' })).toBeDefined();
  });
});
