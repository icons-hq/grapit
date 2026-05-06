import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from './user.service.js';
import type { UserRepository } from './user.repository.js';

const baseUser = {
  id: 'user-1',
  email: 'fan@example.com',
  name: 'Fan',
  phone: '+821012345678',
  gender: 'unspecified' as const,
  country: 'KR',
  birthDate: '1990-01-01',
  preferredLocale: 'en',
  isPhoneVerified: true,
  role: 'user',
  createdAt: new Date('2026-05-06T00:00:00Z'),
};

describe('UserService preferred locale persistence', () => {
  let repository: Pick<UserRepository, 'findById' | 'updateProfile'>;
  let service: UserService;

  beforeEach(() => {
    repository = {
      findById: vi.fn().mockResolvedValue(baseUser),
      updateProfile: vi.fn().mockResolvedValue(baseUser),
    } as unknown as Pick<UserRepository, 'findById' | 'updateProfile'>;
    service = new UserService(repository as UserRepository);
  });

  it('returns preferredLocale when reading the logged-in user profile', async () => {
    await expect(service.getUserProfile('user-1')).resolves.toMatchObject({
      preferredLocale: 'en',
    });
  });

  it('persists supported preferredLocale updates for logged-in users', async () => {
    vi.mocked(repository.updateProfile).mockResolvedValue({
      ...baseUser,
      preferredLocale: 'th',
    } as never);

    await expect(
      service.updateProfile('user-1', { preferredLocale: 'th' } as never),
    ).resolves.toMatchObject({ preferredLocale: 'th' });
    expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
      preferredLocale: 'th',
    });
  });

  it('rejects unsupported preferredLocale updates before repository writes', async () => {
    await expect(
      service.updateProfile('user-1', { preferredLocale: 'ja' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });
});
