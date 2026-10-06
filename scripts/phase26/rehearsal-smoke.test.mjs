import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  amountOverrideWarning,
  buildPrepareRequest,
  checkoutAmount,
  loadConfig,
  makeConsentItems,
  resolveSeatFixture,
} from './rehearsal-smoke.mjs';

// The real request contract, so the rehearsal cannot drift from the checkout page.
const shared = createRequire(new URL('../../apps/api/package.json', import.meta.url))('@grabit/shared');
const prepareTransportSchema = shared.prepareReservationSchema
  .omit({ queueAdmission: true })
  .extend({ queueAdmission: shared.queueAdmissionSchema.partial().optional() });

const SEAT = {
  seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1F', tierName: 'VIP', price: 50000, row: 'A', number: '1',
};

test('importing the rehearsal smoke does not start a rehearsal', () => {
  assert.equal(process.exitCode, undefined);
});

test('rehearsal prepare sends the current booking consent rows (audit #65 #106, D7)', () => {
  // Before: terms/privacy/pipa_required with version "phase26-rehearsal", which no
  // consent_items row has, so every prepare was a 400.
  assert.deepEqual(makeConsentItems(), shared.BOOKING_CONSENT_ITEM_KEYS.map((key) => ({
    key,
    version: shared.CONSENT_DOCUMENT_VERSIONS[key],
    language: 'ko',
    accepted: true,
    sourceFlow: 'booking',
  })));
  assert.equal(makeConsentItems().some((item) => item.key === 'pipa_required'), false);
});

test('rehearsal prepare and confirm carry the order total with the service fee', () => {
  // Before: amount was the seat price only, which the server rejects as an amount mismatch.
  assert.equal(checkoutAmount(SEAT), SEAT.price + shared.TICKET_SERVICE_FEE_KRW);

  const body = buildPrepareRequest({
    orderId: 'PHASE26_ORD-rehearsal-1',
    config: { showtimeId: '22222222-2222-4222-8222-222222222222' },
    seat: SEAT,
    now: new Date(0),
  });
  const parsed = prepareTransportSchema.safeParse(body);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(body.amount, 52000);
  assert.equal(body.paymentDeadlineAt, new Date(7 * 60 * 1000).toISOString());
  assert.deepEqual(body.consentItems, makeConsentItems());
});

// Only the variables loadConfig() reads; no request, file or database is touched.
const REHEARSAL_ENV = {
  GRABIT_API_URL: 'https://api.example.test',
  GRABIT_SMOKE_AUTH_HEADER_FILE: '/nonexistent/auth-header',
  PHASE26_TEST_PERFORMANCE_ID: '11111111-1111-4111-8111-111111111111',
  PHASE26_TEST_SHOWTIME_ID: '22222222-2222-4222-8222-222222222222',
  PHASE26_TEST_SEAT_ID: '1F:A-1',
  PHASE26_TEST_ORDER_PREFIX: 'PHASE26_ORD',
  PHASE26_TEST_MARKER: 'PHASE26_REHEARSAL_AMOUNT',
  PHASE26_REHEARSAL_ALLOW_MUTATION: 'PHASE26_DEDICATED_TEST_EVENT_APPROVED',
  PHASE26_DATABASE_URL: 'disposable-placeholder',
  PHASE26_TEST_AMOUNT: undefined,
  PHASE26_TEST_TIER_PRICE: undefined,
};

function withEnv(t, overrides) {
  const env = { ...REHEARSAL_ENV, ...overrides };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const apply = (values) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(env);
  t.after(() => apply(saved));
}

const PERFORMANCE = { seatMap: { tiers: [{ name: 'VIP', price: 50000, color: '#111111', seatIds: ['A-1'] }] } };

test('PHASE26_TEST_AMOUNT is the seat price and the run warns that it is not the total (ops-infra-5)', (t) => {
  withEnv(t, { PHASE26_TEST_AMOUNT: '3000' });
  const stderr = t.mock.method(console, 'error', () => {});

  const config = loadConfig();
  assert.equal(config.amountOverride, 3000);
  assert.equal(stderr.mock.callCount(), 1);
  assert.equal(stderr.mock.calls[0].arguments[0], amountOverrideWarning(3000));
  assert.match(stderr.mock.calls[0].arguments[0], /PHASE26_TEST_AMOUNT=3000 is read as the seat price, not the order total/);

  // Before: the usage called it the "fixture amount"; an operator who entered the order
  // total got a prepare of total + fee, which the server rejects as an amount mismatch.
  const seat = resolveSeatFixture(PERFORMANCE, config);
  assert.equal(seat.price, 3000);
  const body = buildPrepareRequest({ orderId: 'PHASE26_ORD-amount-1', config, seat, now: new Date(0) });
  assert.equal(body.amount, 3000 + shared.TICKET_SERVICE_FEE_KRW);
  assert.equal(checkoutAmount(seat), 3000 + shared.TICKET_SERVICE_FEE_KRW);
  const parsed = prepareTransportSchema.safeParse(body);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test('the tier price stays the seat price without a warning when PHASE26_TEST_AMOUNT is unset', (t) => {
  withEnv(t, { PHASE26_TEST_TIER_PRICE: '4000' });
  const stderr = t.mock.method(console, 'error', () => {});

  const config = loadConfig();
  assert.equal(config.amountOverride, null);
  assert.equal(stderr.mock.callCount(), 0);
  const seat = resolveSeatFixture(PERFORMANCE, config);
  assert.equal(seat.price, 4000);
  assert.equal(checkoutAmount(seat), 4000 + shared.TICKET_SERVICE_FEE_KRW);
});
