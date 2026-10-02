import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

describe('GoogleStrategy', () => {
  it('should extract provider, providerId, email, name from Google profile', async () => {
    const { GoogleStrategy } = await import('./google.strategy.js');

    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          GOOGLE_CLIENT_ID: 'test-google-client-id',
          GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
          GOOGLE_CALLBACK_URL: 'http://localhost:8080/api/v1/auth/social/google/callback',
        };
        return config[key];
      }),
    } as unknown as ConfigService;

    const strategy = new GoogleStrategy(mockConfigService);

    const mockProfile = {
      id: 'google-id-789',
      displayName: 'Google User',
      emails: [{ value: 'google@test.com', verified: true }],
    };

    const result = await strategy.extractProfile(mockProfile);

    expect(result).toEqual({
      provider: 'google',
      providerId: 'google-id-789',
      email: 'google@test.com',
      emailVerified: true,
      name: 'Google User',
    });
  });

  it('does not report an email as verified when Google withholds email_verified', async () => {
    const { GoogleStrategy } = await import('./google.strategy.js');
    const strategy = new GoogleStrategy({ get: vi.fn().mockReturnValue('test-value') } as unknown as ConfigService);

    for (const verified of [false, undefined, 'false']) {
      const result = strategy.extractProfile({
        id: 'google-id-unverified',
        displayName: 'Google User',
        emails: [{ value: 'google@test.com', verified }],
      });
      expect(result.emailVerified).toBe(false);
    }
  });

  it('should use default callbackURL containing /social/ segment when env var is not set', async () => {
    const { GoogleStrategy } = await import('./google.strategy.js');

    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
        const config: Record<string, string> = {
          GOOGLE_CLIENT_ID: 'test-google-client-id',
          GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        };
        return config[key] ?? defaultValue;
      }),
    } as unknown as ConfigService;

    const strategy = new GoogleStrategy(mockConfigService);

    const callbackCall = mockConfigService.get.mock.calls.find(
      (call: unknown[]) => call[0] === 'GOOGLE_CALLBACK_URL',
    );
    expect(callbackCall).toBeDefined();
    expect(callbackCall![1]).toContain('/auth/social/google/callback');

    expect(strategy).toBeDefined();
  });

  it('should handle missing email gracefully', async () => {
    const { GoogleStrategy } = await import('./google.strategy.js');

    const mockConfigService = {
      get: vi.fn().mockReturnValue('test-value'),
    } as unknown as ConfigService;

    const strategy = new GoogleStrategy(mockConfigService);

    const mockProfile = {
      id: 'google-id-000',
      displayName: 'Google No Email',
      emails: [],
    };

    const result = await strategy.extractProfile(mockProfile);

    expect(result.email).toBeUndefined();
    expect(result.provider).toBe('google');
  });
});
