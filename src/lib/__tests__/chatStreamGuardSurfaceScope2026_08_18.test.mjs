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

// ── CR-01 (code-review HIGH, 2026-08-21) ─────────────────────────────────────
// F-303 was reasoned about in ONE direction: "a phone stream must not steal an
// active desktop answer". The inverse hits the same branch — the user types on
// the desktop while a phone-mirror answer streams — and NativelyInterface
// returns on !honor BEFORE setIsProcessing(false), so the spinner never stops.
test('a cross-surface done for the LOCAL surface releases the local spinner', () => {
  // Phone answer streaming (adopted id 6); the user types here, stream id 7.
  // A desktop done is untagged on the wire and normalizes to 'desktop'.
  const d = resolveChatStreamDone(6, 7, 'phone', undefined);
  assert.equal(d.honor, false, 'the phone stream still owns its row — do not finalize it');
  assert.equal(d.release, true, 'but the request THIS surface started must release the spinner');
  assert.equal(d.activeId, 6, 'the phone stream stays active');
});

test('a cross-surface done from the REMOTE surface does not release the local spinner', () => {
  // Desktop answer streaming; a phone done arrives. Releasing here would stop a
  // spinner that belongs to a still-running desktop answer.
  const d = resolveChatStreamDone(6, 7, 'desktop', 'phone');
  assert.equal(d.honor, false);
  assert.notEqual(d.release, true, 'a remote done must never stop the local spinner');
});

test('a STALE same-surface done does not release the spinner', () => {
  // id 5 is older than the active 6 on the same surface: a newer desktop stream
  // is live and will deliver its own done. Releasing here would clear a spinner
  // that is still legitimately running.
  const d = resolveChatStreamDone(6, 5, 'desktop', 'desktop');
  assert.equal(d.honor, false);
  assert.notEqual(d.release, true, 'a superseded same-surface done must not stop the live spinner');
});
