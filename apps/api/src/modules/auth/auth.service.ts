import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  GoneException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import * as schema from '../../database/schema/index.js';
import { UserRepository } from '../user/user.repository.js';
import { SmsService } from '../sms/sms.service.js';
import type { SmsVerificationPurpose } from '../sms/sms.service.js';
import { EmailService } from './email/email.service.js';
import { ConsentService } from '../consent/consent.service.js';
import type { ConsentRequestMeta } from '../consent/consent.service.js';
import type { RegisterBody } from './dto/register.dto.js';
import type { SocialRegisterBody } from './dto/social-register.dto.js';
import type { SocialProfile } from './interfaces/social-profile.interface.js';
import type { UserProfile } from '@grabit/shared/types/user.types.js';
import type {
  EmailAvailabilityResponse,
  SocialAuthResult,
} from '@grabit/shared/types/auth.types.js';
import {
  REFRESH_TOKEN_EXPIRY_DAYS,
} from '@grabit/shared/constants/index.js';

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
  isPhoneVerified: boolean;
  createdAt: Date;
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
  email: string;
  verificationExpiresAt: Date;
  user: UserProfile;
}

const EMAIL_VERIFICATION_EXPIRY_MS = 30 * 60 * 1000;
const EMAIL_VERIFICATION_PURPOSE = 'signup';
const REFRESH_FAMILY_LIMIT_NOTICE = '다른 기기에서 로그인되어 가장 오래된 세션이 종료되었습니다.';

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

    // 1. Check email uniqueness
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

    const user = await this.db.transaction(async (tx) => {
      // 3. Insert user
      const createdUser = await this.userRepository.create({
        email: dto.email,
        passwordHash,
        name: dto.name,
        phone: dto.phone,
        gender: dto.gender,
        country: dto.country,
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
    });

    const verification = await this.issueEmailVerificationForUser(
      user.id,
      user.email,
      dto.locale,
    );

    return {
      emailVerificationRequired: true,
      email: user.email,
      verificationExpiresAt: verification.expiresAt,
      user: this.mapToProfile(user),
    };
  }

  async login(user: ValidatedUser): Promise<AuthResult> {
    const tokens = await this.generateTokenPair(user.id, user.email, user.role);

    return {
      ...tokens,
      user: this.mapToProfile(user),
    };
  }

  async validateUser(email: string, password: string): Promise<ValidatedUser> {
    const user = await this.userRepository.findByEmail(email);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 일치하지 않습니다');
    }

    const isValid = await argon2.verify(user.passwordHash, password);
    if (!isValid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 일치하지 않습니다');
    }

    this.assertEmailVerified(user);

    // Return user without passwordHash
    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword as ValidatedUser;
  }

  async refreshTokens(
    oldRawToken: string,
  ): Promise<TokenPair> {
    // 1. Hash the incoming raw token
    const tokenHash = createHash('sha256').update(oldRawToken).digest('hex');

    // 2. Find refresh token by hash
    const tokens = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash));

    const tokenRecord = tokens[0];

    // 3. Token not found
    if (!tokenRecord) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다');
    }

    // 4. Token already revoked -- possible theft! Revoke entire family
    if (tokenRecord.revokedAt) {
      await this.revokeRefreshTokenFamily(tokenRecord.family);

      throw new UnauthorizedException('토큰이 재사용되었습니다. 보안을 위해 해당 세션이 종료됩니다.');
    }

    // 5. Check expiration
    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('리프레시 토큰이 만료되었습니다');
    }

    // 6. Generate new refresh token with same family
    const newRawToken = randomBytes(32).toString('hex');
    const newTokenHash = createHash('sha256').update(newRawToken).digest('hex');
    const now = new Date();
    const newTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    // 7. Fetch current user for up-to-date role/email
    const user = await this.userRepository.findById(tokenRecord.userId);
    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다');
    }

    await this.db.transaction(async (tx) => {
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
        await this.revokeRefreshTokenFamily(tokenRecord.family, tx);
        throw new UnauthorizedException('토큰이 재사용되었습니다. 보안을 위해 해당 세션이 종료됩니다.');
      }

      await tx.insert(schema.refreshTokens).values({
        userId: tokenRecord.userId,
        tokenHash: newTokenHash,
        family: tokenRecord.family,
        expiresAt: newTokenExpiresAt,
      });
    });

    // 8. Generate new access token with full claims
    const accessToken = await this.jwtService.signAsync({
      sub: tokenRecord.userId,
      email: user.email,
      role: user.role,
    });

    return { accessToken, refreshToken: newRawToken };
  }

  private async revokeRefreshTokenFamily(
    family: string,
    db: Pick<DrizzleDB, 'update'> = this.db,
  ): Promise<void> {
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.family, family));
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.tokenHash, tokenHash));
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);

    // 소셜 전용 계정(passwordHash === null)은 리셋 링크를 발송하지 않는다.
    // - 발송 시: 유저가 링크를 따라 비밀번호를 설정하면 소셜 전용 → 비밀번호 계정으로
    //   의도치 않게 전환되고, 첫 회전 entropy 가 빈 문자열이 되어 one-time 토큰 보장이 약화된다.
    // - 미발송 시: enumeration 방지를 위해 에러를 노출하지 않고 silent return.
    // 유저에게 "소셜로 로그인하세요" UX는 프론트엔드 레벨에서 별도로 제공되어야 한다.
    if (!user || !user.passwordHash) {
      return;
    }

    // Generate reset token with user's password hash as additional entropy
    const secret =
      this.configService.get<string>('auth.jwtSecret') + user.passwordHash;

    const resetToken = await this.jwtService.signAsync(
      { sub: user.id, purpose: 'password-reset' },
      { secret, expiresIn: '1h' },
    );

    // Dispatch reset link via EmailService (dev: console.log mock, prod: Resend).
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const resetLink = `${frontendUrl}/auth/reset-password?token=${resetToken}`;

    await this.emailService.sendPasswordResetEmail(email, resetLink);
  }

  async requestEmailVerification(
    email: string,
    locale: string = 'ko',
  ): Promise<{ expiresAt: Date }> {
    return this.issueEmailVerification(email, locale);
  }

  async resendEmailVerification(
    email: string,
    locale: string = 'ko',
  ): Promise<{ expiresAt: Date }> {
    return this.issueEmailVerification(email, locale);
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
    maxFamilies = 3,
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
    if (!user) {
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

  async findOrCreateSocialUser(profile: SocialProfile): Promise<SocialAuthResult> {
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
      if (!user) {
        throw new UnauthorizedException('연결된 사용자 계정을 찾을 수 없습니다');
      }

      const tokens = await this.generateTokenPair(user.id, user.email, user.role);

      return {
        status: 'authenticated',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: this.mapToProfile(user),
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
  ): Promise<AuthResult> {
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
    };

    try {
      payload = await this.jwtService.verifyAsync(registrationToken);
    } catch {
      throw new UnauthorizedException('등록 토큰이 만료되었거나 유효하지 않습니다');
    }

    if (payload.purpose !== 'social-registration') {
      throw new UnauthorizedException('유효하지 않은 등록 토큰입니다');
    }

    this.consentService.assertAgeAllowed(dto.birthDate);
    await this.consentService.assertRequiredConsents({ items: dto.consentItems });

    // 2. Check if user with that email already exists (account linking)
    const email = payload.email ?? `${payload.provider}_${payload.providerId}@social.grabit.com`;
    const existingUser = await this.userRepository.findByEmail(email);

    if (existingUser) {
      throw new ConflictException({
        code: 'ACCOUNT_LINK_CONFIRMATION_REQUIRED',
        message: 'Sign in to the existing account before linking this social provider.',
      });
    }

    const user = await this.db.transaction(async (tx) => {
      // 3. Create new user (passwordHash = null for social-only accounts)
      const createdUser = await this.userRepository.create({
        email,
        passwordHash: null, // social-only accounts have no password
        name: dto.name,
        phone: dto.phone,
        gender: dto.gender,
        country: dto.country,
        birthDate: dto.birthDate,
        marketingConsent: dto.marketingConsent,
        isPhoneVerified: true,
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
    });

    // 6. Generate JWT tokens
    const tokens = await this.generateTokenPair(user.id, user.email, user.role);

    this.logger.log(`completeSocialRegistration: completed for userId=${user.id}`);

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

  private assertEmailVerified(user: { isEmailVerified: boolean }): void {
    if (!user.isEmailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email verification is required.',
      });
    }
  }

  private async issueEmailVerification(
    email: string,
    locale: string,
  ): Promise<{ expiresAt: Date }> {
    const user = await this.userRepository.findByEmail(email);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

    if (!user) {
      return { expiresAt };
    }

    return this.issueEmailVerificationForUser(user.id, email, locale);
  }

  private async issueEmailVerificationForUser(
    userId: string,
    email: string,
    locale: string,
  ): Promise<{ expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.db.insert(schema.emailVerificationTokens).values({
      userId,
      email,
      purpose: EMAIL_VERIFICATION_PURPOSE,
      tokenHash,
      expiresAt,
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const verificationLink = `${frontendUrl}/auth/verify-email?token=${rawToken}`;
    await this.emailService.sendEmailVerificationEmail(email, verificationLink, locale);

    return { expiresAt };
  }

  private async generateTokenPair(
    userId: string,
    email: string,
    role: string,
  ): Promise<TokenPair> {
    // Access token
    const accessToken = await this.jwtService.signAsync({
      sub: userId,
      email,
      role,
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
    const limitResult = await this.enforceRefreshFamilyLimit(userId);

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
    preferredLocale?: UserProfile['preferredLocale'] | null;
    isPhoneVerified: boolean;
    role: string;
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
      preferredLocale: user.preferredLocale ?? 'ko',
      isPhoneVerified: user.isPhoneVerified,
      role: user.role as 'user' | 'admin',
      createdAt: user.createdAt.toISOString(),
    };
  }
}
