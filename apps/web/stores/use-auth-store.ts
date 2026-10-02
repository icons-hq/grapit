'use client';

import { create } from 'zustand';
import type { UserProfile } from '@grabit/shared';

interface AuthState {
  accessToken: string | null;
  user: UserProfile | null;
  isInitialized: boolean;
  /**
   * The page continued signed out because the API could not confirm the
   * session, and lib/auth retries it in the background. Login screens tell the
   * user the session may still come back on its own.
   */
  sessionRestorePending: boolean;
  setAuth: (accessToken: string, user: UserProfile) => void;
  clearAuth: () => void;
  setInitialized: () => void;
  setSessionRestorePending: (pending: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isInitialized: false,
  sessionRestorePending: false,
  // A signed-in session ends any pending background restore notice.
  setAuth: (accessToken, user) => set({ accessToken, user, isInitialized: true, sessionRestorePending: false }),
  clearAuth: () => set({ accessToken: null, user: null }),
  setInitialized: () => set({ isInitialized: true }),
  // Unchanged values notify nobody: lib/auth counts every other store update
  // with the same session as a session change (an empty-store clearAuth).
  setSessionRestorePending: (pending) =>
    set((state) => (state.sessionRestorePending === pending ? state : { sessionRestorePending: pending })),
}));
