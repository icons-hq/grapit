import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, GoneException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { AuthService } from './auth.service.js';
import type { RegisterBody } from './dto/register.dto.js';
import type { ConsentService } from '../consent/consent.service.js';
import type { AuthConsentCaptureItem } from '@grabit/shared';

// Hash password once (argon2 is expensive)
let preHashedPassword: string;

const mockRegisterDto: RegisterBody = {
  email: 'new@test.com',
  password: 'Test1234!',
  name: 'New User',
  gender: 'male',
  country: 'KR',
  birthDate: '1995-05-15',
  phone: '010-9876-5432',
  phoneVerificationToken: 'signed-phone-token',
  termsOfService: true,
  privacyPolicy: true,
  marketingConsent: false,
  consentItems: makeConsentItems(),
};

function makeConsentItems(
  overrides: Partial<Record<AuthConsentCaptureItem['key'], boolean>> = {},
  sourceFlow: 'signup' | 'social_completion' = 'signup',
): AuthConsentCaptureItem[] {
  return [
    'terms',
    'privacy',
    'pipa_required',
    'cross_border_transfer',
    'pdpa_notice',
    'pipl_notice',
    'marketing',
  ].map((key) => ({
    key: key as AuthConsentCaptureItem['key'],
    version: '2026-05-01',
    language: 'ko',
    accepted: overrides[key as AuthConsentCaptureItem['key']] ?? true,
    required: key !== 'marketing',
    sourceFlow,
  }));
}

function makeSocialConsentItems(
  overrides: Partial<Record<AuthConsentCaptureItem['key'], boolean>> = {},
): AuthConsentCaptureItem[] {
  return makeConsentItems(overrides, 'social_completion');
}

function createMockUser() {
  return {
    id: randomUUID(),
    email: 'test@test.com',
    passwordHash: preHashedPassword,
    name: 'Test User',
    phone: '010-1234-5678',
    gender: 'male' as const,
    country: 'KR',
    birthDate: '1990-01-01',
    isPhoneVerified: false,
    isEmailVerified: false,
    marketingConsent: false,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Drizzle mock: insert().values() returns a thenable promise
function makeMockInsertChain() {
  return {
    values: vi.fn().mockReturnValue(
      Object.assign(Promise.resolve([]), {
        returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
      }),
    ),
  };
}

function makeMockUpdateChain(returningRows: Array<{ id: string }> = [{ id: randomUUID() }]) {
  const returning = vi.fn().mockResolvedValue(returningRows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set, where, returning };
}

function containsPrimitiveValue(value: unknown, needle: string, seen = new Set<object>()): boolean {
  if (value === needle) return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsPrimitiveValue(item, needle, seen));
  }
  return Object.values(value as Record<string, unknown>).some((item) =>
    containsPrimitiveValue(item, needle, seen),
  );
}

