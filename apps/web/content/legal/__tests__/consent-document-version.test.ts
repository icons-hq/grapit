import { describe, expect, it } from 'vitest';
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
});
