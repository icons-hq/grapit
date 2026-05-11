import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Param,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { AuthService, type ValidatedUser } from './auth.service.js';
import { registerBodySchema, type RegisterBody } from './dto/register.dto.js';
import {
  completeSocialRegistrationSchema,
  type CompleteSocialRegistrationBody,
} from './dto/social-register.dto.js';
import {
  resetPasswordRequestBodySchema,
  type ResetPasswordRequestBody,
  resetPasswordBodySchema,
  type ResetPasswordBody,
} from './dto/reset-password.dto.js';
import {
  KakaoAuthGuard,
  NaverAuthGuard,
  GoogleAuthGuard,
} from './guards/social-auth.guard.js';
import type { SocialProfile } from './interfaces/social-profile.interface.js';
import { AUTH_COOKIE_NAME } from '@grabit/shared/constants/index.js';

const launchLocaleSchema = z.enum(['ko', 'en', 'th', 'zh-CN', 'ja']).default('ko');
const emailVerificationRequestSchema = z.object({
  email: z.string().email(),
  locale: launchLocaleSchema.optional(),
});
const emailVerificationTokenSchema = z.object({
  token: z.string().min(32),
});

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerBodySchema)) dto: RegisterBody,
    @Req() req: Request,
  ) {
    const result = await this.authService.register(dto, this.resolveConsentMeta(req));

    return {
      emailVerificationRequired: result.emailVerificationRequired,
      email: result.email,
      verificationExpiresAt: result.verificationExpiresAt,
      user: result.user,
    };
  }

  @Public()
  @UseGuards(AuthGuard('local'))
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(req.user as ValidatedUser);
    this.setRefreshTokenCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
      ...(result.deviceLimitNotice ? { deviceLimitNotice: result.deviceLimitNotice } : {}),
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>)?.[AUTH_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('리프레시 토큰이 없습니다');
    }

    const result = await this.authService.refreshTokens(token);
    this.setRefreshTokenCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>)?.[AUTH_COOKIE_NAME];
    if (token) {
      await this.authService.revokeRefreshToken(token);
    }

    res.clearCookie(AUTH_COOKIE_NAME, { path: '/', sameSite: 'none', secure: true });

    return { message: 'Logged out' };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  // 3 req / 15 min / IP (REVIEWS.md HIGH-04; v6 object signature, ttl = 900_000ms = 15min, NOT 900s)
  @Post('password-reset/request')
  async requestReset(
    @Body(new ZodValidationPipe(resetPasswordRequestBodySchema))
    dto: ResetPasswordRequestBody,
  ) {
    await this.authService.requestPasswordReset(dto.email);
    return { message: '비밀번호 재설정 링크를 발송했습니다' };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  // 3 req / 15 min / IP (REVIEWS.md HIGH-04; v6 object signature)
  @Post('password-reset/confirm')
  async confirmReset(
    @Body(new ZodValidationPipe(resetPasswordBodySchema))
    dto: ResetPasswordBody,
  ) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: '비밀번호가 변경되었습니다' };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  @Post('email-verification/request')
  async requestEmailVerification(
    @Body(new ZodValidationPipe(emailVerificationRequestSchema))
    dto: z.infer<typeof emailVerificationRequestSchema>,
  ) {
    const result = await this.authService.requestEmailVerification(dto.email, dto.locale);
    return {
      message: '인증 메일을 발송했습니다',
      expiresAt: result.expiresAt,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  @Post('email-verification/resend')
  async resendEmailVerification(
    @Body(new ZodValidationPipe(emailVerificationRequestSchema))
    dto: z.infer<typeof emailVerificationRequestSchema>,
  ) {
    const result = await this.authService.resendEmailVerification(dto.email, dto.locale);
    return {
      message: '인증 메일을 다시 보냈습니다',
      expiresAt: result.expiresAt,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('email-verification/verify')
  async verifyEmailVerification(
    @Body(new ZodValidationPipe(emailVerificationTokenSchema))
    dto: z.infer<typeof emailVerificationTokenSchema>,
  ) {
    return this.authService.verifyEmailVerificationToken(dto.token);
  }

  // -- Social OAuth endpoints --

  @Public()
  @UseGuards(KakaoAuthGuard)
  @Get('social/kakao')
  socialKakao(): void {
    // Guard redirects to Kakao OAuth consent page
  }

  @Public()
  @UseGuards(KakaoAuthGuard)
  @Get('social/kakao/callback')
  async socialKakaoCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleSocialCallback(req, res);
  }

  @Public()
  @UseGuards(NaverAuthGuard)
  @Get('social/naver')
  socialNaver(): void {
    // Guard redirects to Naver OAuth consent page
  }

  @Public()
  @UseGuards(NaverAuthGuard)
  @Get('social/naver/callback')
  async socialNaverCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleSocialCallback(req, res);
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('social/google')
  socialGoogle(): void {
    // Guard redirects to Google OAuth consent page
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('social/google/callback')
  async socialGoogleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleSocialCallback(req, res);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('social/complete-registration')
  async completeSocialRegistration(
    @Body(new ZodValidationPipe(completeSocialRegistrationSchema))
    dto: CompleteSocialRegistrationBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { registrationToken, ...registerData } = dto;
    const result = await this.authService.completeSocialRegistration(
      registrationToken,
      registerData,
      this.resolveConsentMeta(req),
    );
    this.setRefreshTokenCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
      ...(result.deviceLimitNotice ? { deviceLimitNotice: result.deviceLimitNotice } : {}),
    };
  }

  // -- Private helpers --

  private async handleSocialCallback(req: Request, res: Response): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    if (res.headersSent || !req.user) {
      if (!res.headersSent) {
        this.logger.warn('Social callback received without user profile');
      }
      return;
    }

    const profile = req.user as SocialProfile;

    try {
      this.logger.log(`Social callback: provider=${profile.provider}, providerId=${profile.providerId}`);
      const result = await this.authService.findOrCreateSocialUser(profile);

      if (result.status === 'authenticated') {
        this.logger.log(`Social login authenticated: provider=${profile.provider}, providerId=${profile.providerId}`);
        if (result.refreshToken) {
          this.setRefreshTokenCookie(res, result.refreshToken);
        }
        res.redirect(`${frontendUrl}/auth/callback?status=authenticated`);
      } else {
        this.logger.log(`Social login needs registration: provider=${profile.provider}`);
        res.redirect(
          `${frontendUrl}/auth/callback?registrationToken=${result.registrationToken}&status=needs_registration`,
        );
      }
    } catch (error) {
      this.logger.error(`Social callback failed: provider=${profile.provider}`, (error as Error).stack);
      res.redirect(`${frontendUrl}/auth/callback?error=server_error&provider=${profile.provider}`);
    }
  }

  private setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
  }

  private resolveConsentMeta(req: Request): { ipAddress: string; userAgent?: string } {
    return {
      ipAddress: resolveTrustedRequestIp(req),
      userAgent: req.get('user-agent'),
    };
  }
}
