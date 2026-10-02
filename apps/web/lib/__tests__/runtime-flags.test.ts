import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeFlagsUnavailableError,
  buildRuntimeFlagsPayload,
  fetchRuntimeFlags,
  parseRetryAfterMs,
} from '@/lib/runtime-flags';
import {
  getServerClockOffsetMs,
  resetServerClockForTests,
} from '@/lib/server-clock';
import { GET } from '@/app/api/runtime-flags/route';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

describe('fetchRuntimeFlags', () => {
  beforeEach(() => {
    resetServerClockForTests();
  });

  afterEach(() => {
    resetServerClockForTests();
    vi.useRealTimers();
  });

  it.each([429, 503])(
    'throws on HTTP %i instead of resolving to booking disabled',
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(
        jsonResponse({ message: 'busy' }, { status }),
      );

      await expect(fetchRuntimeFlags(fetcher)).rejects.toBeInstanceOf(
        RuntimeFlagsUnavailableError,
      );
    },
  );

  it('carries the server Retry-After so retries can honour it', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ message: 'busy' }, { status: 429, headers: { 'Retry-After': '12' } }),
    );

    const error = await fetchRuntimeFlags(fetcher).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RuntimeFlagsUnavailableError);
    expect((error as RuntimeFlagsUnavailableError).retryAfterMs).toBe(12_000);
  });

  it('propagates network failures so the query can retry', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchRuntimeFlags(fetcher)).rejects.toThrow('Failed to fetch');
  });

  it('throws on a non-JSON body (for example an edge error page)', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('<html>502</html>', { status: 200 }),
    );

    await expect(fetchRuntimeFlags(fetcher)).rejects.toBeInstanceOf(
      RuntimeFlagsUnavailableError,
    );
  });

  it('returns the real flag value', async () => {
    const enabled = vi.fn().mockResolvedValue(jsonResponse({ bookingEnabled: true }));
    const disabled = vi.fn().mockResolvedValue(jsonResponse({ bookingEnabled: false }));

    await expect(fetchRuntimeFlags(enabled)).resolves.toEqual({ bookingEnabled: true });
    await expect(fetchRuntimeFlags(disabled)).resolves.toEqual({ bookingEnabled: false });
  });

  it('records the server clock offset from serverNow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-02T10:58:30.000Z'));
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        bookingEnabled: true,
        serverNow: Date.parse('2026-10-02T11:00:00.000Z'),
      }),
    );

    await fetchRuntimeFlags(fetcher);

    expect(getServerClockOffsetMs()).toBe(90_000);
  });

  it('does not take the clock offset from a cached response', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        { bookingEnabled: true, serverNow: Date.now() - 600_000 },
        { headers: { Age: '600' } },
      ),
    );

    await expect(fetchRuntimeFlags(fetcher)).resolves.toEqual({ bookingEnabled: true });
    expect(getServerClockOffsetMs()).toBe(0);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads delta seconds and HTTP dates and ignores anything else', () => {
    const now = Date.parse('2026-10-02T11:00:00.000Z');

    expect(parseRetryAfterMs('30', now)).toBe(30_000);
    expect(parseRetryAfterMs('Fri, 02 Oct 2026 11:00:45 GMT', now)).toBe(45_000);
    expect(parseRetryAfterMs('Fri, 02 Oct 2026 10:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfterMs('soon', now)).toBeNull();
    expect(parseRetryAfterMs(null, now)).toBeNull();
  });
});

describe('/api/runtime-flags', () => {
  it('includes the server clock in the payload', () => {
    expect(
      buildRuntimeFlagsPayload({ BOOKING_ENABLED: 'false' }, 1_790_000_000_000),
    ).toEqual({ bookingEnabled: false, serverNow: 1_790_000_000_000 });
  });

  it('responds with serverNow and forbids caching', async () => {
    const before = Date.now();
    const response = GET();
    const body = (await response.json()) as { bookingEnabled: boolean; serverNow: number };

    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(typeof body.bookingEnabled).toBe('boolean');
    expect(body.serverNow).toBeGreaterThanOrEqual(before);
    expect(body.serverNow).toBeLessThanOrEqual(Date.now());
  });
});
