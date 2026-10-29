import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { StartedTestContainer } from 'testcontainers';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { UserRepository } from '../src/modules/user/user.repository.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { QueueService } from '../src/modules/queue/queue.service.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

// Exercise the actual authentication/session readers, not a substitute cache.
// The read budget catches the N-per-buyer round trips without a timing assertion
// that depends on the machine running this test. The pool remains five.
describe('booking burst reads — fresh authority from PostgreSQL', () => {
  let container: StartedTestContainer;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let strategy: JwtStrategy;
  let queue: QueueService;
  let reads = 0;
  let countReads = false;
  const performanceId = randomUUID();
  const otherPerformanceId = randomUUID();
  const showtimeId = randomUUID();
  const gate = (id = performanceId, role?: string) => (queue as unknown as {
    assertPerformanceBookingOpen(id: string, role?: string): Promise<void>;
  }).assertPerformanceBookingOpen(id, role);
  const buyers = Array.from({ length: 1500 }, (_, index) => ({
    id: randomUUID(), email: `burst-${index}-${randomUUID()}@example.test`,
    token: randomUUID(), family: randomUUID(),
  }));
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  const validate = (index: number) => strategy.validate({
    sub: buyers[index]!.id, email: 'untrusted-claim@example.test', role: 'admin',
  });

  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'booking_burst_reads' });
    container = postgres.container;
    const pool = new Pool({ connectionString: postgres.connectionString, max: 5 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema, logger: { logQuery(query) {
      if (countReads && /^select\b/i.test(query)) reads += 1;
    } } });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    await db.insert(schema.users).values(buyers.map((buyer, index) => ({
      id: buyer.id, email: buyer.email, name: `Synthetic buyer ${index}`,
      phone: `+8210${70000000 + index}`, gender: 'unspecified', country: 'KR',
      birthDate: '1990-01-01', isEmailVerified: true, isPhoneVerified: true,
      role: index === 0 ? 'admin' as const : 'user' as const,
      adminCapabilityBundle: index === 0 ? 'scanner' as const : null,
      accountStatus: index === 1498 ? 'withdrawn' as const
        : index === 1499 ? 'merged' as const : 'active' as const,
    })));
    await db.insert(schema.refreshTokens).values(buyers.map((buyer, index) => ({
      userId: buyer.id, tokenHash: hash(buyer.token), family: buyer.family,
      expiresAt: new Date(Date.now() + (index === 1497 ? -60_000 : 3600_000)),
      revokedAt: index === 1496 ? new Date() : null,
    })));
    strategy = new JwtStrategy(new ConfigService({ auth: { jwtSecret: 'test-burst-key' } }), new UserRepository(db));
    queue = new QueueService({} as never, db, {} as never, new ConfigService({ QUEUE_MAX_ACTIVE_ADMISSIONS: '200' }));
    const date = new Date(Date.now() + 3600_000);
    await db.insert(schema.performances).values([performanceId, otherPerformanceId].map((id) => ({
      id, title: 'Synthetic burst test', genre: 'concert' as const, ageRating: 'All',
      startDate: date, endDate: date, status: 'selling' as const,
      publishState: id === performanceId ? 'published' as const : 'draft' as const,
    })));
    await db.insert(schema.showtimes).values([
      { id: showtimeId, performanceId, dateTime: date },
      { performanceId: otherPerformanceId, dateTime: date },
    ]);
  });
  afterAll(async () => { await closePool?.(); await container?.stop(); });

  it('bounds concurrent JWT reads while preserving each buyer and live account restrictions', async () => {
    reads = 0; countReads = true;
    const results = await Promise.allSettled(buyers.map((_buyer, index) => validate(index)));
    countReads = false;
    for (let index = 0; index < buyers.length; index += 1) {
      const result = results[index]!;
      if (index >= 1498) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(UnauthorizedException);
      } else {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') expect(result.value).toMatchObject({
          id: buyers[index]!.id, email: buyers[index]!.email,
          role: index === 0 ? 'admin' : 'user', adminCapabilityBundle: index === 0 ? 'scanner' : null,
        });
      }
    }
    expect(reads).toBeLessThanOrEqual(24);
  });

  it('bounds concurrent browser-session reads without accepting another owner, revoked or expired tokens', async () => {
    reads = 0; countReads = true;
    const results = await Promise.allSettled([
      ...buyers.map((buyer) => queue.resolveBrowserIdentity(buyer.id, buyer.token)),
      queue.resolveBrowserIdentity(buyers[0]!.id, buyers[1]!.token),
    ]);
    countReads = false;
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      if (index === 1496 || index === 1497 || index === buyers.length) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(UnauthorizedException);
      } else {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') expect(result.value).toEqual({
          userId: buyers[index]!.id, refreshTokenFamilyId: buyers[index]!.family,
          deviceSlotId: buyers[index]!.family,
        });
      }
    }
    expect(reads).toBeLessThanOrEqual(24);
  });

  it('observes committed withdrawal, role changes and session revocation on the next read', async () => {
    await validate(1);
    await queue.resolveBrowserIdentity(buyers[2]!.id, buyers[2]!.token);
    await db.update(schema.users).set({ accountStatus: 'withdrawn' }).where(eq(schema.users.id, buyers[1]!.id));
    await db.update(schema.users).set({ role: 'admin', adminCapabilityBundle: 'finance' }).where(eq(schema.users.id, buyers[2]!.id));
    await db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.tokenHash, hash(buyers[2]!.token)));
    await expect(validate(1)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(validate(2)).resolves.toMatchObject({ role: 'admin', adminCapabilityBundle: 'finance' });
    await expect(queue.resolveBrowserIdentity(buyers[2]!.id, buyers[2]!.token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('bounds same-performance gate reads and keeps roles and performances isolated', async () => {
    reads = 0; countReads = true;
    const results = await Promise.allSettled([
      ...buyers.map(() => gate()), gate(otherPerformanceId), gate(otherPerformanceId, 'admin'),
    ]);
    countReads = false;
    expect(results.slice(0, buyers.length).every((result) => result.status === 'fulfilled')).toBe(true);
    expect(results[buyers.length]).toMatchObject({ status: 'rejected', reason: expect.any(NotFoundException) });
    expect(results[buyers.length + 1]!.status).toBe('fulfilled');
    expect(reads).toBeLessThanOrEqual(2);
  });

  it('reads publication changes and the showtime cutoff again on the next gate check', async () => {
    await gate();
    await db.update(schema.performances).set({ publishState: 'draft' }).where(eq(schema.performances.id, performanceId));
    await expect(gate()).rejects.toBeInstanceOf(NotFoundException);
    await expect(gate(performanceId, 'admin')).resolves.toBeUndefined();
    await db.update(schema.showtimes).set({ dateTime: new Date(Date.now() - 1000) }).where(eq(schema.showtimes.id, showtimeId));
    await expect(gate(performanceId, 'admin')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
