import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PHASE26_MARKER_PATTERN,
  PHASE26_ORDER_PREFIX_PATTERN,
  assertPhase26Marker,
  assertPhase26OrderPrefix,
  assertPhase26TestEventTitle,
} from './test-event-identity.mjs';

test('refuses substring markers that can appear in real performance copy', () => {
  for (const marker of ['greatest', 'contest', 'TEST', 'PHASE26', 'PHASE26_', 'PHASE26_abc', 'phase26_test-event', 'PHASE26_TEST EVENT', 'PHASE26_%%%%%%']) {
    assert.throws(() => assertPhase26Marker(marker), /PHASE26_TEST_MARKER must match/, marker);
  }
  assert.doesNotThrow(() => assertPhase26Marker('PHASE26_TEST-20261002'));
  assert.doesNotThrow(() => assertPhase26Marker('PHASE26-LOAD_EVENT'));
});

test('requires the performance title to start with the marker', () => {
  const marker = 'PHASE26_TEST-20261002';
  assert.doesNotThrow(() => assertPhase26TestEventTitle(`${marker} load rehearsal`, marker));
  assert.throws(() => assertPhase26TestEventTitle(`Greatest Hits Live (${marker})`, marker), /title must start/);
  assert.throws(() => assertPhase26TestEventTitle('Greatest Hits Live', marker), /title must start/);
  assert.throws(() => assertPhase26TestEventTitle(`${marker} Girl Rules`, marker), /Girl Rules/);
});

test('order prefixes are literal tokens without SQL LIKE wildcards', () => {
  assert.doesNotThrow(() => assertPhase26OrderPrefix('PHASE26_ORD-'));
  for (const prefix of ['PHASE26%', 'PHASE26_ORD%', 'ORD-PHASE26', 'PHASE26_ORD.']) {
    assert.throws(() => assertPhase26OrderPrefix(prefix), /PHASE26_TEST_ORDER_PREFIX/, prefix);
  }
});

test('the cleanup SQL and k6 scripts enforce the same identity rules', async () => {
  const sqlMarker = `'${PHASE26_MARKER_PATTERN.source}'`;
  const sqlPrefix = `'${PHASE26_ORDER_PREFIX_PATTERN.source}'`;
  for (const file of ['cleanup-dry-run.sql', 'cleanup-test-event.sql']) {
    const sql = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.ok(sql.includes(`cfg.test_marker !~ ${sqlMarker}`), `${file} marker rule`);
    assert.ok(sql.includes(`cfg.order_prefix !~ ${sqlPrefix}`), `${file} order prefix rule`);
    assert.ok(sql.includes('not starts_with(target.title, cfg.test_marker)'), `${file} title rule`);
    assert.ok(sql.includes("target.publish_state = 'published'"), `${file} published rule`);
    assert.ok(sql.includes('target.booking_starts_at > now()'), `${file} future opening rule`);
    const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    assert.equal(/\blike\b/i.test(statements.replace(/\bilike\b/gi, '')), false, `${file} must not use LIKE prefix patterns`);
  }
  const k6 = await import('../k6/lib/phase26-load.js');
  assert.equal(k6.PHASE26_MARKER_PATTERN.source, PHASE26_MARKER_PATTERN.source);
});
