import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

export const PREWARM_CONTROL_TOKEN = 'PREWARM_CONTROL_TOKEN';
export const PREWARM_PROJECT_ID = 'PREWARM_PROJECT_ID';
export const PREWARM_REGION = 'PREWARM_REGION';
export const PREWARM_ALLOWED_SCHEDULER_EMAIL = 'PREWARM_ALLOWED_SCHEDULER_EMAIL';
export const PREWARM_ALLOWED_AUDIENCE = 'PREWARM_ALLOWED_AUDIENCE';
export const PREWARM_ALLOWED_SERVICE_NAME = 'PREWARM_ALLOWED_SERVICE_NAME';
export const PREWARM_MAX_MIN_INSTANCES = 'PREWARM_MAX_MIN_INSTANCES';

const GOOGLE_OIDC_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const GOOGLE_METADATA_ACCESS_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const GOOGLE_ALLOWED_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);
const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

type PrewarmRequestLike = Request & {
  headers: Record<string, string | string[] | undefined>;
};

type GoogleOpenIdDiscoveryDocument = {
  jwks_uri: string;
};

type GoogleJwksResponse = {
  keys: GoogleJwk[];
};

type GoogleAccessTokenResponse = {
  access_token: string;
  expires_in: number;
};

type PrewarmTokenClaims = {
  aud: string;
  email: string;
  email_verified?: boolean;
  exp: number;
  iat?: number;
  iss: string;
  sub: string;
};

type CachedJwks = {
  expiresAt: number;
  keys: GoogleJwk[];
};

type CachedAccessToken = {
  accessToken: string;
  expiresAt: number;
};

type GoogleJwk = JsonWebKey & {
  kid?: string;
};

@Injectable()
export class PrewarmService {
  private jwksCache: CachedJwks | null = null;
  private accessTokenCache: CachedAccessToken | null = null;

  constructor(private readonly configService: ConfigService) {}

  async scaleUp(serviceName: string, minInstances: number, req: Request) {
    const claims = await this.authorizeSchedulerRequest(req as PrewarmRequestLike);
    return this.updateMinInstances(serviceName, minInstances, 'scale-up', claims);
  }

  async stepDown(serviceName: string, minInstances: number | undefined, req: Request) {
    const claims = await this.authorizeSchedulerRequest(req as PrewarmRequestLike);
    return this.updateMinInstances(serviceName, minInstances ?? 0, 'step-down', claims);
  }

  private async authorizeSchedulerRequest(req: PrewarmRequestLike): Promise<PrewarmTokenClaims> {
    this.assertControlToken(req);

    const oidcToken = this.extractBearerToken(req);
    const claims = await this.verifyGoogleSignedIdToken(oidcToken);

    this.assertExpectedClaims(claims);

    return claims;
  }

  private assertExpectedClaims(claims: PrewarmTokenClaims) {
    if (!GOOGLE_ALLOWED_ISSUERS.has(claims.iss)) {
      throw new ForbiddenException('PREWARM_INVALID_ISSUER');
    }

    if (claims.exp * 1000 <= Date.now()) {
      throw new ForbiddenException('PREWARM_TOKEN_EXPIRED');
    }

    if (claims.aud !== this.getRequiredEnv(PREWARM_ALLOWED_AUDIENCE)) {
      throw new ForbiddenException('PREWARM_INVALID_AUDIENCE');
    }

    if (claims.email !== this.getRequiredEnv(PREWARM_ALLOWED_SCHEDULER_EMAIL)) {
      throw new ForbiddenException('PREWARM_INVALID_EMAIL');
    }

    if (claims.email_verified === false) {
      throw new ForbiddenException('PREWARM_UNVERIFIED_EMAIL');
    }
  }

  private assertControlToken(req: PrewarmRequestLike) {
    const expectedToken = this.getRequiredEnv(PREWARM_CONTROL_TOKEN);
    const presentedToken = this.readHeader(req.headers, 'x-prewarm-control-token');

    if (!presentedToken) {
      throw new ForbiddenException('PREWARM_CONTROL_TOKEN_REQUIRED');
    }

    if (presentedToken !== expectedToken) {
      throw new ForbiddenException('PREWARM_CONTROL_TOKEN_INVALID');
    }
  }

  private async updateMinInstances(
    serviceName: string,
    minInstances: number,
    operation: 'scale-up' | 'step-down',
    claims: PrewarmTokenClaims,
  ) {
    if (!SERVICE_NAME_PATTERN.test(serviceName)) {
      throw new BadRequestException('PREWARM_INVALID_SERVICE_NAME');
    }

    const allowedServiceName = this.getRequiredEnv(PREWARM_ALLOWED_SERVICE_NAME);
    if (serviceName !== allowedServiceName) {
      throw new ForbiddenException('PREWARM_SERVICE_NOT_ALLOWED');
    }

    const maxMinInstances = this.getRequiredNonNegativeIntegerEnv(PREWARM_MAX_MIN_INSTANCES);
    if (
      !Number.isInteger(minInstances) ||
      minInstances < 0 ||
      minInstances > maxMinInstances
    ) {
      throw new BadRequestException('PREWARM_INVALID_MIN_INSTANCES');
    }

    const projectId = this.getRequiredEnv(PREWARM_PROJECT_ID);
    const region = this.getRequiredEnv(PREWARM_REGION);
    const accessToken = await this.getGoogleAccessToken();
    const endpoint =
      `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(region)}/services/${encodeURIComponent(serviceName)}` +
      '?update_mask=template.scaling.minInstanceCount';

    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template: {
          scaling: {
            minInstanceCount: minInstances,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `PREWARM_SCALE_UPDATE_FAILED:${response.status}`,
      );
    }

    const payload = (await response.json()) as { name?: string };

    return {
      audience: claims.aud,
      operation,
      schedulerEmail: claims.email,
      serviceName,
      minInstances,
      operationName: payload.name ?? null,
    };
  }

