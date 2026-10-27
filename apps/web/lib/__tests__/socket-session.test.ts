import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { attachSocketSessionRecovery } from '../socket-session';
import { refreshAccessToken } from '../api-client';

vi.mock('../api-client', () => ({ refreshAccessToken: vi.fn() }));
const user = { id: 'buyer' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;
function setup() {
  const socket = Object.assign(new EventEmitter(), { connected: false, connect: vi.fn(), disconnect: vi.fn() });
  const detach = attachSocketSessionRecovery(socket as unknown as Socket);
  return { socket, detach };
}
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user, accessToken: 'old-token' });
});

describe('socket session recovery', () => {
  it('refreshes and reconnects after expiry without an authenticated HTTP request', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({ status: 'refreshed', accessToken: 'new-token' });
    const { socket, detach } = setup();
    socket.emit('connect_error', new Error('transport error'));
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledOnce());
    expect(useAuthStore.getState().accessToken).toBe('new-token');
    detach();
  });

  it('reconnects after another API call refreshes the token, even after automatic retries stopped', () => {
    const { socket, detach } = setup();
    useAuthStore.getState().setAuth('renewed-token', user);
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    detach();
  });

  it('does not resurrect a logged-out account from a refresh that finishes late', async () => {
    let finish!: (value: { status: 'refreshed'; accessToken: string }) => void;
    vi.mocked(refreshAccessToken).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { socket, detach } = setup();
    socket.emit('connect_error');
    useAuthStore.getState().clearAuth();
    finish({ status: 'refreshed', accessToken: 'late-token' });
    await Promise.resolve();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledOnce();
    detach();
  });

  it('keeps a session on temporary failure and throttles refresh storms', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({ status: 'unavailable' });
    const { socket, detach } = setup();
    socket.emit('connect_error');
    await Promise.resolve();
    socket.emit('connect_error');
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().accessToken).toBe('old-token');
    detach();
  });

  it('does not reconnect a disposed screen after refresh completes', async () => {
    let finish!: (value: { status: 'refreshed'; accessToken: string }) => void;
    vi.mocked(refreshAccessToken).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { socket, detach } = setup();
    socket.emit('connect_error');
    detach();
    finish({ status: 'refreshed', accessToken: 'late-token' });
    await Promise.resolve();
    expect(socket.connect).not.toHaveBeenCalled();
  });
});
