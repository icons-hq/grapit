import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { TossWebhookGuard } from './toss-webhook.guard.js';

function createConfigService(input?: string | Record<string, string>): ConfigService {
  const values = typeof input === 'string'
    ? { TOSS_WEBHOOK_SECRET: input }
    : input ?? {};

  return {
    get: vi.fn((key: string, defaultValue = '') => values[key] ?? defaultValue),
  } as unknown as ConfigService;
}

function createExecutionContext(request: {
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
}): ExecutionContext {
  return {
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
    }),
    getHandler: vi.fn(),
    getClass: vi.fn(),
    getArgs: vi.fn(),
    getArgByIndex: vi.fn(),
    switchToRpc: vi.fn(),
    switchToWs: vi.fn(),
    getType: vi.fn().mockReturnValue('http'),
  } as unknown as ExecutionContext;
}

describe('TossWebhookGuard', () => {
  it('allows webhook requests with the configured shared secret header', () => {
    const guard = new TossWebhookGuard(createConfigService('webhook-secret'));

    expect(
      guard.canActivate(
        createExecutionContext({
          headers: {
            'x-toss-webhook-secret': 'webhook-secret',
          },
        }),
      ),
    ).toBe(true);
  });

  it('allows webhook requests with the configured shared secret query parameter', () => {
    const guard = new TossWebhookGuard(createConfigService('webhook-secret'));

    expect(
      guard.canActivate(
        createExecutionContext({
          query: {
            tossWebhookSecret: 'webhook-secret',
          },
        }),
      ),
    ).toBe(true);
  });

  it('allows webhook requests with the configured overseas-card security key', () => {
    const guard = new TossWebhookGuard(createConfigService({
      TOSS_WEBHOOK_SECRET: 'webhook-secret',
      TOSS_OVERSEAS_CARD_WEBHOOK_SECRET: 'overseas-card-security-key',
    }));
    const request = {
      headers: {
        'x-toss-webhook-secret': 'overseas-card-security-key',
      },
    };

    expect(
      guard.canActivate(
        createExecutionContext(request),
      ),
    ).toBe(true);
    expect(request).toHaveProperty('tossWebhookSecretScope', 'overseas-card');
  });

  it('rejects standard Toss payment webhook headers without a configured shared secret value', () => {
    const guard = new TossWebhookGuard(createConfigService('webhook-secret'));

    expect(() =>
      guard.canActivate(
        createExecutionContext({
          headers: {
            'user-agent': 'tosspayments',
            'tosspayments-webhook-transmission-id': 'whtrans_123',
            'tosspayments-webhook-transmission-time': '2026-06-05T10:00:00+09:00',
          },
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects webhook requests with an invalid shared secret', () => {
    const guard = new TossWebhookGuard(createConfigService('webhook-secret'));

    expect(() => guard.canActivate(
      createExecutionContext({
        headers: {
          'x-toss-webhook-secret': 'wrong-secret',
        },
      }),
    )).toThrow(UnauthorizedException);
  });

  it('fails closed when the webhook secret is not configured', () => {
    const guard = new TossWebhookGuard(createConfigService());

    expect(() => guard.canActivate(
      createExecutionContext({
        headers: {
          'x-toss-webhook-secret': 'webhook-secret',
        },
      }),
    )).toThrow(UnauthorizedException);
  });
});
