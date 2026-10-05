// src/lib/__tests__/partnerLinks.test.mjs
//
// Covers src/lib/partnerLinks.ts — the partner/referral URLs and the
// sponsorship contact. These links are opened through open-external (https
// only), so the tests parse each one as a URL and check scheme, host and the
// attribution parameters rather than comparing whole strings.
//
// Run: node --experimental-strip-types --test src/lib/__tests__/partnerLinks.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLUXION_REFERRAL_URL,
  AGENTROUTER_REFERRAL_URL,
  SPONSORSHIP_EMAIL,
  SPONSORSHIP_GMAIL_COMPOSE_URL,
} from '../partnerLinks.ts';

describe('FLUXION_REFERRAL_URL', () => {
  const u = new URL(FLUXION_REFERRAL_URL);

  test('is an https link to the Fluxion registration page', () => {
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'fluxionai.world');
    assert.equal(u.pathname, '/register');
  });

  test("carries Natively's attribution parameters", () => {
    assert.deepEqual(Object.fromEntries(u.searchParams), {
      source: 'github',
      campaign: 'natively',
      promo: 'NATIVELY',
    });
  });
});

describe('AGENTROUTER_REFERRAL_URL', () => {
  const u = new URL(AGENTROUTER_REFERRAL_URL);

  test('is an https link to the AgentRouter registration page', () => {
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'agentrouter.org');
    assert.equal(u.pathname, '/register');
  });

  test("uses Natively's own referral code, not the docs-navigation one", () => {
    assert.deepEqual(Object.fromEntries(u.searchParams), { aff: '9ZCx' });
    assert.notEqual(u.searchParams.get('aff'), 'IPN5');
  });
});

describe('SPONSORSHIP_EMAIL', () => {
  test('is a single plain email address', () => {
    assert.equal(SPONSORSHIP_EMAIL, 'natively.contact@gmail.com');
    assert.match(SPONSORSHIP_EMAIL, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});

describe('SPONSORSHIP_GMAIL_COMPOSE_URL', () => {
  const u = new URL(SPONSORSHIP_GMAIL_COMPOSE_URL);

  test('is an https Gmail link (open-external only allows https)', () => {
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'mail.google.com');
    assert.equal(u.pathname, '/mail/');
  });

  test('opens a full-screen compose window addressed to the sponsorship inbox', () => {
    assert.deepEqual(Object.fromEntries(u.searchParams), {
      view: 'cm',
      fs: '1',
      to: SPONSORSHIP_EMAIL,
      su: 'Sponsorship / advertising on Natively',
    });
  });

  test('has exactly one of each parameter', () => {
    for (const key of ['view', 'fs', 'to', 'su']) {
      assert.equal(u.searchParams.getAll(key).length, 1, key);
    }
  });

  test('encodes spaces as %20, never as +', () => {
    assert.equal(SPONSORSHIP_GMAIL_COMPOSE_URL.includes('+'), false);
    assert.ok(SPONSORSHIP_GMAIL_COMPOSE_URL.includes('su=Sponsorship%20%2F%20advertising%20on%20Natively'));
  });

  test('contains no raw whitespace and percent-encodes the @ and /', () => {
    assert.doesNotMatch(SPONSORSHIP_GMAIL_COMPOSE_URL, /\s/);
    assert.ok(SPONSORSHIP_GMAIL_COMPOSE_URL.includes('to=natively.contact%40gmail.com'));
  });
});

describe('partner links — shared invariants', () => {
  test('every outbound link is https with no credentials or fragment', () => {
    for (const link of [FLUXION_REFERRAL_URL, AGENTROUTER_REFERRAL_URL, SPONSORSHIP_GMAIL_COMPOSE_URL]) {
      const u = new URL(link);
      assert.equal(u.protocol, 'https:', link);
      assert.equal(u.username, '', link);
      assert.equal(u.password, '', link);
      assert.equal(u.hash, '', link);
      assert.equal(u.port, '', link);
    }
  });
});
