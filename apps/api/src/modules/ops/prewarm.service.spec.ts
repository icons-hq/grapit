import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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
  PREWARM_ALLOWED_SERVICE_NAME: 'grabit-api',
  PREWARM_MAX_MIN_INSTANCES: '100',
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

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
    ...init,
  });
}

function oidcAndTokenResponses(jwk: JsonWebKey) {
  return [
    jsonResponse({ jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs' }),
    jsonResponse({ keys: [jwk] }),
    jsonResponse({ access_token: 'gcp-access-token', expires_in: 3600 }),
  ];
}

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

function schedulerRequest(token: string) {
  return createRequest({
    authorization: `Bearer ${token}`,
    'x-prewarm-control-token': TEST_ENV.PREWARM_CONTROL_TOKEN,
  }) as never;
}

function createService(env: Partial<Record<string, string>> = {}) {
  const service = new PrewarmService({
    get: vi.fn((key: string, fallback?: string) =>
      key in env ? env[key] : (TEST_ENV as Record<string, string>)[key] ?? fallback,
    ),
  } as never);
  vi.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(
    undefined,
  );
  return service;
}

const SERVICE_URL =
  'https://run.googleapis.com/v2/projects/grabit-prod/locations/asia-northeast3/services/grabit-api';

describe('PrewarmService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'wrong-prewarm-secret'],
  ])(
    'rejects %s control token before Google OIDC network verification',
    async (_caseName, presentedControlToken) => {
      const configService = createConfigService();
      const service = new PrewarmService(configService as never);
      const { token } = signServiceAccountToken();
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
      };

      if (presentedControlToken) {
        headers['x-prewarm-control-token'] = presentedControlToken;
      }

      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof global.fetch;

      await expect(
        service.scaleUp('grabit-api', 100, createRequest(headers) as never),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('validates Scheduler OIDC claims and shared app token before scaling up', async () => {
    const service = createService();
    const { token, jwk } = signServiceAccountToken();
    const fetchMock = mockFetchSequence([
      ...oidcAndTokenResponses(jwk),
      jsonResponse({ template: { scaling: { maxInstanceCount: 100 } } }),
      jsonResponse({
        name: 'projects/grabit-prod/locations/asia-northeast3/operations/prewarm-scale-up',
        done: false,
      }),
      jsonResponse({
        name: 'projects/grabit-prod/locations/asia-northeast3/operations/prewarm-scale-up',
        done: true,
        response: { scaling: { minInstanceCount: 100 } },
      }),
    ]);

    const result = await service.scaleUp('grabit-api', 100, schedulerRequest(token));

    expect(result).toMatchObject({
      operation: 'scale-up',
      serviceName: 'grabit-api',
      minInstances: 100,
      maxInstances: 100,
      state: 'applied',
      operationName: 'projects/grabit-prod/locations/asia-northeast3/operations/prewarm-scale-up',
    });

    // Service-level scaling: no template change, therefore no new revision rollout.
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVICE_URL}?update_mask=scaling.minInstanceCount`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer gcp-access-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          scaling: {
            minInstanceCount: 100,
          },
        }),
      }),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('template.scaling')),
    ).toBe(false);
    // The LRO is polled before success is reported.
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://run.googleapis.com/v2/projects/grabit-prod/locations/asia-northeast3/operations/prewarm-scale-up',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('defaults step-down to minInstances=0 after the same OIDC and app-token checks', async () => {
    const service = createService();
    const { token, jwk } = signServiceAccountToken();
    mockFetchSequence([
      ...oidcAndTokenResponses(jwk),
      jsonResponse({ template: { scaling: { maxInstanceCount: 40 } } }),
      jsonResponse({ name: 'operations/prewarm-step-down', done: true, response: { scaling: {} } }),
    ]);

    const result = await service.stepDown('grabit-api', undefined, schedulerRequest(token));

    expect(result.minInstances).toBe(0);
    expect(result.operation).toBe('step-down');
    expect(result.state).toBe('applied');
  });

  it('rejects a minimum above the live Cloud Run maximum before patching', async () => {
    const service = createService();
    const { token, jwk } = signServiceAccountToken();
    const fetchMock = mockFetchSequence([
      ...oidcAndTokenResponses(jwk),
      jsonResponse({
        scaling: { maxInstanceCount: 60 },
        template: { scaling: { maxInstanceCount: 40 } },
      }),
    ]);

    await expect(service.scaleUp('grabit-api', 41, schedulerRequest(token))).rejects.toMatchObject({
      message: 'PREWARM_MIN_EXCEEDS_MAX_INSTANCES',
    });
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH')).toBe(
      false,
    );
  });

  it('reports a failed Cloud Run operation instead of success', async () => {
    const service = createService();
    const { token, jwk } = signServiceAccountToken();
    mockFetchSequence([
      ...oidcAndTokenResponses(jwk),
      jsonResponse({ template: { scaling: { maxInstanceCount: 40 } } }),
      jsonResponse({ name: 'operations/prewarm-scale-up', done: false }),
      jsonResponse({
        name: 'operations/prewarm-scale-up',
        done: true,
        error: { code: 9, message: 'FAILED_PRECONDITION' },
      }),
    ]);

    await expect(service.scaleUp('grabit-api', 20, schedulerRequest(token))).rejects.toMatchObject({
      message: 'PREWARM_SCALE_OPERATION_FAILED:9',
    });
  });

  it('marks the update pending when the operation does not finish within the wait budget', async () => {
    const service = createService({ PREWARM_OPERATION_WAIT_MS: '0' });
    const { token, jwk } = signServiceAccountToken();
    const fetchMock = mockFetchSequence([
      ...oidcAndTokenResponses(jwk),
      jsonResponse({ template: { scaling: { maxInstanceCount: 40 } } }),
      jsonResponse({ name: 'operations/prewarm-scale-up', done: false }),
    ]);

    const result = await service.scaleUp('grabit-api', 20, schedulerRequest(token));

    expect(result.state).toBe('pending');
    expect(result.operationName).toBe('operations/prewarm-scale-up');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('rejects an operation whose service-level minimum does not read back', async () => {
    const service = createService();
    const { token, jwk } = signServiceAccountToken();
    mockFetchSequence([
      ...oidcAndTokenResponses(jwk),
      jsonResponse({ template: { scaling: { maxInstanceCount: 40 } } }),
      jsonResponse({
        name: 'operations/prewarm-scale-up',
        done: true,
        response: { scaling: { minInstanceCount: 1 } },
      }),
    ]);

    await expect(service.scaleUp('grabit-api', 20, schedulerRequest(token))).rejects.toMatchObject({
      message: 'PREWARM_SCALE_READBACK_MISMATCH',
    });
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

  it('rejects service names outside the configured allowlist before Cloud Run Admin update', async () => {
    const configService = createConfigService();
    const service = new PrewarmService(configService as never);
    const { token, jwk } = signServiceAccountToken();
    const fetchMock = vi
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
      );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(
      service.scaleUp(
        'other-api',
        100,
        createRequest({
          authorization: `Bearer ${token}`,
          'x-prewarm-control-token': TEST_ENV.PREWARM_CONTROL_TOKEN,
        }) as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('run.googleapis.com')),
    ).toBe(false);
  });

  it('rejects minInstances above the configured cap before Cloud Run Admin update', async () => {
    const configService = createConfigService();
    const service = new PrewarmService(configService as never);
    const { token, jwk } = signServiceAccountToken();
    const fetchMock = vi
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
      );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(
      service.scaleUp(
        'grabit-api',
        101,
        createRequest({
          authorization: `Bearer ${token}`,
          'x-prewarm-control-token': TEST_ENV.PREWARM_CONTROL_TOKEN,
        }) as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('run.googleapis.com')),
    ).toBe(false);
  });

  it('registers prewarm routes: 200 after the operation applied, 202 while pending', async () => {
    const scaleUp = vi.fn().mockResolvedValue({ operation: 'scale-up', state: 'applied' });
    const stepDown = vi.fn().mockResolvedValue({ operation: 'step-down', state: 'pending' });
    const moduleRef = await Test.createTestingModule({
      controllers: [PrewarmController],
      providers: [
        {
          provide: PrewarmService,
          useValue: {
            scaleUp,
            stepDown,
          },
        },
      ],
    }).compile();
    const controller = moduleRef.get(PrewarmController);
    (controller as unknown as { prewarmService: unknown }).prewarmService = {
      scaleUp,
      stepDown,
    };
    const app: INestApplication = moduleRef.createNestApplication();

    try {
      await app.init();
      const server = app.getHttpServer();

      await request(server)
        .post('/internal/prewarm/services/grabit-api')
        .send({ minInstances: 100 })
        .expect(HttpStatus.OK)
        .expect(({ body }) => {
          expect(body).toEqual({ operation: 'scale-up', state: 'applied' });
        });
      expect(scaleUp).toHaveBeenCalledWith('grabit-api', 100, expect.any(Object));

      scaleUp.mockClear();
      await request(server)
        .post('/internal/prewarm/services/grabit-api')
        .send({})
        .expect(HttpStatus.BAD_REQUEST);
      expect(scaleUp).not.toHaveBeenCalled();

      await request(server)
        .post('/internal/prewarm/services/grabit-api/step-down')
        .send({})
        .expect(HttpStatus.ACCEPTED)
        .expect(({ body }) => {
          expect(body).toEqual({ operation: 'step-down', state: 'pending' });
        });
      expect(stepDown).toHaveBeenCalledWith('grabit-api', undefined, expect.any(Object));
    } finally {
      await app.close();
    }

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PrewarmController)).toBe(true);
  });
});
