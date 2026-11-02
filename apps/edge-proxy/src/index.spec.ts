import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
  EDGE_CLIENT_IP_HEADER,
  EDGE_SECRET_HEADER,
  buildOriginRequest,
  resolveOrigin,
  rewriteOriginRedirect,
} from './index.js';

const env = {
  WEB_ORIGIN: 'https://grabit-web-d3c6wrfdbq-du.a.run.app',
  API_ORIGIN: 'https://grabit-api-d3c6wrfdbq-du.a.run.app',
  ALLOW_STAGING_HOSTS: 'true',
} satisfies Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('origin routing', () => {
  it('does not pin API requests to a socket instance or replace its affinity cookie', async () => {
    const authCookie = 'refreshToken=test-value==; Path=/; HttpOnly; Secure; SameSite=None';
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'GAESA=origin-affinity; Path=/; Secure; HttpOnly');
    headers.append('set-cookie', authCookie);
    headers.append('set-cookie', 'consent=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/');
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      expect(request.headers.get('cookie')).toBe('refreshToken=old-value==; GAESA_backup=keep');
      expect(request.headers.get('authorization')).toBe('Bearer test-access');
      expect(await request.text()).toBe('{"orderId":"test-order"}');
      return new Response('{"ok":true}', { status: 201, headers });
    }));
    const response = await worker.fetch(new Request('https://api.heygrabit.com/api/v1/payments/confirm', {
      method: 'POST', headers: { cookie: 'GAESA=socket-affinity; refreshToken=old-value==; GAESA_backup=keep', authorization: 'Bearer test-access' },
      body: '{"orderId":"test-order"}',
    }), env);
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual([authCookie, 'consent=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/']);
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each(['/socket.io?EIO=4&transport=websocket', '/socket.io/?EIO=4&transport=polling'])
    ('preserves socket affinity and the original response for %s', async (path) => {
      const upstream = new Response('socket', { headers: { 'set-cookie': 'GAESA=socket-affinity; Path=/; Secure' } });
      vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
        expect(request.headers.get('cookie')).toBe('GAESA=socket-affinity; socketAccessToken=test');
        return upstream;
      }));
      const response = await worker.fetch(new Request('https://api.heygrabit.com' + path, {
        headers: { cookie: 'GAESA=socket-affinity; socketAccessToken=test' },
      }), env);
      expect(response).toBe(upstream);
    });

  it('keeps web affinity and does not treat lookalike API paths as Socket.IO', async () => {
    const upstream = new Response('ok', { headers: { 'set-cookie': 'GAESA=web; Path=/' } });
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      expect(request.headers.get('cookie')).toBe(request.url.startsWith(env.WEB_ORIGIN) ? 'GAESA=web' : null);
      return upstream.clone();
    }));
    const web = await worker.fetch(new Request('https://heygrabit.com/', { headers: { cookie: 'GAESA=web' } }), env);
    expect(web.headers.getSetCookie()).toEqual(['GAESA=web; Path=/']);
    for (const path of ['/socket.io-other', '/api/v1/socket.io']) {
      const api = await worker.fetch(new Request('https://api.heygrabit.com' + path, { headers: { cookie: 'GAESA=web' } }), env);
      expect(api.headers.getSetCookie()).toEqual([]);
    }
  });

  it('maps only the three public Grabit hosts', () => {
    expect(resolveOrigin('heygrabit.com', '/', env)).toBe(env.WEB_ORIGIN);
    expect(resolveOrigin('WWW.HEYGRABIT.COM', '/', env)).toBe(env.WEB_ORIGIN);
    expect(resolveOrigin('api.heygrabit.com', '/api/v1/health', env)).toBe(
      env.API_ORIGIN,
    );
    expect(resolveOrigin('attacker.example', '/', env)).toBeNull();
  });

  it('routes workers.dev and local staging requests by path', () => {
    expect(
      resolveOrigin('grabit-origin-proxy-staging.workers.dev', '/', env),
    ).toBe(env.WEB_ORIGIN);
    expect(
      resolveOrigin(
        'grabit-origin-proxy-staging.workers.dev',
        '/api/v1/health',
        env,
      ),
    ).toBe(env.API_ORIGIN);
    expect(resolveOrigin('127.0.0.1', '/socket.io/', env)).toBe(env.API_ORIGIN);

    const productionEnv = { ...env, ALLOW_STAGING_HOSTS: 'false' } as const;
    expect(
      resolveOrigin(
        'grabit-origin-proxy-staging.workers.dev',
        '/',
        productionEnv,
      ),
    ).toBeNull();
  });

  it('preserves method, path, query, body, and overwrites forwarded host metadata', async () => {
    const incoming = new Request('https://api.heygrabit.com/api/v1/refunds?retry=1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-host': 'spoofed.example',
      },
      body: JSON.stringify({ refundId: 'refund-1' }),
    });

    const proxied = buildOriginRequest(incoming, env.API_ORIGIN);

    expect(proxied.url).toBe(
      'https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/refunds?retry=1',
    );
    expect(proxied.method).toBe('POST');
    expect(proxied.headers.get('x-forwarded-host')).toBe('api.heygrabit.com');
    expect(proxied.headers.get('x-forwarded-proto')).toBe('https');
    expect(await proxied.json()).toEqual({ refundId: 'refund-1' });
  });

  it('forwards the Cloudflare visitor IP with the shared edge secret', () => {
    const incoming = new Request('https://api.heygrabit.com/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '198.51.100.44',
        'x-grabit-client-ip': '203.0.113.250',
        'x-grabit-edge-secret': 'visitor-guess',
      },
    });

    const proxied = buildOriginRequest(incoming, env.API_ORIGIN, 'edge-secret-value');

    expect(proxied.headers.get(EDGE_SECRET_HEADER)).toBe('edge-secret-value');
    expect(proxied.headers.get(EDGE_CLIENT_IP_HEADER)).toBe('198.51.100.44');
  });

  it('strips visitor-supplied edge identity headers when no secret is provisioned', () => {
    const incoming = new Request('https://api.heygrabit.com/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '198.51.100.44',
        'x-grabit-client-ip': '203.0.113.250',
        'x-grabit-edge-secret': 'visitor-guess',
      },
    });

    const proxied = buildOriginRequest(incoming, env.API_ORIGIN);

    expect(proxied.headers.get(EDGE_SECRET_HEADER)).toBeNull();
    expect(proxied.headers.get(EDGE_CLIENT_IP_HEADER)).toBeNull();
  });

  it('attaches the edge secret from the Worker env on proxied requests', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.headers.get(EDGE_SECRET_HEADER)).toBe('edge-secret-value');
      expect(request.headers.get(EDGE_CLIENT_IP_HEADER)).toBe('198.51.100.44');
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(
      new Request('https://api.heygrabit.com/api/v1/health', {
        headers: { 'cf-connecting-ip': '198.51.100.44' },
      }),
      { ...env, EDGE_PROXY_SHARED_SECRET: 'edge-secret-value' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the edge secret off requests proxied to the Web origin', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://grabit-web-d3c6wrfdbq-du.a.run.app/');
      expect(request.headers.get(EDGE_SECRET_HEADER)).toBeNull();
      expect(request.headers.get(EDGE_CLIENT_IP_HEADER)).toBeNull();
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);

    await worker.fetch(
      new Request('https://heygrabit.com/', {
        headers: { 'cf-connecting-ip': '198.51.100.44' },
      }),
      { ...env, EDGE_PROXY_SHARED_SECRET: 'edge-secret-value' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('streams the origin response and rewrites only same-origin redirects', async () => {
    const response = new Response('redirecting', {
      status: 307,
      headers: {
        location: 'https://grabit-web-d3c6wrfdbq-du.a.run.app/auth/callback?ok=1',
      },
    });

    const rewritten = rewriteOriginRedirect(
      response,
      env.WEB_ORIGIN,
      'https://heygrabit.com',
    );

    expect(rewritten.headers.get('location')).toBe(
      'https://heygrabit.com/auth/callback?ok=1',
    );
    expect(await rewritten.text()).toBe('redirecting');
  });

  it('passes a request to fetch without buffering its payload', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        'https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/health',
      );
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://api.heygrabit.com/api/v1/health'),
      env,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe('ok');
  });

  it('rejects unknown hosts instead of becoming an open proxy', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://attacker.example/api/v1/health'),
      env,
    );

    expect(response.status).toBe(421);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
