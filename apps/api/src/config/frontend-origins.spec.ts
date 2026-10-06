import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingGateway } from '../modules/booking/booking.gateway.js';
import { QueueGateway } from '../modules/queue/queue.gateway.js';
import {
  allowSocketIoFrontendOrigin,
  DEFAULT_FRONTEND_ORIGIN,
  getFrontendOrigins,
  getPrimaryFrontendUrl,
  isAllowedFrontendOrigin,
  parseFrontendUrlList,
} from './frontend-origins.js';

const MULTI_ORIGIN = 'https://heygrabit.com, https://www.heygrabit.com/';
const GATEWAY_OPTIONS_METADATA = 'websockets:gateway_options';

type CorsCallback = (err: Error | null, allow?: boolean) => void;

function checkOrigin(origin: string | undefined): { err: Error | null; allow?: boolean } {
  let outcome: { err: Error | null; allow?: boolean } | undefined;
  allowSocketIoFrontendOrigin(origin, (err, allow) => {
    outcome = { err, allow };
  });
  if (!outcome) throw new Error('CORS callback was not called');
  return outcome;
}

describe('FRONTEND_URL origin helpers (audit #93)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses a comma-separated FRONTEND_URL into trimmed entries', () => {
    expect(parseFrontendUrlList(MULTI_ORIGIN)).toEqual([
      'https://heygrabit.com',
      'https://www.heygrabit.com/',
    ]);
    expect(parseFrontendUrlList(' , ')).toEqual([]);
    expect(parseFrontendUrlList(undefined)).toEqual([]);
  });

  it('normalizes every entry to a browser origin and falls back to the local web origin', () => {
    expect(getFrontendOrigins(MULTI_ORIGIN)).toEqual([
      'https://heygrabit.com',
      'https://www.heygrabit.com',
    ]);
    expect(getFrontendOrigins('')).toEqual([DEFAULT_FRONTEND_ORIGIN]);
  });

  it('uses the first entry as the single URL for redirects and email links', () => {
    expect(getPrimaryFrontendUrl(MULTI_ORIGIN)).toBe('https://heygrabit.com');
    expect(getPrimaryFrontendUrl('https://heygrabit.com/')).toBe('https://heygrabit.com');
    expect(getPrimaryFrontendUrl(undefined)).toBe(DEFAULT_FRONTEND_ORIGIN);
  });

  it('accepts every configured origin and nothing else', () => {
    expect(isAllowedFrontendOrigin('https://heygrabit.com', MULTI_ORIGIN)).toBe(true);
    expect(isAllowedFrontendOrigin('https://www.heygrabit.com', MULTI_ORIGIN)).toBe(true);
    expect(isAllowedFrontendOrigin('https://evil.example', MULTI_ORIGIN)).toBe(false);
    expect(isAllowedFrontendOrigin(MULTI_ORIGIN, MULTI_ORIGIN)).toBe(false);
  });

  it('allows every listed origin for Socket.IO handshakes in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FRONTEND_URL', MULTI_ORIGIN);

    expect(checkOrigin('https://heygrabit.com')).toEqual({ err: null, allow: true });
    expect(checkOrigin('https://www.heygrabit.com')).toEqual({ err: null, allow: true });
    expect(checkOrigin(undefined)).toEqual({ err: null, allow: true });

    const rejected = checkOrigin('https://evil.example');
    expect(rejected.err?.message).toBe('CORS not allowed');
    expect(rejected.allow).toBeUndefined();
  });

  it('keeps allowing any origin outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FRONTEND_URL', 'https://heygrabit.com');

    expect(checkOrigin('http://localhost:3001')).toEqual({ err: null, allow: true });
  });

  it('is the CORS origin check of both the booking and queue gateways', () => {
    for (const gateway of [BookingGateway, QueueGateway]) {
      const options = Reflect.getMetadata(GATEWAY_OPTIONS_METADATA, gateway) as {
        cors?: { origin?: CorsCallback; credentials?: boolean };
      };
      expect(options.cors?.origin).toBe(allowSocketIoFrontendOrigin);
      expect(options.cors?.credentials).toBe(true);
    }
  });
});
