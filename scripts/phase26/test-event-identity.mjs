// Positive identification of the dedicated Phase 26 test event. The same rules
// are enforced by cleanup-dry-run.sql, cleanup-test-event.sql and the k6 load
// scripts: a marker is a dedicated token (never a word that can appear in real
// performance copy) and the performance title must start with it.
export const PHASE26_MARKER_PATTERN = /^PHASE26[_-][A-Za-z0-9_-]{6,}$/;
export const PHASE26_ORDER_PREFIX_PATTERN = /^PHASE26[_-][A-Za-z0-9_-]*$/;
const REAL_EVENT_DENYLIST = /Girl Rules|걸룰/i;

export function assertPhase26Marker(marker, name = 'PHASE26_TEST_MARKER') {
  if (typeof marker !== 'string' || !PHASE26_MARKER_PATTERN.test(marker)) {
    throw new Error(`${name} must match ${PHASE26_MARKER_PATTERN.source}`);
  }
}

export function assertPhase26OrderPrefix(prefix, name = 'PHASE26_TEST_ORDER_PREFIX') {
  if (typeof prefix !== 'string' || !PHASE26_ORDER_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`${name} must start with PHASE26_ or PHASE26- and use only letters, digits, _ or -`);
  }
}

export function assertPhase26TestEventTitle(title, marker) {
  assertPhase26Marker(marker);
  const text = typeof title === 'string' ? title : '';
  if (REAL_EVENT_DENYLIST.test(text)) {
    throw new Error('Dedicated test-event fixture check failed: real Girl Rules content is in scope');
  }
  if (!text.startsWith(marker)) {
    throw new Error('Dedicated test-event fixture check failed: performance title must start with PHASE26_TEST_MARKER');
  }
}
