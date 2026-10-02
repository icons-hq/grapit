import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildPrepareRequest, checkoutAmount, makeConsentItems } from './rehearsal-smoke.mjs';

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
