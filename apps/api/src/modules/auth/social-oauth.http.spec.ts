import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleAuthGuard, KakaoAuthGuard, NaverAuthGuard } from './guards/social-auth.guard.js';
import { GoogleStrategy } from './strategies/google.strategy.js';
import { KakaoStrategy } from './strategies/kakao.strategy.js';
import { NaverStrategy } from './strategies/naver.strategy.js';

// Real passport strategies, guards, cookie parsing and redirects. No provider is called:
// the start request only redirects, and every callback here must be rejected first.
describe('Social OAuth state over HTTP', () => {
  let app: INestApplication;
  const authService = { findOrCreateSocialUser: vi.fn() };
  const settings: Record<string, string> = {
    FRONTEND_URL: 'http://localhost:3000',
    'auth.jwtSecret': 'http-spec-jwt-secret',
    KAKAO_CLIENT_ID: 'kakao-client',
    KAKAO_CLIENT_SECRET: 'kakao-secret',
    KAKAO_CALLBACK_URL: 'http://localhost:8080/api/v1/auth/social/kakao/callback',
    NAVER_CLIENT_ID: 'naver-client',
    NAVER_CLIENT_SECRET: 'naver-secret',
    NAVER_CALLBACK_URL: 'http://localhost:8080/api/v1/auth/social/naver/callback',
  };
  const config = {
    get: (key: string, fallback?: unknown) => settings[key] ?? fallback,
  };

  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [AuthService, ConfigService], AuthController);
    for (const target of [KakaoAuthGuard, NaverAuthGuard, GoogleAuthGuard, KakaoStrategy, NaverStrategy, GoogleStrategy]) {
      Reflect.defineMetadata('design:paramtypes', [ConfigService], target);
    }
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AuthController],
      providers: [
        KakaoStrategy,
        NaverStrategy,
        GoogleStrategy,
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => authService.findOrCreateSocialUser.mockReset());

  async function startKakaoLogin() {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/social/kakao')
      .query({ locale: 'en', returnTo: '/en/booking/show-1' });
    const location = new URL(response.headers['location'] as string);
    const setCookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
    const stateCookie = setCookie.find((cookie) => cookie.startsWith('grabit_oauth_state='))!;
    return { response, location, stateCookie, state: location.searchParams.get('state')! };
  }

  it('starts the provider login with a signed state and a matching Lax nonce cookie', async () => {
    const { response, location, stateCookie, state } = await startKakaoLogin();

    expect(response.status).toBe(302);
    expect(location.hostname).toBe('kauth.kakao.com');
    expect(new URLSearchParams(state).get('sig')).toBeTruthy();
    expect(stateCookie).toMatch(/Path=\/api\/v1\/auth\/social/);
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie).toMatch(/Secure/);
    expect(stateCookie).toMatch(/SameSite=Lax/);
    const nonce = decodeURIComponent(stateCookie.split(';')[0]!.split('=')[1]!);
    expect(new URLSearchParams(state).get('nonce')).toBe(nonce);
  });

  it('rejects a captured callback opened in a browser without the nonce cookie (login CSRF)', async () => {
    const { state } = await startKakaoLogin();

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/social/kakao/callback')
      .query({ code: 'attacker-authorization-code', state });

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      'http://localhost:3000/en/auth/callback?error=oauth_failed&provider=kakao&returnTo=%2Fen%2Fbooking%2Fshow-1',
    );
    expect(authService.findOrCreateSocialUser).not.toHaveBeenCalled();
  });

  it('rejects an authorization code sent in a JSON body before passport-oauth2 1.8 exchanges it', async () => {
    // Naver uses passport-oauth2 1.8, which also reads body.code. Stub the token
    // exchange so a regression would be visible without contacting Naver.
    const naver = app.get(NaverStrategy) as unknown as {
      _oauth2: { getOAuthAccessToken: (...args: unknown[]) => void };
    };
    const exchange = vi
      .spyOn(naver._oauth2, 'getOAuthAccessToken')
      .mockImplementation((...args: unknown[]) => {
        (args.at(-1) as (error: Error) => void)(new Error('stubbed token exchange'));
      });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/social/naver/callback')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ code: 'attacker-authorization-code' }));

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      'http://localhost:3000/auth/callback?error=oauth_failed&provider=naver',
    );
    expect(exchange).not.toHaveBeenCalled();
    expect(authService.findOrCreateSocialUser).not.toHaveBeenCalled();
    exchange.mockRestore();
  });

  it('rejects a legacy unsigned state even when a nonce cookie is present', async () => {
    const { stateCookie } = await startKakaoLogin();

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/social/kakao/callback')
      .set('Cookie', stateCookie.split(';')[0]!)
      .query({ code: 'authorization-code', state: 'ko' });

    expect(response.status).toBe(302);
    expect(response.headers['location']).toContain('error=oauth_failed');
    expect(authService.findOrCreateSocialUser).not.toHaveBeenCalled();
    // The nonce is single-use.
    expect(([] as string[]).concat(response.headers['set-cookie'] ?? []).some((cookie) => cookie.startsWith('grabit_oauth_state=;'))).toBe(true);
  });
});
