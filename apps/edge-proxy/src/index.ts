const WEB_HOSTS = new Set(['heygrabit.com', 'www.heygrabit.com']);
const API_HOST = 'api.heygrabit.com';
const LOCAL_STAGING_HOSTS = new Set(['localhost', '127.0.0.1']);
// The API trusts EDGE_CLIENT_IP_HEADER only when EDGE_SECRET_HEADER matches its
// EDGE_PROXY_SHARED_SECRET (apps/api/src/common/request-ip.ts).
export const EDGE_SECRET_HEADER = 'x-grabit-edge-secret';
export const EDGE_CLIENT_IP_HEADER = 'x-grabit-client-ip';

function isApiPath(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/socket.io' ||
    pathname.startsWith('/socket.io/')
  );
}

export function resolveOrigin(
  hostname: string,
  pathname: string,
  env: Env,
): string | null {
  const normalizedHostname = hostname.toLowerCase();
  if (WEB_HOSTS.has(normalizedHostname)) {
    return env.WEB_ORIGIN;
  }
  if (normalizedHostname === API_HOST) {
    return env.API_ORIGIN;
  }
  if (
    env.ALLOW_STAGING_HOSTS === 'true' &&
    (
      LOCAL_STAGING_HOSTS.has(normalizedHostname) ||
      normalizedHostname.endsWith('.workers.dev')
    )
  ) {
    return isApiPath(pathname) ? env.API_ORIGIN : env.WEB_ORIGIN;
  }
  return null;
}

export function buildOriginRequest(
  request: Request,
  origin: string,
  edgeSecret?: string,
): Request {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(origin);
  targetUrl.pathname = incomingUrl.pathname;
  targetUrl.search = incomingUrl.search;

  const originRequest = new Request(targetUrl, request);
  originRequest.headers.delete('host');
  originRequest.headers.set('x-forwarded-host', incomingUrl.host);
  originRequest.headers.set('x-forwarded-proto', 'https');
  originRequest.headers.set('x-forwarded-port', '443');

  // Never relay a visitor-supplied value for the edge identity headers.
  originRequest.headers.delete(EDGE_SECRET_HEADER);
  originRequest.headers.delete(EDGE_CLIENT_IP_HEADER);
  const secret = edgeSecret?.trim();
  if (secret) {
    originRequest.headers.set(EDGE_SECRET_HEADER, secret);
    // Cloudflare sets cf-connecting-ip on the inbound request to the visitor IP.
    const clientIp = request.headers.get('cf-connecting-ip')?.trim();
    if (clientIp) {
      originRequest.headers.set(EDGE_CLIENT_IP_HEADER, clientIp);
    }
  }
  return originRequest;
}

export function rewriteOriginRedirect(
  response: Response,
  origin: string,
  publicOrigin: string,
): Response {
  const location = response.headers.get('location');
  if (!location) {
    return response;
  }

  const originUrl = new URL(origin);
  const redirectUrl = new URL(location, originUrl);
  if (redirectUrl.origin !== originUrl.origin) {
    return response;
  }

  const publicUrl = new URL(publicOrigin);
  redirectUrl.protocol = publicUrl.protocol;
  redirectUrl.host = publicUrl.host;

  const headers = new Headers(response.headers);
  headers.set('location', redirectUrl.toString());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function proxy(request: Request, env: Env): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const origin = resolveOrigin(incomingUrl.hostname, incomingUrl.pathname, env);
  if (!origin) {
    return new Response('Unsupported host', {
      status: 421,
      headers: { 'cache-control': 'no-store' },
    });
  }

  // Only the API consumes the edge identity headers; keep the secret off the Web origin.
  const edgeSecret = origin === env.API_ORIGIN ? env.EDGE_PROXY_SHARED_SECRET : undefined;
  const response = await fetch(buildOriginRequest(request, origin, edgeSecret));
  return rewriteOriginRedirect(response, origin, incomingUrl.origin);
}

export default {
  fetch(request, env) {
    return proxy(request, env);
  },
} satisfies ExportedHandler<Env>;
