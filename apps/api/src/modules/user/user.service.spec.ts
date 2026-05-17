import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from './user.service.js';
import type { UserRepository } from './user.repository.js';
import type { SmsService } from '../sms/sms.service.js';

const baseUser = {
  id: 'user-1',
  email: 'fan@example.com',
  name: 'Fan',
  phone: '+821012345678',
  gender: 'unspecified' as const,
  country: 'KR',
  birthDate: '1990-01-01',
  preferredLocale: 'en',
  isEmailVerified: true,
  isPhoneVerified: true,
  marketingConsent: false,
  role: 'user',
  createdAt: new Date('2026-05-06T00:00:00Z'),
};

describe('UserService preferred locale persistence', () => {
  let repository: Pick<UserRepository, 'findById' | 'updateProfile'>;
  let smsService: Pick<SmsService, 'verifyPhoneVerificationToken'>;
  let service: UserService;

  beforeEach(() => {
    repository = {
      findById: vi.fn().mockResolvedValue(baseUser),
      updateProfile: vi.fn().mockResolvedValue(baseUser),
    } as unknown as Pick<UserRepository, 'findById' | 'updateProfile'>;
    smsService = {
      verifyPhoneVerificationToken: vi.fn(),
    };
    service = new UserService(
      repository as UserRepository,
      smsService as SmsService,
    );
  });

  it('returns preferredLocale when reading the logged-in user profile', async () => {
    await expect(service.getUserProfile('user-1')).resolves.toMatchObject({
      preferredLocale: 'en',
      marketingConsent: false,
    });
  });

  it('persists supported preferredLocale updates for logged-in users', async () => {
    vi.mocked(repository.updateProfile).mockResolvedValue({
      ...baseUser,
      preferredLocale: 'zh-CN',
    } as never);

    await expect(
      service.updateProfile('user-1', { preferredLocale: 'zh-CN' } as never),
    ).resolves.toMatchObject({ preferredLocale: 'zh-CN' });
    expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
      preferredLocale: 'zh-CN',
    });
  });

  it('persists marketing consent updates through the existing profile path', async () => {
    vi.mocked(repository.updateProfile).mockResolvedValue({
      ...baseUser,
      marketingConsent: true,
    } as never);

    await expect(
      service.updateProfile('user-1', { marketingConsent: true }),
    ).resolves.toMatchObject({ marketingConsent: true });
    expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
      marketingConsent: true,
    });
  });

  it('requires a purpose-bound verification token when phone changes', async () => {
    vi.mocked(repository.updateProfile).mockResolvedValue({
      ...baseUser,
      phone: '+821099998888',
      isPhoneVerified: true,
    } as never);

    await expect(
      service.updateProfile('user-1', {
        phone: '+821099998888',
        phoneVerificationToken: 'signed-profile-phone-token',
      }),
    ).resolves.toMatchObject({
      phone: '+821099998888',
      isPhoneVerified: true,
    });

    expect(smsService.verifyPhoneVerificationToken).toHaveBeenCalledWith(
      'signed-profile-phone-token',
      { phone: '+821099998888', purpose: 'profile_phone_change' },
    );
    expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
      phone: '+821099998888',
      isPhoneVerified: true,
    });
  });

  it('rejects phone changes without verification token before repository writes', async () => {
    await expect(
      service.updateProfile('user-1', { phone: '+821099998888' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects unsupported preferredLocale updates before repository writes', async () => {
    const staleLocale = ['zh', 'TW'].join('-');

    await expect(
      service.updateProfile('user-1', { preferredLocale: staleLocale } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });
});
