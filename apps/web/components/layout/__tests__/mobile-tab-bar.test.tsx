import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockPathname = vi.fn<() => string>().mockReturnValue('/');
const mockIntlState = vi.hoisted(() => ({
  locale: 'ko',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => mockIntlState.locale,
}));

// Import after mock setup
import { MobileTabBar } from '../mobile-tab-bar';

describe('MobileTabBar', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    mockIntlState.locale = 'ko';
  });

  it('renders 4 tabs with correct labels', () => {
    render(<MobileTabBar />);
    expect(screen.getByText('홈')).toBeDefined();
    expect(screen.getByText('분류')).toBeDefined();
    expect(screen.getByText('검색')).toBeDefined();
    expect(screen.getByText('마이페이지')).toBeDefined();
  });

  it('active tab uses primary color class when pathname matches href', () => {
    mockPathname.mockReturnValue('/');
    render(<MobileTabBar />);
    const homeLink = screen.getByText('홈').closest('a');
    expect(homeLink?.className).toContain('text-primary');
  });

  it('inactive tabs use gray color classes', () => {
    mockPathname.mockReturnValue('/');
    render(<MobileTabBar />);
    const searchLink = screen.getByText('검색').closest('a');
    expect(searchLink?.className).toContain('text-gray-400');
  });

  it('category tab has href="/genre/artist_celebrity"', () => {
    render(<MobileTabBar />);
    const categoryLink = screen.getByText('분류').closest('a');
    expect(categoryLink?.getAttribute('href')).toBe('/genre/artist_celebrity');
  });

  it('has role="navigation" and active tab has aria-current="page"', () => {
    mockPathname.mockReturnValue('/');
    render(<MobileTabBar />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeDefined();

    const homeLink = screen.getByText('홈').closest('a');
    expect(homeLink?.getAttribute('aria-current')).toBe('page');

    const searchLink = screen.getByText('검색').closest('a');
    expect(searchLink?.getAttribute('aria-current')).toBeNull();
  });

  it('component has md:hidden class (hidden on desktop)', () => {
    render(<MobileTabBar />);
    const nav = screen.getByRole('navigation');
    expect(nav.className).toContain('md:hidden');
  });

  it('marks genre sub-paths as active for category tab', () => {
    mockPathname.mockReturnValue('/genre/ip_popup');
    render(<MobileTabBar />);
    const categoryLink = screen.getByText('분류').closest('a');
    expect(categoryLink?.getAttribute('aria-current')).toBe('page');
    expect(categoryLink?.className).toContain('text-primary');
  });

  it('marks mypage sub-paths as active for mypage tab', () => {
    mockPathname.mockReturnValue('/mypage/reservations/123');
    render(<MobileTabBar />);
    const mypageLink = screen.getByText('마이페이지').closest('a');
    expect(mypageLink?.getAttribute('aria-current')).toBe('page');
  });

  it('localizes labels and hrefs for prefixed locale routes', () => {
    mockPathname.mockReturnValue('/en/search');
    mockIntlState.locale = 'en';

    render(<MobileTabBar />);

    const searchLink = screen.getByText('Search').closest('a');
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Category')).toBeDefined();
    expect(searchLink?.getAttribute('href')).toBe('/en/search');
    expect(searchLink?.getAttribute('aria-current')).toBe('page');
  });
});
