import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import marketingConsentMd from '../marketing-consent.md?raw';
import privacyPolicyMd from '../privacy-policy.md?raw';
import termsOfServiceMd from '../terms-of-service.md?raw';

const legalContentDir = path.resolve(process.cwd(), 'content/legal');

function readLegalDocument(filename: string) {
  const filePath = path.join(legalContentDir, filename);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

const legalDocuments = {
  'terms-of-service.md': termsOfServiceMd,
  'privacy-policy.md': privacyPolicyMd,
  'marketing-consent.md': marketingConsentMd,
};

const englishLegalDocuments = {
  'terms-of-service.en.md': readLegalDocument('terms-of-service.en.md'),
  'privacy-policy.en.md': readLegalDocument('privacy-policy.en.md'),
  'marketing-consent.en.md': readLegalDocument('marketing-consent.en.md'),
};

const allCanonicalLegalDocuments = {
  ...legalDocuments,
  ...englishLegalDocuments,
};

const placeholderPatterns = [
  /\[사업자명:/,
  /\[대표자명:/,
  /\[사업자등록번호:/,
  /\[통신판매업 신고번호:/,
  /\[주소:/,
  /\[전화번호:/,
  /\[보호책임자 실명:/,
  /\[직책:/,
  /\[시행일:/,
  /\[직전 시행일:/,
  /000-00-00000/,
  /0000-서울/,
  /000-0000-0000/,
  /YYYY-MM-DD/,
];

const requiredEnglishHeadingPatterns = {
  'terms-of-service.en.md': [
    /^# Terms of Service/m,
    /^## Article 1 \(Purpose\)/m,
    /^## Article 15 \(Business Identity and Contact\)/m,
  ],
  'privacy-policy.en.md': [
    /^# Privacy Policy/m,
    /^## Article 1 \(Purpose of Processing Personal Information\)/m,
    /^## Article 6 \(Cross-Border Transfer of Personal Information\)/m,
  ],
  'marketing-consent.en.md': [
    /^# Marketing Consent/m,
    /^## Purpose of Collection and Use/m,
    /^## Right to Refuse Consent/m,
  ],
};

describe('legal content', () => {
  it.each(Object.entries(allCanonicalLegalDocuments))(
    '%s does not expose launch placeholder values',
    (_filename, content) => {
      expect(content).toEqual(expect.any(String));

      for (const pattern of placeholderPatterns) {
        expect(content).not.toMatch(pattern);
      }
    },
  );

  it('uses the supplied business identity in terms of service', () => {
    expect(termsOfServiceMd).toContain('사업자명: (주)아이콘스');
    expect(termsOfServiceMd).toContain('대표자명: 정승준');
    expect(termsOfServiceMd).toContain('사업자등록번호: 109-86-27576');
    expect(termsOfServiceMd).toContain('통신판매업 신고번호: 2025-서울마포-1494');
    expect(termsOfServiceMd).toContain('사업장 주소: 서울특별시 마포구 월드컵로8길 69');
    expect(termsOfServiceMd).toContain('고객센터 전화번호: 02-325-179');
  });

  it('uses the launch effective date across legal documents', () => {
    for (const content of Object.values(allCanonicalLegalDocuments)) {
      expect(content).toEqual(expect.any(String));
      expect(content).toContain('2026-04-28');
    }
  });

  it('discloses the runtime SMS provider in privacy policy', () => {
    expect(privacyPolicyMd).not.toContain('Infobip');
    expect(privacyPolicyMd).toContain('SMS 발송**: Twilio Inc. 및 그 계열사');
    expect(privacyPolicyMd).toContain('| Twilio Inc. 및 그 계열사 | 미국 (United States) |');
    expect(privacyPolicyMd).toContain('휴대전화번호, SMS 인증 요청 및 상태 정보');
    expect(privacyPolicyMd).toContain('SMS 본인인증 OTP 발송 및 확인');
  });

  it('locks legal canonical markdown locales to Korean and English', () => {
    const legalMarkdownFiles = readdirSync(legalContentDir)
      .filter((filename) => filename.endsWith('.md'))
      .sort();

    const canonicalLocales = new Set(
      legalMarkdownFiles.map((filename) => {
        const match = filename.match(/\.(en|th|zh-CN|zh-TW)\.md$/);
        return match?.[1] ?? 'ko';
      }),
    );

    expect([...canonicalLocales].sort()).toEqual(['en', 'ko']);
  });

  it.each(Object.entries(englishLegalDocuments))(
    '%s exists as manual English canonical legal copy',
    (_filename, content) => {
      expect(content).toEqual(expect.any(String));
      expect(content).not.toMatch(/machine translated|automatic translation|자동 번역/i);
      expect(content).toContain('Grabit');
      expect(content).toContain('2026-04-28');
    },
  );

  it.each(Object.entries(requiredEnglishHeadingPatterns))(
    '%s follows the Korean legal document structure',
    (filename, headingPatterns) => {
      const content = englishLegalDocuments[filename as keyof typeof englishLegalDocuments];

      expect(content).toEqual(expect.any(String));
      for (const pattern of headingPatterns) {
        expect(content).toMatch(pattern);
      }
    },
  );

  it('rejects Thai and Chinese legal markdown files', () => {
    const forbiddenLegalMarkdownFiles = [
      'terms-of-service.th.md',
      'terms-of-service.zh-CN.md',
      'terms-of-service.zh-TW.md',
      'privacy-policy.th.md',
      'privacy-policy.zh-CN.md',
      'privacy-policy.zh-TW.md',
      'marketing-consent.th.md',
      'marketing-consent.zh-CN.md',
      'marketing-consent.zh-TW.md',
    ];

    for (const filename of forbiddenLegalMarkdownFiles) {
      expect(existsSync(path.join(legalContentDir, filename))).toBe(false);
    }
  });
});
