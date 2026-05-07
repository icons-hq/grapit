import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const mockPathname = vi.fn<() => string>().mockReturnValue('/');
const mockPush = vi.fn();
const mockNavigateToLocalizedPath = vi.hoisted(() => vi.fn());
const mockAuthState = vi.hoisted(() => ({
  user: null as { name: string } | null,
  accessToken: null as string | null,
  activeLocale: 'ko',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams('q=girl&page=2'),
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('next-intl', () => ({
  useLocale: () => mockAuthState.activeLocale,
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({
    user: mockAuthState.user,
    isInitialized: true,
    accessToken: mockAuthState.accessToken,
    clearAuth: vi.fn(),
  }),
}));

vi.mock('@/lib/i18n/locale-navigation', () => ({
  navigateToLocalizedPath: mockNavigateToLocalizedPath,
}));

import { GNB } from '../gnb';
import { MobileMenu } from '../mobile-menu';
import {
  appendSearchParams,
  getLocalizedPathname,
} from '@/components/i18n/locale-switcher';

describe('locale switcher shell wiring', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    mockPush.mockClear();
    mockNavigateToLocalizedPath.mockClear();
    mockAuthState.user = null;
    mockAuthState.accessToken = null;
    mockAuthState.activeLocale = 'ko';
  });

  it('renders explicit locale switcher through the desktop GNB', () => {
    render(<GNB />);

    expect(
      screen.getByRole('button', { name: /언어 선택/ }),
    ).toBeDefined();
    expect(screen.getByText('한국어').getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('renders desktop navigation labels from the active locale', () => {
    mockPathname.mockReturnValue('/en');
    mockAuthState.activeLocale = 'en';

    render(<GNB />);

    expect(screen.getByRole('link', { name: 'Artist/Celebrity' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'IP Popup' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search shows' })).toHaveAttribute(
      'placeholder',
      'Search shows or artists',
    );
    expect(screen.getByRole('link', { name: 'Login / Sign up' })).toHaveAttribute(
      'href',
      '/en/auth',
    );
  });

  it('uses document navigation when a new locale is selected', async () => {
    render(<GNB />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /언어 선택/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'English' }));

    expect(mockNavigateToLocalizedPath).toHaveBeenCalledWith(
      '/en?q=girl&page=2',
    );
    expect(document.cookie).toContain('preferred-locale=en');
  });

  it('renders explicit locale switcher through the mobile menu surface', () => {
    render(
      <MobileMenu
        isOpen
        onClose={vi.fn()}
        onLogout={vi.fn()}
        isAuthenticated={false}
      />,
    );

    expect(
      screen.getByRole('button', { name: /언어 선택/ }),
    ).toBeDefined();
    expect(screen.getByText('한국어').getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('preserves query strings when building localized switch targets', () => {
    expect(
      appendSearchParams(
        getLocalizedPathname('/search', 'en'),
        'q=girl&page=2',
      ),
    ).toBe('/en/search?q=girl&page=2');
  });

  it('keeps authenticated mobile My Page navigation under the active locale', () => {
    mockPathname.mockReturnValue('/en');
    mockAuthState.activeLocale = 'en';
    mockAuthState.user = { name: 'Fan User' };
    mockAuthState.accessToken = 'access-token';

    render(
      <MobileMenu
        isOpen
        onClose={vi.fn()}
        onLogout={vi.fn()}
        isAuthenticated
        userName="Fan User"
      />,
    );

    expect(screen.getByRole('link', { name: /My Page/i })).toHaveAttribute(
      'href',
      '/en/mypage',
    );
  });
});
