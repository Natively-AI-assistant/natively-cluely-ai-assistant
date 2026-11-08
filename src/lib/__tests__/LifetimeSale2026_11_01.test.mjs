// src/lib/__tests__/LifetimeSale2026_11_01.test.mjs
//
// Pro lifetime: $60 against a struck $79, named for the season (Evin,
// 2026-11-01). Halloween until 20 Nov, Black Friday until 5 Dec, Christmas
// through December, New Year through January, then no named sale (and no
// struck price).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFETIME_LIST, LIFETIME_PCT_OFF, LIFETIME_SALE, lifetimeSaleLabel, lifetimeSaleOn,
  YEARLY_LIST, YEARLY_PCT_OFF, YEARLY_SALE, yearlySaleLabel,
} from '../lifetimeSale.mjs';

test('the sale windows turn over at local midnight on 20 Nov, 5 Dec, 1 Jan and 1 Feb', () => {
  assert.equal(lifetimeSaleOn(new Date(2026, 10, 1)), 'halloween');
  assert.equal(lifetimeSaleOn(new Date(2026, 10, 19, 23, 59)), 'halloween');
  assert.equal(lifetimeSaleOn(new Date(2026, 10, 20)), 'blackfriday');
  assert.equal(lifetimeSaleOn(new Date(2026, 11, 4, 23, 59)), 'blackfriday');
  assert.equal(lifetimeSaleOn(new Date(2026, 11, 5)), 'christmas');
  assert.equal(lifetimeSaleOn(new Date(2026, 11, 31, 23, 59)), 'christmas');
  assert.equal(lifetimeSaleOn(new Date(2027, 0, 1)), 'newyear');
  assert.equal(lifetimeSaleOn(new Date(2027, 0, 31, 23, 59)), 'newyear');
  assert.equal(lifetimeSaleOn(new Date(2027, 1, 1)), null);
});

test('the prices and the quoted discount are the real ones', () => {
  assert.equal(LIFETIME_LIST, 79);
  assert.equal(LIFETIME_SALE, 60);
  assert.equal(LIFETIME_PCT_OFF, 24);
  assert.equal(lifetimeSaleLabel(new Date(2026, 10, 1)), 'Halloween −24%');
  assert.equal(lifetimeSaleLabel(new Date(2026, 10, 25)), 'Black Friday −24%');
  assert.equal(lifetimeSaleLabel(new Date(2026, 11, 10)), 'Christmas −24%');
  assert.equal(lifetimeSaleLabel(new Date(2027, 0, 2)), 'New Year −24%');
  assert.equal(lifetimeSaleLabel(new Date(2027, 1, 2)), null);
});

// Pro yearly (Evin, 2026-11-06): $30 against a struck $39, same seasons.
// Dodo charges 24% off $39 = $29.64; the card rounds up to $30 and quotes
// Dodo's 24%, not the 23% the rounded figure would give.
test('yearly: $30 against a struck $39, Dodo\'s 24%, on the lifetime calendar', () => {
  assert.equal(YEARLY_LIST, 39);
  assert.equal(YEARLY_SALE, 30);
  assert.equal(YEARLY_PCT_OFF, 24);
  // Never shows less than Dodo charges.
  assert.ok(YEARLY_SALE >= YEARLY_LIST * (1 - YEARLY_PCT_OFF / 100));
  assert.equal(yearlySaleLabel(new Date(2026, 10, 6)), 'Halloween −24%');
  assert.equal(yearlySaleLabel(new Date(2026, 10, 20)), 'Black Friday −24%');
  assert.equal(yearlySaleLabel(new Date(2026, 11, 25)), 'Christmas −24%');
  assert.equal(yearlySaleLabel(new Date(2027, 0, 31, 23, 59)), 'New Year −24%');
  assert.equal(yearlySaleLabel(new Date(2027, 1, 1)), null);
});