describe('AuthService', () => {
  let authService: AuthService;
  let mockUser: ReturnType<typeof createMockUser>;
  let mockUserRepo: {
    findByEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updatePassword: ReturnType<typeof vi.fn>;
  };
  let mockJwtService: {
    signAsync: ReturnType<typeof vi.fn>;
    verifyAsync: ReturnType<typeof vi.fn>;
    decode: ReturnType<typeof vi.fn>;
  };
  let mockDb: {
    insert: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let mockConfigService: {
    get: ReturnType<typeof vi.fn>;
  };
  let mockEmailService: {
    sendPasswordResetEmail: ReturnType<typeof vi.fn>;
    sendEmailVerificationEmail: ReturnType<typeof vi.fn>;
  };
  let mockConsentService: {
    assertAgeAllowed: ReturnType<typeof vi.fn>;
    assertRequiredConsents: ReturnType<typeof vi.fn>;
    captureConsent: ReturnType<typeof vi.fn>;
  };
  let mockSmsService: {
    verifyCode: ReturnType<typeof vi.fn>;
    sendVerificationCode: ReturnType<typeof vi.fn>;
    isPhoneVerified: ReturnType<typeof vi.fn>;
    verifyPhoneVerificationToken: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    preHashedPassword = await argon2.hash('Test1234!', {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }, 30000);

  beforeEach(() => {
    mockUser = createMockUser();

    mockUserRepo = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updatePassword: vi.fn(),
    };

    mockJwtService = {
      signAsync: vi.fn().mockResolvedValue('mock-access-token'),
      verifyAsync: vi.fn(),
      decode: vi.fn(),
    };

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          'auth.jwtSecret': 'test-jwt-secret',
          'auth.jwtRefreshSecret': 'test-refresh-secret',
          'auth.jwtExpiresIn': '15m',
          'auth.jwtRefreshExpiresIn': '7d',
          FRONTEND_URL: 'http://localhost:3000',
        };
        return config[key];
      }),
    };

    mockDb = {
      insert: vi.fn().mockImplementation(() => makeMockInsertChain()),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn().mockImplementation(() => makeMockUpdateChain()),
      transaction: vi.fn(async (callback: (tx: typeof mockDb) => Promise<unknown>) =>
        callback(mockDb),
      ),
    };

    mockSmsService = {
      verifyCode: vi.fn().mockResolvedValue({ verified: true }),
      sendVerificationCode: vi.fn().mockResolvedValue({ success: true, message: '' }),
      isPhoneVerified: vi.fn().mockResolvedValue(false),
      verifyPhoneVerificationToken: vi.fn(),
    };

    // REVIEWS.md HIGH-03: capture reset link via EmailService spy
    mockEmailService = {
      sendPasswordResetEmail: vi.fn().mockResolvedValue({ success: true }),
      sendEmailVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
    };

    mockConsentService = {
      assertAgeAllowed: vi.fn(),
      assertRequiredConsents: vi.fn().mockResolvedValue(undefined),
      captureConsent: vi.fn().mockResolvedValue(undefined),
    };

    // Instantiate AuthService directly (no NestJS DI overhead)
    authService = new AuthService(
      mockJwtService as unknown as JwtService,
      mockConfigService as unknown as ConfigService,
      mockUserRepo as any,
      mockSmsService as any,
      mockEmailService as any,
      mockDb as any,
      mockConsentService as unknown as ConsentService,
    );
  });

  describe('register', () => {
    it('should create a user with argon2-hashed password and return AuthResponse', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
        ...mockUser,
        id: randomUUID(),
        email: mockRegisterDto.email,
        name: mockRegisterDto.name,
      });

      const result = await authService.register(mockRegisterDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(mockRegisterDto.email);

      // Verify password was hashed with argon2
      const createCall = mockUserRepo.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      expect(createCall?.passwordHash).toBeDefined();
      expect(createCall?.passwordHash).not.toBe(mockRegisterDto.password);
      const isArgon2 = await argon2.verify(
        createCall!.passwordHash as string,
        mockRegisterDto.password,
      );
      expect(isArgon2).toBe(true);
    }, 15000);

    it('should throw ConflictException (409) if email already exists', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);

      await expect(authService.register(mockRegisterDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('blocks signup when required cross-border consent is missing', async () => {
      const dto = {
        ...mockRegisterDto,
        consentItems: makeConsentItems({ cross_border_transfer: false }),
      };
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
        ...mockUser,
        id: randomUUID(),
        email: dto.email,
        name: dto.name,
      });
      mockConsentService.assertRequiredConsents.mockRejectedValue(
        new BadRequestException('국외이전 동의가 필요합니다. 동의하지 않으면 가입 또는 팬미팅 예매를 진행할 수 없습니다.'),
      );

      await expect(authService.register(dto)).rejects.toThrow(
        '국외이전 동의가 필요합니다. 동의하지 않으면 가입 또는 팬미팅 예매를 진행할 수 없습니다.',
      );

      expect(mockConsentService.assertRequiredConsents).toHaveBeenCalledWith({
        items: dto.consentItems,
      });
      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    it('captures itemized signup consent rows after creating the user', async () => {
      const userId = randomUUID();
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
        ...mockUser,
        id: userId,
        email: mockRegisterDto.email,
        name: mockRegisterDto.name,
      });

      await authService.register(mockRegisterDto, {
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Browser',
      });

      expect(mockConsentService.assertAgeAllowed).toHaveBeenCalledWith(mockRegisterDto.birthDate);
      expect(mockConsentService.captureConsent).toHaveBeenCalledWith(
        userId,
        {
          birthDate: mockRegisterDto.birthDate,
          items: mockRegisterDto.consentItems,
          sourceFlow: 'signup',
        },
        { ipAddress: '203.0.113.10', userAgent: 'Vitest Browser' },
        expect.anything(),
      );
    }, 15000);

    it('purpose-bound phone verification token이 있으면 OTP를 재검증하지 않고 가입한다', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
        ...mockUser,
        id: randomUUID(),
        email: mockRegisterDto.email,
        name: mockRegisterDto.name,
      });

      const result = await authService.register(mockRegisterDto);

      expect(result.user.email).toBe(mockRegisterDto.email);
      expect(mockSmsService.verifyPhoneVerificationToken).toHaveBeenCalledWith(
        mockRegisterDto.phoneVerificationToken,
        { phone: mockRegisterDto.phone, purpose: 'signup' },
      );
      expect(mockSmsService.verifyCode).not.toHaveBeenCalled();
      expect(mockSmsService.isPhoneVerified).not.toHaveBeenCalled();
      expect(mockUserRepo.create).toHaveBeenCalled();
    }, 15000);

    it('invalid phone verification token이면 가입을 거부한다', async () => {
      mockSmsService.verifyPhoneVerificationToken.mockImplementation(() => {
        throw new BadRequestException('전화번호 인증이 완료되지 않았습니다');
      });

      await expect(authService.register(mockRegisterDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('should return user without passwordHash for valid credentials', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);

      const result = await authService.validateUser('test@test.com', 'Test1234!');

      expect(result).toBeDefined();
      expect(result.email).toBe('test@test.com');
      expect(result).not.toHaveProperty('passwordHash');
    }, 10000);

    it('should throw UnauthorizedException for wrong password', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.validateUser('test@test.com', 'WrongPassword1!'),
      ).rejects.toThrow(UnauthorizedException);
    }, 10000);

    it('should throw UnauthorizedException for non-existent email', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);

      await expect(
        authService.validateUser('nouser@test.com', 'Test1234!'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('should return AuthResponse with accessToken and refreshToken', async () => {
      const result = await authService.login({
        id: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        name: mockUser.name,
        phone: mockUser.phone,
        gender: mockUser.gender,
        country: mockUser.country,
        birthDate: mockUser.birthDate,
        isPhoneVerified: mockUser.isPhoneVerified,
        createdAt: mockUser.createdAt,
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe(mockUser.email);
    });
  });

  describe('refreshTokens', () => {
    it('should return new accessToken and refreshToken when valid token provided', async () => {
      const rawToken = 'valid-raw-refresh-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const family = randomUUID();
      const tokenId = randomUUID();

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: tokenId,
              userId: mockUser.id,
              tokenHash,
              family,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              createdAt: new Date(),
              revokedAt: null,
            },
          ]),
        }),
      });

      mockDb.update.mockImplementation(() => makeMockUpdateChain());

      mockUserRepo.findById.mockResolvedValue(mockUser);

      const result = await authService.refreshTokens(rawToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.refreshToken).not.toBe(rawToken);
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('conditional revoke 0 rows이면 concurrent reuse로 보고 family를 폐기한다', async () => {
      const rawToken = 'raced-refresh-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const family = randomUUID();

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: randomUUID(),
              userId: mockUser.id,
              tokenHash,
              family,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              createdAt: new Date(),
              revokedAt: null,
            },
          ]),
        }),
      });
      mockUserRepo.findById.mockResolvedValue(mockUser);
      const conditionalRevoke = makeMockUpdateChain([]);
      const familyWhere = vi.fn().mockResolvedValue([]);
      const familySet = vi.fn().mockReturnValue({ where: familyWhere });
      mockDb.update
        .mockReturnValueOnce({ set: conditionalRevoke.set })
        .mockReturnValueOnce({ set: familySet });

      await expect(authService.refreshTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(conditionalRevoke.returning).toHaveBeenCalledWith({
        id: expect.anything(),
      });
      expect(containsPrimitiveValue(familyWhere.mock.calls, family)).toBe(true);
    });

    it('should revoke entire token family on reuse (theft detection)', async () => {
      const rawToken = 'reused-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const family = randomUUID();

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: randomUUID(),
              userId: mockUser.id,
              tokenHash,
              family,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              createdAt: new Date(),
              revokedAt: new Date(), // already revoked!
            },
          ]),
        }),
      });

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      await expect(authService.refreshTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('reused revoked token revokes only the reused family, not every user session', async () => {
      const rawToken = 'reused-token-family-only';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const family = randomUUID();
      const whereMock = vi.fn().mockResolvedValue([]);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: randomUUID(),
              userId: mockUser.id,
              tokenHash,
              family,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              createdAt: new Date(),
              revokedAt: new Date(),
            },
          ]),
        }),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await expect(authService.refreshTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(whereMock).toHaveBeenCalledTimes(1);
      expect(containsPrimitiveValue(whereMock.mock.calls, family)).toBe(true);
      expect(containsPrimitiveValue(whereMock.mock.calls, mockUser.id)).toBe(false);
    });

    it('should throw UnauthorizedException for expired token', async () => {
      const rawToken = 'expired-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: randomUUID(),
              userId: mockUser.id,
              tokenHash,
              family: randomUUID(),
              expiresAt: new Date(Date.now() - 1000), // expired
              createdAt: new Date(),
              revokedAt: null,
            },
          ]),
        }),
      });

      await expect(authService.refreshTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refresh token family limit', () => {
    function authFamilyLimitApi() {
      return authService as unknown as {
        enforceRefreshFamilyLimit(
          userId: string,
          maxFamilies?: number,
        ): Promise<{ revokedFamily: string | null; notice?: string }>;
      };
    }

    const familyRows = (families: Array<{ family: string; createdAt: Date }>) =>
      families.map((row) => ({
        id: randomUUID(),
        userId: mockUser.id,
        tokenHash: createHash('sha256').update(row.family).digest('hex'),
        family: row.family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        createdAt: row.createdAt,
      }));

    it('keeps one to three active refresh-token families without revocation', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(
            familyRows([
              { family: 'family-1', createdAt: new Date('2026-05-01T00:00:00Z') },
              { family: 'family-2', createdAt: new Date('2026-05-02T00:00:00Z') },
              { family: 'family-3', createdAt: new Date('2026-05-03T00:00:00Z') },
            ]),
          ),
        }),
      });

      const result = await authFamilyLimitApi().enforceRefreshFamilyLimit(mockUser.id);

      expect(result).toEqual({ revokedFamily: null });
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('revokes the oldest active family on the fourth login and returns the user-visible notice', async () => {
      const updateWhereMock = vi.fn().mockResolvedValue([]);
      const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(
            familyRows([
              { family: 'oldest-family', createdAt: new Date('2026-05-01T00:00:00Z') },
              { family: 'family-2', createdAt: new Date('2026-05-02T00:00:00Z') },
              { family: 'family-3', createdAt: new Date('2026-05-03T00:00:00Z') },
              { family: 'newest-family', createdAt: new Date('2026-05-04T00:00:00Z') },
            ]),
          ),
        }),
      });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      const result = await authFamilyLimitApi().enforceRefreshFamilyLimit(mockUser.id);

      expect(result).toEqual({
        revokedFamily: 'oldest-family',
        notice: '다른 기기에서 로그인되어 가장 오래된 세션이 종료되었습니다.',
      });
      expect(updateSetMock).toHaveBeenCalledWith({ revokedAt: expect.any(Date) });
      expect(containsPrimitiveValue(updateWhereMock.mock.calls, 'oldest-family')).toBe(true);
    });

    it('refresh within the same family does not consume a new device slot', async () => {
      const rawToken = 'valid-refresh-same-family';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const family = randomUUID();

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: randomUUID(),
              userId: mockUser.id,
              tokenHash,
              family,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              createdAt: new Date(),
              revokedAt: null,
            },
          ]),
        }),
      });
      mockUserRepo.findById.mockResolvedValue(mockUser);

      await authService.refreshTokens(rawToken);

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeRefreshToken', () => {
    it('should mark token as revoked in DB', async () => {
      const rawToken = 'token-to-revoke';

      const updateWhereMock = vi.fn().mockResolvedValue([]);
      const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      await authService.revokeRefreshToken(rawToken);

      expect(mockDb.update).toHaveBeenCalled();
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('should not reveal whether email exists (always returns silently)', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);

      await expect(
        authService.requestPasswordReset('nonexistent@test.com'),
      ).resolves.not.toThrow();
    });

    it('should generate a reset token for valid email (mock email send)', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.requestPasswordReset('test@test.com'),
      ).resolves.not.toThrow();

      expect(mockJwtService.signAsync).toHaveBeenCalled();
    });
  });

  describe('email verification', () => {
    function authEmailVerificationApi() {
      return authService as unknown as {
        requestEmailVerification(email: string, locale?: string): Promise<{ expiresAt: Date }>;
        resendEmailVerification(email: string, locale?: string): Promise<{ expiresAt: Date }>;
        verifyEmailVerificationToken(token: string): Promise<{ verified: true }>;
      };
    }

    it('issues an opaque hashed token that expires in 30 minutes and does not expose the raw token in the return value', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-06T05:20:00.000Z');
      vi.setSystemTime(now);
      mockUserRepo.findByEmail.mockResolvedValue({ ...mockUser, email: 'verify@test.com' });

      try {
        const result = await authEmailVerificationApi().requestEmailVerification('verify@test.com', 'ko');

        expect(result.expiresAt.toISOString()).toBe('2026-05-06T05:50:00.000Z');
        expect(mockDb.insert).toHaveBeenCalledWith(expect.anything());
        const insertedValues = mockDb.insert.mock.results[0]?.value.values.mock.calls[0]?.[0] as {
          tokenHash?: string;
          expiresAt?: Date;
        };
        expect(insertedValues.tokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(result)).not.toContain(insertedValues.tokenHash);
        expect(mockEmailService.sendEmailVerificationEmail).toHaveBeenCalledWith(
          'verify@test.com',
          expect.stringContaining('/auth/verify-email?token='),
          'ko',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('resend is callable immediately and creates a newer token for latest-token-wins', async () => {
      mockUserRepo.findByEmail.mockResolvedValue({ ...mockUser, email: 'resend@test.com' });

      await authEmailVerificationApi().requestEmailVerification('resend@test.com', 'en');
      await authEmailVerificationApi().resendEmailVerification('resend@test.com', 'en');

      expect(mockDb.insert).toHaveBeenCalledTimes(2);
      expect(mockEmailService.sendEmailVerificationEmail).toHaveBeenCalledTimes(2);
    });

    it('rejects consumed, expired, and superseded verification tokens with distinct messages', async () => {
      const token = 'opaque-email-verification-token';
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const latestHash = createHash('sha256').update('latest-token').digest('hex');
      const baseRecord = {
        id: randomUUID(),
        userId: mockUser.id,
        email: mockUser.email,
        purpose: 'signup',
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        consumedAt: null,
        createdAt: new Date('2026-05-06T05:00:00.000Z'),
      };

      const selectWhere = vi
        .fn()
        .mockResolvedValueOnce([{ ...baseRecord, consumedAt: new Date() }])
        .mockResolvedValueOnce([{ ...baseRecord, expiresAt: new Date(Date.now() - 1000) }])
        .mockResolvedValueOnce([baseRecord])
        .mockResolvedValueOnce([{ ...baseRecord, tokenHash: latestHash, createdAt: new Date('2026-05-06T05:01:00.000Z') }]);
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({ where: selectWhere }),
      });

      await expect(authEmailVerificationApi().verifyEmailVerificationToken(token)).rejects.toThrow(
        /이미 사용된 인증 링크/,
      );
      await expect(authEmailVerificationApi().verifyEmailVerificationToken(token)).rejects.toThrow(
        /인증 링크가 만료되었습니다/,
      );
      await expect(authEmailVerificationApi().verifyEmailVerificationToken(token)).rejects.toThrow(
        /새 인증 메일을 요청/,
      );
    });
  });

  describe('resetPassword', () => {
    it('should update password hash with valid token', async () => {
      const userId = mockUser.id;

      // Build a fake JWT with a valid base64url-encoded payload
      const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: userId, purpose: 'password-reset' })).toString('base64url');
      const fakeToken = `${header}.${payload}.fake-signature`;

      // Preliminary uses jwtService.decode (no signature check) to extract sub
      mockJwtService.decode.mockReturnValue({
        sub: userId,
        purpose: 'password-reset',
      });
      // Final verify uses jwtService.verifyAsync with jwtSecret + passwordHash
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: userId,
        purpose: 'password-reset',
      });
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockUserRepo.updatePassword.mockResolvedValue(undefined);

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      await authService.resetPassword(fakeToken, 'NewPass123!');

      expect(mockUserRepo.updatePassword).toHaveBeenCalledWith(
        userId,
        expect.any(String),
      );

      const newHash = mockUserRepo.updatePassword.mock.calls[0]?.[1];
      expect(newHash).toBeDefined();
      const isValid = await argon2.verify(newHash!, 'NewPass123!');
      expect(isValid).toBe(true);
    }, 15000);
  });

  describe('findOrCreateSocialUser', () => {
    it('should return needs_registration with registrationToken for new social user', async () => {
      // No existing social account
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      // No existing user with this email
      mockUserRepo.findByEmail.mockResolvedValue(null);

      // Mock JWT sign for registration token
      mockJwtService.signAsync.mockResolvedValue('mock-registration-token');

      const result = await authService.findOrCreateSocialUser({
        provider: 'kakao',
        providerId: '12345',
        email: 'kakao@test.com',
        name: 'Kakao User',
      });

      expect(result.status).toBe('needs_registration');
      expect(result.registrationToken).toBe('mock-registration-token');
      expect(result.socialProfile).toEqual({
        provider: 'kakao',
        providerId: '12345',
        email: 'kakao@test.com',
        name: 'Kakao User',
      });
    });

    it('should return authenticated with tokens for existing social user', async () => {
      const existingUser = createMockUser();

      // Existing social account found
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: randomUUID(),
              userId: existingUser.id,
              provider: 'kakao',
              providerId: '12345',
              providerEmail: 'kakao@test.com',
              createdAt: new Date(),
            },
          ]),
        }),
      });

      // findById returns existing user
      mockUserRepo.findById.mockResolvedValue(existingUser);

      const result = await authService.findOrCreateSocialUser({
        provider: 'kakao',
        providerId: '12345',
        email: 'kakao@test.com',
        name: 'Kakao User',
      });

      expect(result.status).toBe('authenticated');
      expect(result.accessToken).toBeDefined();
      expect(result.user).toBeDefined();
    });
  });

  describe('completeSocialRegistration', () => {
    it('should create user + social account + terms with valid registrationToken', async () => {
      const newUserId = randomUUID();

      // Verify registration token
      mockJwtService.verifyAsync.mockResolvedValue({
        provider: 'kakao',
        providerId: '12345',
        email: 'kakao@test.com',
        name: 'Kakao User',
        purpose: 'social-registration',
      });

      // No existing user with this email
      mockUserRepo.findByEmail.mockResolvedValue(null);

      // Create user
      mockUserRepo.create.mockResolvedValue({
        ...createMockUser(),
        id: newUserId,
        email: 'kakao@test.com',
        name: 'Registered Name',
        passwordHash: null,
      });

      const result = await authService.completeSocialRegistration(
        'valid-registration-token',
        {
          name: 'Registered Name',
          gender: 'male',
          country: 'KR',
          birthDate: '1995-05-15',
          phone: '010-1234-5678',
          phoneVerificationToken: 'signed-social-phone-token',
          termsOfService: true,
          privacyPolicy: true,
          marketingConsent: false,
          consentItems: makeSocialConsentItems(),
        },
        { ipAddress: '203.0.113.20', userAgent: 'Vitest Social' },
      );

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(mockUserRepo.create).toHaveBeenCalled();
      expect(mockConsentService.captureConsent).toHaveBeenCalledWith(
        newUserId,
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ sourceFlow: 'social_completion' }),
          ]),
          sourceFlow: 'social_completion',
        }),
        { ipAddress: '203.0.113.20', userAgent: 'Vitest Social' },
        expect.anything(),
      );
    });

    it('should throw UnauthorizedException for expired registrationToken', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(
        authService.completeSocialRegistration('expired-token', {
          name: 'Name',
          gender: 'male',
          country: 'KR',
          birthDate: '1995-05-15',
          phone: '010-1234-5678',
          phoneVerificationToken: 'signed-social-phone-token',
          termsOfService: true,
          privacyPolicy: true,
          marketingConsent: false,
          consentItems: makeSocialConsentItems(),
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should link accounts when social email matches existing user without social link', async () => {
      const existingUser = createMockUser();

      // Verify registration token
      mockJwtService.verifyAsync.mockResolvedValue({
        provider: 'google',
        providerId: 'google-789',
        email: existingUser.email,
        name: 'Google User',
        purpose: 'social-registration',
      });

      // Existing user found with same email
      mockUserRepo.findByEmail.mockResolvedValue(existingUser);

      const result = await authService.completeSocialRegistration(
        'valid-registration-token',
        {
          name: existingUser.name,
          gender: existingUser.gender,
          country: existingUser.country,
          birthDate: existingUser.birthDate,
          phone: existingUser.phone,
          phoneVerificationToken: 'signed-social-phone-token',
          termsOfService: true,
          privacyPolicy: true,
          marketingConsent: false,
          consentItems: makeSocialConsentItems(),
        },
        { ipAddress: '203.0.113.30', userAgent: 'Vitest Link' },
      );

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('user');
      // Should NOT create a new user -- should link to existing
      expect(mockUserRepo.create).not.toHaveBeenCalled();
      // Should insert social account link
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockConsentService.captureConsent).toHaveBeenCalledWith(
        existingUser.id,
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ sourceFlow: 'social_completion' }),
          ]),
          sourceFlow: 'social_completion',
        }),
        { ipAddress: '203.0.113.30', userAgent: 'Vitest Link' },
        expect.anything(),
      );
    });

    it('purpose-bound phone verification token이 있으면 social registration을 완료한다', async () => {
      const newUserId = randomUUID();
      mockJwtService.verifyAsync.mockResolvedValue({
        provider: 'kakao',
        providerId: '12345',
        email: 'kakao@test.com',
        name: 'Kakao User',
        purpose: 'social-registration',
      });
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockUserRepo.create.mockResolvedValue({
        ...createMockUser(),
        id: newUserId,
        email: 'kakao@test.com',
        name: 'Registered Name',
        passwordHash: null,
      });

      const result = await authService.completeSocialRegistration(
        'valid-registration-token',
        {
          name: 'Registered Name',
          gender: 'male',
          country: 'KR',
          birthDate: '1995-05-15',
          phone: '010-1234-5678',
          phoneVerificationToken: 'signed-social-phone-token',
          termsOfService: true,
          privacyPolicy: true,
          marketingConsent: false,
          consentItems: makeSocialConsentItems(),
        },
      );

      expect(result).toHaveProperty('accessToken');
      expect(mockSmsService.verifyPhoneVerificationToken).toHaveBeenCalledWith(
        'signed-social-phone-token',
        { phone: '010-1234-5678', purpose: 'social_registration' },
      );
      expect(mockSmsService.verifyCode).not.toHaveBeenCalled();
      expect(mockSmsService.isPhoneVerified).not.toHaveBeenCalled();
      expect(mockUserRepo.create).toHaveBeenCalled();
    });

    it('invalid phone verification token이면 social registration을 거부한다', async () => {
      mockSmsService.verifyPhoneVerificationToken.mockImplementation(() => {
        throw new BadRequestException('전화번호 인증이 완료되지 않았습니다');
      });

      await expect(
        authService.completeSocialRegistration('valid-registration-token', {
          name: 'Registered Name',
          gender: 'male',
          country: 'KR',
          birthDate: '1995-05-15',
          phone: '010-1234-5678',
          phoneVerificationToken: 'invalid-social-phone-token',
          termsOfService: true,
          privacyPolicy: true,
          marketingConsent: false,
          consentItems: makeSocialConsentItems(),
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockUserRepo.create).not.toHaveBeenCalled();
      // Phone token failures must stop before any JWT verification of the registration token.
      expect(mockJwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  // REVIEWS.md HIGH-03 + Blocker B4 (revision-2): End-to-end password reset flow within service layer.
  // Proves that:
  //   (1) the reset link captured from EmailService spy can be successfully used
  //       to complete password change — closing the roadmap success criterion
  //       "실제 이메일 발송 + 링크를 통해 비밀번호 변경 완료" without requiring real Resend send.
  //   (2) JwtService.verifyAsync is called with secret = `${jwtSecret}${user.passwordHash}`
  //       (Blocker B4 — secret-rotation argument assertion; previous mock bypassed this).
  //   (3) Once password is reset, reusing the SAME token fails because passwordHash changed,
  //       which is the one-time-token guarantee built into auth.service.ts:227 + L262-272.
  describe('password reset flow integration', () => {
    const TEST_JWT_SECRET = 'test-jwt-secret';

    beforeEach(() => {
      // The test assumes configService returns a known jwtSecret so we can compose expected secret.
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'auth.jwtSecret') return TEST_JWT_SECRET;
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        return undefined;
      });
    });

    it('requestPasswordReset → EmailService.sendPasswordResetEmail captures resetLink → token extracted → resetPassword succeeds → password hash changed (+ JwtService secret rotation asserted)', async () => {
      // Setup: existing user with a current password
      const email = 'reset@test.com';
      const testUserId = randomUUID();
      const currentUser = {
        ...mockUser,
        id: testUserId,
        email,
        passwordHash: preHashedPassword, // argon2 hash of 'Test1234!'
      };
      mockUserRepo.findByEmail.mockResolvedValue(currentUser);
      mockUserRepo.findById.mockResolvedValue(currentUser);

      // Mock jwt sign to return a deterministic token.
      const fakeToken = 'header.payload.sig';
      mockJwtService.signAsync.mockResolvedValue(fakeToken);

      // CR-02: auth.service.ts resetPassword는 이제 preliminary 에서 decode (서명 검증 없음)
      // 만 수행하고, final verify 에서 { secret: jwtSecret + passwordHash } 로 서명/만료를 검증한다.
      //   1) preliminary: jwtService.decode(token)                         — sub 추출용
      //   2) final:       jwtService.verifyAsync(token, { secret: full })  — one-time 토큰 검증용
      mockJwtService.decode.mockReturnValue({
        sub: currentUser.id,
        purpose: 'password-reset',
      });
      mockJwtService.verifyAsync.mockImplementation(
        async (_token: string, opts: { secret: string }) => {
          const fullSecret = `${TEST_JWT_SECRET}${currentUser.passwordHash ?? ''}`;
          if (opts.secret === fullSecret) {
            return { sub: currentUser.id, purpose: 'password-reset' };
          }
          throw new Error('invalid signature');
        },
      );

      // --- Act 1: request password reset ---
      await authService.requestPasswordReset(email);

      // --- Assert 1a: EmailService.sendPasswordResetEmail called with a valid reset URL ---
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [toArg, linkArg] = mockEmailService.sendPasswordResetEmail.mock.calls[0] as [
        string,
        string,
      ];
      expect(toArg).toBe(email);
      expect(linkArg).toContain('/auth/reset-password?token=');
      expect(linkArg).toContain(fakeToken); // token is embedded in the link

      // --- Assert 1b (Blocker B4): jwtService.signAsync was called with rotation-aware secret ---
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        { sub: currentUser.id, purpose: 'password-reset' },
        expect.objectContaining({
          secret: `${TEST_JWT_SECRET}${currentUser.passwordHash ?? ''}`,
          expiresIn: '1h',
        }),
      );

      // --- Act 2: extract token from link (mirrors frontend `useSearchParams().get('token')`) ---
      const tokenFromLink = new URL(linkArg, 'http://localhost:3000').searchParams.get('token');
      expect(tokenFromLink).toBe(fakeToken);

      // --- Act 3: complete password reset with new password ---
      const newPassword = 'NewPwd9876!';
      await authService.resetPassword(tokenFromLink!, newPassword);

      // --- Assert 3a: verifyAsync was called with the OLD passwordHash in secret ---
      // (This is what passes because findById returned currentUser with preHashedPassword.)
      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(
        tokenFromLink!,
        expect.objectContaining({
          secret: `${TEST_JWT_SECRET}${currentUser.passwordHash ?? ''}`,
        }),
      );

      // --- Assert 3b: userRepository.updatePassword was called with a new argon2 hash ---
      expect(mockUserRepo.updatePassword).toHaveBeenCalledTimes(1);
      const [updatedUserId, newHash] = mockUserRepo.updatePassword.mock.calls[0] as [
        string,
        string,
      ];
      expect(updatedUserId).toBe(testUserId);
      expect(newHash).not.toBe(preHashedPassword); // hash changed
      expect(newHash).toMatch(/^\$argon2id\$/); // argon2id format

      // --- Assert 4: the new hash actually verifies against the new password ---
      const argon2 = await import('argon2');
      const isValidNew = await argon2.verify(newHash, newPassword);
      expect(isValidNew).toBe(true);

      // --- Assert 5: old password no longer verifies ---
      const isValidOld = await argon2.verify(newHash, 'Test1234!');
      expect(isValidOld).toBe(false);
    }, 15000); // argon2 hash creation is expensive

    it('Blocker B4: one-time token — reusing the same reset token after password change throws UnauthorizedException (passwordHash-based secret rotated)', async () => {
      const email = 'rotate@test.com';
      const rotateUserId = randomUUID();
      const userBefore = {
        ...mockUser,
        id: rotateUserId,
        email,
        passwordHash: preHashedPassword,
      };
      mockUserRepo.findByEmail.mockResolvedValue(userBefore);

      const fakeToken = 'header.payload.sig';

      // Track original secret at token-sign time — mimics the fact that JwtService.signAsync
      // bakes the secret into the token and verifyAsync rejects if verification secret differs.
      let tokenSignedSecret: string | undefined;
      mockJwtService.signAsync.mockImplementation(
        async (_payload: unknown, opts: { secret: string }) => {
          tokenSignedSecret = opts.secret;
          return fakeToken;
        },
      );

      // Mutable ref — findById returns the "current" user state. After first resetPassword,
      // the test mutates `currentStoredHash` so the second findById returns the rotated user.
      let currentStoredHash = preHashedPassword;
      mockUserRepo.findById.mockImplementation(async (id: string) =>
        id === userBefore.id ? { ...userBefore, passwordHash: currentStoredHash } : null,
      );

      // updatePassword simulates the DB write by updating the mutable ref.
      mockUserRepo.updatePassword.mockImplementation(async (_id: string, newHash: string) => {
        currentStoredHash = newHash;
      });

      // CR-02 + Blocker B4:
      // - preliminary: jwtService.decode (서명 검증 없음, sub 추출만) → 항상 성공.
      // - final verify(jwtSecret + passwordHash): sign-time 의 secret 과 일치해야 성공 → rotation 후 실패.
      mockJwtService.decode.mockReturnValue({
        sub: userBefore.id,
        purpose: 'password-reset',
      });
      mockJwtService.verifyAsync.mockImplementation(
        async (_token: string, opts: { secret: string }) => {
          if (opts.secret !== tokenSignedSecret) {
            throw new Error('invalid signature');
          }
          return { sub: userBefore.id, purpose: 'password-reset' };
        },
      );

      // --- First use: succeeds ---
      await authService.requestPasswordReset(email);
      // Token was signed with jwtSecret + OLD passwordHash. At verify-time the user still
      // has the old hash, so verify secret matches → reset succeeds and hash rotates.
      await authService.resetPassword(fakeToken, 'FirstNewPwd!1');

      // Hash should have rotated.
      expect(currentStoredHash).not.toBe(preHashedPassword);

      // --- Second use: the controller-level resetPassword manually parses JWT header and
      //     then calls verifyAsync with secret = jwtSecret + NEW passwordHash.
      //     But the token was signed with OLD passwordHash. verifyAsync rejects.
      await expect(
        authService.resetPassword(fakeToken, 'SecondAttempt!2'),
      ).rejects.toThrow(/유효하지 않은 재설정 토큰입니다/);

      // updatePassword was only called once (first time).
      expect(mockUserRepo.updatePassword).toHaveBeenCalledTimes(1);
    }, 15000);

    it('requestPasswordReset for unknown user → EmailService is NOT called (enumeration prevention preserved)', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);

      await authService.requestPasswordReset('unknown@test.com');

      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });
});

