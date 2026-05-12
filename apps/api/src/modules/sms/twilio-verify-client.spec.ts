import { describe, expect, it, vi, beforeEach } from 'vitest';
import twilio from 'twilio';
import {
  TwilioVerifyApiError,
  TwilioVerifyClient,
} from './twilio-verify-client.js';

vi.mock('twilio', () => ({
  default: vi.fn(),
}));

const createVerification = vi.fn();
const createVerificationCheck = vi.fn();
const services = vi.fn(() => ({
  verifications: { create: createVerification },
  verificationChecks: { create: createVerificationCheck },
}));

describe('TwilioVerifyClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (twilio as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      verify: {
        v2: {
          services,
        },
      },
    });
  });

  it('creates a Twilio client with auth token credentials and sends an SMS verification', async () => {
    createVerification.mockResolvedValueOnce({
      sid: 'VE123',
      status: 'pending',
      channel: 'sms',
    });

    const client = new TwilioVerifyClient({
      accountSid: 'AC123',
      authToken: 'auth-token',
    }, 'VA123', 'ko');
    const result = await client.sendVerification('+821012345678');

    expect(twilio).toHaveBeenCalledWith('AC123', 'auth-token');
    expect(services).toHaveBeenCalledWith('VA123');
    expect(createVerification).toHaveBeenCalledWith({
      to: '+821012345678',
      channel: 'sms',
      locale: 'ko',
    });
    expect(result).toEqual({
      sid: 'VE123',
      status: 'pending',
      channel: 'sms',
    });
  });

  it('creates a Twilio client with API key credentials when configured', async () => {
    createVerification.mockResolvedValueOnce({
      sid: 'VE123',
      status: 'pending',
      channel: 'sms',
    });

    const client = new TwilioVerifyClient({
      accountSid: 'AC123',
      apiKeySid: 'SK123',
      apiKeySecret: 'api-secret',
    }, 'VA123');
    await client.sendVerification('+821012345678');

    expect(twilio).toHaveBeenCalledWith('SK123', 'api-secret', {
      accountSid: 'AC123',
    });
  });

  it('omits locale when no override is configured', async () => {
    createVerification.mockResolvedValueOnce({
      sid: 'VE123',
      status: 'pending',
      channel: 'sms',
    });

    const client = new TwilioVerifyClient({
      accountSid: 'AC123',
      authToken: 'auth-token',
    }, 'VA123');
    await client.sendVerification('+14155552671');

    expect(createVerification).toHaveBeenCalledWith({
      to: '+14155552671',
      channel: 'sms',
    });
  });

  it('checks a submitted code through Twilio Verify', async () => {
    createVerificationCheck.mockResolvedValueOnce({
      sid: 'VE123',
      status: 'approved',
      valid: true,
    });

    const client = new TwilioVerifyClient({
      accountSid: 'AC123',
      authToken: 'auth-token',
    }, 'VA123');
    const result = await client.checkVerification('+821012345678', '123456');

    expect(createVerificationCheck).toHaveBeenCalledWith({
      to: '+821012345678',
      code: '123456',
    });
    expect(result).toEqual({
      sid: 'VE123',
      status: 'approved',
      valid: true,
    });
  });

  it('normalizes Twilio SDK errors for service-layer retry and expiry policy', async () => {
    createVerificationCheck.mockRejectedValueOnce({
      status: 404,
      code: 20404,
      message: 'Verification not found',
      moreInfo: 'https://www.twilio.com/docs/errors/20404',
    });

    const client = new TwilioVerifyClient({
      accountSid: 'AC123',
      authToken: 'auth-token',
    }, 'VA123');

    await expect(
      client.checkVerification('+821012345678', '123456'),
    ).rejects.toMatchObject({
      name: 'TwilioVerifyApiError',
      status: 404,
      code: 20404,
      isExpiredOrExhausted: true,
      shouldRollbackQuota: false,
    } satisfies Partial<TwilioVerifyApiError>);
  });
});
