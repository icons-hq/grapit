import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from './user.repository.js';
import type { UserProfile } from '@grabit/shared/types/user.types.js';
import { DEFAULT_LOCALE, isSupportedLocale } from '@grabit/shared/constants/locales.js';
import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  type AdminCapabilityBundle,
} from '@grabit/shared/schemas/admin-operations.schema.js';
import type { UpdateProfileInput } from '@grabit/shared/schemas/user.schema.js';
import { SmsService } from '../sms/sms.service.js';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly smsService: SmsService,
  ) {}

  async getUserProfile(userId: string): Promise<UserProfile> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }
    return this.mapToUserProfile(user);
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
      createdAt: user.createdAt.toISOString(),
    };
  }
}

function normalizeStoredPreferredLocale(locale: string | null): UserProfile['preferredLocale'] {
  if (!locale) return DEFAULT_LOCALE;
  if (isSupportedLocale(locale)) return locale;
  if (locale.toLowerCase() === 'zh-tw') return 'zh-CN';
  return DEFAULT_LOCALE;
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
