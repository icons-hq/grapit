import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { ioMock } = vi.hoisted(() => ({
  ioMock: vi.fn(() => ({})),
}));

vi.mock('socket.io-client', () => ({
  io: ioMock,
}));

describe('createBookingSocket', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the local API socket origin outside production', async () => {
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'http://192.0.2.10:8080');
    const { createBookingSocket } = await import('../socket-client');

    createBookingSocket();

    expect(ioMock).toHaveBeenCalledWith('http://localhost:8080/booking', expect.objectContaining({
      autoConnect: false,
      withCredentials: true,
    }));
  });

  it('uses NEXT_PUBLIC_WS_URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'https://api.example.com/');
    const { createBookingSocket } = await import('../socket-client');

    createBookingSocket();

    expect(ioMock).toHaveBeenCalledWith('https://api.example.com/booking', expect.any(Object));
  });

  it('throws in production when NEXT_PUBLIC_WS_URL is empty', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
    const { createBookingSocket } = await import('../socket-client');

    expect(() => createBookingSocket()).toThrow(
      'NEXT_PUBLIC_WS_URL must be set in production',
    );
  });

  it.each([
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://0.0.0.0:8080',
    'http://[::1]:8080',
  ])('throws in production when NEXT_PUBLIC_WS_URL is local: %s', async (baseUrl) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', baseUrl);
    const { createBookingSocket } = await import('../socket-client');

    expect(() => createBookingSocket()).toThrow(
      'NEXT_PUBLIC_WS_URL must not point to localhost in production',
    );
  });

  it('throws in production when NEXT_PUBLIC_WS_URL is not HTTPS', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'http://api.example.com');
    const { createBookingSocket } = await import('../socket-client');

    expect(() => createBookingSocket()).toThrow(
      'NEXT_PUBLIC_WS_URL must be an https URL in production',
    );
  });

  it.each([
    'https://api.example.com/base',
    'https://api.example.com?x=1',
    'https://api.example.com#fragment',
  ])('throws in production when NEXT_PUBLIC_WS_URL is not origin-only: %s', async (baseUrl) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', baseUrl);
    const { createBookingSocket } = await import('../socket-client');

    expect(() => createBookingSocket()).toThrow(
      'NEXT_PUBLIC_WS_URL must be an origin URL in production',
    );
  });
});
