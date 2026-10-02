import { Injectable, type ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  buildSocialCallbackUrl,
  getSocialCallbackStateFromRequest,
} from '../social-callback-url.js';
import {
  SOCIAL_OAUTH_STATE_COOKIE,
  buildSignedSocialOAuthState,
  createSocialOAuthNonce,
  isSocialProviderCallbackRequest,
  resolveSocialOAuthStateSecret,
  socialOAuthStateCookieOptions,
  verifySignedSocialOAuthState,
} from '../social-oauth-state.js';

function redirectToSocialCallbackError(
  context: ExecutionContext,
  configService: ConfigService,
  providerName: string,
  errorCode: 'oauth_denied' | 'oauth_failed',
): void {
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  const http = context.switchToHttp();
  const req = http.getRequest<Request>();
  const res = http.getResponse<Response>();
  // Only allow-listed locale values and same-site returnTo paths are read here.
  const callbackState = getSocialCallbackStateFromRequest(req, 'state');
  const returnToParam: Record<string, string> = callbackState.returnTo
    ? { returnTo: callbackState.returnTo }
    : {};
  res.redirect(
    buildSocialCallbackUrl(
      frontendUrl,
      callbackState.locale,
      { error: errorCode, provider: providerName, ...returnToParam },
    ),
  );
}

function handleSocialAuthRequest<T>(
  err: Error | null,
  user: T,
  context: ExecutionContext,
  configService: ConfigService,
  providerName: string,
  logger: Logger,
): T {
  if (err || !user) {
    const errorCode =
      err?.message?.toLowerCase().includes('denied') ||
      err?.message?.toLowerCase().includes('cancel')
        ? 'oauth_denied'
        : 'oauth_failed';

    logger.warn(`${providerName} OAuth failed: ${err?.message ?? 'no user returned'}`);
    redirectToSocialCallbackError(context, configService, providerName, errorCode);
    return null as T;
  }

  return user;
}

/**
 * Rejects a provider callback whose state was not issued to this browser.
 * Returns false after redirecting to the frontend error page; the guard then lets
 * the (no-op) handler run with no req.user, exactly like a passport failure.
 */
function acceptSocialCallbackState(
  context: ExecutionContext,
  configService: ConfigService,
  providerName: string,
  logger: Logger,
): boolean {
  const http = context.switchToHttp();
  const req = http.getRequest<Request>();
  if (!isSocialProviderCallbackRequest(req)) {
    return true;
  }

  const res = http.getResponse<Response>();
  const nonceCookie = (req.cookies as Record<string, unknown> | undefined)?.[SOCIAL_OAUTH_STATE_COOKIE];
  const { maxAge: _maxAge, ...clearOptions } = socialOAuthStateCookieOptions();
  void _maxAge;
  // The nonce is single-use: a replayed callback must not reuse it.
  res.clearCookie(SOCIAL_OAUTH_STATE_COOKIE, clearOptions);

  const verification = verifySignedSocialOAuthState(
    (req.query as Record<string, unknown> | undefined)?.['state'],
    {
      provider: providerName,
      nonceCookie,
      secret: resolveSocialOAuthStateSecret(configService),
    },
  );
  if (verification.ok) {
    return true;
  }

  logger.warn(`${providerName} OAuth callback rejected: ${verification.reason}`);
  redirectToSocialCallbackError(context, configService, providerName, 'oauth_failed');
  return false;
}

function getSocialAuthenticateOptions(
  context: ExecutionContext,
  configService: ConfigService,
  providerName: string,
): { state: string } | undefined {
  const http = context.switchToHttp();
  const req = http.getRequest<Request>();
  if (isSocialProviderCallbackRequest(req)) {
    // The callback state is verified in canActivate; passport must not issue a new one.
    return undefined;
  }

  const res = http.getResponse<Response>();
  const query = req.query as Record<string, unknown> | undefined;
  const nonce = createSocialOAuthNonce();
  res.cookie(SOCIAL_OAUTH_STATE_COOKIE, nonce, socialOAuthStateCookieOptions());
  return {
    state: buildSignedSocialOAuthState({
      provider: providerName,
      nonce,
      locale: query?.['locale'],
      returnTo: query?.['returnTo'],
      secret: resolveSocialOAuthStateSecret(configService),
    }),
  };
}

@Injectable()
export class KakaoAuthGuard extends AuthGuard('kakao') {
  private readonly logger = new Logger('KakaoAuthGuard');

  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!acceptSocialCallbackState(context, this.configService, 'kakao', this.logger)) {
      return true;
    }
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return getSocialAuthenticateOptions(context, this.configService, 'kakao');
  }

  handleRequest<T>(err: Error | null, user: T, _info: unknown, context: ExecutionContext): T {
    return handleSocialAuthRequest(err, user, context, this.configService, 'kakao', this.logger);
  }
}

@Injectable()
export class NaverAuthGuard extends AuthGuard('naver') {
  private readonly logger = new Logger('NaverAuthGuard');

  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!acceptSocialCallbackState(context, this.configService, 'naver', this.logger)) {
      return true;
    }
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return getSocialAuthenticateOptions(context, this.configService, 'naver');
  }

  handleRequest<T>(err: Error | null, user: T, _info: unknown, context: ExecutionContext): T {
    return handleSocialAuthRequest(err, user, context, this.configService, 'naver', this.logger);
  }
}

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger('GoogleAuthGuard');

  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!acceptSocialCallbackState(context, this.configService, 'google', this.logger)) {
      return true;
    }
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return getSocialAuthenticateOptions(context, this.configService, 'google');
  }

  handleRequest<T>(err: Error | null, user: T, _info: unknown, context: ExecutionContext): T {
    return handleSocialAuthRequest(err, user, context, this.configService, 'google', this.logger);
  }
}
