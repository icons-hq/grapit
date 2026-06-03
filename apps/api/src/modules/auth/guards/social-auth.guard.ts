import { Injectable, type ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  buildSocialCallbackUrl,
  getSocialCallbackLocaleFromRequest,
} from '../social-callback-url.js';

function handleSocialAuthRequest<T>(
  err: Error | null,
  user: T,
  context: ExecutionContext,
  configService: ConfigService,
  providerName: string,
  logger: Logger,
): T {
  if (err || !user) {
    const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const errorCode =
      err?.message?.toLowerCase().includes('denied') ||
      err?.message?.toLowerCase().includes('cancel')
        ? 'oauth_denied'
        : 'oauth_failed';

    logger.warn(`${providerName} OAuth failed: ${err?.message ?? 'no user returned'}`);

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    res.redirect(
      buildSocialCallbackUrl(
        frontendUrl,
        getSocialCallbackLocaleFromRequest(req, 'state'),
        { error: errorCode, provider: providerName },
      ),
    );
    return null as T;
  }

  return user;
}

function getSocialAuthenticateOptions(context: ExecutionContext): { state: string } | undefined {
  const req = context.switchToHttp().getRequest<Request>();
  const locale = getSocialCallbackLocaleFromRequest(req, 'locale');
  return locale ? { state: locale } : undefined;
}

@Injectable()
export class KakaoAuthGuard extends AuthGuard('kakao') {
  private readonly logger = new Logger('KakaoAuthGuard');

  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return getSocialAuthenticateOptions(context);
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
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return getSocialAuthenticateOptions(context);
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
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return getSocialAuthenticateOptions(context);
  }

  handleRequest<T>(err: Error | null, user: T, _info: unknown, context: ExecutionContext): T {
    return handleSocialAuthRequest(err, user, context, this.configService, 'google', this.logger);
  }
}
