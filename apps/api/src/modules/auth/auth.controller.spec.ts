import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthController } from './auth.controller.js';
import { AUTH_COOKIE_NAME } from '@grabit/shared/constants/index.js';

const authModuleSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'auth.module.ts'),
  'utf8',
);
const authControllerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'auth.controller.ts'),
  'utf8',
);
const excludedLaunchProviderTokens = {
  strategy: ['Line', 'Strategy'].join(''),
  passportPackage: ['passport', 'line'].join('-'),
  authRoute: ['/auth', 'line'].join('/'),
  envPrefix: ['LINE', 'CLIENT'].join('_'),
  socialRoute: ['social', 'line'].join('/'),
};

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: {
    register: ReturnType<typeof vi.fn>;
    completeSocialRegistration: ReturnType<typeof vi.fn>;
    findOrCreateSocialUser: ReturnType<typeof vi.fn>;
    refreshTokens: ReturnType<typeof vi.fn>;
    requestEmailVerification: ReturnType<typeof vi.fn>;
    resendEmailVerification: ReturnType<typeof vi.fn>;
    verifyEmailVerificationToken: ReturnType<typeof vi.fn>;
    checkEmailAvailability: ReturnType<typeof vi.fn>;
  };
  let mockConfigService: {
    get: ReturnType<typeof vi.fn>;
  };
  let mockRequest: Partial<Request>;
  let mockResponse: {
    cookie: ReturnType<typeof vi.fn>;
    redirect: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    headersSent: boolean;
  };

  beforeEach(() => {
    mockAuthService = {
      register: vi.fn(),
      completeSocialRegistration: vi.fn(),
      findOrCreateSocialUser: vi.fn(),
      refreshTokens: vi.fn(),
      requestEmailVerification: vi.fn(),
      resendEmailVerification: vi.fn(),
      verifyEmailVerificationToken: vi.fn(),
      checkEmailAvailability: vi.fn(),
    };

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        return defaultValue;
      }),
    };

    mockResponse = {
      cookie: vi.fn(),
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis(),
      headersSent: false,
    };

    mockRequest = {
      user: {
        provider: 'kakao',
        providerId: 'test-provider-id-123',
        email: 'test@test.com',
        name: 'Test User',
      },
    };

    controller = new AuthController(
      mockAuthService as never,
      mockConfigService as never,
    );
  });

  describe('refresh session probe', () => {
    it('returns 204 for an anonymous session probe instead of surfacing a console 401 on public pages', async () => {
      const result = await controller.refresh(
        { cookies: {} } as Request,
        mockResponse as unknown as Response,
      );

      expect(result).toBeUndefined();
      expect(mockResponse.status).toHaveBeenCalledWith(204);
      expect(mockAuthService.refreshTokens).not.toHaveBeenCalled();
    });

    it('rotates a present refresh token and returns a new access token', async () => {
      mockAuthService.refreshTokens.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const result = await controller.refresh(
        {
          cookies: { [AUTH_COOKIE_NAME]: 'old-refresh-token' },
        } as unknown as Request,
        mockResponse as unknown as Response,
      );

      expect(mockAuthService.refreshTokens).toHaveBeenCalledWith(
        'old-refresh-token',
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        'new-refresh-token',
        expect.any(Object),
      );
      expect(result).toEqual({ accessToken: 'new-access-token' });
    });
  });

  describe('consent request metadata', () => {
    it('register passes normalized request IP and user-agent into consent capture metadata', async () => {
      mockAuthService.register.mockResolvedValue({
        emailVerificationRequired: true,
        email: 'user@example.com',
        verificationExpiresAt: new Date('2026-05-06T05:50:00Z'),
        user: { id: 'user-1', email: 'user@example.com' },
      });
      const req = {
        ip: '198.51.100.20',
        get: vi.fn((header: string) => {
          const headers: Record<string, string> = {
            'x-forwarded-for': '203.0.113.50, 10.0.0.1',
            'user-agent': 'Vitest Browser',
          };
          return headers[header.toLowerCase()];
        }),
      };

      await controller.register({ email: 'user@example.com' } as never, req as Request);

      expect(mockAuthService.register).toHaveBeenCalledWith(
        { email: 'user@example.com' },
        { ipAddress: '198.51.100.20', userAgent: 'Vitest Browser' },
      );
    });

    it('social registration completion passes request metadata into consent capture metadata', async () => {
      mockAuthService.completeSocialRegistration.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1', email: 'user@example.com' },
      });
      const req = {
        ip: '198.51.100.2',
        get: vi.fn((header: string) => {
          const headers: Record<string, string> = {
            'user-agent': 'Vitest Social',
          };
          return headers[header.toLowerCase()];
        }),
      };

      await controller.completeSocialRegistration(
        { registrationToken: 'registration-token', name: 'User' } as never,
        req as Request,
        mockResponse as unknown as Response,
      );

      expect(mockAuthService.completeSocialRegistration).toHaveBeenCalledWith(
        'registration-token',
        { name: 'User' },
        { ipAddress: '198.51.100.2', userAgent: 'Vitest Social' },
      );
    });
  });

  describe('setRefreshTokenCookie via socialKakaoCallback — Gap 1', () => {
    it('refresh token 쿠키에 sameSite가 항상 none으로 설정된다 (프로덕션 환경 포함)', async () => {
      mockAuthService.findOrCreateSocialUser.mockResolvedValue({
        status: 'authenticated',
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user-1', email: 'test@test.com' },
      });

      const originalNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      try {
        await controller.socialKakaoCallback(
          mockRequest as Request,
          mockResponse as unknown as Response,
        );
      } finally {
        process.env['NODE_ENV'] = originalNodeEnv;
      }

      expect(mockResponse.cookie).toHaveBeenCalledOnce();
      const cookieOptions = mockResponse.cookie.mock.calls[0]![2] as Record<string, unknown>;
      expect(cookieOptions['sameSite']).toBe('none');
    });

    it('refresh token 쿠키에 sameSite가 개발 환경에서도 none으로 설정된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockResolvedValue({
        status: 'authenticated',
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user-1', email: 'test@test.com' },
      });

      process.env['NODE_ENV'] = 'development';

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      expect(mockResponse.cookie).toHaveBeenCalledOnce();
      const cookieOptions = mockResponse.cookie.mock.calls[0]![2] as Record<string, unknown>;
      expect(cookieOptions['sameSite']).toBe('none');
    });

    it('secure가 환경변수와 무관하게 항상 true로 설정된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockResolvedValue({
        status: 'authenticated',
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user-1', email: 'test@test.com' },
      });

      process.env['NODE_ENV'] = 'development';

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      const cookieOptions = mockResponse.cookie.mock.calls[0]![2] as Record<string, unknown>;
      expect(cookieOptions['secure']).toBe(true);
    });

    it('refresh token 쿠키에 httpOnly가 true로 설정된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockResolvedValue({
        status: 'authenticated',
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user-1', email: 'test@test.com' },
      });

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      const cookieOptions = mockResponse.cookie.mock.calls[0]![2] as Record<string, unknown>;
      expect(cookieOptions['httpOnly']).toBe(true);
    });
  });

  describe('handleSocialCallback null user check — Gap 2', () => {
    it('req.user가 null이면 findOrCreateSocialUser가 호출되지 않는다', async () => {
      mockRequest.user = null as unknown as undefined;

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      expect(mockAuthService.findOrCreateSocialUser).not.toHaveBeenCalled();
    });

    it('req.user가 undefined이면 findOrCreateSocialUser가 호출되지 않는다', async () => {
      mockRequest.user = undefined;

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      expect(mockAuthService.findOrCreateSocialUser).not.toHaveBeenCalled();
    });

    it('req.user가 null이면 redirect도 발생하지 않는다 (Guard가 이미 처리)', async () => {
      mockRequest.user = null as unknown as undefined;

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('handleSocialCallback server_error redirect — Gap 3', () => {
    it('findOrCreateSocialUser가 에러를 throw하면 ?error=server_error로 redirect된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      expect(mockResponse.redirect).toHaveBeenCalledOnce();
      const redirectUrl = mockResponse.redirect.mock.calls[0]![0] as string;
      expect(redirectUrl).toContain('error=server_error');
    });

    it('findOrCreateSocialUser 에러 시 provider 정보가 redirect URL에 포함된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockRejectedValue(
        new Error('Unexpected error'),
      );

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      const redirectUrl = mockResponse.redirect.mock.calls[0]![0] as string;
      expect(redirectUrl).toContain('provider=kakao');
    });

    it('findOrCreateSocialUser 에러 시 프론트엔드 URL로 redirect된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockRejectedValue(
        new Error('Service unavailable'),
      );

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      const redirectUrl = mockResponse.redirect.mock.calls[0]![0] as string;
      expect(redirectUrl).toContain('http://localhost:3000/auth/callback');
    });

    it('naver callback에서도 findOrCreateSocialUser 에러 시 server_error redirect된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockRejectedValue(
        new Error('Service error'),
      );
      mockRequest.user = {
        provider: 'naver',
        providerId: 'naver-123',
        email: 'naver@test.com',
        name: 'Naver User',
      };

      await controller.socialNaverCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      const redirectUrl = mockResponse.redirect.mock.calls[0]![0] as string;
      expect(redirectUrl).toContain('error=server_error');
      expect(redirectUrl).toContain('provider=naver');
    });
  });

  describe('logout clearCookie options', () => {
    it('logout 시 clearCookie에 sameSite:none, secure:true가 포함된다', async () => {
      const mockClearCookie = vi.fn();
      const mockRevokeRefreshToken = vi.fn();

      const logoutResponse = {
        ...mockResponse,
        clearCookie: mockClearCookie,
      };

      const logoutAuthService = {
        ...mockAuthService,
        revokeRefreshToken: mockRevokeRefreshToken,
      };

      const logoutController = new AuthController(
        logoutAuthService as never,
        mockConfigService as never,
      );

      const logoutRequest = {
        cookies: { [AUTH_COOKIE_NAME]: 'test-token' },
      } as unknown as Request;

      await logoutController.logout(logoutRequest, logoutResponse as unknown as Response);

      expect(mockClearCookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        expect.objectContaining({
          sameSite: 'none',
          secure: true,
          path: '/',
        }),
      );
    });
  });

  describe('email verification endpoints', () => {
    it('GET email availability delegates to AuthService and returns only availability', async () => {
      mockAuthService.checkEmailAvailability.mockResolvedValue({
        available: false,
      });

      const result = await (controller as unknown as {
        checkEmailAvailability(dto: { email: string }): Promise<unknown>;
      }).checkEmailAvailability({ email: 'used@test.com' });

      expect(mockAuthService.checkEmailAvailability).toHaveBeenCalledWith(
        'used@test.com',
      );
      expect(result).toEqual({ available: false });
      expect(JSON.stringify(result)).not.toMatch(
        /user|id|provider|verification|token/i,
      );
    });

    it('POST request delegates to AuthService without returning a raw token', async () => {
      mockAuthService.requestEmailVerification.mockResolvedValue({
        expiresAt: new Date('2026-05-06T05:50:00.000Z'),
      });

      const result = await (controller as unknown as {
        requestEmailVerification(dto: { email: string; locale: string }): Promise<unknown>;
      }).requestEmailVerification({ email: 'verify@test.com', locale: 'ko' });

      expect(mockAuthService.requestEmailVerification).toHaveBeenCalledWith('verify@test.com', 'ko');
      expect(JSON.stringify(result)).not.toContain('token');
    });

    it('POST resend keeps the resend action immediately visible through a dedicated endpoint', async () => {
      mockAuthService.resendEmailVerification.mockResolvedValue({
        expiresAt: new Date('2026-05-06T05:50:00.000Z'),
      });

      await (controller as unknown as {
        resendEmailVerification(dto: { email: string; locale: string }): Promise<unknown>;
      }).resendEmailVerification({ email: 'verify@test.com', locale: 'en' });

      expect(mockAuthService.resendEmailVerification).toHaveBeenCalledWith('verify@test.com', 'en');
    });

    it('POST verify consumes an opaque token through AuthService', async () => {
      mockAuthService.verifyEmailVerificationToken.mockResolvedValue({ verified: true });

      const result = await (controller as unknown as {
        verifyEmailVerification(dto: { token: string }): Promise<unknown>;
      }).verifyEmailVerification({ token: 'opaque-token' });

      expect(result).toEqual({ verified: true });
      expect(mockAuthService.verifyEmailVerificationToken).toHaveBeenCalledWith('opaque-token');
    });
  });

  describe('launch social provider surface', () => {
    it('AuthModule registers Kakao, Naver, and Google strategies only', () => {
      expect(authModuleSource).toContain('KakaoStrategy');
      expect(authModuleSource).toContain('NaverStrategy');
      expect(authModuleSource).toContain('GoogleStrategy');
      expect(authModuleSource).not.toContain(excludedLaunchProviderTokens.strategy);
      expect(authModuleSource).not.toContain(excludedLaunchProviderTokens.passportPackage);
      expect(authModuleSource).not.toContain(excludedLaunchProviderTokens.envPrefix);
    });

    it('AuthController exposes no LINE social route or callback', () => {
      expect(authControllerSource).toContain('social/kakao');
      expect(authControllerSource).toContain('social/naver');
      expect(authControllerSource).toContain('social/google');
      expect(authControllerSource).not.toContain(excludedLaunchProviderTokens.authRoute);
      expect(authControllerSource).not.toContain(excludedLaunchProviderTokens.socialRoute);
      expect(authControllerSource).not.toContain(excludedLaunchProviderTokens.envPrefix);
    });
  });

  describe('handleSocialCallback 정상 플로우 — 기반 검증', () => {
    it('status=authenticated 시 프론트엔드 callback으로 redirect된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockResolvedValue({
        status: 'authenticated',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1', email: 'test@test.com' },
      });

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      const redirectUrl = mockResponse.redirect.mock.calls[0]![0] as string;
      expect(redirectUrl).toContain('/auth/callback?status=authenticated');
    });

    it('status=needs_registration 시 registrationToken이 포함된 URL로 redirect된다', async () => {
      mockAuthService.findOrCreateSocialUser.mockResolvedValue({
        status: 'needs_registration',
        registrationToken: 'reg-token-xyz',
      });

      await controller.socialKakaoCallback(
        mockRequest as Request,
        mockResponse as unknown as Response,
      );

      const redirectUrl = mockResponse.redirect.mock.calls[0]![0] as string;
      expect(redirectUrl).toContain('registrationToken=reg-token-xyz');
      expect(redirectUrl).toContain('status=needs_registration');
    });
  });
});
