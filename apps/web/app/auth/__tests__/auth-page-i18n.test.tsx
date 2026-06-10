import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({
    isInitialized: true,
    accessToken: null,
    setAuth: vi.fn(),
  }),
}));

vi.mock('@/components/auth/signup-form', () => ({
  SignupForm: () => <div>signup form</div>,
}));

import AuthPage from '../page';
import { getSocialLoginPath } from '@/components/auth/login-form';

describe('auth page i18n visible copy', () => {
  it('renders auth tabs and login form copy from the active locale', () => {
    render(<AuthPage />);

    expect(screen.getByRole('tab', { name: 'Login' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Sign up' })).toBeDefined();
    expect(screen.getByPlaceholderText('Enter your email')).toBeDefined();
    expect(screen.getByPlaceholderText('Enter your password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Login' })).toBeDefined();
    expect(screen.getByText('Forgot password?')).toBeDefined();
  });

  it('builds social login start URLs with the active locale', () => {
    expect(getSocialLoginPath('google', 'en')).toBe(
      '/api/v1/auth/social/google?locale=en',
    );
    expect(getSocialLoginPath('kakao', 'ko')).toBe(
      '/api/v1/auth/social/kakao?locale=ko',
    );
    expect(getSocialLoginPath('naver', 'ko', '/booking/performance-auth')).toBe(
      '/api/v1/auth/social/naver?locale=ko&returnTo=%2Fbooking%2Fperformance-auth',
    );
  });
});