// CR-02 regression guard (Plan 09-04 Task 5):
// 기존 unit 테스트는 `mockJwtService.verifyAsync.mockImplementation(... opts.secret ...)` 로
// 서명 검증을 시뮬했는데, 실제 @nestjs/jwt `JwtService` 는 preliminary 호출
// `verifyAsync(token, { secret: jwtSecret, ignoreExpiration: true })` 에서 **서명을 실제로 검증**한다.
// 토큰은 `jwtSecret + user.passwordHash` 로 서명되어 있어 preliminary 단계에서 서명 key 가 일치하지 않아
// 합법 토큰도 항상 401 이 된다 (`bc3b434 fix(09): CR-01` regression).
//
// 아래 describe 는 실제 `JwtService` 를 주입해 integration 수준에서 regression 을 재현한다.
describe('resetPassword (integration — real JwtService — CR-02 regression guard)', () => {
  const jwtSecret = 'test-jwt-secret-for-reset-integration';
  let realJwtService: JwtService;
  let authServiceLocal: AuthService;
  let integUserRepo: {
    findByEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updatePassword: ReturnType<typeof vi.fn>;
  };
  let integConfig: { get: ReturnType<typeof vi.fn> };
  let integDb: {
    insert: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let integSms: {
    sendVerification: ReturnType<typeof vi.fn>;
    verifyCode: ReturnType<typeof vi.fn>;
    isPhoneVerified: ReturnType<typeof vi.fn>;
    verifyPhoneVerificationToken: ReturnType<typeof vi.fn>;
  };
  let integEmail: { sendPasswordResetEmail: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    // argon2 hash is expensive; `preHashedPassword` is shared from outer beforeAll.
    // If this integration block is executed before the outer one (it isn't under
    // current Vitest semantics, but defensive), re-hash here.
    if (!preHashedPassword) {
      preHashedPassword = await argon2.hash('Test1234!', {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    }
  }, 30000);

  beforeEach(() => {
    realJwtService = new JwtService({ secret: jwtSecret });

    integUserRepo = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updatePassword: vi.fn(),
    };
    integConfig = {
      get: vi.fn((key: string) => {
        if (key === 'auth.jwtSecret') return jwtSecret;
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        return undefined;
      }),
    };
    integDb = {
      insert: vi.fn(),
      select: vi.fn(),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
    };
    integSms = {
      sendVerification: vi.fn(),
      verifyCode: vi.fn(),
      isPhoneVerified: vi.fn(),
      verifyPhoneVerificationToken: vi.fn(),
    };
    integEmail = { sendPasswordResetEmail: vi.fn() };

    // Real constructor order: (jwtService, configService, userRepository, smsService, emailService, db, consentService)
    authServiceLocal = new AuthService(
      realJwtService,
      integConfig as unknown as ConfigService,
      integUserRepo as any,
      integSms as any,
      integEmail as any,
      integDb as any,
      {
        assertAgeAllowed: vi.fn(),
        assertRequiredConsents: vi.fn(),
        captureConsent: vi.fn(),
      } as any,
    );
  });

  it('정상 token (secret = jwtSecret + passwordHash) 은 preliminary 를 통과하고 resetPassword 를 성공적으로 완료한다', async () => {
    const userId = randomUUID();
    const user = { ...createMockUser(), id: userId, passwordHash: preHashedPassword };
    integUserRepo.findById.mockResolvedValue(user);

    const token = await realJwtService.signAsync(
      { sub: userId, purpose: 'password-reset' },
      { secret: jwtSecret + user.passwordHash, expiresIn: '1h' },
    );

    await expect(
      authServiceLocal.resetPassword(token, 'NewPass123!'),
    ).resolves.toBeUndefined();
    expect(integUserRepo.updatePassword).toHaveBeenCalledWith(userId, expect.any(String));
  }, 15000);

  it('sub 이 UUID 형식이 아니면 401 (DoS 가드 유지)', async () => {
    const token = await realJwtService.signAsync(
      { sub: 'not-a-uuid', purpose: 'password-reset' },
      { secret: jwtSecret + preHashedPassword, expiresIn: '1h' },
    );

    await expect(
      authServiceLocal.resetPassword(token, 'NewPass123!'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('passwordHash 누락된 secret 으로 서명된 token 은 final verify 에서 401 (회귀 가드)', async () => {
    const userId = randomUUID();
    const user = { ...createMockUser(), id: userId, passwordHash: preHashedPassword };
    integUserRepo.findById.mockResolvedValue(user);

    const tokenWithoutHash = await realJwtService.signAsync(
      { sub: userId, purpose: 'password-reset' },
      { secret: jwtSecret, expiresIn: '1h' }, // passwordHash 누락
    );

    await expect(
      authServiceLocal.resetPassword(tokenWithoutHash, 'NewPass123!'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
