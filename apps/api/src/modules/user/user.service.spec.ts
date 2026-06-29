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
  accountStatus: 'active',
  withdrawnAt: null,
  createdAt: new Date('2026-05-06T00:00:00Z'),
};

describe('UserService preferred locale persistence', () => {
  let repository: Pick<UserRepository, 'findById' | 'updateProfile'>;
  let smsService: Pick<SmsService, 'verifyPhoneVerificationToken'>;
  let db: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let auditService: { write: ReturnType<typeof vi.fn> };
  let service: UserService;

  beforeEach(() => {
    repository = {
      findById: vi.fn().mockResolvedValue(baseUser),
      updateProfile: vi.fn().mockResolvedValue(baseUser),
    } as unknown as Pick<UserRepository, 'findById' | 'updateProfile'>;
    smsService = {
      verifyPhoneVerificationToken: vi.fn(),
    };
    const reservationWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    const reservationJoin = vi.fn().mockReturnValue({ where: reservationWhere });
    const reservationFrom = vi.fn().mockReturnValue({ leftJoin: reservationJoin });
    const select = vi.fn().mockReturnValue({ from: reservationFrom });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const updateReturning = vi.fn().mockResolvedValue([
      {
        ...baseUser,
        passwordHash: null,
        marketingConsent: false,
        accountStatus: 'withdrawn',
        withdrawnAt: new Date('2026-05-18T00:00:00Z'),
      },
    ]);
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: updateReturning }),
    });
    const update = vi.fn().mockReturnValue({ set: updateSet, where: updateWhere });
    const deleteWhere = vi.fn().mockResolvedValue([]);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    const tx = { update, delete: deleteFn };
    db = {
      select,
      update,
      delete: deleteFn,
      transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    auditService = { write: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    service = new UserService(
      repository as UserRepository,
      smsService as SmsService,
      db as never,
      auditService as never,
    );
  });

  it('returns preferredLocale when reading the logged-in user profile', async () => {
    await expect(service.getUserProfile('user-1')).resolves.toMatchObject({
      preferredLocale: 'en',
      marketingConsent: false,
    });
  });

  it('preserves merged account status when reading the logged-in user profile', async () => {
    vi.mocked(repository.findById).mockResolvedValue({
      ...baseUser,
      accountStatus: 'merged',
    } as never);

    await expect(service.getUserProfile('user-1')).resolves.toMatchObject({
      accountStatus: 'merged',
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

  it.each(['withdrawn', 'merged'] as const)(
    'rejects %s account profile updates before repository writes',
    async (accountStatus) => {
      vi.mocked(repository.findById).mockResolvedValue({
        ...baseUser,
        accountStatus,
      } as never);

      await expect(
        service.updateProfile('user-1', { marketingConsent: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.updateProfile).not.toHaveBeenCalled();
    },
  );

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

  it('withdraws the current user and writes a user.withdraw audit event', async () => {
    await expect(
      service.withdrawSelf(
        'user-1',
        { reason: '서비스 이용 종료', confirmed: true },
        { ipAddress: '203.0.113.10', userAgent: 'Vitest', requestId: 'req-1' },
      ),
    ).resolves.toMatchObject({
      accountStatus: 'withdrawn',
      marketingConsent: false,
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        action: 'user.withdraw',
        resourceType: 'user',
        resourceId: 'user-1',
        reason: '서비스 이용 종료',
        ipAddress: '203.0.113.10',
      }),
      expect.anything(),
    );
  });

  it('treats merged account self withdrawal as idempotent without overwriting status', async () => {
    vi.mocked(repository.findById).mockResolvedValue({
      ...baseUser,
      accountStatus: 'merged',
    } as never);

    await expect(
      service.withdrawSelf('user-1', {
        reason: '서비스 이용 종료',
        confirmed: true,
      }),
    ).resolves.toMatchObject({
      accountStatus: 'merged',
    });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });
});
