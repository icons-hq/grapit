import { BadRequestException, ConflictException } from '@nestjs/common';
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
  let smsService: Pick<SmsService, 'claimPhoneVerificationToken'>;
  let releasePhoneClaim: ReturnType<typeof vi.fn>;
  let db: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let tx: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  // Calls in transaction order: the account row lock, then the blocker read.
  let txCalls: string[];
  let lockedAccountStatus: string;
  let blockerRows: Array<Record<string, unknown>>;
  let auditService: { write: ReturnType<typeof vi.fn> };
  let service: UserService;

  beforeEach(() => {
    repository = {
      findById: vi.fn().mockResolvedValue(baseUser),
      updateProfile: vi.fn().mockResolvedValue(baseUser),
    } as unknown as Pick<UserRepository, 'findById' | 'updateProfile'>;
    releasePhoneClaim = vi.fn().mockResolvedValue(undefined);
    smsService = {
      claimPhoneVerificationToken: vi.fn().mockResolvedValue({ release: releasePhoneClaim }),
    };
    txCalls = [];
    lockedAccountStatus = 'active';
    blockerRows = [];
    // users ... FOR UPDATE, or reservations LEFT JOIN showtimes ... LIMIT n.
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn((strength: string) => {
            txCalls.push(`lock users ${strength}`);
            return Promise.resolve([{ accountStatus: lockedAccountStatus }]);
          }),
        })),
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => {
              txCalls.push('read blockers');
              return Promise.resolve(blockerRows);
            }),
          })),
        })),
      })),
    }));
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
    tx = { select, update, delete: deleteFn };
    db = {
      select,
      update,
      delete: deleteFn,
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
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

  it('preserves scanner authority when refreshing the signed-in profile', async () => {
    vi.mocked(repository.findById).mockResolvedValue({ ...baseUser, role: 'admin', adminCapabilityBundle: 'scanner', adminCapabilities: [] } as never);
    await expect(service.getUserProfile('user-1')).resolves.toMatchObject({ adminCapabilityBundle: 'scanner' });
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

    expect(smsService.claimPhoneVerificationToken).toHaveBeenCalledWith(
      'signed-profile-phone-token',
      { phone: '+821099998888', purpose: 'profile_phone_change' },
    );
    expect(repository.updateProfile).toHaveBeenCalledWith('user-1', {
      phone: '+821099998888',
      isPhoneVerified: true,
    });
    expect(releasePhoneClaim).not.toHaveBeenCalled();
  });

  it('rejects a phone verification token that was already consumed before writing the profile', async () => {
    vi.mocked(smsService.claimPhoneVerificationToken).mockRejectedValueOnce(
      new BadRequestException('이미 사용된 전화번호 인증입니다. 휴대폰 인증을 다시 진행해주세요.'),
    );

    await expect(
      service.updateProfile('user-1', {
        phone: '+821099998888',
        phoneVerificationToken: 'reused-profile-phone-token',
      }),
    ).rejects.toThrow('이미 사용된 전화번호 인증입니다');
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it('releases the consumed phone verification token when the profile write fails', async () => {
    const writeError = new Error('db unavailable');
    vi.mocked(repository.updateProfile).mockRejectedValueOnce(writeError);

    await expect(
      service.updateProfile('user-1', {
        phone: '+821099998888',
        phoneVerificationToken: 'signed-profile-phone-token',
      }),
    ).rejects.toBe(writeError);
    expect(releasePhoneClaim).toHaveBeenCalledTimes(1);
  });

  it('does not consume a phone token when the phone is unchanged and already verified', async () => {
    await service.updateProfile('user-1', {
      phone: baseUser.phone,
      phoneVerificationToken: 'unused-proof',
      marketingConsent: true,
    });
    expect(smsService.claimPhoneVerificationToken).not.toHaveBeenCalled();
  });

  it('verifies an existing unverified phone with the same purpose-bound proof', async () => {
    vi.mocked(repository.findById).mockResolvedValue({ ...baseUser, isPhoneVerified: false } as never);
    await service.updateProfile('user-1', { phone: baseUser.phone, phoneVerificationToken: 'current-phone-proof' });
    expect(smsService.claimPhoneVerificationToken).toHaveBeenCalledWith('current-phone-proof', {
      phone: baseUser.phone, purpose: 'profile_phone_change',
    });
    expect(repository.updateProfile).toHaveBeenCalledWith('user-1', { phone: baseUser.phone, isPhoneVerified: true });
  });

  it('does not verify the existing phone without proof', async () => {
    vi.mocked(repository.findById).mockResolvedValue({ ...baseUser, isPhoneVerified: false } as never);
    await expect(service.updateProfile('user-1', { phone: baseUser.phone })).rejects.toThrow('전화번호 인증이 필요합니다');
    expect(repository.updateProfile).not.toHaveBeenCalled();
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

  it('checks blockers on the locked account row inside the withdrawal transaction (audit #44)', async () => {
    await service.withdrawSelf('user-1', { reason: '서비스 이용 종료', confirmed: true });

    // The row lock comes first, then the blocker read, both on the transaction.
    expect(txCalls).toEqual(['lock users update', 'read blockers']);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses self withdrawal when a payment committed before the lock, without writing anything', async () => {
    blockerRows = [{
      id: 'reservation-1',
      reservationNumber: 'R-1',
      status: 'PENDING_PAYMENT',
      showtimeAt: new Date('2026-10-10T10:00:00.000Z'),
    }];

    const error = await service
      .withdrawSelf('user-1', { reason: '서비스 이용 종료', confirmed: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'ACCOUNT_WITHDRAWAL_BLOCKED',
      blockers: [expect.objectContaining({ reservationNumber: 'R-1', status: 'PENDING_PAYMENT' })],
    });
    expect(txCalls).toEqual(['lock users update', 'read blockers']);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('does not withdraw again when the locked row was withdrawn by a concurrent request', async () => {
    lockedAccountStatus = 'withdrawn';

    await expect(
      service.withdrawSelf('user-1', { reason: '서비스 이용 종료', confirmed: true }),
    ).resolves.toMatchObject({ accountStatus: 'withdrawn' });

    expect(txCalls).toEqual(['lock users update']);
    expect(tx.update).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
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