  private extractBearerToken(req: PrewarmRequestLike): string {
    const authorization = this.readHeader(req.headers, 'authorization');

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('PREWARM_OIDC_TOKEN_REQUIRED');
    }

    return authorization.slice('Bearer '.length).trim();
  }

  private async verifyGoogleSignedIdToken(token: string): Promise<PrewarmTokenClaims> {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new ForbiddenException('PREWARM_INVALID_OIDC_TOKEN');
    }

    const header = this.parseJsonSegment<{ alg?: string; kid?: string }>(encodedHeader);
    if (header.alg !== 'RS256' || !header.kid) {
      throw new ForbiddenException('PREWARM_UNSUPPORTED_OIDC_TOKEN');
    }

    const payload = this.parseJsonSegment<PrewarmTokenClaims>(encodedPayload);
    const jwk = await this.findGoogleJwk(header.kid);

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify'],
    );

    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      Buffer.from(this.normalizeBase64Url(encodedSignature), 'base64'),
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf-8'),
    );

    if (!verified) {
      throw new ForbiddenException('PREWARM_INVALID_OIDC_SIGNATURE');
    }

    return payload;
  }

  private async findGoogleJwk(kid: string): Promise<GoogleJwk> {
    const initialJwks = await this.getGoogleJwks();
    const initialMatch = initialJwks.find((key) => key.kid === kid);
    if (initialMatch) {
      return initialMatch;
    }

    this.jwksCache = null;
    const refreshedJwks = await this.getGoogleJwks();
    const refreshedMatch = refreshedJwks.find((key) => key.kid === kid);
    if (!refreshedMatch) {
      throw new ForbiddenException('PREWARM_UNKNOWN_OIDC_KEY');
    }

    return refreshedMatch;
  }

  private async getGoogleJwks(): Promise<GoogleJwk[]> {
    if (this.jwksCache && this.jwksCache.expiresAt > Date.now()) {
      return this.jwksCache.keys;
    }

    const discoveryResponse = await fetch(GOOGLE_OIDC_DISCOVERY_URL);
    if (!discoveryResponse.ok) {
      throw new ServiceUnavailableException('PREWARM_OIDC_DISCOVERY_FAILED');
    }

    const discovery = (await discoveryResponse.json()) as GoogleOpenIdDiscoveryDocument;
    if (!discovery.jwks_uri) {
      throw new ServiceUnavailableException('PREWARM_OIDC_JWKS_URI_MISSING');
    }

    const jwksResponse = await fetch(discovery.jwks_uri);
    if (!jwksResponse.ok) {
      throw new ServiceUnavailableException('PREWARM_OIDC_JWKS_FETCH_FAILED');
    }

    const jwksPayload = (await jwksResponse.json()) as GoogleJwksResponse;
    const maxAgeSeconds = this.parseCacheMaxAgeSeconds(jwksResponse.headers.get('cache-control'));
    this.jwksCache = {
      keys: jwksPayload.keys ?? [],
      expiresAt: Date.now() + maxAgeSeconds * 1000,
    };

    return this.jwksCache.keys;
  }

  private async getGoogleAccessToken(): Promise<string> {
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > Date.now()) {
      return this.accessTokenCache.accessToken;
    }

    const response = await fetch(GOOGLE_METADATA_ACCESS_TOKEN_URL, {
      headers: {
        'Metadata-Flavor': 'Google',
      },
    });

    if (!response.ok) {
      throw new ServiceUnavailableException('PREWARM_METADATA_TOKEN_FETCH_FAILED');
    }

    const payload = (await response.json()) as GoogleAccessTokenResponse;
    const expiresInSeconds = Math.max(60, payload.expires_in);

    this.accessTokenCache = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + (expiresInSeconds - 30) * 1000,
    };

    return this.accessTokenCache.accessToken;
  }

  private getRequiredEnv(name: string): string {
    const value = this.configService.get<string>(name)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${name} is required`);
    }

    return value;
  }

  private getRequiredNonNegativeIntegerEnv(name: string): number {
    const value = this.getRequiredEnv(name);
    if (!/^\d+$/.test(value)) {
      throw new ServiceUnavailableException(`${name} must be a non-negative integer`);
    }

    return Number.parseInt(value, 10);
  }

  private readHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | null {
    const value = headers[name];
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private parseJsonSegment<T>(segment: string): T {
    try {
      const json = Buffer.from(this.normalizeBase64Url(segment), 'base64').toString('utf-8');
      return JSON.parse(json) as T;
    } catch {
      throw new ForbiddenException('PREWARM_INVALID_OIDC_TOKEN');
    }
  }

  private normalizeBase64Url(segment: string): string {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    return padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), '=');
  }

  private parseCacheMaxAgeSeconds(cacheControl: string | null): number {
    if (!cacheControl) {
      return 300;
    }

    const match = cacheControl.match(/max-age=(\d+)/i);
    if (!match) {
      return 300;
    }

    const value = Number.parseInt(match[1] ?? '300', 10);
    return Number.isFinite(value) && value > 0 ? value : 300;
  }
}
