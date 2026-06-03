import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';

describe('SocialAuthGuards', () => {
  let mockResponse: Partial<Response>;
  let mockContext: Partial<ExecutionContext>;
  let mockConfigService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockResponse = {
      redirect: vi.fn(),
    };

    mockContext = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ query: {} }),
        getResponse: vi.fn().mockReturnValue(mockResponse),
      }),
    };

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        return defaultValue;
      }),
    };
  });

  describe('KakaoAuthGuard', () => {
    it('should redirect with oauth_failed when err is present', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');

      const guard = new KakaoAuthGuard(mockConfigService as never);
      const error = new Error('Authentication failed');

      const result = guard.handleRequest(error, null, undefined, mockContext as ExecutionContext);

      expect(result).toBeNull();
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback?error=oauth_failed&provider=kakao',
      );
    });

    it('should preserve a supported locale state on OAuth failure redirects', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');
      mockContext.switchToHttp = vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ query: { state: 'en' } }),
        getResponse: vi.fn().mockReturnValue(mockResponse),
      });

      const guard = new KakaoAuthGuard(mockConfigService as never);
      const error = new Error('Authentication failed');

      guard.handleRequest(error, null, undefined, mockContext as ExecutionContext);

      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/en/auth/callback?error=oauth_failed&provider=kakao',
      );
    });

    it('should pass supported locale query as OAuth state on provider start', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');
      mockContext.switchToHttp = vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ query: { locale: 'en' } }),
        getResponse: vi.fn().mockReturnValue(mockResponse),
      });

      const guard = new KakaoAuthGuard(mockConfigService as never);
      const options = (guard as unknown as {
        getAuthenticateOptions(context: ExecutionContext): { state?: string };
      }).getAuthenticateOptions(mockContext as ExecutionContext);

      expect(options).toEqual({ state: 'en' });
    });

    it('should redirect with oauth_denied when user denied access', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');

      const guard = new KakaoAuthGuard(mockConfigService as never);
      const error = new Error('Access denied by user');

      const result = guard.handleRequest(error, null, undefined, mockContext as ExecutionContext);

      expect(result).toBeNull();
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback?error=oauth_denied&provider=kakao',
      );
    });

    it('should redirect with oauth_failed when user is null', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');

      const guard = new KakaoAuthGuard(mockConfigService as never);

      const result = guard.handleRequest(null, null, undefined, mockContext as ExecutionContext);

      expect(result).toBeNull();
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback?error=oauth_failed&provider=kakao',
      );
    });

    it('should return user when authentication succeeds', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');

      const guard = new KakaoAuthGuard(mockConfigService as never);
      const mockUser = { provider: 'kakao', providerId: '123' };

      const result = guard.handleRequest(null, mockUser, undefined, mockContext as ExecutionContext);

      expect(result).toEqual(mockUser);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('NaverAuthGuard', () => {
    it('should redirect with provider=naver on error', async () => {
      const { NaverAuthGuard } = await import('./social-auth.guard.js');

      const guard = new NaverAuthGuard(mockConfigService as never);
      const error = new Error('Authentication failed');

      guard.handleRequest(error, null, undefined, mockContext as ExecutionContext);

      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback?error=oauth_failed&provider=naver',
      );
    });

    it('should return user when authentication succeeds', async () => {
      const { NaverAuthGuard } = await import('./social-auth.guard.js');

      const guard = new NaverAuthGuard(mockConfigService as never);
      const mockUser = { provider: 'naver', providerId: '456' };

      const result = guard.handleRequest(null, mockUser, undefined, mockContext as ExecutionContext);

      expect(result).toEqual(mockUser);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });

  describe('GoogleAuthGuard', () => {
    it('should redirect with provider=google on error', async () => {
      const { GoogleAuthGuard } = await import('./social-auth.guard.js');

      const guard = new GoogleAuthGuard(mockConfigService as never);
      const error = new Error('Authentication failed');

      guard.handleRequest(error, null, undefined, mockContext as ExecutionContext);

      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback?error=oauth_failed&provider=google',
      );
    });

    it('should redirect with oauth_denied on cancel error', async () => {
      const { GoogleAuthGuard } = await import('./social-auth.guard.js');

      const guard = new GoogleAuthGuard(mockConfigService as never);
      const error = new Error('User cancelled the login');

      guard.handleRequest(error, null, undefined, mockContext as ExecutionContext);

      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback?error=oauth_denied&provider=google',
      );
    });

    it('should return user when authentication succeeds', async () => {
      const { GoogleAuthGuard } = await import('./social-auth.guard.js');

      const guard = new GoogleAuthGuard(mockConfigService as never);
      const mockUser = { provider: 'google', providerId: '789' };

      const result = guard.handleRequest(null, mockUser, undefined, mockContext as ExecutionContext);

      expect(result).toEqual(mockUser);
      expect(mockResponse.redirect).not.toHaveBeenCalled();
    });
  });
});
