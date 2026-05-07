import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockPathname = vi.fn<() => string>().mockReturnValue('/');
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({
    user: null,
    isInitialized: true,
    accessToken: null,
    clearAuth: vi.fn(),
  }),
}));

import { GNB } from '../gnb';
import { MobileMenu } from '../mobile-menu';

describe('locale switcher shell wiring', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    mockPush.mockClear();
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
});
