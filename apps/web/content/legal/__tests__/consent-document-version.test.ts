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
    ko: 'bbfb81cc358dafc095ebac2b521fcb87558bfa64eca8ac6fbeb86823b6384c01',
    en: '8cc9e21a7f8a18715fd2cf234804de8d57d86ab957366c333357fce6a834f152',
  },
  'privacy-policy': {
    version: '2026-05-11',
    ko: '598ef46cf5d46e3426dbacd4df8e0c4c3db113428465194b7dcb4c216966f4e3',
    en: 'f56f605781043740b61ceb5ad20c1e10779868992cc11abd47721b129911bb86',
  },
  'marketing-consent': {
    version: '2026-04-28',
    ko: '3eec747d93452797b67ca294184f078a80773da4160d23dd1091b8ba9d8491ed',
    en: '0149e26ddccf77428eca5d122f0c650970f4e49642b90422cd71ac07a3481c61',
  },
} as const satisfies Record<(typeof DOCUMENT_BY_CONSENT_KEY)[keyof typeof DOCUMENT_BY_CONSENT_KEY], unknown>;

function textHash(filename: string): string {
  const content = readFileSync(path.join(legalContentDir, filename), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(content).digest('hex');
}

function effectiveDate(filename: string): string | undefined {
  const content = readFileSync(path.join(legalContentDir, filename), 'utf8');
  const match = content.match(/(\d{4}-\d{2}-\d{2})부터 (?:시행|적용)됩니다/)
    ?? content.match(/(?:effective|applies) from (\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

describe('consent document versions', () => {
  it.each(Object.entries(DOCUMENT_BY_CONSENT_KEY))(
    '%s consent is recorded with the effective date of the %s document it shows',
    (key, document) => {
      const version = CONSENT_DOCUMENT_VERSIONS[key as keyof typeof CONSENT_DOCUMENT_VERSIONS];

      expect(effectiveDate(`${document}.md`)).toBe(version);
      expect(effectiveDate(`${document}.en.md`)).toBe(version);
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
      expect(textHash(`${document}.en.md`), `${document}.en.md changed without a version bump`).toBe(snapshot.en);
    },
  );
});
