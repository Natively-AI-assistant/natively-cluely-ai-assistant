// F-303 regression test (audit/autopilot-2026-08-18).
//
// The desktop and phone-mirror chat paths allocate stream ids from ONE shared
// counter in the main process, and this guard was strictly newest-numeric-wins.
// A phone chat started while a desktop answer streamed therefore adopted the
// desktop bubble, appended phone text into it, dropped every remaining desktop
// token as "stale" (truncating the answer on screen while main kept streaming),
// and finalized the mixed row with its own finalText-less done — after which
// the desktop's own done was honored too, double-finalizing.
//
// Both the main-process comment ("cross-surface false supersession can't
// happen") and the renderer comment ("a phone-mirror or stale desktop stream
// can't bleed into the active bubble") asserted the opposite of the behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveChatStreamToken, resolveChatStreamDone } from '../chatStreamGuard.mjs';

test('a phone stream cannot take over a live desktop bubble', () => {
  const active = resolveChatStreamToken(null, 41, null, undefined);
  assert.equal(active.activeId, 41);
  assert.equal(active.activeSource, 'desktop');

  const phone = resolveChatStreamToken(active.activeId, 42, active.activeSource, 'phone');
  assert.equal(phone.accept, false, 'a higher-numbered PHONE id must not supersede a live desktop stream');
  assert.equal(phone.activeId, 41);
});

test('the desktop stream keeps rendering after a phone stream starts', () => {
  const next = resolveChatStreamToken(41, 41, 'desktop', undefined);
  assert.equal(next.accept, true, 'remaining desktop tokens must still render, or the answer truncates on screen');
});

test('a phone done cannot finalize the desktop row, but the desktop done can', () => {
  const phoneDone = resolveChatStreamDone(41, 42, 'desktop', 'phone');
  assert.equal(phoneDone.honor, false);
  assert.equal(phoneDone.activeId, 41, 'the desktop stream must remain adopted');

  const deskDone = resolveChatStreamDone(41, 41, 'desktop', undefined);
  assert.equal(deskDone.honor, true);
  assert.equal(deskDone.activeId, null);
});

test('same-surface supersession and id-less back-compat are preserved', () => {
  const newer = resolveChatStreamToken(41, 43, 'desktop', undefined);
  assert.equal(newer.accept, true);
  assert.equal(newer.activeId, 43);

  const older = resolveChatStreamToken(43, 41, 'desktop', undefined);
  assert.equal(older.accept, false, 'a stale same-surface stream must still be dropped');

  const legacy = resolveChatStreamToken(41, undefined, 'desktop', undefined);
  assert.equal(legacy.accept, true);
  assert.equal(legacy.activeId, 41);

  const legacyDone = resolveChatStreamDone(41, undefined, 'desktop', undefined);
  assert.equal(legacyDone.honor, true);
});
