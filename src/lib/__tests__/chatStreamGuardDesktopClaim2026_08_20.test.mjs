// R-17 regression test — F-303's surface scoping had no answer for the
// reverse direction.
//
// F-303 stopped a phone stream from taking over a live DESKTOP bubble. But the
// scoping only protects a stream that has ALREADY adopted the bubble. When the
// user types on the desktop while a phone turn is still streaming, the desktop
// stream has adopted nothing — its id does not exist until main allocates it —
// so the phone stream still owns the guard. Every desktop token was then
// rejected as cross-surface and the desktop `done` went unhonored, so the
// bubble never finalized: no text at all and a spinner that only Escape
// cleared. R-02 fixed the same shape for a phone ERROR; a phone turn that is
// merely still streaming (or that main abandoned at
// `if (phoneSuperseded) return;`, which emits neither done nor error) was left.
//
// Clearing the refs on desktop send cannot fix it on its own: the phone is
// mid-stream and re-adopts the empty slot long before the desktop's first token
// arrives. The renderer therefore CLAIMS the surface (source set, id still
// null) and the guard honours that claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveChatStreamToken, resolveChatStreamDone } from '../chatStreamGuard.mjs';

// The state NativelyInterface.tsx enters at both streamGeminiChat call sites.
const DESKTOP_CLAIM = { activeId: null, activeSource: 'desktop' };

test('a claimed desktop surface is not stolen by an in-flight phone stream', () => {
  const t = resolveChatStreamToken(DESKTOP_CLAIM.activeId, 7, DESKTOP_CLAIM.activeSource, 'phone');
  assert.equal(t.accept, false, 'a phone token must not adopt the bubble the desktop turn just claimed');
  assert.equal(t.activeId, null, 'the claim must survive — adopting here is what dropped the desktop answer');
  assert.equal(t.activeSource, 'desktop');
});

test('a phone done cannot finalize a claimed desktop bubble', () => {
  const d = resolveChatStreamDone(DESKTOP_CLAIM.activeId, 7, DESKTOP_CLAIM.activeSource, 'phone');
  assert.equal(d.honor, false, "honoring it would finalize the desktop turn's empty placeholder");
  assert.equal(d.activeSource, 'desktop', 'the claim must still be held');
});

test('the desktop stream the claim was made for is accepted and finalizes', () => {
  const first = resolveChatStreamToken(DESKTOP_CLAIM.activeId, 8, DESKTOP_CLAIM.activeSource, undefined);
  assert.equal(first.accept, true);
  assert.equal(first.activeId, 8, 'the desktop stream must adopt the bubble it claimed');

  const more = resolveChatStreamToken(first.activeId, 8, first.activeSource, undefined);
  assert.equal(more.accept, true, 'the rest of the desktop answer must render');

  const done = resolveChatStreamDone(first.activeId, 8, first.activeSource, undefined);
  assert.equal(done.honor, true, 'the desktop done must finalize, or the spinner never stops');
  assert.equal(done.activeId, null);
  assert.equal(done.activeSource, null, 'and the claim must be released for the next turn');
});

test('an unclaimed guard still lets a phone-only turn through', () => {
  const t = resolveChatStreamToken(null, 3, null, 'phone');
  assert.equal(t.accept, true, 'with nothing claimed the phone surface may adopt as before');
  assert.equal(t.activeSource, 'phone');

  const d = resolveChatStreamDone(t.activeId, 3, t.activeSource, 'phone');
  assert.equal(d.honor, true);
});

test('F-303 still holds: an adopted desktop stream is not superseded by phone', () => {
  const phone = resolveChatStreamToken(41, 42, 'desktop', 'phone');
  assert.equal(phone.accept, false, 'the original F-303 protection must be unchanged');
  assert.equal(phone.activeId, 41);
});

test('id-less tokens keep their backward-compatible behaviour under a claim', () => {
  const t = resolveChatStreamToken(DESKTOP_CLAIM.activeId, undefined, DESKTOP_CLAIM.activeSource, 'phone');
  assert.equal(t.accept, true, 'an older main emits no streamId; that path must behave exactly as before');
});
