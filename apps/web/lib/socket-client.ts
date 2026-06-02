import { io, type Socket } from 'socket.io-client';

const LOCAL_BOOKING_SOCKET_URL = 'http://localhost:8080';
const LOCALHOST_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

function getHostname(baseUrl: string): string {
  return new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function assertProductionSocketUrl(baseUrl: string): void {
  if (baseUrl === '') {
    throw new Error('NEXT_PUBLIC_WS_URL must be set in production');
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('NEXT_PUBLIC_WS_URL must be an absolute URL in production');
  }

  if (LOCALHOST_HOSTNAMES.has(getHostname(baseUrl))) {
    throw new Error('NEXT_PUBLIC_WS_URL must not point to localhost in production');
  }

  if (url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_WS_URL must be an https URL in production');
  }

  if (url.origin !== baseUrl) {
    throw new Error('NEXT_PUBLIC_WS_URL must be an origin URL in production');
  }
}

function resolveBookingSocketUrl(): string {
  if (process.env.NODE_ENV !== 'production') {
    return LOCAL_BOOKING_SOCKET_URL;
  }

  const baseUrl = (process.env.NEXT_PUBLIC_WS_URL ?? '').trim().replace(/\/+$/, '');
  assertProductionSocketUrl(baseUrl);
  return baseUrl;
}

export function createBookingSocket(): Socket {
  return io(`${resolveBookingSocketUrl()}/booking`, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}
