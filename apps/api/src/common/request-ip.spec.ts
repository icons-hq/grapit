import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { resolveTrustedRequestIp } from './request-ip.js';

function requestWithIp(ip?: string, remoteAddress?: string): Request {
  return {
    ip,
    socket: { remoteAddress },
  } as Request;
}

describe('resolveTrustedRequestIp', () => {
  it('uses the framework-normalized request IP', () => {
    expect(resolveTrustedRequestIp(requestWithIp('198.51.100.20', '10.0.0.1')))
      .toBe('198.51.100.20');
  });

  it('falls back to the socket remote address when request IP is absent', () => {
    expect(resolveTrustedRequestIp(requestWithIp(undefined, '203.0.113.10')))
      .toBe('203.0.113.10');
  });

  it('rejects untrusted or malformed IP strings', () => {
    expect(resolveTrustedRequestIp(requestWithIp('203.0.113.50, 10.0.0.1')))
      .toBe('0.0.0.0');
  });
});
