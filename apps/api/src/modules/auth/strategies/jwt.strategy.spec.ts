import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
    findAuthPrincipalById: vi.fn().mockResolvedValue({
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
  const jwt = new JwtService({ secret: 'test-jwt-secret' });
  const authenticate = (strategy: JwtStrategy, token: string) => new Promise<unknown>((resolve, reject) => {
    strategy.success = (user) => resolve(user);
    strategy.fail = (error) => reject(error);
    strategy.error = (error) => reject(error);
    strategy.authenticate({ headers: { authorization: `Bearer ${token}` } } as never);
  });

  it('verifies a real token with the prepared key before reading current account authority', async () => {
    const repository = makeUserRepository('active');
    const strategy = new JwtStrategy(makeConfigService(), repository as never);
    const token = jwt.sign({ sub: 'user-1', role: 'admin' }, { expiresIn: '1h' });
    await expect(authenticate(strategy, token)).resolves.toMatchObject({ id: 'user-1', role: 'user' });
    repository.findAuthPrincipalById.mockResolvedValueOnce({
      ...(await repository.findAuthPrincipalById()), accountStatus: 'withdrawn',
    });
    await expect(authenticate(strategy, token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['expired', 'wrong-key', 'unsigned'] as const)('rejects %s tokens before account lookup', async (kind) => {
    const repository = makeUserRepository('active');
    const strategy = new JwtStrategy(makeConfigService(), repository as never);
    let token = jwt.sign({ sub: 'user-1' }, {
      secret: kind === 'wrong-key' ? 'another-key' : 'test-jwt-secret',
      expiresIn: kind === 'expired' ? -1 : '1h',
    });
    if (kind === 'unsigned') token = `${token.split('.').slice(0, 2).join('.')}.`;
    await expect(authenticate(strategy, token)).rejects.toBeInstanceOf(Error);
    expect(repository.findAuthPrincipalById).not.toHaveBeenCalled();
  });

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
