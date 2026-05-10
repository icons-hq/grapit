import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { PrewarmController } from './prewarm.controller.js';
import { PrewarmService } from './prewarm.service.js';

const TEST_ENV = {
  PREWARM_CONTROL_TOKEN: 'shared-prewarm-secret',
  PREWARM_PROJECT_ID: 'grabit-prod',
  PREWARM_REGION: 'asia-northeast3',
  PREWARM_ALLOWED_SCHEDULER_EMAIL:
    'scheduler-prewarm@grabit-prod.iam.gserviceaccount.com',
  PREWARM_ALLOWED_AUDIENCE:
    'https://api.heygrabit.com/api/v1/internal/prewarm/services/grabit-api',
};

function createConfigService() {
  return {
    get: vi.fn((key: keyof typeof TEST_ENV, fallback?: string) => TEST_ENV[key] ?? fallback),
  };
}

function createRequest(headers: Record<string, string>) {
  return {
    headers,
  };
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signServiceAccountToken(
  payloadOverrides: Record<string, unknown> = {},
  options?: { kid?: string },
) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const kid = options?.kid ?? 'test-kid';
  const header = {
    alg: 'RS256',
    kid,
    typ: 'JWT',
  };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: TEST_ENV.PREWARM_ALLOWED_AUDIENCE,
    email: TEST_ENV.PREWARM_ALLOWED_SCHEDULER_EMAIL,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000) - 30,
    sub: 'service-account-subject',
    ...payloadOverrides,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = base64UrlEncode(signer.sign(privateKey));

  return {
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
    jwk: {
      ...publicJwk,
      kid,
      alg: 'RS256',
      use: 'sig',
    } satisfies JsonWebKey,
  };
}

describe('PrewarmService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('validates Scheduler OIDC claims and shared app token before scaling up', async () => {
    const configService = createConfigService();
    const service = new PrewarmService(configService as never);
    const { token, jwk } = signServiceAccountToken();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          }),
          { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'gcp-access-token',
            expires_in: 3600,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name:
              'projects/grabit-prod/locations/asia-northeast3/operations/prewarm-scale-up',
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ) as typeof global.fetch;

    const result = await service.scaleUp(
      'grabit-api',
      100,
      createRequest({
        authorization: `Bearer ${token}`,
        'x-prewarm-control-token': TEST_ENV.PREWARM_CONTROL_TOKEN,
      }) as never,
    );

    expect(result).toMatchObject({
      operation: 'scale-up',
      serviceName: 'grabit-api',
      minInstances: 100,
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(
        '/v2/projects/grabit-prod/locations/asia-northeast3/services/grabit-api?update_mask=template.scaling.minInstanceCount',
      ),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer gcp-access-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          template: {
            scaling: {
              minInstanceCount: 100,
            },
          },
        }),
      }),
    );
  });

  it('defaults step-down to minInstances=0 after the same OIDC and app-token checks', async () => {
    const configService = createConfigService();
    const service = new PrewarmService(configService as never);
    const { token, jwk } = signServiceAccountToken();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          }),
          { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'gcp-access-token', expires_in: 3600 }), {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'operations/prewarm-step-down' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ) as typeof global.fetch;

    const result = await service.stepDown(
      'grabit-api',
      undefined,
      createRequest({
        authorization: `Bearer ${token}`,
        'x-prewarm-control-token': TEST_ENV.PREWARM_CONTROL_TOKEN,
      }) as never,
    );

    expect(result.minInstances).toBe(0);
    expect(result.operation).toBe('step-down');
  });

  it('rejects wrong aud and email claims before performing any scale change', async () => {
    const configService = createConfigService();
    const service = new PrewarmService(configService as never);
    const { token, jwk } = signServiceAccountToken({
      aud: 'https://wrong.example.com/prewarm',
      email: 'wrong-scheduler@example.com',
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          }),
          { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
        }),
      ) as typeof global.fetch;

    await expect(
      service.scaleUp(
        'grabit-api',
        100,
        createRequest({
          authorization: `Bearer ${token}`,
          'x-prewarm-control-token': TEST_ENV.PREWARM_CONTROL_TOKEN,
        }) as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('wires both prewarm and step-down routes in the controller source', async () => {
    const source = await readFile(resolve(__dirname, 'prewarm.controller.ts'), 'utf-8');

    expect(source).toContain("@Post('services/:serviceName')");
    expect(source).toContain("@Post('services/:serviceName/step-down')");
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PrewarmController)).toBe(true);
  });
});
