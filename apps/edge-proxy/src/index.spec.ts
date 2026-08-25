import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
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
