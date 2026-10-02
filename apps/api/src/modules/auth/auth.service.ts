import {
  Injectable,
  Inject,
  ConflictException,
  UnauthorizedException,
  GoneException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import type IORedis from 'ioredis';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import * as schema from '../../database/schema/index.js';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import { UserRepository } from '../user/user.repository.js';
import { SmsService, releasePhoneClaimAndRethrow } from '../sms/sms.service.js';
import type { PhoneVerificationClaim, SmsVerificationPurpose } from '../sms/sms.service.js';
import { EmailService } from './email/email.service.js';
import { ConsentService } from '../consent/consent.service.js';
import type { ConsentRequestMeta } from '../consent/consent.service.js';
import { isSocialPlaceholderEmail } from '../../common/email-address.js';
import { isSameAuthEmail, normalizeAuthEmail } from './auth-email.js';
import {
  hashSocialRegistrationBinding,
  isSocialRegistrationBindingValid,
} from './social-oauth-state.js';
import type { RegisterBody } from './dto/register.dto.js';
import type { SocialRegisterBody } from './dto/social-register.dto.js';
import type { SocialProfile } from './interfaces/social-profile.interface.js';
import type { UserProfile } from '@grabit/shared/types/user.types.js';
import type {
  AdminCapability,
  AdminCapabilityBundle,
} from '@grabit/shared/types/admin-operations.types.js';
import { ADMIN_CAPABILITIES, adminCapabilityBundleSchema } from '@grabit/shared/schemas/admin-operations.schema.js';
import type {
  EmailAvailabilityResponse,
  SocialAuthResult,
} from '@grabit/shared/types/auth.types.js';
import {
  DEFAULT_LOCALE,
  REFRESH_TOKEN_EXPIRY_DAYS,
  isSupportedLocale,
} from '@grabit/shared/constants/index.js';
import { normalizeMergeName } from '../account-merge/account-merge-policy.js';
import { resolveAuthReturnTo } from '@grabit/shared';

// UUID v4 형식 검증용 regex. resetPassword 경로에서 DB lookup 전
// sub 클레임이 실제 UUID임을 보장하여 payload-amplification DoS와
// PostgreSQL 22P02(invalid uuid) 예외 누출을 차단한다.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ValidatedUser {
  id: string;
  email: string;
  role: string;
  name: string;
  phone: string;
  gender: 'male' | 'female' | 'unspecified';
  country: string;
  birthDate: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  marketingConsent: boolean;
  createdAt: Date;
  adminCapabilityBundle?: string | null;
  adminCapabilities?: AdminCapability[] | readonly string[] | null;
  accountStatus?: string | null;
  withdrawnAt?: Date | null;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  deviceLimitNotice?: string;
}

interface AuthResult extends TokenPair {
  user: UserProfile;
}

interface RegistrationPendingResult {
  emailVerificationRequired: true;
  emailDeliveryFailed?: boolean;
  email: string;
  verificationExpiresAt: Date;
  user: UserProfile;
}

const EMAIL_VERIFICATION_EXPIRY_MS = 30 * 60 * 1000;
const EMAIL_VERIFICATION_PURPOSE = 'signup';
const ACCOUNT_EMAIL_VERIFICATION_PURPOSE = 'account_email';
const EMAIL_VERIFICATION_CODE_DIGITS = 6;
/**
 * Guesses allowed per issued code (audit #12). The route throttle is per email
 * and IP, so a distributed guesser could otherwise try most of the 10^6 codes
 * within the 30-minute lifetime. The last allowed wrong guess invalidates the
 * code; the buyer then requests a new one.
 */
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
export const EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED_MESSAGE =
  '인증번호 입력 횟수를 초과했습니다. 새 인증 메일을 요청해주세요.';
const EMAIL_VERIFICATION_ATTEMPT_KEY_PREFIX = 'auth:email-verification-attempts:';
// Atomic INCR; the first attempt sets the TTL to the code's remaining lifetime.
const EMAIL_VERIFICATION_ATTEMPT_INCR_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;
const USER_REFRESH_FAMILY_LIMIT = 2;
/**
 * A rotated refresh token stays usable for this long. Several tabs (or a retry
 * after a lost response) presenting the same parent inside the window receive the
 * same child token instead of tripping token-reuse detection.
 */
