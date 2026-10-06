import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';

const push = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/components/auth/login-form', () => ({ LoginForm: () => <div>login form</div> }));
vi.mock('@/components/auth/signup-form', () => ({ SignupForm: () => <div>signup form</div> }));

import AuthPage from '../page';

const NOTICE = '연결이 불안정해 로그인 상태를 다시 확인하고 있습니다. 잠시 후 자동으로 돌아갑니다.';
const scanner = { id: 'scanner-1', email: 'scanner@example.test', isEmailVerified: true } as UserProfile;

// A page load whose /auth/refresh kept failing continues signed out and the
// guard sends the user here while lib/auth retries in the background
// (field-ops-11). Without a notice the user signs in again during the outage.
describe('/auth while a background session restore is pending', () => {
  beforeEach(() => {
    push.mockClear();
    useAuthStore.setState({ accessToken: null, user: null, isInitialized: true, sessionRestorePending: false });
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('tells the user the session is being restored instead of only asking for a login', () => {
    useAuthStore.setState({ sessionRestorePending: true });
    render(<AuthPage />);

    expect(screen.getByRole('status')).toHaveTextContent(NOTICE);
    expect(screen.getByText('login form')).toBeInTheDocument();
  });

  it('shows no notice for an ordinary signed-out visit', () => {
    render(<AuthPage />);

    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('returns to the protected page once the background restore signs the user back in', async () => {
    window.history.replaceState(null, '', `/auth?returnTo=${encodeURIComponent('/field/check-in?showtimeId=st-1')}`);
    useAuthStore.setState({ sessionRestorePending: true });
    render(<AuthPage />);
    expect(screen.getByRole('status')).toHaveTextContent(NOTICE);

    act(() => useAuthStore.getState().setAuth('restored-access', scanner));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/field/check-in?showtimeId=st-1'));
    expect(useAuthStore.getState().sessionRestorePending).toBe(false);
  });
});
