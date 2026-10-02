import { toast } from 'sonner';
import { buildAuthRoute, resolveSafeReturnTo, resolveSafeReturnToFromSearch } from './auth-return';
import { getClientLocale } from './i18n/client-copy';
import { navigateToLocalizedPath } from './i18n/locale-navigation';
import { apiUrl } from '@/lib/api-url';
import { useAuthStore } from '@/stores/use-auth-store';
import {
  getDefaultErrorMessage,
  getStatusMessages,
} from './error-messages';
import { formatCopy, getClientVisibleCopy } from './i18n/client-copy';

interface ApiError {
  message: string;
  statusCode: number;
}

interface ApiClientOptions {
  showErrorToast?: boolean;
}

type ApiPath = `/${string}`;

class ApiClientError extends Error {
  statusCode: number;
  data: unknown;

  constructor(message: string, statusCode: number, data?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

/**
 * Result of renewing the access token from the httpOnly refresh cookie.
 * - refreshed: a new access token was issued.
 * - signed_out: the server rejected or did not receive a refresh session (401/403/204).
 * - unavailable: the server could not answer (5xx, 429, network error, timeout); the
 *   session may still be valid, so callers must not clear it.
 */
export type RefreshOutcome =
  | { status: 'refreshed'; accessToken: string }
  | { status: 'signed_out' }
  | { status: 'unavailable' };

type RefreshAttempt = RefreshOutcome | { status: 'rejected' };

const REFRESH_LOCK_NAME = 'grabit-auth-refresh';
const REFRESH_LOCK_WAIT_MS = 20_000;
const REFRESH_REQUEST_TIMEOUT_MS = 10_000;
const REJECTED_REFRESH_RECHECK_DELAY_MS = 300;
export const DEFAULT_REFRESH_RETRY_DELAYS_MS: readonly number[] = [500, 1_500];

let refreshPromise: Promise<RefreshOutcome> | null = null;

/**
 * Renews the access token. Concurrent callers in this tab share one request, and
 * tabs take turns through a Web Lock so a single refresh cookie is rotated by one
 * tab at a time (the API also tolerates a concurrent replay of a just-rotated
 * token). Transient failures are retried with backoff before reporting
 * `unavailable`.
 */
export function refreshAccessToken(
  options: { retryDelaysMs?: readonly number[] } = {},
): Promise<RefreshOutcome> {
  // Deduplicate concurrent refresh requests
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshWithRetries(options.retryDelaysMs ?? DEFAULT_REFRESH_RETRY_DELAYS_MS)
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function refreshWithRetries(retryDelaysMs: readonly number[]): Promise<RefreshOutcome> {
  let attempt = await withCrossTabRefreshLock(requestRefresh);

  if (attempt.status === 'rejected') {
    // Another tab may have rotated the shared cookie while this request was in
    // flight; give the cookie jar a moment and check once more before signing out.
    await sleep(REJECTED_REFRESH_RECHECK_DELAY_MS);
    attempt = await withCrossTabRefreshLock(requestRefresh);
    if (attempt.status === 'rejected') return { status: 'signed_out' };
  }

  for (const delayMs of retryDelaysMs) {
    if (attempt.status !== 'unavailable') break;
    await sleep(withJitter(delayMs));
    attempt = await withCrossTabRefreshLock(requestRefresh);
  }

  return attempt.status === 'rejected' ? { status: 'signed_out' } : attempt;
}

async function requestRefresh(): Promise<RefreshAttempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REFRESH_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    // 204: no refresh cookie was sent, so there is no session to keep.
    if (res.status === 204) return { status: 'signed_out' };
    if (res.status === 401 || res.status === 403) return { status: 'rejected' };
    if (!res.ok) return { status: 'unavailable' };

    const data = (await res.json()) as { accessToken?: unknown };
    return typeof data.accessToken === 'string' && data.accessToken.length > 0
      ? { status: 'refreshed', accessToken: data.accessToken }
      : { status: 'unavailable' };
  } catch {
    // Network failure, aborted (timeout) or unreadable body: the session is unknown.
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

async function withCrossTabRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks || typeof locks.request !== 'function') return task();

  const controller = new AbortController();
  const lockWait = setTimeout(() => controller.abort(), REFRESH_LOCK_WAIT_MS);
  let acquired = false;
  try {
    return await locks.request(REFRESH_LOCK_NAME, { signal: controller.signal }, async () => {
      acquired = true;
      clearTimeout(lockWait);
      return task();
    });
  } catch (error) {
    // The lock could not be obtained (wait timed out or unsupported options). The
    // API keeps a concurrent rotation safe, so refreshing without the lock is fine.
    if (!acquired) return task();
    throw error;
  } finally {
    clearTimeout(lockWait);
  }
}

function withJitter(delayMs: number): number {
  return Math.round(delayMs * (0.8 + Math.random() * 0.4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redirectToLogin() {
  useAuthStore.getState().clearAuth();
  if (typeof window !== 'undefined') {
    const returnTo = resolveSafeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      ?? resolveSafeReturnToFromSearch(window.location.search);
    navigateToLocalizedPath(buildAuthRoute('/auth', getClientLocale(), { returnTo }));
  }
}

/**
 * Sends an API request with the in-memory access token. On 401 it renews the token
 * once and retries. Only a rejected refresh session signs the buyer out; when the
 * API is temporarily unavailable the session and in-memory booking state are kept
 * and a retryable 503 ApiClientError is thrown instead.
 */
async function sendWithSession(
  method: string,
  path: ApiPath,
  init: { body?: BodyInit; headers?: Record<string, string> },
  options: ApiClientOptions,
): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  const headers: Record<string, string> = { ...(init.headers ?? {}) };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const config: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };

  if (init.body !== undefined) {
    config.body = init.body;
  }

  const res = await fetch(apiUrl(path), config);

  // On 401, attempt silent refresh and retry once
  if (res.status !== 401 || !accessToken) {
    return res;
  }

  const refresh = await refreshAccessToken();

  if (refresh.status === 'refreshed') {
    // Update store with new token
    const { user } = useAuthStore.getState();
    if (user) {
      useAuthStore.getState().setAuth(refresh.accessToken, user);
    }

    // Retry with new token
    return fetch(apiUrl(path), {
      ...config,
      headers: { ...headers, Authorization: `Bearer ${refresh.accessToken}` },
    });
  }

  if (refresh.status === 'signed_out') {
    // Refresh session is gone -- clear auth and send the buyer to login.
    redirectToLogin();
    throw new ApiClientError(getClientVisibleCopy().commonErrors.authExpired, 401);
  }

  // Temporary outage: keep the session and the current screen; let the caller retry.
  const commonErrors = getClientVisibleCopy().commonErrors;
  if (options.showErrorToast !== false) {
    toast.error(commonErrors.default, {
      description: formatCopy(commonErrors.errorCode, { status: 503 }),
      duration: 5000,
    });
  }
  throw new ApiClientError(commonErrors.default, 503);
}

async function request<T>(
  method: string,
  path: ApiPath,
  body?: unknown,
  options: ApiClientOptions = {},
): Promise<T> {
  const res = await sendWithSession(
    method,
    path,
    {
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    options,
  );

  if (!res.ok) {
    const status = res.status;
    const commonErrors = getClientVisibleCopy().commonErrors;
    let errorMessage = getStatusMessages()[status] ?? getDefaultErrorMessage();
    let errorData: unknown;
    try {
      errorData = await res.json();
      if (
        errorData &&
        typeof errorData === 'object' &&
        'message' in errorData &&
        typeof (errorData as ApiError).message === 'string' &&
        (errorData as ApiError).message.trim().length > 0
      ) {
        errorMessage = (errorData as ApiError).message;
      }
    } catch {
      // Use default message
    }

    // 401 is handled above (redirect). No toast needed here.
    if (status !== 401 && options.showErrorToast !== false) {
      toast.error(getClientLocale() === 'ko' ? errorMessage : getStatusMessages()[status] ?? getDefaultErrorMessage(), {
        description: formatCopy(commonErrors.errorCode, { status }),
        duration: 5000,
      });
    }

    throw new ApiClientError(errorMessage, status, errorData);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

/**
 * Authenticated request for non-JSON responses such as CSV downloads. It shares the
 * 401 → refresh → retry handling of JSON requests and returns the raw Response so
 * the caller can read a Blob and its own error body.
 */
function requestRaw(
  method: string,
  path: ApiPath,
  body?: unknown,
  options: ApiClientOptions = {},
): Promise<Response> {
  return sendWithSession(
    method,
    path,
    body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    options,
  );
}

export const apiClient = {
  get: <T>(path: ApiPath, options?: ApiClientOptions) =>
    request<T>('GET', path, undefined, options),
  post: <T>(path: ApiPath, body?: unknown, options?: ApiClientOptions) =>
    request<T>('POST', path, body, options),
  put: <T>(path: ApiPath, body?: unknown, options?: ApiClientOptions) =>
    request<T>('PUT', path, body, options),
  patch: <T>(path: ApiPath, body?: unknown, options?: ApiClientOptions) =>
    request<T>('PATCH', path, body, options),
  delete: <T>(path: ApiPath, options?: ApiClientOptions) =>
    request<T>('DELETE', path, undefined, options),
  raw: (method: 'GET' | 'POST', path: ApiPath, body?: unknown, options?: ApiClientOptions) =>
    requestRaw(method, path, body, options),
};

export { ApiClientError };