export const REFRESH_ROTATION_GRACE_MS = 30 * 1000;
const REFRESH_ROTATION_MAX_DESCENDANT_DEPTH = 5;
const REFRESH_TOKEN_REUSE_MESSAGE = '토큰이 재사용되었습니다. 보안을 위해 해당 세션이 종료됩니다.';
const SOCIAL_REGISTRATION_BINDING_MESSAGE = '소셜 로그인 확인이 만료되었습니다. 소셜 로그인을 다시 진행해주세요.';
const REFRESH_FAMILY_LIMIT_NOTICE = '다른 기기에서 로그인되어 가장 오래된 세션이 종료되었습니다.';
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';
const LOCAL_FRONTEND_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userRepository: UserRepository,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly consentService: ConsentService,
    @Inject(REDIS_CLIENT) private readonly redis: Pick<IORedis, 'eval'>,
  ) {}

  async checkEmailAvailability(email: string): Promise<EmailAvailabilityResponse> {
    const existing = await this.userRepository.findByEmail(email);

    return { available: !existing };
  }

  async register(
    dto: RegisterBody,
    requestMeta: ConsentRequestMeta = { ipAddress: '0.0.0.0' },
  ): Promise<RegistrationPendingResult> {
    this.consentService.assertAgeAllowed(dto.birthDate);
    await this.consentService.assertRequiredConsents({ items: dto.consentItems });

    // 0. Verify phone number with a server-signed token issued by /sms/verify-code.
    await this.assertPhoneVerified(
      dto.phone,
      dto.phoneVerificationToken,
      'signup',
    );

    // 1. Check email uniqueness (case-insensitive) and store the canonical lower-case form.
    const email = normalizeAuthEmail(dto.email);
    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('이미 사용 중인 이메일입니다');
    }

    // 2. Hash password with argon2id
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // Consume the single-use phone token right before the write; a failed
    // write releases it so the buyer can retry without another SMS.
    const phoneClaim = await this.claimPhoneVerification(
      dto.phone,
      dto.phoneVerificationToken,
      'signup',
    );
    const user = await this.db.transaction(async (tx) => {
      // 3. Insert user
      const createdUser = await this.userRepository.create({
        email,
        passwordHash,
        name: dto.name,
        phone: dto.phone,
        gender: dto.gender,
        country: dto.country,
        preferredLocale: dto.locale ?? DEFAULT_LOCALE,
        birthDate: dto.birthDate,
        marketingConsent: dto.marketingConsent,
        isPhoneVerified: true,
      }, tx);

      // 4. Insert terms agreement and consent audit in the same transaction.
      await tx.insert(schema.termsAgreements).values({
        userId: createdUser.id,
        termsOfService: dto.termsOfService,
        privacyPolicy: dto.privacyPolicy,
        marketingConsent: dto.marketingConsent,
      });

      await this.consentService.captureConsent(
        createdUser.id,
        {
          birthDate: dto.birthDate,
          items: dto.consentItems,
          sourceFlow: 'signup',
        },
        requestMeta,
        tx,
      );

      return createdUser;
    }).catch(releasePhoneClaimAndRethrow(phoneClaim));

    const verification = await this.issueEmailVerificationForUser(
      user.id,
      user.email,
      dto.locale,
    );

    return {
      emailVerificationRequired: true,
      email: user.email,
      verificationExpiresAt: verification.expiresAt,
      ...(verification.emailDeliveryFailed ? { emailDeliveryFailed: true } : {}),
      user: this.mapToProfile(user),
    };
  }

  async login(user: ValidatedUser): Promise<AuthResult> {
    const tokens = await this.generateTokenPair(
      user.id,
      user.email,
      user.role,
      normalizeAdminCapabilityBundle(user.adminCapabilityBundle),
      user.adminCapabilities,
    );

    return {
      ...tokens,
      user: this.mapToProfile(user),
    };
  }

  async validateUser(email: string, password: string): Promise<ValidatedUser> {
    const user = await this.userRepository.findByEmail(email);

    if (!user || !user.passwordHash || this.isInactiveAccount(user)) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 일치하지 않습니다');
    }

    const isValid = await argon2.verify(user.passwordHash, password);
    if (!isValid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 일치하지 않습니다');
    }

    // Return user without passwordHash
    const { passwordHash: _passwordHash, ...userWithoutPassword } = user;
    void _passwordHash;
    return userWithoutPassword as ValidatedUser;
  }

  async refreshTokens(
    oldRawToken: string,
  ): Promise<TokenPair> {
    // 1. Hash the incoming raw token
    const tokenHash = hashRefreshToken(oldRawToken);

    // 2. Find refresh token by hash
    const tokenRecord = await this.findRefreshTokenByHash(tokenHash);

    // 3. Token not found
    if (!tokenRecord) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다');
    }

    // 4. Token already revoked: a just-rotated parent replayed by another tab or a
    //    retry gets the same child; any other reuse is treated as theft.
    if (tokenRecord.revokedAt) {
      return this.resolveRevokedRefreshToken(oldRawToken, tokenRecord);
    }

    // 5. Check expiration
    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('리프레시 토큰이 만료되었습니다');
    }

    // 6. Derive the child token deterministically so a concurrent or retried
    //    rotation of the same parent converges on the same child.
    const derivedRawToken = this.deriveRotatedRefreshToken(oldRawToken);
    // Without a server secret the child cannot be private, so fall back to a random
    // child (rotation still works, the grace window does not apply).
    const newRawToken = derivedRawToken ?? randomBytes(32).toString('hex');
    const newTokenHash = hashRefreshToken(newRawToken);
    const now = new Date();
    const newTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    // 7. Fetch current user for up-to-date role/email
    const user = await this.userRepository.findById(tokenRecord.userId);
    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다');
    }
    if (this.isInactiveAccount(user)) {
      await this.revokeRefreshTokenFamily(tokenRecord.family);
      throw new UnauthorizedException('탈퇴 처리된 계정입니다');
    }

    const rotated = await this.db.transaction(async (tx) => {
      const revokedRows = await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.refreshTokens.id, tokenRecord.id),
            isNull(schema.refreshTokens.revokedAt),
          ),
        )
        .returning({ id: schema.refreshTokens.id });

      if (revokedRows.length === 0) {
        // Another request revoked this parent first; nothing is written here.
        return false;
      }

      await tx.insert(schema.refreshTokens).values({
        userId: tokenRecord.userId,
        tokenHash: newTokenHash,
        family: tokenRecord.family,
        expiresAt: newTokenExpiresAt,
      });
      return true;
    });

    if (!rotated) {
      if (!derivedRawToken) {
        // A random child cannot be found again, so the grace decision would revoke the
        // winner's family. Reject only this request, as before deterministic children.
        throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다');
      }
      // The conditional UPDATE waited for the winning transaction, so its revoke and
      // child row are committed now. Re-read and apply the same grace decision.
      const committedRecord = await this.findRefreshTokenByHash(tokenHash);
      if (!committedRecord?.revokedAt) {
        throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다');
      }
      return this.resolveRevokedRefreshToken(oldRawToken, committedRecord);
    }

    // 8. Generate new access token with full claims
    const accessToken = await this.signAccessTokenForUser(tokenRecord.userId, user);

    return { accessToken, refreshToken: newRawToken };
  }

  /**
   * Handles a refresh token that is already revoked.
   *
   * Inside REFRESH_ROTATION_GRACE_MS of its revocation, if the rotation chain that
   * started at this token still ends in an active child of the same family, the
   * caller receives that child again (no new row, no family revoke). This keeps
   * concurrent tabs and lost-response retries signed in. Everything else — reuse
   * after the window, or a token revoked by logout/password reset/family revoke —
   * keeps the theft response: revoke the family and reject.
   */
  private async resolveRevokedRefreshToken(
    rawToken: string,
    tokenRecord: typeof schema.refreshTokens.$inferSelect,
  ): Promise<TokenPair> {
    const revokedAt = tokenRecord.revokedAt;
    const withinGrace =
      revokedAt !== null && Date.now() - revokedAt.getTime() <= REFRESH_ROTATION_GRACE_MS;

    if (withinGrace) {
      const descendant = await this.findActiveRotationDescendant(rawToken, tokenRecord);
      if (descendant) {
        const user = await this.userRepository.findById(tokenRecord.userId);
        if (!user) {
          throw new UnauthorizedException('사용자를 찾을 수 없습니다');
        }
        if (this.isInactiveAccount(user)) {
          await this.revokeRefreshTokenFamily(tokenRecord.family);
          throw new UnauthorizedException('탈퇴 처리된 계정입니다');
        }

        this.logger.debug('Refresh token replayed inside the rotation grace window; reusing the active child');
        const accessToken = await this.signAccessTokenForUser(tokenRecord.userId, user);
        return { accessToken, refreshToken: descendant.rawToken };
      }
    }

    await this.revokeRefreshTokenFamily(tokenRecord.family);
    throw new UnauthorizedException(REFRESH_TOKEN_REUSE_MESSAGE);
  }

  private async findActiveRotationDescendant(
    rawToken: string,
    tokenRecord: typeof schema.refreshTokens.$inferSelect,
  ): Promise<{ rawToken: string } | null> {
    const now = new Date();
    let currentRawToken = rawToken;

    for (let depth = 0; depth < REFRESH_ROTATION_MAX_DESCENDANT_DEPTH; depth += 1) {
      const childRawToken = this.deriveRotatedRefreshToken(currentRawToken);
      if (!childRawToken) return null;
      const child = await this.findRefreshTokenByHash(hashRefreshToken(childRawToken));
      if (!child || child.family !== tokenRecord.family || child.userId !== tokenRecord.userId) {
        // No rotation child: the token was revoked by logout, password reset,
        // a family revoke, or rotated before deterministic children existed.
        return null;
      }
      if (!child.revokedAt) {
        return child.expiresAt > now ? { rawToken: childRawToken } : null;
      }
      currentRawToken = childRawToken;
    }

    return null;
  }

  private async findRefreshTokenByHash(tokenHash: string) {
    const tokens = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash));
    return tokens[0];
  }

  /**
   * Child refresh token = HMAC(server secret, parent). Only the server can derive
   * it, and only from the parent's raw value, which the database never stores.
   */
  private deriveRotatedRefreshToken(parentRawToken: string): string | null {
    const secret =
      this.configService.get<string>('auth.jwtRefreshSecret') ??
      this.configService.get<string>('auth.jwtSecret');
    if (!secret) return null;

    return createHmac('sha256', secret)
      .update(`refresh-rotation:v1:${parentRawToken}`)
      .digest('hex');
  }

  private async signAccessTokenForUser(
    userId: string,
    user: {
      email: string;
      role: string;
      adminCapabilityBundle?: string | null;
      adminCapabilities?: readonly string[] | null;
    },
  ): Promise<string> {
    return this.jwtService.signAsync({
      sub: userId,
      email: user.email,
      role: user.role,
      adminCapabilityBundle: normalizeAdminCapabilityBundle(user.adminCapabilityBundle),
      adminCapabilities: normalizeAdminCapabilities(user.adminCapabilities),
    });
  }

  private async revokeRefreshTokenFamily(
    family: string,
    db: Pick<DrizzleDB, 'update'> = this.db,
  ): Promise<void> {
    // Keep the original revoked_at of already revoked rows; it decides the grace window.
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.family, family),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
  }

  /**
   * Logout ends the device session the cookie belongs to: every active token of its
   * family is revoked. Rows that were already revoked keep their revoked_at, so a
   * stale (just-rotated) cookie presented here neither reopens its rotation grace
   * window nor leaves the active child signed in.
   */
  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenRecord = await this.findRefreshTokenByHash(hashRefreshToken(rawToken));
    if (!tokenRecord) return;

    await this.revokeRefreshTokenFamily(tokenRecord.family);
  }

  async requestPasswordReset(
    email: string,
    frontendOrigin?: string,
    navigation: { locale?: string; returnTo?: string } = {},
  ): Promise<void> {
    const user = await this.userRepository.findByEmail(email);

    // 소셜 전용 계정(passwordHash === null)은 리셋 링크를 발송하지 않는다.
    // - 발송 시: 유저가 링크를 따라 비밀번호를 설정하면 소셜 전용 → 비밀번호 계정으로
    //   의도치 않게 전환되고, 첫 회전 entropy 가 빈 문자열이 되어 one-time 토큰 보장이 약화된다.
    // - 미발송 시: enumeration 방지를 위해 에러를 노출하지 않고 silent return.
    // 유저에게 "소셜로 로그인하세요" UX는 프론트엔드 레벨에서 별도로 제공되어야 한다.
    if (!user || !user.passwordHash || this.isInactiveAccount(user)) {
      return;
    }

    // Generate reset token with user's password hash as additional entropy.
    // The lookup is case-insensitive; the link goes to the address stored on the account.
    const secret =
      this.configService.get<string>('auth.jwtSecret') + user.passwordHash;

    const resetToken = await this.jwtService.signAsync(
      { sub: user.id, purpose: 'password-reset' },
      { secret, expiresIn: '1h' },
    );

    // Dispatch reset link via EmailService (dev: console.log mock, prod: Resend).
    const frontendUrl = this.resolveFrontendOrigin(frontendOrigin);
    const locale = navigation.locale && isSupportedLocale(navigation.locale) ? navigation.locale : DEFAULT_LOCALE;
    const resetUrl = new URL(`${locale === DEFAULT_LOCALE ? '' : `/${locale}`}/auth/reset-password`, frontendUrl);
    resetUrl.searchParams.set('token', resetToken);
    const returnTo = resolveAuthReturnTo(navigation.returnTo);
    if (returnTo) resetUrl.searchParams.set('returnTo', returnTo);

    await this.emailService.sendPasswordResetEmail(user.email, resetUrl.toString(), locale);
  }

  async requestEmailVerification(
    email: string,
    locale: string = 'ko',
    _frontendOrigin?: string,
  ): Promise<{ expiresAt: Date; emailDeliveryFailed?: boolean }> {
    return this.issueEmailVerification(email, locale);
  }

  async resendEmailVerification(
    email: string,
    locale: string = 'ko',
    _frontendOrigin?: string,
  ): Promise<{ expiresAt: Date; emailDeliveryFailed?: boolean }> {
    return this.issueEmailVerification(email, locale);
  }

  async requestAccountEmailVerification(
    userId: string,
    email: string,
    locale: string = 'ko',
  ): Promise<{ expiresAt: Date; emailDeliveryFailed?: boolean }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (isSocialPlaceholderEmail(normalizedEmail)) {
      throw new BadRequestException('실제 수신 가능한 이메일을 입력해주세요');
    }

    const currentUser = await this.userRepository.findById(userId);
    if (!currentUser || this.isInactiveAccount(currentUser)) {
      throw new UnauthorizedException('사용자 인증이 필요합니다');
    }

    const existingUser = await this.userRepository.findByEmail(normalizedEmail);
    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException('이미 사용 중인 이메일입니다');
    }

    return this.issueEmailVerificationForUser(
      userId,
      normalizedEmail,
      locale,
      ACCOUNT_EMAIL_VERIFICATION_PURPOSE,
    );
  }

  async verifyAccountEmailVerificationCode(
    userId: string,
    email: string,
    code: string,
  ): Promise<{ verified: true; user: UserProfile }> {
    const normalizedEmail = email.trim().toLowerCase();
    const currentUser = await this.userRepository.findById(userId);
    if (!currentUser || this.isInactiveAccount(currentUser)) {
      throw new UnauthorizedException('사용자 인증이 필요합니다');
    }

    const latestRows = await this.db
      .select()
      .from(schema.emailVerificationTokens)
      .where(
        and(
          eq(schema.emailVerificationTokens.userId, userId),
          eq(schema.emailVerificationTokens.email, normalizedEmail),
          eq(schema.emailVerificationTokens.purpose, ACCOUNT_EMAIL_VERIFICATION_PURPOSE),
        ),
      );
    const latestRecord = [...latestRows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    if (!latestRecord) {
      throw new BadRequestException('인증번호가 일치하지 않습니다');
    }

    if (latestRecord.consumedAt) {
      throw new GoneException('이미 사용된 인증번호입니다');
    }

    if (latestRecord.expiresAt < new Date()) {
      throw new GoneException('인증번호가 만료되었습니다. 새 인증 메일을 요청해주세요.');
    }

    const attempt = await this.countEmailVerificationAttempt(latestRecord);
    const codeHash = this.hashEmailVerificationCode(
      normalizedEmail,
      code,
      ACCOUNT_EMAIL_VERIFICATION_PURPOSE,
    );
    if (latestRecord.tokenHash !== codeHash) {
      await this.rejectWrongEmailVerificationCode(latestRecord, attempt);
    }

    const existingUser = await this.userRepository.findByEmail(normalizedEmail);
    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException('이미 사용 중인 이메일입니다');
    }

    await this.db
      .update(schema.emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(schema.emailVerificationTokens.id, latestRecord.id));

    const [updatedUser] = await this.db
      .update(schema.users)
      .set({
        email: normalizedEmail,
        isEmailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

    if (!updatedUser) {
      throw new UnauthorizedException('사용자 인증이 필요합니다');
    }

    return {
      verified: true,
      user: this.mapToProfile(updatedUser),
    };
  }

  async verifyEmailVerificationCode(
    rawEmail: string,
    code: string,
  ): Promise<{ verified: true }> {
    // Codes are issued against the canonical lower-case address.
    const email = normalizeAuthEmail(rawEmail);
    const latestRecord = await this.findLatestSignupVerificationRecord(email);

    if (!latestRecord) {
      throw new BadRequestException('인증번호가 일치하지 않습니다');
    }

    if (latestRecord.consumedAt) {
      throw new GoneException('이미 사용된 인증번호입니다');
    }

    if (latestRecord.expiresAt < new Date()) {
      throw new GoneException('인증번호가 만료되었습니다. 새 인증 메일을 요청해주세요.');
    }

    const attempt = await this.countEmailVerificationAttempt(latestRecord);
    const codeHash = this.hashEmailVerificationCode(email, code, latestRecord.purpose);
    if (latestRecord.tokenHash !== codeHash) {
      await this.rejectWrongEmailVerificationCode(latestRecord, attempt);
    }

    await this.db
      .update(schema.emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(schema.emailVerificationTokens.id, latestRecord.id));

    if (latestRecord.userId) {
      await this.db
        .update(schema.users)
        .set({ isEmailVerified: true, updatedAt: new Date() })
        .where(eq(schema.users.id, latestRecord.userId));
    }

    return { verified: true };
  }

  /**
   * Counts a guess against one issued code before it is compared (audit #12).
   * Every guess is counted atomically, so parallel requests cannot exceed the
   * limit. A code that already used its guesses is invalidated and refused
   * even when the guess is right.
   */
  private async countEmailVerificationAttempt(record: { id: string; expiresAt: Date }): Promise<number> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000));
    let attempt: number;
    try {
      attempt = Number(await this.redis.eval(
        EMAIL_VERIFICATION_ATTEMPT_INCR_LUA,
        1,
        `${EMAIL_VERIFICATION_ATTEMPT_KEY_PREFIX}${record.id}`,
        ttlSeconds,
      ));
    } catch (error) {
      // Fail closed: without the counter the code could be guessed freely.
      this.logger.error(`Email verification attempt counter unavailable: ${(error as Error).message}`);
      throw new ServiceUnavailableException('인증번호 확인을 잠시 후 다시 시도해주세요.');
    }
    if (attempt > EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      await this.invalidateEmailVerificationRecord(record.id);
      throw new GoneException(EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED_MESSAGE);
    }
    return attempt;
  }

  private async rejectWrongEmailVerificationCode(
    record: { id: string },
    attempt: number,
  ): Promise<never> {
    if (attempt >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      await this.invalidateEmailVerificationRecord(record.id);
      throw new GoneException(EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED_MESSAGE);
    }
    throw new BadRequestException('인증번호가 일치하지 않습니다');
  }

  /** Expires the code in the database too, so a lost counter cannot revive it. */
  private async invalidateEmailVerificationRecord(recordId: string): Promise<void> {
    await this.db
      .update(schema.emailVerificationTokens)
      .set({ expiresAt: new Date() })
      .where(
        and(
          eq(schema.emailVerificationTokens.id, recordId),
          isNull(schema.emailVerificationTokens.consumedAt),
        ),
      );
  }

  /**
   * Latest signup verification code for an address. Codes are stored against the
   * lower-case address; codes issued before that change kept the address as typed.
   * When no lower-case row exists, the account's own codes are compared
   * case-insensitively so an unused code from before the change still works.
   */
  private async findLatestSignupVerificationRecord(email: string) {
    let rows = await this.db
      .select()
      .from(schema.emailVerificationTokens)
      .where(
        and(
          eq(schema.emailVerificationTokens.email, email),
          eq(schema.emailVerificationTokens.purpose, EMAIL_VERIFICATION_PURPOSE),
        ),
      );

    if (rows.length === 0) {
      const user = await this.userRepository.findByEmail(email);
      if (user) {
        const userRows = await this.db
          .select()
          .from(schema.emailVerificationTokens)
          .where(
            and(
              eq(schema.emailVerificationTokens.userId, user.id),
              eq(schema.emailVerificationTokens.purpose, EMAIL_VERIFICATION_PURPOSE),
            ),
          );
        rows = userRows.filter((row) => isSameAuthEmail(row.email, email));
      }
    }

    return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async verifyEmailVerificationToken(token: string): Promise<{ verified: true }> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const matchingRows = await this.db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.tokenHash, tokenHash));
    const tokenRecord = matchingRows[0];

    if (!tokenRecord) {
      throw new UnauthorizedException('유효하지 않은 인증 링크입니다');
    }

    if (tokenRecord.consumedAt) {
      throw new GoneException('이미 사용된 인증 링크입니다');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new GoneException('인증 링크가 만료되었습니다. 새 인증 메일을 요청해주세요.');
    }

    const tokenUserId = tokenRecord.userId;
    const latestRows = await this.db
      .select()
      .from(schema.emailVerificationTokens)
      .where(
        and(
          eq(schema.emailVerificationTokens.email, tokenRecord.email),
          eq(schema.emailVerificationTokens.purpose, tokenRecord.purpose),
        ),
      );
    const latestRecord = [...latestRows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    if (latestRecord && latestRecord.tokenHash !== tokenHash) {
      throw new GoneException('새 인증 메일을 요청해주세요.');
    }

    await this.db
      .update(schema.emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(schema.emailVerificationTokens.id, tokenRecord.id));

    if (tokenUserId) {
      await this.db
        .update(schema.users)
        .set({ isEmailVerified: true, updatedAt: new Date() })
        .where(eq(schema.users.id, tokenUserId));
    }

    return { verified: true };
  }

  async enforceRefreshFamilyLimit(
    userId: string,
    maxFamilies = USER_REFRESH_FAMILY_LIMIT,
  ): Promise<{ revokedFamily: string | null; notice?: string }> {
    const now = new Date();
    const activeRows = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.revokedAt),
          gt(schema.refreshTokens.expiresAt, now),
        ),
      );

    const oldestByFamily = new Map<string, Date>();
    for (const row of activeRows) {
      const currentOldest = oldestByFamily.get(row.family);
      if (!currentOldest || row.createdAt < currentOldest) {
        oldestByFamily.set(row.family, row.createdAt);
      }
    }

    const activeFamilies = [...oldestByFamily.entries()]
      .map(([family, createdAt]) => ({ family, createdAt }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    if (activeFamilies.length <= maxFamilies) {
      return { revokedFamily: null };
    }

    const familiesToRevoke = activeFamilies.slice(0, activeFamilies.length - maxFamilies);
    for (const family of familiesToRevoke) {
      await this.db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.refreshTokens.userId, userId),
            eq(schema.refreshTokens.family, family.family),
            isNull(schema.refreshTokens.revokedAt),
          ),
        );
    }

    return {
      revokedFamily: familiesToRevoke[0]?.family ?? null,
      notice: REFRESH_FAMILY_LIMIT_NOTICE,
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // 1. Preliminary: decode 로 sub 만 추출. 서명은 검증하지 않고 형식(UUID) 검사로 DB lookup 전
    //    payload-amplification DoS 와 PostgreSQL 22P02(invalid uuid) 에러 누출을 차단한다.
    //    서명/만료 검증은 아래 3단계 final verify (jwtSecret + passwordHash) 에서 엄격히 수행되므로
    //    여기서 서명 검증을 생략해도 보안 약화가 아니다.
    //    (CR-02: 이전에는 preliminary 에서 `verifyAsync(token, { secret: jwtSecret })` 로 서명을
    //     검증했으나, 실제 토큰은 `jwtSecret + passwordHash` 로 서명되어 있어 서명 key 불일치로
    //     합법 토큰도 401 이 되는 regression 이 있었다.)
    const jwtSecret = this.configService.get<string>('auth.jwtSecret');
    if (!jwtSecret) {
      // 설정 누락은 500이 적절하지만, 외부에 상태를 알리지 않도록 401로 통일.
      throw new UnauthorizedException('유효하지 않은 재설정 토큰입니다');
    }

    let preliminarySub: string;
    try {
      const decoded = this.jwtService.decode<{ sub?: unknown } | null>(token);
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        typeof decoded.sub !== 'string' ||
        !UUID_REGEX.test(decoded.sub)
      ) {
        throw new Error('invalid sub');
      }
      preliminarySub = decoded.sub;
    } catch {
      throw new UnauthorizedException('유효하지 않은 재설정 토큰입니다');
    }

    // 2. sub가 UUID로 확정된 뒤에만 DB lookup 수행.
    const user = await this.userRepository.findById(preliminarySub);
    if (!user || this.isInactiveAccount(user)) {
      throw new UnauthorizedException('유효하지 않은 재설정 토큰입니다');
    }

    // 3. 최종 검증: jwtSecret + passwordHash 로 서명 + 만료 재확인.
    //    passwordHash가 바뀌면 이 단계에서 실패 → one-time token 불변조건 유지.
    const secret = jwtSecret + (user.passwordHash ?? '');

    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwtService.verifyAsync<{
        sub: string;
        purpose: string;
      }>(token, { secret });
    } catch {
      throw new UnauthorizedException('유효하지 않은 재설정 토큰입니다');
    }

    if (payload.purpose !== 'password-reset') {
      throw new UnauthorizedException('유효하지 않은 재설정 토큰입니다');
    }

    // 4. Hash new password
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // 5. Update password
    await this.userRepository.updatePassword(payload.sub, passwordHash);

    // 6. Revoke all refresh tokens (force re-login)
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.userId, payload.sub));
  }

  // -- Social auth methods --

  async findOrCreateSocialUser(
    profile: SocialProfile,
    options: { registrationBinding?: string } = {},
  ): Promise<SocialAuthResult> {
    this.logger.log(`findOrCreateSocialUser: provider=${profile.provider}, providerId=${profile.providerId}`);

    // 1. Look up social_accounts by (provider, providerId)
    const existingSocial = await this.db
      .select()
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.provider, profile.provider),
          eq(schema.socialAccounts.providerId, profile.providerId),
        ),
      );

    const socialAccount = existingSocial[0];

    // 2. If found: user already registered, generate JWT tokens
    if (socialAccount) {
      this.logger.log(`Social user found: userId=${socialAccount.userId}`);
      const user = await this.userRepository.findById(socialAccount.userId);
      if (!user || this.isInactiveAccount(user)) {
        throw new UnauthorizedException('연결된 사용자 계정을 찾을 수 없습니다');
      }

      // Social-only accounts keep the 2026-05-17 policy (verified on login), but an
      // address that did not come from this provider login, such as a linked local
      // account's never-verified signup email, needs the provider's own assertion.
      const effectiveUser = shouldMarkEmailVerifiedOnSocialLogin(user, socialAccount, profile)
        ? await this.markSocialEmailVerified(user)
        : user;

      const tokens = await this.generateTokenPair(
        effectiveUser.id,
        effectiveUser.email,
        effectiveUser.role,
        normalizeAdminCapabilityBundle(effectiveUser.adminCapabilityBundle),
        effectiveUser.adminCapabilities,
      );

      return {
        status: 'authenticated',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ...(tokens.deviceLimitNotice ? { deviceLimitNotice: tokens.deviceLimitNotice } : {}),
        user: this.mapToProfile(effectiveUser),
      };
    }

    // 3. Not found -- generate registrationToken for frontend to collect additional info
    this.logger.log(`New social user, registration required: provider=${profile.provider}`);
    const registrationToken = await this.jwtService.signAsync(
      {
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email,
        name: profile.name,
        purpose: 'social-registration',
        // Only the browser holding the matching httpOnly binding cookie can complete it.
        ...(options.registrationBinding
          ? { binding: hashSocialRegistrationBinding(options.registrationBinding) }
          : {}),
      },
      { expiresIn: '30m' },
    );

    return {
      status: 'needs_registration',
      registrationToken,
      socialProfile: {
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email,
        name: profile.name,
      },
    };
  }

  async completeSocialRegistration(
    registrationToken: string,
    dto: SocialRegisterBody,
    requestMeta: ConsentRequestMeta = { ipAddress: '0.0.0.0' },
    options: { registrationBinding?: string } = {},
  ): Promise<AuthResult | RegistrationPendingResult> {
    this.logger.log('completeSocialRegistration: started');

    // 0. Verify phone number with a purpose-bound token from /sms/verify-code.
    await this.assertPhoneVerified(
      dto.phone,
      dto.phoneVerificationToken,
      'social_registration',
    );

    // 1. Verify registrationToken JWT
    let payload: {
      provider: string;
      providerId: string;
      email?: string;
      name?: string;
      purpose: string;
      binding?: string;
    };

    try {
      payload = await this.jwtService.verifyAsync(registrationToken);
    } catch {
      throw new UnauthorizedException('등록 토큰이 만료되었거나 유효하지 않습니다');
    }

    if (payload.purpose !== 'social-registration') {
      throw new UnauthorizedException('유효하지 않은 등록 토큰입니다');
    }

    // A registrationToken travels in a URL. Without the binding cookie issued to the
    // browser that finished the provider login, a forwarded link cannot be completed.
    if (!isSocialRegistrationBindingValid(payload.binding, options.registrationBinding)) {
      throw new UnauthorizedException(SOCIAL_REGISTRATION_BINDING_MESSAGE);
    }

    this.consentService.assertAgeAllowed(dto.birthDate);
    await this.consentService.assertRequiredConsents({ items: dto.consentItems });

    const identityMatches = await this.userRepository.findActiveByVerifiedIdentity(
      dto.phone,
      dto.birthDate,
    );
    const normalizedSubmittedName = normalizeMergeName(dto.name);
    const nameMatchedIdentityMatches = identityMatches.filter(
      (user) => normalizeMergeName(user.name) === normalizedSubmittedName,
    );

    const providerEmail = payload.email ? normalizeAuthEmail(payload.email) : undefined;
    const email = providerEmail ?? `${payload.provider}_${payload.providerId}@social.grabit.com`;

    if (nameMatchedIdentityMatches.length === 1) {
      const targetUser = nameMatchedIdentityMatches[0]!;
      if (hasAdminAuthority(targetUser)) {
        // Phone + birth date + name must never be enough to add a login route to an
        // admin or scanner account; those links need an explicit operator process.
        this.logger.warn(`completeSocialRegistration: refused automatic link to privileged userId=${targetUser.id}`);
        throw new ConflictException({
          code: 'ACCOUNT_LINK_CONFIRMATION_REQUIRED',
          message: '이미 가입된 계정이 있습니다. 기존 계정으로 로그인해주세요.',
        });
      }
      // Claim the single-use phone token only after every pre-write rejection, so a
      // refused link (privileged target) leaves the token usable.
      const linkPhoneClaim = await this.claimPhoneVerification(
        dto.phone,
        dto.phoneVerificationToken,
        'social_registration',
      );
      const linkedUser = await this.db.transaction(async (tx) => {
        const updatedAt = new Date();
        const guardedUsers = await tx
          .update(schema.users)
          .set({ marketingConsent: dto.marketingConsent, updatedAt })
          .where(
            and(
              eq(schema.users.id, targetUser.id),
              eq(schema.users.name, targetUser.name),
              eq(schema.users.phone, dto.phone),
              eq(schema.users.birthDate, dto.birthDate),
              eq(schema.users.isPhoneVerified, true),
              eq(schema.users.accountStatus, 'active'),
            ),
          )
          .returning();
        const guardedUser = guardedUsers[0];
        if (!guardedUser) {
          throw new UnauthorizedException('활성 계정이 아니어서 소셜 계정을 연결할 수 없습니다');
        }

        await tx.insert(schema.socialAccounts).values({
          userId: guardedUser.id,
          provider: payload.provider,
          providerId: payload.providerId,
          providerEmail: payload.email,
        });

        await tx.insert(schema.termsAgreements).values({
          userId: guardedUser.id,
          termsOfService: dto.termsOfService,
          privacyPolicy: dto.privacyPolicy,
          marketingConsent: dto.marketingConsent,
        });

        await this.consentService.captureConsent(
          guardedUser.id,
          {
            birthDate: dto.birthDate,
            items: dto.consentItems,
            sourceFlow: 'social_completion',
          },
          requestMeta,
          tx,
        );

        return guardedUser;
      }).catch(releasePhoneClaimAndRethrow(linkPhoneClaim));

      this.logger.log(`completeSocialRegistration: linked for userId=${linkedUser.id}`);
      const tokens = await this.generateTokenPair(
        linkedUser.id,
        linkedUser.email,
        linkedUser.role,
        normalizeAdminCapabilityBundle(linkedUser.adminCapabilityBundle),
        linkedUser.adminCapabilities,
      );

      return {
        ...tokens,
        user: this.mapToProfile(linkedUser),
      };
    }

    // 2. Check if user with that email already exists (account linking, case-insensitive)
    const existingUser = await this.userRepository.findByEmail(email);

    if (existingUser) {
      throw new ConflictException({
        code: 'ACCOUNT_LINK_CONFIRMATION_REQUIRED',
        message: 'Sign in to the existing account before linking this social provider.',
      });
    }

    const phoneClaim = await this.claimPhoneVerification(
      dto.phone,
      dto.phoneVerificationToken,
      'social_registration',
    );
    const user = await this.db.transaction(async (tx) => {
      // 3. Create new user (passwordHash = null for social-only accounts)
      const createdUser = await this.userRepository.create({
        email,
        passwordHash: null, // social-only accounts have no password
        name: dto.name,
        phone: dto.phone,
        gender: dto.gender,
        country: dto.country,
        preferredLocale: dto.locale ?? DEFAULT_LOCALE,
        birthDate: dto.birthDate,
        marketingConsent: dto.marketingConsent,
        isPhoneVerified: true,
        // 2026-05-17 product policy: a social-only account completes sign-up with the
        // provider (or placeholder) address marked verified. Placeholder addresses are
        // never mailed (ticket delivery skips them).
        isEmailVerified: true,
      }, tx);

      // 4. Create social account link
      await tx.insert(schema.socialAccounts).values({
        userId: createdUser.id,
        provider: payload.provider,
        providerId: payload.providerId,
        providerEmail: payload.email,
      });

      // 5. Create terms agreement and consent audit in the same transaction.
      await tx.insert(schema.termsAgreements).values({
        userId: createdUser.id,
        termsOfService: dto.termsOfService,
        privacyPolicy: dto.privacyPolicy,
        marketingConsent: dto.marketingConsent,
      });

      await this.consentService.captureConsent(
        createdUser.id,
        {
          birthDate: dto.birthDate,
          items: dto.consentItems,
          sourceFlow: 'social_completion',
        },
        requestMeta,
        tx,
      );

      return createdUser;
    }).catch(releasePhoneClaimAndRethrow(phoneClaim));

    this.logger.log(`completeSocialRegistration: completed for userId=${user.id}`);
    const tokens = await this.generateTokenPair(
      user.id,
      user.email,
      user.role,
      normalizeAdminCapabilityBundle(user.adminCapabilityBundle),
      user.adminCapabilities,
    );

    return {
      ...tokens,
      user: this.mapToProfile(user),
    };
  }

  // -- Private helpers --

  private async assertPhoneVerified(
    phone: string,
    verificationToken: string,
    purpose: SmsVerificationPurpose,
  ): Promise<void> {
    this.smsService.verifyPhoneVerificationToken(verificationToken, {
      phone,
      purpose,
    });
  }

  private claimPhoneVerification(
    phone: string,
    verificationToken: string,
    purpose: SmsVerificationPurpose,
  ): Promise<PhoneVerificationClaim> {
    return this.smsService.claimPhoneVerificationToken(verificationToken, {
      phone,
      purpose,
    });
  }

  private async issueEmailVerification(
    rawEmail: string,
    locale: string,
  ): Promise<{ expiresAt: Date; emailDeliveryFailed?: boolean }> {
    const user = await this.userRepository.findByEmail(rawEmail);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

    if (!user) {
      return { expiresAt };
    }

    return this.issueEmailVerificationForUser(user.id, normalizeAuthEmail(rawEmail), locale);
  }

  private async markSocialEmailVerified<T extends { id: string; isEmailVerified: boolean }>(
    user: T,
  ): Promise<T> {
    await this.db
      .update(schema.users)
      .set({ isEmailVerified: true, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    return { ...user, isEmailVerified: true };
  }

  private async issueEmailVerificationForUser(
    userId: string,
    email: string,
    locale: string,
    purpose = EMAIL_VERIFICATION_PURPOSE,
  ): Promise<{ expiresAt: Date; emailDeliveryFailed?: boolean }> {
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);
    const verificationCode = this.generateEmailVerificationCode();
    const tokenHash = this.hashEmailVerificationCode(email, verificationCode, purpose);

    await this.db.insert(schema.emailVerificationTokens).values({
      userId,
      email,
      purpose,
      tokenHash,
      expiresAt,
    });

    // Account and consent have already committed. Preserve that outcome while
    // telling the buyer to retry delivery, rather than repeating registration.
    try {
      const delivery = await this.emailService.sendEmailVerificationEmail(email, verificationCode, locale);
      if (!delivery.success) return { expiresAt, emailDeliveryFailed: true };
    } catch {
      this.logger.warn('Verification email delivery failed; verification can be requested again');
      return { expiresAt, emailDeliveryFailed: true };
    }

    return { expiresAt };
  }

  private generateEmailVerificationCode(): string {
    return randomInt(0, 10 ** EMAIL_VERIFICATION_CODE_DIGITS)
      .toString()
      .padStart(EMAIL_VERIFICATION_CODE_DIGITS, '0');
  }

  private hashEmailVerificationCode(
    email: string,
    code: string,
    purpose = EMAIL_VERIFICATION_PURPOSE,
  ): string {
    const secret =
      this.configService.get<string>('auth.jwtSecret') ??
      this.configService.get<string>('JWT_SECRET') ??
      'dev-email-verification-code-secret';

    return createHmac('sha256', secret)
      .update(`${purpose}:${email.toLowerCase()}:${code}`)
      .digest('hex');
  }

  private resolveFrontendOrigin(frontendOrigin?: string): string {
    const configuredOrigins = this.getConfiguredFrontendOrigins();
    const fallbackOrigin = configuredOrigins[0] ?? DEFAULT_FRONTEND_ORIGIN;
    const candidateOrigin = this.normalizeFrontendOrigin(frontendOrigin);

    if (!candidateOrigin) {
      return fallbackOrigin;
    }

    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    if (nodeEnv === 'production') {
      return configuredOrigins.includes(candidateOrigin)
        ? candidateOrigin
        : fallbackOrigin;
    }

    if (
      configuredOrigins.includes(candidateOrigin) ||
      this.isLocalFrontendOrigin(candidateOrigin)
    ) {
      return candidateOrigin;
    }

    return fallbackOrigin;
  }

  private getConfiguredFrontendOrigins(): string[] {
    const rawFrontend = this.configService.get<string>('FRONTEND_URL')?.trim() ?? '';
    const origins = rawFrontend
      .split(',')
      .map((origin) => this.normalizeFrontendOrigin(origin.trim()))
      .filter((origin): origin is string => Boolean(origin));

    return origins.length > 0 ? origins : [DEFAULT_FRONTEND_ORIGIN];
  }

  private normalizeFrontendOrigin(value?: string | null): string | null {
    if (!value) return null;

    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }

  private isLocalFrontendOrigin(origin: string): boolean {
    try {
      return LOCAL_FRONTEND_HOSTNAMES.has(new URL(origin).hostname);
    } catch {
      return false;
    }
  }

  private isInactiveAccount(
    user: { accountStatus?: string | null } | null | undefined,
  ): boolean {
    return user?.accountStatus === 'withdrawn' || user?.accountStatus === 'merged';
  }

  private async generateTokenPair(
    userId: string,
    email: string,
    role: string,
    adminCapabilityBundle?: string | null,
    adminCapabilities?: readonly string[] | null,
  ): Promise<TokenPair> {
    // Access token
    const accessToken = await this.jwtService.signAsync({
      sub: userId,
      email,
      role,
      adminCapabilityBundle: normalizeAdminCapabilityBundle(adminCapabilityBundle),
      adminCapabilities: normalizeAdminCapabilities(adminCapabilities),
    });

    // Refresh token: random bytes, hashed for storage
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const family = randomUUID();

    await this.db.insert(schema.refreshTokens).values({
      userId,
      tokenHash,
      family,
      expiresAt: new Date(
        Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      ),
    });
    const limitResult = role === 'admin'
      ? { revokedFamily: null }
      : await this.enforceRefreshFamilyLimit(userId);

    return {
      accessToken,
      refreshToken: rawToken,
      ...(limitResult.notice ? { deviceLimitNotice: limitResult.notice } : {}),
    };
  }

  private mapToProfile(user: {
    id: string;
    email: string;
    name: string;
    phone: string;
    gender: 'male' | 'female' | 'unspecified';
    country: string;
    birthDate: string;
    preferredLocale?: string | null;
    isEmailVerified: boolean;
    isPhoneVerified: boolean;
    marketingConsent?: boolean;
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
      preferredLocale: normalizeStoredPreferredLocale(user.preferredLocale ?? null),
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      marketingConsent: user.marketingConsent ?? false,
      role: user.role as 'user' | 'admin',
      adminCapabilityBundle: normalizeAdminCapabilityBundle(user.adminCapabilityBundle),
      adminCapabilities: normalizeAdminCapabilities(user.adminCapabilities),
      accountStatus: normalizeAccountStatus(user.accountStatus),
      withdrawnAt: user.withdrawnAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

/**
 * Decides whether an existing social login may mark users.email verified.
 *
 * - Placeholder addresses (`@social.grabit.com`) are never mailed, so marking them
 *   verified cannot misdirect a ticket and keeps legacy social accounts bookable.
 * - A social-only account (no password) whose stored address is the address this
 *   provider link was created with follows the 2026-05-17 social sign-up policy.
 * - Any other address (for example the never-verified signup email of a linked
 *   local account) is verified only when the provider asserts it verified that
 *   same address.
 */
function shouldMarkEmailVerifiedOnSocialLogin(
  user: { email: string; isEmailVerified: boolean; passwordHash?: string | null },
  socialAccount: { providerEmail: string | null },
  profile: SocialProfile,
): boolean {
  if (user.isEmailVerified) return false;
  if (isSocialPlaceholderEmail(user.email)) return true;
  if (!user.passwordHash && isSameAuthEmail(socialAccount.providerEmail, user.email)) return true;
  return profile.emailVerified === true && isSameAuthEmail(profile.email, user.email);
}

function hasAdminAuthority(user: {
  role?: string | null;
  adminCapabilityBundle?: string | null;
  adminCapabilities?: readonly string[] | null;
}): boolean {
  return (
    user.role === 'admin' ||
    Boolean(user.adminCapabilityBundle) ||
    (user.adminCapabilities?.length ?? 0) > 0
  );
}

function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function normalizeAccountStatus(
  status: string | null | undefined,
): UserProfile['accountStatus'] {
  if (status === 'withdrawn') return status;
  if (status === 'merged') return status as UserProfile['accountStatus'];
  return 'active';
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
  const parsed = adminCapabilityBundleSchema.safeParse(bundle);
  return parsed.success ? parsed.data : null;
}
