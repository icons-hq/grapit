import type { Socket } from 'socket.io-client';
import { refreshAccessToken } from './api-client';
import { useAuthStore } from '@/stores/use-auth-store';

/** Refresh the httpOnly socket cookie when an expired transport reconnects.
 * Public seat polling cannot trigger the HTTP client's 401 refresh. Keep this
 * event-driven, share the existing refresh lock, and never restore a signed-out
 * or replaced account from an in-flight response.
 */
export function attachSocketSessionRecovery(socket: Socket): () => void {
  let disposed = false;
  let refreshing = false;
  let nextRefreshAt = 0;
  const recover = async () => {
    const before = useAuthStore.getState();
    if (disposed || refreshing || !before.user || !before.accessToken || Date.now() < nextRefreshAt) return;
    refreshing = true;
    nextRefreshAt = Date.now() + 20_000;
    try {
      const result = await refreshAccessToken({ retryDelaysMs: [] });
      const current = useAuthStore.getState();
      if (disposed || current.user?.id !== before.user.id || current.accessToken !== before.accessToken) return;
      if (result.status === 'refreshed') {
        const changed = result.accessToken !== current.accessToken;
        current.setAuth(result.accessToken, current.user!);
        // A changed token reconnects through the subscription below. Tokens
        // issued in the same second may be identical but renew the cookie.
        if (!changed && !socket.connected) socket.connect();
      }
    } catch {
      // A transport outage must not clear the buyer's session or selection.
    } finally {
      refreshing = false;
    }
  };
  const onError = () => { void recover(); };
  socket.on('connect_error', onError);
  const unsubscribe = useAuthStore.subscribe((current, previous) => {
    if (!current.user || current.user.id !== previous.user?.id) {
      socket.disconnect();
    } else if (current.accessToken && current.accessToken !== previous.accessToken && !socket.connected) {
      // Also recover after Socket.IO exhausted its automatic retry attempts.
      socket.connect();
    }
  });
  return () => {
    disposed = true;
    unsubscribe();
    socket.off('connect_error', onError);
  };
}
