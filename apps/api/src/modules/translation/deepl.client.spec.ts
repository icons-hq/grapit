import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepLClient, mapDeepLTargetLocale } from './deepl.client.js';

describe('mapDeepLTargetLocale', () => {
  it('maps launch locales to DeepL target languages', () => {
    expect(mapDeepLTargetLocale('en')).toBe('EN-US');
    expect(mapDeepLTargetLocale('th')).toBe('TH');
    expect(mapDeepLTargetLocale('zh-CN')).toBe('ZH-HANS');
    expect(mapDeepLTargetLocale('zh-TW')).toBe('ZH-HANT');
  });
});

describe('DeepLClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns deterministic unavailable state without calling fetch when DEEPL_AUTH_KEY is missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new DeepLClient({
      get: vi.fn((key: string, defaultValue?: string) => {
        if (key === 'DEEPL_AUTH_KEY') {
          return '';
        }
        return defaultValue;
      }),
    } as unknown as ConfigService);

    const result = await client.translateText('팬미팅 안내', 'en');

    expect(result).toEqual({
      status: 'unavailable',
      text: '[manual-review:deepl-unavailable] 팬미팅 안내',
      targetLang: 'EN-US',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls DeepL translate endpoint with auth key and mapped target language', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        translations: [{ text: 'Fan meeting guide', detected_source_language: 'KO' }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = new DeepLClient({
      get: vi.fn((key: string, defaultValue?: string) => {
        if (key === 'DEEPL_AUTH_KEY') {
          return 'test-deepl-key';
        }
        return defaultValue;
      }),
    } as unknown as ConfigService);

    const result = await client.translateText('팬미팅 안내', 'zh-CN');

    expect(result).toEqual({
      status: 'translated',
      text: 'Fan meeting guide',
      targetLang: 'ZH-HANS',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api-free.deepl.com/v2/translate',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'DeepL-Auth-Key test-deepl-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: ['팬미팅 안내'],
          source_lang: 'KO',
          target_lang: 'ZH-HANS',
        }),
      }),
    );
  });
});
