import type { SupportedLocale } from '@grabit/shared';
import termsKo from './terms-of-service.md?raw';
import termsEn from './terms-of-service.en.md?raw';
import termsTh from './terms-of-service.th.md?raw';
import termsZh from './terms-of-service.zh-CN.md?raw';
import privacyKo from './privacy-policy.md?raw';
import privacyEn from './privacy-policy.en.md?raw';
import privacyTh from './privacy-policy.th.md?raw';
import privacyZh from './privacy-policy.zh-CN.md?raw';
import marketingKo from './marketing-consent.md?raw';
import marketingEn from './marketing-consent.en.md?raw';
import marketingTh from './marketing-consent.th.md?raw';
import marketingZh from './marketing-consent.zh-CN.md?raw';

export const legalDocuments = {
  terms: { ko: termsKo, en: termsEn, th: termsTh, 'zh-CN': termsZh },
  privacy: { ko: privacyKo, en: privacyEn, th: privacyTh, 'zh-CN': privacyZh },
  marketing: { ko: marketingKo, en: marketingEn, th: marketingTh, 'zh-CN': marketingZh },
} satisfies Record<string, Record<SupportedLocale, string>>;
