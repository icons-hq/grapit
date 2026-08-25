const WEB_HOSTS = new Set(['heygrabit.com', 'www.heygrabit.com']);
const API_HOST = 'api.heygrabit.com';

export function resolveOrigin(hostname: string, env: Env): string | null {
  const normalizedHostname = hostname.toLowerCase();
  if (WEB_HOSTS.has(normalizedHostname)) {
    return env.WEB_ORIGIN;
  }
  if (normalizedHostname === API_HOST) {
    return env.API_ORIGIN;
  }
  return null;
}

export function buildOriginRequest(request: Request, origin: string): Request {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(origin);
  targetUrl.pathname = incomingUrl.pathname;
  targetUrl.search = incomingUrl.search;

  const originRequest = new Request(targetUrl, request);
  originRequest.headers.delete('host');
  originRequest.headers.set('x-forwarded-host', incomingUrl.host);
  originRequest.headers.set('x-forwarded-proto', 'https');
  originRequest.headers.set('x-forwarded-port', '443');
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
  const origin = resolveOrigin(incomingUrl.hostname, env);
  if (!origin) {
    return new Response('Unsupported host', {
      status: 421,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const response = await fetch(buildOriginRequest(request, origin));
  return rewriteOriginRedirect(response, origin, incomingUrl.origin);
}

export default {
  fetch(request, env) {
    return proxy(request, env);
  },
} satisfies ExportedHandler<Env>;
