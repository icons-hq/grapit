import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { AuthService, REFRESH_ROTATION_GRACE_MS } from '../src/modules/auth/auth.service.js';
import { UserRepository } from '../src/modules/user/user.repository.js';
import type { SmsService } from '../src/modules/sms/sms.service.js';
import type { EmailService } from '../src/modules/auth/email/email.service.js';
import type { ConsentService } from '../src/modules/consent/consent.service.js';

// Disposable database only: real rotation transactions, row locks and lower(email) lookups.
describe('Auth session and email identity — PostgreSQL', () => {
  let container: StartedTestContainer;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let users: UserRepository;
  let auth: AuthService;
  const emailService = {
    sendEmailVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPasswordResetEmail: vi.fn().mockResolvedValue({ success: true }),
  };
  // Signup consumes a single-use phone token through a claim it can release on a failed write.
  const phoneClaimRelease = vi.fn().mockResolvedValue(undefined);
  const smsService = {
    verifyPhoneVerificationToken: vi.fn(),
    claimPhoneVerificationToken: vi.fn().mockResolvedValue({ release: phoneClaimRelease }),
  };

  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'auth_session_test' });
    container = postgres.container;
    const pool = new Pool({ host: postgres.host, port: postgres.port,
      user: 'postgres', password: 'test', database: 'auth_session_test', max: 10 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });

    const config = {
      get: (key: string) => ({
        'auth.jwtSecret': 'integration-jwt-secret',
        'auth.jwtRefreshSecret': 'integration-refresh-secret',
        FRONTEND_URL: 'http://localhost:3000',
      } as Record<string, string>)[key],
    } as unknown as ConfigService;
    users = new UserRepository(db);
    auth = new AuthService(
      new JwtService({ secret: 'integration-jwt-secret', signOptions: { expiresIn: '15m' } }),
      config,
      users,
      smsService as unknown as SmsService,
      emailService as unknown as EmailService,
      db,
      {
        assertAgeAllowed: vi.fn(),
        assertRequiredConsents: vi.fn().mockResolvedValue(undefined),
        captureConsent: vi.fn().mockResolvedValue(undefined),
      } as unknown as ConsentService,
      // Email verification attempt counter (Valkey INCR); this suite covers PostgreSQL only.
      { eval: vi.fn().mockResolvedValue(1) },
    );
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function createBuyer(email: string, password = 'Test1234!') {
    const [user] = await db.insert(schema.users).values({
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      name: 'Integration Buyer',
      phone: `010${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`,
      gender: 'unspecified',
      birthDate: '1990-01-01',
      isPhoneVerified: true,
      isEmailVerified: true,
    }).returning();
    return user!;
  }

  async function familyRows(family: string) {
    return db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.family, family));
  }

  async function loginFamily(email: string) {
    const user = await users.findByEmail(email);
    const session = await auth.login({ ...user!, adminCapabilities: [] } as never);
    const [row] = await db.select().from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, user!.id));
    return { session, family: row!.family };
  }

  describe('refresh rotation across tabs (#13)', () => {
    it('keeps every tab signed in when several tabs refresh the same cookie at once', async () => {
      await createBuyer('multi.tab@example.test');
      const { session, family } = await loginFamily('multi.tab@example.test');

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => auth.refreshTokens(session.refreshToken)),
      );

      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      const refreshTokens = new Set(results.map((result) => (result as PromiseFulfilledResult<{ refreshToken: string }>).value.refreshToken));
      expect(refreshTokens.size).toBe(1);

      const rows = await familyRows(family);
      const active = rows.filter((row) => row.revokedAt === null);
      expect(rows).toHaveLength(2);
      expect(active).toHaveLength(1);

      // The shared cookie (the converged child) keeps rotating normally afterwards.
      const next = await auth.refreshTokens([...refreshTokens][0]!);
      expect(next.refreshToken).not.toBe([...refreshTokens][0]);
    });

    it('lets a tab that still sends the grandparent cookie inside the grace window catch up', async () => {
      await createBuyer('stale.tab@example.test');
      const { session } = await loginFamily('stale.tab@example.test');
      const child = await auth.refreshTokens(session.refreshToken);
      const grandchild = await auth.refreshTokens(child.refreshToken);

      const replay = await auth.refreshTokens(session.refreshToken);

      expect(replay.refreshToken).toBe(grandchild.refreshToken);
    });

    it('still revokes the whole family when a rotated token is reused after the grace window', async () => {
      await createBuyer('theft.after.grace@example.test');
      const { session, family } = await loginFamily('theft.after.grace@example.test');
      const child = await auth.refreshTokens(session.refreshToken);
      const parentHash = (await familyRows(family)).find((row) => row.revokedAt !== null)!.tokenHash;
      await db.update(schema.refreshTokens)
        .set({ revokedAt: new Date(Date.now() - REFRESH_ROTATION_GRACE_MS - 1_000) })
        .where(eq(schema.refreshTokens.tokenHash, parentHash));

      await expect(auth.refreshTokens(session.refreshToken)).rejects.toThrow(UnauthorizedException);

      const active = await db.select().from(schema.refreshTokens)
        .where(and(eq(schema.refreshTokens.family, family), isNull(schema.refreshTokens.revokedAt)));
      expect(active).toHaveLength(0);
      await expect(auth.refreshTokens(child.refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('does not resurrect a session that was logged out, even inside the grace window', async () => {
      await createBuyer('logged.out@example.test');
      const { session } = await loginFamily('logged.out@example.test');
      const child = await auth.refreshTokens(session.refreshToken);
      await auth.revokeRefreshToken(child.refreshToken);

      await expect(auth.refreshTokens(session.refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('logs out the active child when logout arrives with a just-rotated cookie, without reopening its grace window', async () => {
      await createBuyer('stale.logout@example.test');
      const { session, family } = await loginFamily('stale.logout@example.test');
      const child = await auth.refreshTokens(session.refreshToken);
      const parentRevokedAt = (await familyRows(family)).find((row) => row.revokedAt !== null)!.revokedAt!;

      await new Promise((resolve) => setTimeout(resolve, 20));
      await auth.revokeRefreshToken(session.refreshToken);

      const rows = await familyRows(family);
      expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(0);
      // The stale parent keeps its rotation time; logout does not restart its 30 s window.
      expect(rows.find((row) => row.revokedAt!.getTime() === parentRevokedAt.getTime())).toBeDefined();
      await expect(auth.refreshTokens(child.refreshToken)).rejects.toThrow(UnauthorizedException);
      await expect(auth.refreshTokens(session.refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('social login email verification (#100 and the 2026-05-17 social policy)', () => {
    async function linkSocial(userId: string, provider: string, providerId: string, providerEmail: string | null) {
      await db.insert(schema.socialAccounts).values({ userId, provider, providerId, providerEmail });
    }

    it('repairs a legacy unverified placeholder social account on login so it can book', async () => {
      const [legacy] = await db.insert(schema.users).values({
        email: 'kakao_legacy001@social.grabit.com',
        passwordHash: null,
        name: 'Legacy Kakao',
        phone: '01090000001',
        gender: 'unspecified',
        birthDate: '1990-01-01',
        isPhoneVerified: true,
        isEmailVerified: false,
      }).returning();
      await linkSocial(legacy!.id, 'kakao', 'legacy001', null);

      const result = await auth.findOrCreateSocialUser({ provider: 'kakao', providerId: 'legacy001', name: 'Legacy Kakao' });

      expect(result).toMatchObject({ status: 'authenticated', user: { id: legacy!.id, isEmailVerified: true } });
      const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, legacy!.id));
      expect(stored!.isEmailVerified).toBe(true);
    });

    it('does not verify the never-verified signup email of a linked local account', async () => {
      const local = await createBuyer('typo.local@naver.co');
      await db.update(schema.users).set({ isEmailVerified: false }).where(eq(schema.users.id, local.id));
      await linkSocial(local.id, 'kakao', 'linked002', 'typo.local@kakao.com');

      const result = await auth.findOrCreateSocialUser({
        provider: 'kakao',
        providerId: 'linked002',
        email: 'typo.local@kakao.com',
        emailVerified: true,
        name: 'Integration Buyer',
      });

      expect(result).toMatchObject({ status: 'authenticated', user: { id: local.id, isEmailVerified: false } });
      const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, local.id));
      expect(stored!.isEmailVerified).toBe(false);
    }, 30000);
  });

  describe('case-insensitive login email (#99)', () => {
    it('stores new signups in lower case and blocks a case-only duplicate signup', async () => {
      const registered = await auth.register({
        email: 'New.Fan@Example.TEST',
        password: 'Test1234!',
        name: 'New Fan',
        gender: 'female',
        country: 'KR',
        birthDate: '1995-05-15',
        phone: '01011112222',
        phoneVerificationToken: 'phone-token',
        termsOfService: true,
        privacyPolicy: true,
        marketingConsent: false,
        consentItems: [],
        locale: 'ko',
      } as never);

      expect(registered.email).toBe('new.fan@example.test');
      expect(smsService.claimPhoneVerificationToken).toHaveBeenCalledWith('phone-token', {
        phone: '01011112222',
        purpose: 'signup',
      });
      smsService.claimPhoneVerificationToken.mockClear();
      await expect(auth.checkEmailAvailability('NEW.FAN@example.test')).resolves.toEqual({ available: false });
      await expect(auth.register({ email: 'new.FAN@example.test', password: 'Test1234!', name: 'Dup', gender: 'female', country: 'KR', birthDate: '1995-05-15', phone: '01011113333', phoneVerificationToken: 'x', termsOfService: true, privacyPolicy: true, marketingConsent: false, consentItems: [] } as never))
        .rejects.toThrow(ConflictException);
      // The case-only duplicate is refused before its phone token is consumed.
      expect(smsService.claimPhoneVerificationToken).not.toHaveBeenCalled();
      expect(phoneClaimRelease).not.toHaveBeenCalled();
      const rows = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = 'new.fan@example.test'`);
      expect(rows).toHaveLength(1);
    }, 30000);

    it('logs in and sends password reset for a legacy mixed-case account typed in another case', async () => {
      const legacy = await createBuyer('Hong.Legacy@Naver.com');

      const validated = await auth.validateUser('hong.legacy@naver.com', 'Test1234!');
      expect(validated.id).toBe(legacy.id);

      emailService.sendPasswordResetEmail.mockClear();
      await auth.requestPasswordReset('HONG.LEGACY@NAVER.COM');
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith('Hong.Legacy@Naver.com', expect.any(String), 'ko');
    }, 30000);

    it('prefers the exact spelling when legacy rows differ only by case', async () => {
      const upper = await createBuyer('Twin@Example.test', 'Upper1234!');
      await createBuyer('twin@example.test', 'Lower1234!');

      await expect(auth.validateUser('Twin@Example.test', 'Upper1234!')).resolves.toMatchObject({ id: upper.id });
      await expect(users.findByEmail('TWIN@example.test')).resolves.toMatchObject({ id: upper.id });
    }, 30000);

    it('accepts an unused verification code issued to the mixed-case address before the change', async () => {
      const legacy = await createBuyer('Code.Legacy@Naver.com');
      await db.update(schema.users).set({ isEmailVerified: false }).where(eq(schema.users.id, legacy.id));
      const code = '135790';
      await db.insert(schema.emailVerificationTokens).values({
        userId: legacy.id,
        email: 'Code.Legacy@Naver.com',
        purpose: 'signup',
        tokenHash: createHmac('sha256', 'integration-jwt-secret')
          .update(`signup:code.legacy@naver.com:${code}`)
          .digest('hex'),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      await expect(auth.verifyEmailVerificationCode('code.legacy@naver.com', code)).resolves.toEqual({ verified: true });

      const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, legacy.id));
      expect(stored!.isEmailVerified).toBe(true);
    }, 30000);

    it('serves lower(email) lookups from the expression index', async () => {
      const indexes = await db.execute(sql`select indexdef from pg_indexes where indexname = 'idx_users_email_lower'`);
      expect(indexes.rows[0]).toMatchObject({ indexdef: expect.stringContaining('lower((email)::text)') });
    });
  });
});
