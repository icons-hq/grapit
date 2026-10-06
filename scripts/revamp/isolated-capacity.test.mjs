import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// isolated-capacity.mjs runs disposable containers at import time, so its
// constants are read from source instead of being imported.
function declaredNumber(relativePath, name) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const match = new RegExp(`\\b${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(source);
  assert.ok(match, `${name} declaration not found in ${relativePath}`);
  return Number(match[1].replaceAll('_', ''));
}

test('checkout consent rows come from the shared booking contract, not a hardcoded version (audit D7)', () => {
  // A hardcoded '2026-04-28' for every row breaks prepare once the old privacy
  // document is retired; booking records only terms and privacy.
  const source = readFileSync(new URL('./isolated-capacity.mjs', import.meta.url), 'utf8');
  assert.match(source, /\nconst shared = require\('@grabit\/shared'\);\n/);
  const body = /\nfunction prepareBody\([^)]*\) \{\n[\s\S]*?\n\}\n/.exec(source)?.[0];
  assert.ok(body, 'prepareBody found');
  assert.match(body, /consentItems: shared\.BOOKING_CONSENT_ITEM_KEYS\.map\(\(key\) =>/);
  assert.match(body, /version: shared\.CONSENT_DOCUMENT_VERSIONS\[key\]/);
  assert.match(body, /language: shared\.resolveConsentDocumentLanguage\('ko'\)/);
  assert.doesNotMatch(body, /pipa_required|version: '/);
});

test('the WAITING expectation uses the API active-admission cap', () => {
  // waitingRoom.passed compares admitted/WAITING counts against this cap; a
  // silent drift would mark a correct queue as failed or a broken one as passed.
  assert.equal(
    declaredNumber('./isolated-capacity.mjs', 'QUEUE_ACTIVE_ADMISSION_LIMIT'),
    declaredNumber('../../apps/api/src/modules/queue/queue.service.ts', 'QUEUE_MAX_ACTIVE_ADMISSIONS'),
  );
});
