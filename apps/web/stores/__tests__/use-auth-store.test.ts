import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@grabit/shared';
import { useAuthStore } from '../use-auth-store';

const buyer = { id: 'buyer-1', email: 'buyer@example.test', isEmailVerified: true } as UserProfile;

describe('auth store session restore notice', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, isInitialized: true, sessionRestorePending: false });
  });

  it('notifies subscribers only when the notice actually changes', () => {
    // lib/auth treats any other update with an unchanged session as a session
    // change (an empty-store logout), so a repeated value must stay silent.
    const listener = vi.fn();
    const unsubscribe = useAuthStore.subscribe(listener);

    useAuthStore.getState().setSessionRestorePending(true);
    useAuthStore.getState().setSessionRestorePending(true);
    useAuthStore.getState().setSessionRestorePending(false);
    useAuthStore.getState().setSessionRestorePending(false);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ends the notice when a session is set and keeps it across a logout of an empty store', () => {
    useAuthStore.getState().setSessionRestorePending(true);
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().sessionRestorePending).toBe(true);

    useAuthStore.getState().setAuth('access', buyer);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'access', sessionRestorePending: false });
  });
});
