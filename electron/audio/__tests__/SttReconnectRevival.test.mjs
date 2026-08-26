// Regression test for the "STT stuck reconnecting after the app was hidden a
// while, and never recovers without ending the meeting" bug.
//
// Mechanism (Soniox, same pattern in Deepgram/ElevenLabs): after
// RECONNECT_MAX_ATTEMPTS failed reconnects the provider latches
// shouldReconnect=false PERMANENTLY. During a silent/hidden stretch the backoff
// ladder quietly burns all attempts; when the user returns and speaks, write()
// checks shouldReconnect (false) and never reconnects — dead until a manual
// stop/start. The UI sits on "STT reconnecting" forever.
//
// Fix: shouldReviveExhaustedReconnect() lets a write() carrying real audio grant
// ONE fresh reconnect budget to an EXHAUSTED-but-still-ACTIVE session, after a
// cooldown so a genuinely-dead endpoint isn't re-stormed every chunk. This test
// drives that decision through the exact state transitions of the reported
// scenario — no WebSocket, network, or Electron needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldReviveExhaustedReconnect,
  DEFAULT_REVIVE_COOLDOWN_MS,
} from '../sttReconnectPolicy.mjs';

const base = {
  isActive: true,
  shouldReconnect: false,
  isConnecting: false,
  hasSocket: false,
  exhaustedAt: 1_000_000,
  now: 1_000_000 + DEFAULT_REVIVE_COOLDOWN_MS,
  cooldownMs: DEFAULT_REVIVE_COOLDOWN_MS,
};

test('the reported scenario: hidden → exhausted → user returns and speaks after cooldown → revive', () => {
  assert.equal(shouldReviveExhaustedReconnect(base), true);
});

test('does NOT revive before the cooldown elapses (avoids re-storming a dead endpoint)', () => {
  assert.equal(
    shouldReviveExhaustedReconnect({ ...base, now: base.exhaustedAt + DEFAULT_REVIVE_COOLDOWN_MS - 1 }),
    false,
  );
  assert.equal(
    shouldReviveExhaustedReconnect({ ...base, now: base.exhaustedAt + 1 }),
    false,
  );
});

test('exactly at the cooldown boundary revives (>= is inclusive)', () => {
  assert.equal(
    shouldReviveExhaustedReconnect({ ...base, now: base.exhaustedAt + DEFAULT_REVIVE_COOLDOWN_MS }),
    true,
  );
});

test('NEVER revives a user-stopped session (isActive=false), even long after', () => {
  // stop() sets isActive=false AND shouldReconnect=false; resurrecting here would
  // reopen a socket the user deliberately closed.
  assert.equal(
    shouldReviveExhaustedReconnect({ ...base, isActive: false, now: base.exhaustedAt + 10 * DEFAULT_REVIVE_COOLDOWN_MS }),
    false,
  );
});

test('does not revive when reconnect is still healthy (normal lazy-reconnect owns that path)', () => {
  assert.equal(shouldReviveExhaustedReconnect({ ...base, shouldReconnect: true }), false);
});

test('does not stack a revival on an in-flight connect or a live socket', () => {
  assert.equal(shouldReviveExhaustedReconnect({ ...base, isConnecting: true }), false);
  assert.equal(shouldReviveExhaustedReconnect({ ...base, hasSocket: true }), false);
});

test('a plain stop()-style latch (no exhaustion timestamp) stays dead', () => {
  // shouldReconnect=false with exhaustedAt=null is a normal stop(), not an
  // exhaustion — must not be revived by incoming audio.
  assert.equal(shouldReviveExhaustedReconnect({ ...base, exhaustedAt: null }), false);
  assert.equal(shouldReviveExhaustedReconnect({ ...base, exhaustedAt: undefined }), false);
});

test('a second exhaustion needs its own fresh cooldown (no rapid re-storm)', () => {
  // After a revival fails again, exhaustedAt is updated to the new give-up time;
  // audio arriving within the new cooldown must not revive again.
  const secondExhaustion = 2_000_000;
  assert.equal(
    shouldReviveExhaustedReconnect({ ...base, exhaustedAt: secondExhaustion, now: secondExhaustion + 500 }),
    false,
  );
  assert.equal(
    shouldReviveExhaustedReconnect({ ...base, exhaustedAt: secondExhaustion, now: secondExhaustion + DEFAULT_REVIVE_COOLDOWN_MS }),
    true,
  );
});
