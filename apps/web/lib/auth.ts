import { apiUrl } from '@/lib/api-url';
import { useAuthStore } from '@/stores/use-auth-store';
import type { UserProfile } from '@grabit/shared';

let initialization: Promise<void> | null = null;

export function initializeAuth(): Promise<void> {
  if (useAuthStore.getState().isInitialized) return Promise.resolve();
  // StrictMode and concurrent mount callers must share one refresh rotation.
  initialization ??= restoreSession().finally(() => { initialization = null; });
  return initialization;
}

async function restoreSession(): Promise<void> {
  try {
    const res = await fetch(apiUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      const data = (await res.json()) as { accessToken: string };

      // Fetch user profile with new token
      const userRes = await fetch(apiUrl('/api/v1/users/me'), {
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (userRes.ok) {
        const user = (await userRes.json()) as UserProfile;
        useAuthStore.getState().setAuth(data.accessToken, user);
        return;
      }
    }
  } catch {
    // No valid session -- that's fine
  }

  useAuthStore.getState().setInitialized();
}
