import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';

describe('SocialAuthGuards', () => {
  let mockResponse: Partial<Record<keyof Response, ReturnType<typeof vi.fn>>>;
  let mockContext: Partial<ExecutionContext>;
  let mockConfigService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockResponse = {
      redirect: vi.fn(),
      cookie: vi.fn(),
      clearCookie: vi.fn(),
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

    function startOptions(guard: unknown, query: Record<string, unknown>) {
      mockContext.switchToHttp = vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ query }),
        getResponse: vi.fn().mockReturnValue(mockResponse),
      });
      return (guard as {
        getAuthenticateOptions(context: ExecutionContext): { state: string };
      }).getAuthenticateOptions(mockContext as ExecutionContext);
    }

    it('issues a signed, nonce-bound OAuth state and a matching httpOnly nonce cookie on provider start', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');
      const guard = new KakaoAuthGuard(mockConfigService as never);

      const options = startOptions(guard, { locale: 'en' });

      const params = new URLSearchParams(options.state);
      expect(params.get('locale')).toBe('en');
      expect(params.get('provider')).toBe('kakao');
      expect(params.get('sig')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'grabit_oauth_state',
        params.get('nonce'),
        expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth/social' }),
      );
    });

    it('should include a safe returnTo target in OAuth state on provider start', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');
      const guard = new KakaoAuthGuard(mockConfigService as never);

      const options = startOptions(guard, { locale: 'ko', returnTo: '/booking/performance-auth' });

      const params = new URLSearchParams(options.state);
      expect(params.get('locale')).toBe('ko');
      expect(params.get('returnTo')).toBe('/booking/performance-auth');
    });

    it('should reject unsafe returnTo targets from OAuth state', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');
      const guard = new KakaoAuthGuard(mockConfigService as never);

      for (const returnTo of ['https://evil.test/booking', '/.//evil.test']) {
        const options = startOptions(guard, { locale: 'ko', returnTo });
        expect(new URLSearchParams(options.state).has('returnTo')).toBe(false);
      }
    });

    describe('provider callback state verification', () => {
      async function startAndCapture() {
        const { KakaoAuthGuard } = await import('./social-auth.guard.js');
        const guard = new KakaoAuthGuard(mockConfigService as never);
        const options = startOptions(guard, { locale: 'en', returnTo: '/booking/show-1' });
        const nonce = mockResponse.cookie!.mock.calls.at(-1)![1] as string;
        return { guard, state: options.state, nonce };
      }

      function callbackContext(query: Record<string, unknown>, cookies: Record<string, unknown>) {
        const response = { redirect: vi.fn(), clearCookie: vi.fn() };
        const context = {
          switchToHttp: vi.fn().mockReturnValue({
            getRequest: vi.fn().mockReturnValue({ query, cookies }),
            getResponse: vi.fn().mockReturnValue(response),
          }),
        } as unknown as ExecutionContext;
        return { context, response };
      }

      it('lets passport exchange the code when the signed state matches this browser nonce cookie', async () => {
        const { guard, state, nonce } = await startAndCapture();
        const passport = vi
          .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)) as { canActivate: () => unknown }, 'canActivate')
          .mockResolvedValue(true);
        const { context, response } = callbackContext({ code: 'provider-code', state }, { grabit_oauth_state: nonce });

        await expect(guard.canActivate(context)).resolves.toBe(true);

        expect(passport).toHaveBeenCalledTimes(1);
        expect(response.redirect).not.toHaveBeenCalled();
        expect(response.clearCookie).toHaveBeenCalledWith('grabit_oauth_state', expect.objectContaining({ path: '/api/v1/auth/social' }));
        passport.mockRestore();
      });

      it.each([
        ['a captured callback replayed in a browser without the nonce cookie', (state: string) => ({ state }), () => ({})],
        ['a nonce cookie from a different login attempt', (state: string) => ({ state }), () => ({ grabit_oauth_state: 'other-attempt-nonce' })],
        ['a legacy unsigned locale state', () => ({ state: 'ko' }), (nonce: string) => ({ grabit_oauth_state: nonce })],
        ['a tampered returnTo', (state: string) => ({ state: state.replace('returnTo=%2Fbooking%2Fshow-1', 'returnTo=%2Fmypage') }), (nonce: string) => ({ grabit_oauth_state: nonce })],
      ])('rejects %s before exchanging the authorization code', async (_label, buildQuery, buildCookies) => {
        const { guard, state, nonce } = await startAndCapture();
        const passport = vi
          .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)) as { canActivate: () => unknown }, 'canActivate')
          .mockResolvedValue(true);
        const { context, response } = callbackContext(
          { code: 'attacker-code', ...buildQuery(state) },
          buildCookies(nonce),
        );

        // Rejected callbacks redirect and leave req.user unset, like a passport failure.
        expect(await guard.canActivate(context)).toBe(true);

        expect(passport).not.toHaveBeenCalled();
        const redirect = response.redirect.mock.calls[0]![0] as string;
        expect(redirect).toContain('/auth/callback?error=oauth_failed&provider=kakao');
        passport.mockRestore();
      });

      it('rejects a state signed for another provider', async () => {
        const { GoogleAuthGuard } = await import('./social-auth.guard.js');
        const { state, nonce } = await startAndCapture();
        const googleGuard = new GoogleAuthGuard(mockConfigService as never);
        const passport = vi
          .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(googleGuard)) as { canActivate: () => unknown }, 'canActivate')
          .mockResolvedValue(true);
        const { context, response } = callbackContext({ code: 'code', state }, { grabit_oauth_state: nonce });

        await googleGuard.canActivate(context);

        expect(passport).not.toHaveBeenCalled();
        expect(response.redirect.mock.calls[0]![0]).toContain('error=oauth_failed&provider=google');
        passport.mockRestore();
      });
    });

    it('should preserve locale and returnTo state on OAuth failure redirects', async () => {
      const { KakaoAuthGuard } = await import('./social-auth.guard.js');
      mockContext.switchToHttp = vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({
          query: { state: 'locale=ko&returnTo=%2Fbooking%2Fperformance-auth' },
        }),
        getResponse: vi.fn().mockReturnValue(mockResponse),
      });

      const guard = new KakaoAuthGuard(mockConfigService as never);
      guard.handleRequest(new Error('Authentication failed'), null, undefined, mockContext as ExecutionContext);

      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback?error=oauth_failed&provider=kakao&returnTo=%2Fbooking%2Fperformance-auth',
      );
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
