import 'reflect-metadata';
import { Agent } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { BookingController } from '../booking.controller.js';
import { BookingService } from '../booking.service.js';
import {
  resolveSeatStatusThrottleTracker,
  SEAT_STATUS_THROTTLE_LIMIT,
} from '../seat-status-throttle.js';
import { AdmissionGuard } from '../../queue/guards/admission.guard.js';
import {
  EDGE_CLIENT_IP_HEADER,
  EDGE_PROXY_SECRET_HEADER,
  EDGE_PROXY_SHARED_SECRET_ENV,
} from '../../../common/request-ip.js';

const SHOWTIME_ID = '550e8400-e29b-41d4-a716-446655440000';
const SEATS_PATH = `/booking/schedules/${SHOWTIME_ID}/seats`;
const JWT_SECRET = 'seat-status-throttle-test-secret';

function signAccessToken(sub: string, secret = JWT_SECRET): string {
  return new JwtService().sign({ sub, role: 'user' }, { secret, expiresIn: '15m' });
}

/**
 * Audit #8: the public seat status endpoint used to be @SkipThrottle() with
 * an unvalidated path parameter. It now has its own budget per account (or per
 * IP without a valid access token) and only accepts UUIDs.
 */
describe('GET /booking/schedules/:showtimeId/seats', () => {
  let app: INestApplication;
  let agent: Agent;
  const bookingService = {
    getSeatStatus: vi.fn(async (showtimeId: string) => ({ showtimeId, seats: {} })),
  };

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    bookingService.getSeatStatus.mockClear();
    Reflect.defineMetadata('design:paramtypes', [BookingService], BookingController);
    const module = await Test.createTestingModule({
      imports: [
        // Mirrors the global default throttler in app.module.ts.
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] }),
      ],
      controllers: [BookingController],
      providers: [
        { provide: BookingService, useValue: bookingService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    })
      .overrideGuard(AdmissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
    // One listening server and one keep-alive socket for the whole test. Without
    // it supertest listens on and closes a new ephemeral port per request, and a
    // pooled keep-alive socket from a closed server intermittently fails the
    // ~180 requests here with "socket hang up".
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterEach(async () => {
    // Unset when beforeEach failed before creating it.
    (agent as Agent | undefined)?.destroy();
    await app?.close();
    vi.unstubAllEnvs();
  });

  async function readSeats(headers: Record<string, string> = {}, times = 1): Promise<number[]> {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) {
      const response = await request(app.getHttpServer()).get(SEATS_PATH).agent(agent).set(headers);
      statuses.push(response.status);
    }
    return statuses;
  }

  it('rejects non-UUID showtime IDs before touching Valkey or the database', async () => {
    const response = await request(app.getHttpServer())
      .get('/booking/schedules/not-a-uuid/seats')
      .agent(agent);

    expect(response.status).toBe(400);
    expect(bookingService.getSeatStatus).not.toHaveBeenCalled();
  });

  it('limits one client to the seat status budget inside the window', async () => {
    const statuses = await readSeats({}, SEAT_STATUS_THROTTLE_LIMIT + 1);

    expect(statuses.slice(0, SEAT_STATUS_THROTTLE_LIMIT).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(bookingService.getSeatStatus).toHaveBeenCalledTimes(SEAT_STATUS_THROTTLE_LIMIT);
    expect(bookingService.getSeatStatus).toHaveBeenCalledWith(SHOWTIME_ID);
  });

  it('gives each signed-in buyer behind one address its own budget', async () => {
    const buyerA = { Authorization: `Bearer ${signAccessToken('buyer-a')}` };
    const buyerB = { Authorization: `Bearer ${signAccessToken('buyer-b')}` };

    expect((await readSeats(buyerA, SEAT_STATUS_THROTTLE_LIMIT + 1)).at(-1)).toBe(429);
    expect(await readSeats(buyerB)).toEqual([200]);
    expect(await readSeats({})).toEqual([200]);
  });

  it('counts rotating IPv6 addresses of one /64 in one bucket (audit #5)', async () => {
    vi.stubEnv(EDGE_PROXY_SHARED_SECRET_ENV, 'edge-secret');
    const fromEdge = (clientIp: string) => ({
      [EDGE_PROXY_SECRET_HEADER]: 'edge-secret',
      [EDGE_CLIENT_IP_HEADER]: clientIp,
    });
    const statuses: number[] = [];
    for (let i = 0; i <= SEAT_STATUS_THROTTLE_LIMIT; i++) {
      // A new interface identifier on every request, same subscriber prefix.
      statuses.push(...(await readSeats(fromEdge(`2001:db8:1:2::${(i + 1).toString(16)}`))));
    }

    expect(statuses.slice(0, SEAT_STATUS_THROTTLE_LIMIT).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Another /64 (another subscriber) keeps its own budget.
    expect(await readSeats(fromEdge('2001:db8:1:3::1'))).toEqual([200]);
  });

  it('does not let forged tokens open new buckets', async () => {
    const forged = (i: number) => ({ Authorization: `Bearer ${signAccessToken(`bot-${i}`, 'wrong-secret')}` });
    const statuses: number[] = [];
    for (let i = 0; i <= SEAT_STATUS_THROTTLE_LIMIT; i++) {
      statuses.push(...(await readSeats(forged(i))));
    }

    expect(statuses.at(-1)).toBe(429);
  });
});

describe('resolveSeatStatusThrottleTracker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createRequest(headers: Record<string, string> = {}) {
    return { headers, ip: '203.0.113.7', socket: { remoteAddress: '203.0.113.7' } };
  }

  it('uses the verified access-token subject, never a cookie', () => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET);

    expect(resolveSeatStatusThrottleTracker(createRequest({
      authorization: `Bearer ${signAccessToken('buyer-a')}`,
      cookie: 'refreshToken=random-1',
    }))).toBe('seat-status:user:buyer-a');
    expect(resolveSeatStatusThrottleTracker(createRequest({ cookie: 'refreshToken=random-2' })))
      .toBe('seat-status:ip:203.0.113.7');
  });

  it('groups anonymous IPv6 clients by /64 and keeps IPv4 clients per address', () => {
    function requestFrom(ip: string) {
      return { headers: {}, ip, socket: { remoteAddress: ip } };
    }

    const first = resolveSeatStatusThrottleTracker(requestFrom('2001:db8:1:2::a'));
    expect(resolveSeatStatusThrottleTracker(requestFrom('2001:db8:1:2:ffff:1:2:3'))).toBe(first);
    expect(resolveSeatStatusThrottleTracker(requestFrom('2001:db8:1:3::a'))).not.toBe(first);
    expect(first.startsWith('seat-status:ip:')).toBe(true);
    expect(resolveSeatStatusThrottleTracker(requestFrom('203.0.113.8')))
      .toBe('seat-status:ip:203.0.113.8');
  });

  it('falls back to the client IP for expired, forged or unverifiable tokens', () => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    const expired = new JwtService().sign(
      { sub: 'buyer-a', exp: Math.floor(Date.now() / 1000) - 60 },
      { secret: JWT_SECRET },
    );

    for (const authorization of [
      `Bearer ${expired}`,
      `Bearer ${signAccessToken('buyer-a', 'wrong-secret')}`,
      'Bearer not-a-jwt',
      'Basic abc',
    ]) {
      expect(resolveSeatStatusThrottleTracker(createRequest({ authorization })))
        .toBe('seat-status:ip:203.0.113.7');
    }

    vi.stubEnv('JWT_SECRET', '');
    expect(resolveSeatStatusThrottleTracker(createRequest({
      authorization: `Bearer ${signAccessToken('buyer-a')}`,
    }))).toBe('seat-status:ip:203.0.113.7');
  });
});
