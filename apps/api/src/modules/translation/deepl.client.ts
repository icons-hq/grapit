import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TranslationTargetLocale } from './translation.service.js';

export type DeepLTargetLang = 'EN-US' | 'TH' | 'ZH-HANS' | 'ZH-HANT';

export interface DeepLTranslationResult {
  status: 'translated' | 'unavailable';
  text: string;
  targetLang: DeepLTargetLang;
}

interface DeepLTranslateResponse {
  translations?: Array<{
    text?: unknown;
    detected_source_language?: unknown;
  }>;
}

const DEEPL_TARGET_LOCALE: Record<TranslationTargetLocale, DeepLTargetLang> = {
  en: 'EN-US',
  th: 'TH',
  'zh-CN': 'ZH-HANS',
  'zh-TW': 'ZH-HANT',
};

export function mapDeepLTargetLocale(locale: TranslationTargetLocale): DeepLTargetLang {
  return DEEPL_TARGET_LOCALE[locale];
}

@Injectable()
export class DeepLClient {
  private readonly authKey: string;
  private readonly baseUrl = 'https://api-free.deepl.com';

  constructor(private readonly configService: ConfigService) {
    this.authKey = this.configService.get<string>('DEEPL_AUTH_KEY', '');
  }

  async translateText(
    text: string,
    locale: TranslationTargetLocale,
  ): Promise<DeepLTranslationResult> {
    const targetLang = mapDeepLTargetLocale(locale);

    if (!this.authKey) {
      return {
        status: 'unavailable',
        text: `[manual-review:deepl-unavailable] ${text}`,
        targetLang,
      };
    }

    const response = await fetch(`${this.baseUrl}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${this.authKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        source_lang: 'KO',
        target_lang: targetLang,
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      const statusText = response.statusText || 'Unknown status';
      throw new Error(
        `DeepL 번역 요청에 실패했습니다 (${response.status} ${statusText}): ${responseText.slice(0, 500)}`,
      );
    }

    let data: DeepLTranslateResponse;
    try {
      data = JSON.parse(responseText) as DeepLTranslateResponse;
    } catch {
      throw new Error(
        `DeepL 번역 응답이 JSON 형식이 아닙니다: ${responseText.slice(0, 500)}`,
      );
    }

    const translatedText = data.translations?.[0]?.text;
    if (typeof translatedText !== 'string' || translatedText.length === 0) {
      throw new Error('DeepL 번역 응답이 올바르지 않습니다');
    }

    return {
      status: 'translated',
      text: translatedText,
      targetLang,
    };
  }
}
