import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { UserRepository } from './user.repository.js';
import type { UserProfile } from '@grabit/shared/types/user.types.js';
import { DEFAULT_LOCALE, isSupportedLocale } from '@grabit/shared/constants/locales.js';
import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  type AdminCapabilityBundle,
} from '@grabit/shared/schemas/admin-operations.schema.js';
import type { UpdateProfileInput } from '@grabit/shared/schemas/user.schema.js';
import { accountWithdrawalSchema, type AccountWithdrawalInput } from '@grabit/shared/schemas/user.schema.js';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  refreshTokens,
  reservations,
  showtimes,
  socialAccounts,
  users,
} from '../../database/schema/index.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { SmsService } from '../sms/sms.service.js';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly smsService: SmsService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditService: AdminAuditService,
  ) {}

  async getUserProfile(userId: string): Promise<UserProfile> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }
    return this.mapToUserProfile(user);
  }

  async withdrawSelf(
    userId: string,
    input: AccountWithdrawalInput,
    context: UserWithdrawalContext = {},
  ): Promise<UserProfile> {
    const parsed = accountWithdrawalSchema.parse(input);
    const currentUser = await this.userRepository.findById(userId);
    if (!currentUser) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }
    if (
      currentUser.accountStatus === 'withdrawn' ||
      currentUser.accountStatus === 'merged'
    ) {
      return this.mapToUserProfile(currentUser);
    }

    const blockers = await this.findActiveReservationBlockers(userId);
    if (blockers.length > 0) {
      throw new ConflictException({
        code: 'ACCOUNT_WITHDRAWAL_BLOCKED',
        message: '진행 중인 예매가 있어 회원 탈퇴를 처리할 수 없습니다',
        blockers,
      });
    }

    const now = new Date();
    let updatedUser = currentUser;

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          passwordHash: null,
          marketingConsent: false,
          role: 'user',
          adminCapabilityBundle: null,
          adminCapabilities: [],
          accountStatus: 'withdrawn',
          withdrawnAt: now,
          withdrawalReason: parsed.reason?.trim() || null,
          withdrawnByUserId: userId,
          withdrawalSource: 'self',
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning();

      updatedUser = row ?? currentUser;

      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

      await tx
        .delete(socialAccounts)
        .where(eq(socialAccounts.userId, userId));

      await this.auditService.write(
        {
          actorUserId: userId,
          action: 'user.withdraw',
          resourceType: 'user',
          resourceId: userId,
          status: 'success',
          reason: parsed.reason?.trim() || 'self withdrawal',
          changedFields: [
            'accountStatus',
            'withdrawnAt',
            'withdrawalSource',
            'marketingConsent',
            'role',
            'adminCapabilityBundle',
            'adminCapabilities',
            'socialAccounts',
          ],
          before: {
            accountStatus: currentUser.accountStatus ?? 'active',
            email: currentUser.email,
            phone: currentUser.phone,
            marketingConsent: currentUser.marketingConsent,
            role: currentUser.role,
            adminCapabilityBundle: currentUser.adminCapabilityBundle,
            adminCapabilities: currentUser.adminCapabilities,
          },
          after: {
            accountStatus: 'withdrawn',
            withdrawnAt: now.toISOString(),
            withdrawalSource: 'self',
            email: currentUser.email,
            phone: currentUser.phone,
            marketingConsent: false,
            role: 'user',
            adminCapabilityBundle: null,
            adminCapabilities: [],
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        },
        tx,
      );
    });

    return this.mapToUserProfile(updatedUser);
  }

  private async findActiveReservationBlockers(userId: string) {
    const rows = await this.db
      .select({
        id: reservations.id,
        reservationNumber: reservations.reservationNumber,
        status: reservations.status,
        showtimeAt: showtimes.dateTime,
      })
      .from(reservations)
      .leftJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .where(
        and(
          eq(reservations.userId, userId),
          or(
            eq(reservations.status, 'PENDING_PAYMENT'),
            and(eq(reservations.status, 'CONFIRMED'), gt(showtimes.dateTime, new Date())),
          )!,
        ),
      )
      .limit(10);

    return rows.map((row) => ({
      id: row.id,
      reservationNumber: row.reservationNumber,
      status: row.status,
      showtimeAt: row.showtimeAt?.toISOString() ?? null,
    }));
  }

  async updateProfile(
    userId: string,
    data: UpdateProfileInput,
  ): Promise<UserProfile> {
    // D-06 precedence remains: url > explicit-switch > user-profile > cookie > ko.
    if (
      data.preferredLocale !== undefined &&
      !isSupportedLocale(data.preferredLocale)
    ) {
      throw new BadRequestException('지원하지 않는 언어입니다');
    }

    const currentUser = await this.userRepository.findById(userId);
    if (!currentUser) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }
    if (
      currentUser.accountStatus === 'withdrawn' ||
      currentUser.accountStatus === 'merged'
    ) {
      throw new BadRequestException('비활성 계정은 프로필을 수정할 수 없습니다');
    }

    const updateData: Partial<
      Pick<
        UserProfile,
        'name' | 'phone' | 'preferredLocale' | 'isPhoneVerified' | 'marketingConsent'
      >
    > = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.preferredLocale !== undefined) {
      updateData.preferredLocale = data.preferredLocale;
    }
    if (data.marketingConsent !== undefined) {
      updateData.marketingConsent = data.marketingConsent;
    }
    if (data.phone !== undefined && data.phone !== currentUser.phone) {
      if (!data.phoneVerificationToken) {
        throw new BadRequestException('전화번호 인증이 필요합니다');
      }
      this.smsService.verifyPhoneVerificationToken(data.phoneVerificationToken, {
        phone: data.phone,
        purpose: 'profile_phone_change',
      });
      updateData.phone = data.phone;
      updateData.isPhoneVerified = true;
    }

    const user = await this.userRepository.updateProfile(userId, updateData);
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }
    return this.mapToUserProfile(user);
  }

  private mapToUserProfile(user: {
    id: string;
    email: string;
    name: string;
    phone: string;
    gender: 'male' | 'female' | 'unspecified';
    country: string;
    birthDate: string;
    preferredLocale: string | null;
    isEmailVerified: boolean;
    isPhoneVerified: boolean;
    marketingConsent: boolean;
    role: string;
    adminCapabilityBundle?: string | null;
    adminCapabilities?: readonly string[] | null;
    accountStatus?: string | null;
    withdrawnAt?: Date | null;
    createdAt: Date;
  }): UserProfile {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      gender: user.gender,
      country: user.country,
      birthDate: user.birthDate,
      preferredLocale: normalizeStoredPreferredLocale(user.preferredLocale),
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      marketingConsent: user.marketingConsent,
      role: user.role as 'user' | 'admin',
      adminCapabilityBundle: normalizeAdminCapabilityBundle(user.adminCapabilityBundle),
      adminCapabilities: normalizeAdminCapabilities(user.adminCapabilities),
      accountStatus: normalizeAccountStatus(user.accountStatus),
      withdrawnAt: user.withdrawnAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

export interface UserWithdrawalContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

function normalizeStoredPreferredLocale(locale: string | null): UserProfile['preferredLocale'] {
  if (!locale) return DEFAULT_LOCALE;
  if (isSupportedLocale(locale)) return locale;
  if (locale.toLowerCase() === 'zh-tw') return 'zh-CN';
  return DEFAULT_LOCALE;
}

function normalizeAccountStatus(
  status: string | null | undefined,
): UserProfile['accountStatus'] {
  if (status === 'withdrawn' || status === 'merged') return status;
  return 'active';
}

function normalizeAdminCapabilities(
  capabilities: readonly string[] | null | undefined,
): AdminCapability[] {
  if (!capabilities) return [];
  return ADMIN_CAPABILITIES.filter((capability) =>
    capabilities.includes(capability),
  );
}

function normalizeAdminCapabilityBundle(
  bundle: string | null | undefined,
): AdminCapabilityBundle | null {
  if (
    bundle === 'operator' ||
    bundle === 'reviewer' ||
    bundle === 'approver' ||
    bundle === 'finance' ||
    bundle === 'admin'
  ) {
    return bundle;
  }
  return null;
}
