import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import {
  CLOUDFLARE_CLIENT_IP_WARNING_INTERVAL_MS,
  EDGE_CLIENT_IP_HEADER,
  EDGE_PROXY_SECRET_HEADER,
  EDGE_PROXY_SECRET_MISSING_MESSAGE,
  EDGE_PROXY_SHARED_SECRET_ENV,
  checkEdgeProxySecretAtStartup,
  resolveTrustedRequestIp,
} from './request-ip.js';

function requestWithIp(
  ip?: string,
  remoteAddress?: string,
  headers: Record<string, string | string[] | undefined> = {},
): Request {
  return {
    ip,
    socket: { remoteAddress },
    headers,
  } as Request;
}

describe('resolveTrustedRequestIp', () => {
  beforeEach(() => {
    delete process.env[EDGE_PROXY_SHARED_SECRET_ENV];
  });

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

  it('uses Cloudflare client IP headers before the proxy edge IP', () => {
    expect(
      resolveTrustedRequestIp(
        requestWithIp('172.70.207.202', '172.70.207.202', {
          'cf-connecting-ip': '198.51.100.44',
        }),
      ),
    ).toBe('198.51.100.44');
  });

  it('ignores spoofed Cloudflare client IP headers from direct clients', () => {
    expect(
      resolveTrustedRequestIp(
        requestWithIp('203.0.113.99', '203.0.113.99', {
          'cf-connecting-ip': '198.51.100.44',
          'true-client-ip': '198.51.100.45',
        }),
      ),
    ).toBe('203.0.113.99');
  });

  it('never trusts True-Client-IP or X-Forwarded-For, even from a Cloudflare peer', () => {
    // Any Cloudflare Worker can set these to arbitrary values when it calls the
    // public run.app origin directly; only cf-connecting-ip is Cloudflare-owned.
    expect(
      resolveTrustedRequestIp(
        requestWithIp('172.70.207.202', '172.70.207.202', {
          'true-client-ip': '198.51.100.46',
          'x-forwarded-for': '198.51.100.45, 172.70.207.202',
        }),
      ),
    ).toBe('172.70.207.202');
  });

  it('normalizes an IPv4-mapped Cloudflare client IP', () => {
    expect(
      resolveTrustedRequestIp(
        requestWithIp('172.70.207.202', '172.70.207.202', {
          'cf-connecting-ip': '::ffff:198.51.100.44',
        }),
      ),
    ).toBe('198.51.100.44');
  });

  describe('with the edge proxy shared secret configured', () => {
    beforeEach(() => {
      process.env[EDGE_PROXY_SHARED_SECRET_ENV] = 'edge-secret-value';
    });

    afterEach(() => {
      delete process.env[EDGE_PROXY_SHARED_SECRET_ENV];
    });

    it('trusts the edge client IP header when the edge secret matches', () => {
      expect(
        resolveTrustedRequestIp(
          requestWithIp('172.70.207.202', '172.70.207.202', {
            [EDGE_PROXY_SECRET_HEADER]: 'edge-secret-value',
            [EDGE_CLIENT_IP_HEADER]: '198.51.100.44',
            'cf-connecting-ip': '198.51.100.99',
          }),
        ),
      ).toBe('198.51.100.44');
    });

    it('falls back to cf-connecting-ip on a verified edge request without the client IP header', () => {
      expect(
        resolveTrustedRequestIp(
          requestWithIp('172.70.207.202', '172.70.207.202', {
            [EDGE_PROXY_SECRET_HEADER]: ' edge-secret-value ',
            'cf-connecting-ip': '198.51.100.99',
          }),
        ),
      ).toBe('198.51.100.99');
    });

    it('ignores forwarded client IPs from a Cloudflare peer without the edge secret', () => {
      // e.g. somebody else's Worker calling the public run.app origin directly
      expect(
        resolveTrustedRequestIp(
          requestWithIp('172.70.207.202', '172.70.207.202', {
            [EDGE_CLIENT_IP_HEADER]: '198.51.100.44',
            'cf-connecting-ip': '198.51.100.45',
          }),
        ),
      ).toBe('172.70.207.202');
    });

    it('ignores forwarded client IPs when the edge secret does not match', () => {
      expect(
        resolveTrustedRequestIp(
          requestWithIp('203.0.113.99', '203.0.113.99', {
            [EDGE_PROXY_SECRET_HEADER]: 'edge-secret-valuX',
            [EDGE_CLIENT_IP_HEADER]: '198.51.100.44',
          }),
        ),
      ).toBe('203.0.113.99');
    });

    it('rejects a malformed edge client IP and falls back to the peer', () => {
      expect(
        resolveTrustedRequestIp(
          requestWithIp('172.70.207.202', '172.70.207.202', {
            [EDGE_PROXY_SECRET_HEADER]: 'edge-secret-value',
            [EDGE_CLIENT_IP_HEADER]: '198.51.100.44, 10.0.0.1',
          }),
        ),
      ).toBe('172.70.207.202');
    });

    it('accepts every secret of a comma-separated list during a rotation', () => {
      process.env[EDGE_PROXY_SHARED_SECRET_ENV] = ' old-edge-secret , new-edge-secret ,';
      const viaEdge = (secret: string) =>
        resolveTrustedRequestIp(
          requestWithIp('172.70.207.202', '172.70.207.202', {
            [EDGE_PROXY_SECRET_HEADER]: secret,
            [EDGE_CLIENT_IP_HEADER]: '198.51.100.44',
          }),
        );

      expect(viaEdge('old-edge-secret')).toBe('198.51.100.44');
      expect(viaEdge('new-edge-secret')).toBe('198.51.100.44');
      // The list itself, an empty entry or a partial value is not a secret.
      expect(viaEdge('old-edge-secret,new-edge-secret')).toBe('172.70.207.202');
      expect(viaEdge(',')).toBe('172.70.207.202');
      expect(viaEdge('new-edge')).toBe('172.70.207.202');
    });

    it('treats a list of only separators as no secret configured', () => {
      process.env[EDGE_PROXY_SHARED_SECRET_ENV] = ' , ';

      expect(
        resolveTrustedRequestIp(
          requestWithIp('172.70.207.202', '172.70.207.202', {
            [EDGE_CLIENT_IP_HEADER]: '198.51.100.44',
            'cf-connecting-ip': '198.51.100.45',
          }),
        ),
      ).toBe('198.51.100.45');
    });
  });

  it('ignores forwarded IP headers unless the normalized peer is Cloudflare', () => {
    expect(
      resolveTrustedRequestIp(
        requestWithIp('203.0.113.99', '203.0.113.99', {
          'x-forwarded-for': '198.51.100.45, 203.0.113.99',
        }),
      ),
    ).toBe('203.0.113.99');
  });

  it('trusts Cloudflare IPv6 proxy peers', () => {
    expect(
      resolveTrustedRequestIp(
        requestWithIp('2606:4700:10::6816:1', '2606:4700:10::6816:1', {
          'cf-connecting-ip': '2001:db8::44',
        }),
      ),
    ).toBe('2001:db8::44');
  });
});

