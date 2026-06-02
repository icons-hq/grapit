import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { TossWebhookGuard } from './toss-webhook.guard.js';

function createConfigService(secret?: string): ConfigService {
  return {
    get: vi.fn().mockReturnValue(secret ?? ''),
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
