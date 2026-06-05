import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

interface TossWebhookRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  tossWebhookSecretScope?: 'overseas-card';
}

@Injectable()
export class TossWebhookGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredSecrets = [
      this.configService.get<string>('TOSS_WEBHOOK_SECRET', '').trim(),
      this.configService.get<string>('TOSS_OVERSEAS_CARD_WEBHOOK_SECRET', '').trim(),
    ].filter((secret) => secret.length > 0);

    if (configuredSecrets.length === 0) {
      throw new UnauthorizedException('Toss webhook secret is not configured');
    }

    const request = context
      .switchToHttp()
      .getRequest<TossWebhookRequestLike>();
    const providedSecret = this.extractSecret(request);

    if (!providedSecret) {
      throw new UnauthorizedException('Invalid Toss webhook secret');
    }

    if (
      this.constantTimeEquals(
        providedSecret,
        this.configService.get<string>('TOSS_OVERSEAS_CARD_WEBHOOK_SECRET', '').trim(),
      )
    ) {
      request.tossWebhookSecretScope = 'overseas-card';
      return true;
    }

    if (!configuredSecrets.some((secret) => this.constantTimeEquals(providedSecret, secret))) {
      throw new UnauthorizedException('Invalid Toss webhook secret');
    }

    return true;
  }

  private extractSecret(request: TossWebhookRequestLike): string | null {
    const headerSecret =
      this.getHeader(request, 'x-toss-webhook-secret')
      ?? this.getHeader(request, 'x-grabit-toss-webhook-secret');

    if (headerSecret) {
      return headerSecret;
    }

    const authorization = this.getHeader(request, 'authorization');
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length).trim();
    }

    const querySecret = request.query?.tossWebhookSecret;
    return typeof querySecret === 'string' ? querySecret.trim() || null : null;
  }

  private getHeader(
    request: TossWebhookRequestLike,
    name: string,
  ): string | null {
    const value = request.headers?.[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0]?.trim() || null;
    }

    return value?.trim() || null;
  }

  private constantTimeEquals(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    return (
      providedBuffer.length === expectedBuffer.length
      && timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }
}
