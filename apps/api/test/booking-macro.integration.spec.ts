import 'reflect-metadata';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import type { Request, Response } from 'express';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { BookingMacroService } from '../src/modules/traffic/booking-macro.service.js';
import { TrafficDefenseService } from '../src/modules/traffic/traffic-defense.service.js';

let container: StartedTestContainer;
let redis: Redis;
let service: BookingMacroService;
const show = 'ticketing-fixture';
const user = (id: string) => ({
  user: { id }, cookies: {} as Record<string, string>,
  queueAdmission: { queueSessionId: 'queue-' + id, refreshFamilyId: 'family-' + id, activeUntilAt: new Date(Date.now() + 120000).toISOString() },
});
function client(id: string) {
  const buyer = user(id);
  const req = buyer as unknown as Request & typeof buyer;
  const res = { cookie: (name: string, value: string) => { req.cookies[name] = value; } } as Response;
  return { req, res };
}
beforeAll(async () => {
  container = await new GenericContainer('valkey/valkey:8').withExposedPorts(6379).start();
  redis = new Redis(container.getMappedPort(6379), container.getHost());
  vi.stubEnv('BOOKING_TURNSTILE_CONFIG', JSON.stringify({ secret: 'fixture-only', sitekey: 'public-test-key' }));
  service = new BookingMacroService(redis, new TrafficDefenseService());
}, 120000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { vi.unstubAllEnvs(); await redis?.quit(); await container?.stop(); });

it('keeps a normal buyer and same-seat retries independent of everyone sharing their network', async () => {
  const a = client('normal');
  for (let i=0; i<12; i++) await service.beforeNewSeat(a.req, a.res, show, 'same-seat');
  const b = client('other');
  await expect(service.beforeNewSeat(b.req, b.res, show, 'same-seat')).resolves.toBeUndefined();
  expect(await redis.keys('*proof*')).toEqual([]);
});

it('retains an outstanding challenge and grants proof only to its buyer, showtime and admission', async () => {
  const a = client('check');
  for (let i=0; i<9; i++) await service.beforeNewSeat(a.req, a.res, show, 'fixture-seat-' + i);
  const error = await service.beforeNewSeat(a.req, a.res, show, 'last-seat').catch(e => e);
  const payload = error.getResponse();
  expect(payload).toMatchObject({ message: 'SECURITY_CHALLENGE_REQUIRED', sitekey: 'public-test-key' });
  const proof = (await redis.keys('*proof:*'))[0]!;
  const initialDeadline = await redis.pttl(proof);
  await redis.del(...(await redis.keys('*buyer:*')));
  await expect(service.beforeNewSeat(a.req, a.res, show, 'same-seat')).rejects.toThrow('SECURITY_CHALLENGE_REQUIRED');
  const b = client('other-admission');
  await expect(service.verify(b.req, show, 'fixture-token')).rejects.toThrow('not requested');
  const verify = vi.fn().mockResolvedValueOnce(verificationResult('incorrect-binding')).mockResolvedValueOnce(verificationResult(payload.binding));
  vi.stubGlobal('fetch', verify);
  await expect(service.verify(a.req, show, 'fixture-token')).rejects.toThrow('SECURITY_CHALLENGE_REQUIRED');
  await service.verify(a.req, show, 'fixture-valid');
  await service.verify(a.req, show, 'idempotent retry');
  await expect(service.beforeNewSeat(a.req, a.res, show, 'another-seat')).resolves.toBeUndefined();
  expect(verify).toHaveBeenCalledTimes(2);
  expect(await redis.pttl(proof)).toBeLessThanOrEqual(initialDeadline);
});

function verificationResult(binding: string) {
  return { ok: true, json: async () => ({ success: true, hostname: 'heygrabit.com', action: 'booking_seat', cdata: binding }) };
}
