import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const push = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  isInitialized: true,
  accessToken: 'session-token' as string | null,
  user: { email: 'buyer@example.test', isEmailVerified: true },
}));

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/stores/use-auth-store', () => ({ useAuthStore: () => authState }));
vi.mock('@/components/auth/login-form', () => ({ LoginForm: () => <div>login form</div> }));
vi.mock('@/components/auth/signup-form', () => ({ SignupForm: () => <div>signup form</div> }));

import AuthPage from '../page';
import { resolveSafeReturnTo, resolveSafeReturnToFromSearch } from '@/lib/auth-return';

describe('signed-in visitor returnTo handling on /auth', () => {
  beforeEach(() => push.mockClear());
  afterEach(() => window.history.replaceState(null, '', '/'));

  it.each([
    '/.//evil.example',
    '/..//evil.example',
    '/%2e//evil.example',
    '/a/..//evil.example',
  ])('does not navigate a signed-in buyer to an external site for returnTo=%s', async (target) => {
    window.history.replaceState(null, '', `/auth?returnTo=${encodeURIComponent(target)}`);
    render(<AuthPage />);

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const destination = push.mock.calls[0]![0] as string;
    expect(destination).toBe('/');
    expect(new URL(destination, window.location.origin).origin).toBe(window.location.origin);
  });

  it('still returns a signed-in buyer to a same-site booking destination', async () => {
    window.history.replaceState(null, '', `/auth?returnTo=${encodeURIComponent('/booking/show-1/confirm?resumeOrderId=GRP-1')}`);
    render(<AuthPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/booking/show-1/confirm?resumeOrderId=GRP-1'));
  });

  it('keeps every web returnTo resolver on the current origin', () => {
    expect(resolveSafeReturnTo('/.//evil.example')).toBeNull();
    expect(resolveSafeReturnToFromSearch('?returnTo=%2F.%2F%2Fevil.example')).toBeNull();
    expect(resolveSafeReturnTo('/mypage?tab=wallet')).toBe('/mypage?tab=wallet');
  });
});