describe('checkEdgeProxySecretAtStartup (x3 ops guard)', () => {
  function reporter() {
    return { critical: vi.fn(), captureMessage: vi.fn() };
  }

  it.each<[string, NodeJS.ProcessEnv]>([
    ['NODE_ENV', { NODE_ENV: 'production' }],
    ['GRABIT_ENV', { NODE_ENV: 'test', GRABIT_ENV: 'production' }],
  ])('logs CRITICAL and reports to Sentry when production (%s) has no edge secret', (_label, env) => {
    const report = reporter();

    expect(checkEdgeProxySecretAtStartup({ ...env, [EDGE_PROXY_SHARED_SECRET_ENV]: ' , ' }, report))
      .toBe('missing');

    expect(report.critical).toHaveBeenCalledWith(EDGE_PROXY_SECRET_MISSING_MESSAGE);
    expect(report.captureMessage).toHaveBeenCalledWith(EDGE_PROXY_SECRET_MISSING_MESSAGE);
    expect(EDGE_PROXY_SECRET_MISSING_MESSAGE).toMatch(/^CRITICAL: /);
  });

  it('refuses to start only when EDGE_PROXY_SHARED_SECRET_REQUIRED=true', () => {
    const report = reporter();

    expect(() => checkEdgeProxySecretAtStartup({
      NODE_ENV: 'production',
      EDGE_PROXY_SHARED_SECRET_REQUIRED: 'true',
    }, report)).toThrow(/EDGE_PROXY_SHARED_SECRET_REQUIRED=true, aborting startup/);
    expect(report.captureMessage).toHaveBeenCalledTimes(1);

    expect(checkEdgeProxySecretAtStartup({
      NODE_ENV: 'production',
      EDGE_PROXY_SHARED_SECRET_REQUIRED: 'false',
    }, reporter())).toBe('missing');
  });

  it('stays quiet with a secret or outside production', () => {
    const report = reporter();

    expect(checkEdgeProxySecretAtStartup({
      NODE_ENV: 'production',
      [EDGE_PROXY_SHARED_SECRET_ENV]: 'edge-secret-value',
      EDGE_PROXY_SHARED_SECRET_REQUIRED: 'true',
    }, report)).toBe('configured');
    expect(checkEdgeProxySecretAtStartup({ NODE_ENV: 'development' }, report)).toBe('not_production');
    expect(report.critical).not.toHaveBeenCalled();
    expect(report.captureMessage).not.toHaveBeenCalled();
  });
});

