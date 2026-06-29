import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { JwtStrategy } from './jwt.strategy.js';

function makeConfigService(): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'auth.jwtSecret') return 'test-jwt-secret';
      return undefined;
    }),
  } as unknown as ConfigService;
}

function makeUserRepository(accountStatus: 'active' | 'withdrawn' | 'merged') {
  return {
    findById: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'buyer@example.com',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
      isEmailVerified: true,
      isPhoneVerified: true,
      accountStatus,
    }),
  };
}

describe('JwtStrategy', () => {
  it('returns an authenticated principal for active users', async () => {
    const userRepository = makeUserRepository('active');
    const strategy = new JwtStrategy(makeConfigService(), userRepository as never);

    await expect(
      strategy.validate({ sub: 'user-1', email: 'buyer@example.com', role: 'user' }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'buyer@example.com',
      role: 'user',
      adminCapabilityBundle: null,
      adminCapabilities: [],
      isEmailVerified: true,
      isPhoneVerified: true,
    });
  });

  it.each(['withdrawn', 'merged'] as const)(
    'rejects %s users even when their access token has not expired',
    async (accountStatus) => {
      const userRepository = makeUserRepository(accountStatus);
      const strategy = new JwtStrategy(makeConfigService(), userRepository as never);

      await expect(
        strategy.validate({ sub: 'user-1', email: 'buyer@example.com', role: 'user' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );
});
