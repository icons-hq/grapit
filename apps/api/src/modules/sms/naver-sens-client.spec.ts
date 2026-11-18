import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NaverSensApiError, NaverSensClient, type NaverSensConfig } from './naver-sens-client.js';

const config: NaverSensConfig = {
  accessKey: 'sens-test-access', secretKey: 'sens-test-secret',
  serviceId: 'ncp:sms:kr:123:test', from: '0212345678', companyName: 'ICONS',
};
const accepted = { requestId: 'RSLG-test-id', statusCode: '202', statusName: 'success' };

describe('NaverSensClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('signs the exact URI and sends only the approved China OTP template', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(accepted), { status: 202 }));
    await expect(new NaverSensClient(config).sendCode('+8613912345678', '012345'))
      .resolves.toEqual({ requestId: 'RSLG-test-id' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sens.apigw.ntruss.com/sms/v2/services/ncp:sms:kr:123:test/messages');
    expect(options).toMatchObject({
      method: 'POST', redirect: 'error',
      headers: {
        'x-ncp-apigw-timestamp': '1700000000000',
        'x-ncp-iam-access-key': 'sens-test-access',
        'x-ncp-apigw-signature-v2': 'M1r0PLIhYVIg2rmQ6NDE93jfbLFWcJCjxXhtMLrUwfY=',
      },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options!.body as string)).toEqual({
      type: 'SMS', contentType: 'COMM', countryCode: '86', from: '0212345678',
      content: '[ICONS] verification: 012345', messages: [{ to: '13912345678' }],
    });
  });

  it.each([400, 401, 403, 429, 408, 500, 503])('handles HTTP %s without retaining provider bodies', async (status) => {
    fetchMock.mockResolvedValue(new Response('012345 +8613912345678 sens-test-secret', { status }));
    const error = await new NaverSensClient(config).sendCode('+8613912345678', '012345').catch(e => e);
    expect(error).toBeInstanceOf(NaverSensApiError);
    expect(error).toMatchObject({ status, outcome: status >= 500 || status === 408 ? 'unknown' : 'rejected' });
    expect(String(error) + JSON.stringify(error)).not.toMatch(/012345|8613912345678|sens-test-secret/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a network timeout or preserve the original error', async () => {
    fetchMock.mockRejectedValue(new Error('request with 012345 and sens-test-secret'));
    const error = await new NaverSensClient(config).sendCode('+8613912345678', '012345').catch(e => e);
    expect(error).toMatchObject({ status: 0, outcome: 'unknown' });
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain('012345');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not-json', 202],
    [JSON.stringify({ ...accepted, requestId: undefined }), 202],
    [JSON.stringify({ ...accepted, statusName: 'fail' }), 202],
    [JSON.stringify(accepted), 200],
  ])('requires a valid acceptance acknowledgement', async (body, status) => {
    fetchMock.mockResolvedValue(new Response(body as string, { status: status as number }));
    await expect(new NaverSensClient(config).sendCode('+8613912345678', '012345'))
      .rejects.toMatchObject({ outcome: 'unknown' });
  });

  it.each([
    { accessKey: '' }, { secretKey: '' }, { serviceId: '../other?key=x' },
    { from: '+820212345678' }, { companyName: 'ICONS]\nhttps://x.test' },
  ])('rejects invalid configuration without network access', (override) => {
    expect(() => new NaverSensClient({ ...config, ...override })).toThrow(/Invalid SENS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([['+821012345678', '012345'], ['+8613912345678', '12345']])('rejects invalid destinations or OTPs', async (phone, code) => {
    await expect(new NaverSensClient(config).sendCode(phone, code)).rejects.toThrow(/Invalid China OTP/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