describe('Cloudflare address resolved as the client IP (x3 ops guard)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  // Later than the real clock (earlier tests warn with it) and an hour apart
  // per test, so the once-per-minute state never mutes the next test.
  let baseTimeMs = Date.UTC(2100, 0, 1);

  beforeEach(() => {
    delete process.env[EDGE_PROXY_SHARED_SECRET_ENV];
    vi.useFakeTimers({ toFake: ['Date'] });
    baseTimeMs += 3_600_000;
    vi.setSystemTime(baseTimeMs);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  // A Grabit edge Worker subrequest without the secret: cf-connecting-ip is
  // the Worker's own egress address in 2a06:98c0::/29, the same for everyone.
  const workerSubrequest = () =>
    requestWithIp('2a06:98c0:3600::103', '2a06:98c0:3600::103', {
      'cf-connecting-ip': '2a06:98c0:3600::103',
    });

  it('warns at most once per minute while every visitor resolves to a Worker egress address', () => {
    for (let i = 0; i < 5; i++) {
      expect(resolveTrustedRequestIp(workerSubrequest())).toBe('2a06:98c0:3600::103');
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('2a06:98c0:3600::103');
    expect(String(warn.mock.calls[0]?.[0])).toContain('EDGE_PROXY_SHARED_SECRET');

    vi.setSystemTime(baseTimeMs + CLOUDFLARE_CLIENT_IP_WARNING_INTERVAL_MS - 1);
    resolveTrustedRequestIp(workerSubrequest());
    expect(warn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(baseTimeMs + CLOUDFLARE_CLIENT_IP_WARNING_INTERVAL_MS);
    resolveTrustedRequestIp(workerSubrequest());
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('also warns when a Cloudflare peer itself becomes the client IP', () => {
    process.env[EDGE_PROXY_SHARED_SECRET_ENV] = 'edge-secret-value';
    try {
      // The Worker stopped sending the secret: the peer is used.
      expect(resolveTrustedRequestIp(requestWithIp('172.70.207.202', '172.70.207.202', {
        [EDGE_CLIENT_IP_HEADER]: '198.51.100.44',
      }))).toBe('172.70.207.202');
    } finally {
      delete process.env[EDGE_PROXY_SHARED_SECRET_ENV];
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn for visitor addresses', () => {
    resolveTrustedRequestIp(requestWithIp('172.70.207.202', '172.70.207.202', {
      'cf-connecting-ip': '198.51.100.44',
    }));
    resolveTrustedRequestIp(requestWithIp('2001:db8::44', '2001:db8::44'));

    expect(warn).not.toHaveBeenCalled();
  });
});
