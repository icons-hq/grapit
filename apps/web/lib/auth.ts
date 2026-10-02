import { apiUrl } from '@/lib/api-url';
import { refreshAccessToken } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import type { UserProfile } from '@grabit/shared';

// While these retries run the store stays uninitialized, so protected pages keep
// showing their loading state instead of sending the buyer to the login page.
const RESTORE_RETRY_DELAYS_MS: readonly number[] = [500, 1_500, 4_000];
// After that the page continues signed out, and the session is retried in the
// background so a still-valid refresh cookie signs the buyer back in.
const BACKGROUND_RESTORE_DELAYS_MS: readonly number[] = [10_000, 30_000, 60_000];

type ProfileOutcome =
  | { status: 'loaded'; user: UserProfile }
  | { status: 'rejected' }
  | { status: 'unavailable' };

let initialization: Promise<void> | null = null;
let backgroundRestoreTimer: ReturnType<typeof setTimeout> | null = null;
// Access token from a refresh that succeeded while /users/me did not. The next
// background attempt reads the profile with it first instead of rotating the
// refresh cookie again.
let unconfirmedAccessToken: string | null = null;

export function initializeAuth(): Promise<void> {
  if (useAuthStore.getState().isInitialized) return Promise.resolve();
  // StrictMode and concurrent mount callers must share one refresh rotation.
  initialization ??= restoreSession().finally(() => { initialization = null; });
  return initialization;
}

async function restoreSession(): Promise<void> {
  const outcome = await restoreSessionOnce();
  if (outcome === 'unavailable') {
    scheduleBackgroundRestore(0);
  }
  if (!useAuthStore.getState().isInitialized) {
    useAuthStore.getState().setInitialized();
  }
}

/** Returns whether the session was restored, is absent, or could not be determined. */
async function restoreSessionOnce(): Promise<'restored' | 'signed_out' | 'unavailable'> {
  if (unconfirmedAccessToken) {
    const accessToken = unconfirmedAccessToken;
    const profile = await fetchProfile(accessToken);
    if (profile.status === 'unavailable') return 'unavailable';
    unconfirmedAccessToken = null;
    if (profile.status === 'loaded') {
      useAuthStore.getState().setAuth(accessToken, profile.user);
      return 'restored';
    }
    // The access token expired meanwhile; renew it from the refresh cookie below.
  }

  const refresh = await refreshAccessToken({ retryDelaysMs: RESTORE_RETRY_DELAYS_MS });
  if (refresh.status === 'signed_out') return 'signed_out';
  if (refresh.status === 'unavailable') return 'unavailable';

  // Fetch user profile with new token
  let profile = await fetchProfile(refresh.accessToken);
  for (const delayMs of RESTORE_RETRY_DELAYS_MS) {
    if (profile.status !== 'unavailable') break;
    await sleep(delayMs);
    profile = await fetchProfile(refresh.accessToken);
  }

  if (profile.status === 'loaded') {
    useAuthStore.getState().setAuth(refresh.accessToken, profile.user);
    return 'restored';
  }
  if (profile.status === 'unavailable') {
    // The refresh cookie was valid but the profile could not be read yet; keep the
    // new access token for the background retry.
    unconfirmedAccessToken = refresh.accessToken;
    return 'unavailable';
  }
  return 'signed_out';
}

async function fetchProfile(accessToken: string): Promise<ProfileOutcome> {
  try {
    const userRes = await fetch(apiUrl('/api/v1/users/me'), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (userRes.ok) {
      return { status: 'loaded', user: (await userRes.json()) as UserProfile };
    }
    return userRes.status === 401 || userRes.status === 403
      ? { status: 'rejected' }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

function scheduleBackgroundRestore(attempt: number) {
  if (typeof window === 'undefined' || backgroundRestoreTimer) return;
  const delayMs = BACKGROUND_RESTORE_DELAYS_MS[Math.min(attempt, BACKGROUND_RESTORE_DELAYS_MS.length - 1)]!;
  backgroundRestoreTimer = setTimeout(() => {
    backgroundRestoreTimer = null;
    // A manual login or another restore already produced a session.
    if (useAuthStore.getState().accessToken) {
      unconfirmedAccessToken = null;
      return;
    }
    void restoreSessionOnce().then((outcome) => {
      if (outcome === 'unavailable') scheduleBackgroundRestore(attempt + 1);
    });
  }, delayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Test-only: cancel a pending background session retry. */
export function resetAuthInitializationForTests() {
  if (backgroundRestoreTimer) clearTimeout(backgroundRestoreTimer);
  backgroundRestoreTimer = null;
  initialization = null;
  unconfirmedAccessToken = null;
}
