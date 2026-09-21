import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@grabit/shared';
import { AuthInitializer } from '../auth-initializer';
import { useAuthStore } from '@/stores/use-auth-store';

const profile = { id: 'buyer', email: 'buyer@example.test', isEmailVerified: false } as UserProfile;

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => useAuthStore.setState({ user: null, accessToken: null, isInitialized: false }));

describe('session initialization', () => {
  it('shares the rotating refresh in StrictMode and leaves unverified visitors on a public page', async () => {
    window.history.replaceState(null, '', '/en/support');
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'test-session' })))
      .mockResolvedValueOnce(new Response(JSON.stringify(profile)));
    vi.stubGlobal('fetch', fetchMock);
    render(<StrictMode><AuthInitializer /></StrictMode>);
    await waitFor(() => expect(useAuthStore.getState().isInitialized).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().user?.id).toBe('buyer');
    expect(window.location.pathname).toBe('/en/support');
  });

  it('finishes signed out when no refresh session exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<StrictMode><AuthInitializer /></StrictMode>);
    await waitFor(() => expect(useAuthStore.getState().isInitialized).toBe(true));
    expect(useAuthStore.getState().user).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
