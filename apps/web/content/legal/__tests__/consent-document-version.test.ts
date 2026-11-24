import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONSENT_DOCUMENT_VERSIONS } from '@grabit/shared';

const legalContentDir = path.resolve(process.cwd(), 'content/legal');

// Which bundled document each consent row opens (signup-step2 and TermsAgreement).
const DOCUMENT_BY_CONSENT_KEY = {
  terms: 'terms-of-service',
  privacy: 'privacy-policy',
  pipa_required: 'privacy-policy',
  marketing: 'marketing-consent',
} as const satisfies Record<keyof typeof CONSENT_DOCUMENT_VERSIONS, string>;

/**
 * Text fingerprint of each document at its recorded version. A consent row's
 * version must identify the exact text the buyer saw: privacy policy v1.2 was
 * edited on 2026-05-12 (Infobip to Twilio, transfer country Germany to the US)
 * while keeping 2026-05-11, so one label covers two texts. Changing a document
 * now fails here. For a substantive change, bump CONSENT_DOCUMENT_VERSIONS and
 * seed the new version (consent version runbook); for a purely cosmetic edit
 * (typo, formatting), update the hash in the same change and say so in review.
 */
const DOCUMENT_TEXT_SNAPSHOTS = {
  'terms-of-service': {
    version: '2026-04-28',
    // 2026-11-10: move emphasis delimiters inside quoted Korean definitions so
    // CommonMark renders them. Wording and effective version are unchanged.
    ko: '8b2b0e580ad113695c2017fb0d5c115627c4457db4db15899da1239c8a01a0e2',
    en: '8cc9e21a7f8a18715fd2cf234804de8d57d86ab957366c333357fce6a834f152',
    'th': '828cfdfaee06b497b69f7a70c25849579cd72ad0aa02f8c8584432ebac6652ea',
    'zh-CN': 'fe4316b838348d6fc60a7cee533c7a38656deb575fd89457f4b732f348dddecd',
  },
  'privacy-policy': {
    version: '2026-11-20',
    ko: '088a360bb48c96a40330b901c3f7038e6fcd9c8f2fcf424bc7ea89a2ef619580',
    en: 'f0b64d6022b4ec738e41025db252971baea40fcc11dd98dc3e401134240e90ba',
    'th': 'af3089c4dadc2dd0021c3e34d834bb74e10ac50b53c97c46fcd4c31cd1f87ac8',
    'zh-CN': 'cca380f9a468ce7ee43a8a210c2639a68a8d915310deb2e94ea18e6683d77191',
  },
  'marketing-consent': {
    version: '2026-04-28',
    ko: '3eec747d93452797b67ca294184f078a80773da4160d23dd1091b8ba9d8491ed',
    en: '0149e26ddccf77428eca5d122f0c650970f4e49642b90422cd71ac07a3481c61',
    'th': '33dd7701f2678299b49bb98efc275b26a259657c26c79782d43c7b292d8485d9',
    'zh-CN': '12cb8af383530b54fc8ee90dbdb3a7f2cd4f5ec4b0d213c24755a8e473af1764',
  },
} as const satisfies Record<(typeof DOCUMENT_BY_CONSENT_KEY)[keyof typeof DOCUMENT_BY_CONSENT_KEY], unknown>;

function textHash(filename: string): string {
  const content = readFileSync(path.join(legalContentDir, filename), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(content).digest('hex');
}

function effectiveDate(filename: string): string | undefined {
  const content = readFileSync(path.join(legalContentDir, filename), 'utf8');
  const match = content.match(/(\d{4}-\d{2}-\d{2})부터 (?:시행|적용)됩니다/)
    ?? content.match(/(?:effective|applies) from (\d{4}-\d{2}-\d{2})/)
    ?? content.match(/(?:มีผลตั้งแต่ |自 )(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

describe('consent document versions', () => {
  it.each(Object.entries(DOCUMENT_BY_CONSENT_KEY))(
    '%s consent is recorded with the effective date of the %s document it shows',
    (key, document) => {
      const version = CONSENT_DOCUMENT_VERSIONS[key as keyof typeof CONSENT_DOCUMENT_VERSIONS];

      expect(effectiveDate(`${document}.md`)).toBe(version);
      for (const locale of ['en', 'th', 'zh-CN'] as const) {
        expect(effectiveDate(`${document}.${locale}.md`)).toBe(version);
      }
    },
  );

  it.each(Object.entries(DOCUMENT_BY_CONSENT_KEY))(
    '%s consent version still names the %s text it was recorded for',
    (key, document) => {
      const snapshot = DOCUMENT_TEXT_SNAPSHOTS[document];

      expect(
        CONSENT_DOCUMENT_VERSIONS[key as keyof typeof CONSENT_DOCUMENT_VERSIONS],
        'version bumped: record the new text fingerprint',
      ).toBe(snapshot.version);
      expect(textHash(`${document}.md`), `${document}.md changed without a version bump`).toBe(snapshot.ko);
      for (const locale of ['en', 'th', 'zh-CN'] as const) {
        const filename = `${document}.${locale}.md`;
        expect(textHash(filename), filename).toBe(snapshot[locale]);
      }
    },
  );
});
