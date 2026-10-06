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
// Bumped by every session change made outside restore (login, logout, token
// renewal, profile update). A restore that started in an older generation must
// not overwrite the newer session with the one it was restoring.
let sessionGeneration = 0;
let applyingRestoredSession = false;

useAuthStore.subscribe((state, previous) => {
  if (applyingRestoredSession) return;
  // A flag update (setInitialized, the restore-pending notice) is not a session
  // change; clearAuth is, even when the store was already empty (a logout while
  // restore was still running).
  const flagsOnly = state.accessToken === previous.accessToken
    && state.user === previous.user
    && (state.isInitialized !== previous.isInitialized
      || state.sessionRestorePending !== previous.sessionRestorePending);
  if (flagsOnly) return;
  sessionGeneration += 1;
  unconfirmedAccessToken = null;
});

/**
 * Tells login screens that a background restore is still running, so a user
 * sent to /auth during an API outage is not asked to sign in again for nothing.
 */
function setSessionRestorePending(pending: boolean) {
  useAuthStore.getState().setSessionRestorePending(pending);
}

/** Applies a restored session only if nothing changed the session since `generation`. */
function applyRestoredSession(generation: number, accessToken: string, user: UserProfile): boolean {
  if (generation !== sessionGeneration || useAuthStore.getState().accessToken !== null) {
    return false;
  }
  applyingRestoredSession = true;
  try {
    useAuthStore.getState().setAuth(accessToken, user);
  } finally {
    applyingRestoredSession = false;
  }
  return true;
}

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

/**
 * Returns whether the session was restored, is absent, could not be determined,
 * or was superseded by a session change made while this restore was running.
 */
async function restoreSessionOnce(): Promise<'restored' | 'signed_out' | 'unavailable' | 'superseded'> {
  const generation = sessionGeneration;
  const superseded = () => generation !== sessionGeneration || useAuthStore.getState().accessToken !== null;

  if (unconfirmedAccessToken) {
    const accessToken = unconfirmedAccessToken;
    const profile = await fetchProfile(accessToken);
    if (superseded()) return 'superseded';
    if (profile.status === 'unavailable') return 'unavailable';
    unconfirmedAccessToken = null;
    if (profile.status === 'loaded') {
      return applyRestoredSession(generation, accessToken, profile.user) ? 'restored' : 'superseded';
    }
    // The access token expired meanwhile; renew it from the refresh cookie below.
  }

  const refresh = await refreshAccessToken({ retryDelaysMs: RESTORE_RETRY_DELAYS_MS });
  if (superseded()) return 'superseded';
  if (refresh.status === 'signed_out') return 'signed_out';
  if (refresh.status === 'unavailable') return 'unavailable';

  // Fetch user profile with new token
  let profile = await fetchProfile(refresh.accessToken);
  for (const delayMs of RESTORE_RETRY_DELAYS_MS) {
    if (profile.status !== 'unavailable' || superseded()) break;
    await sleep(delayMs);
    profile = await fetchProfile(refresh.accessToken);
  }

  if (superseded()) return 'superseded';
  if (profile.status === 'loaded') {
    return applyRestoredSession(generation, refresh.accessToken, profile.user) ? 'restored' : 'superseded';
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
    // Same rule as the refresh: only the API's 401 rejects the session. A 403
    // comes from the edge (WAF, edge secret) and says nothing about the token.
    return userRes.status === 401
      ? { status: 'rejected' }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

function scheduleBackgroundRestore(attempt: number) {
  if (typeof window === 'undefined' || backgroundRestoreTimer) return;
  // Set before restoreSession marks the store initialized, so the login screen
  // a protected page redirects to already shows the notice. The retries keep
  // going (every 60 s at most) until the cookie is accepted or rejected.
  setSessionRestorePending(true);
  const delayMs = BACKGROUND_RESTORE_DELAYS_MS[Math.min(attempt, BACKGROUND_RESTORE_DELAYS_MS.length - 1)]!;
  backgroundRestoreTimer = setTimeout(() => {
    backgroundRestoreTimer = null;
    // A manual login or another restore already produced a session.
    if (useAuthStore.getState().accessToken) {
      unconfirmedAccessToken = null;
      setSessionRestorePending(false);
      return;
    }
    void restoreSessionOnce().then((outcome) => {
      if (outcome === 'unavailable') {
        scheduleBackgroundRestore(attempt + 1);
        return;
      }
      // restored, signed_out or superseded: nothing is pending any more.
      setSessionRestorePending(false);
    }, () => {
      // Not expected (each step maps its failures to an outcome); never leave
      // the notice on screen without a retry behind it.
      setSessionRestorePending(false);
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
  applyingRestoredSession = false;
  setSessionRestorePending(false);
}
