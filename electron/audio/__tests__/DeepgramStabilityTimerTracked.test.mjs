// Regression test for the "Deepgram orphan stability timeout clobbers
// reconnectAttempts in a future session" bug.
//
// Symptom: the post-connect setTimeout that resets reconnectAttempts
// after 5s of stable connection used to be UNTRACKED — its handle was
// thrown away. clearTimers() (called from stop() and the Close handler)
// could not cancel it. If stop()/restart fired within the 5s window,
// the orphan timer would fire inside the next session's reconnect
// storm and reset reconnectAttempts to 0 — defeating the exponential
// backoff cap and causing a tight 250ms reconnect loop until the
// server eventually returned a fatal close.
//
// Fix: store the handle on this.stabilityTimer, clear it in
// clearTimers(), and re-cancel it at the top of the on('open') handler
// so a reconnect-during-stability-window doesn't accumulate timers.
//
// Strategy: structural assertion against DeepgramStreamingSTT.ts source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dgPath = path.resolve(__dirname, '../../../electron/audio/DeepgramStreamingSTT.ts');
const dgSource = readFileSync(dgPath, 'utf8');

test('DeepgramStreamingSTT declares a stabilityTimer field', () => {
  assert.ok(
    /private\s+stabilityTimer\s*:\s*NodeJS\.Timeout\s*\|\s*null\s*=\s*null/.test(dgSource),
    'BUG: DeepgramStreamingSTT must declare `private stabilityTimer: NodeJS.Timeout | null = null;` to track the 5s post-connect reset timer.',
  );
});

test('The 5s post-connect reset timeout is stored on this.stabilityTimer', () => {
  // Pin the assignment shape so the next refactor can't silently revert to an untracked setTimeout.
  assert.ok(
    /this\.stabilityTimer\s*=\s*setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*this\.isOpen\s*\)\s*this\.reconnectAttempts\s*=\s*0[\s\S]*?\}\s*,\s*5000\s*\)/.test(dgSource),
    'BUG: the 5000ms post-connect reset setTimeout must be assigned to this.stabilityTimer. Otherwise stop()/clearTimers() cannot cancel it and an orphan can clobber reconnectAttempts in the next session.',
  );
});

test('clearTimers() clears stabilityTimer', () => {
  const m = /private\s+clearTimers\s*\(\s*\)\s*:\s*void\s*\{([\s\S]*?)\}\s*\n\}/.exec(dgSource);
  assert.ok(m, 'could not locate clearTimers() body');
  const body = m[1];
  assert.ok(
    /if\s*\(\s*this\.stabilityTimer\s*\)\s*\{[\s\S]*?clearTimeout\s*\(\s*this\.stabilityTimer\s*\)[\s\S]*?this\.stabilityTimer\s*=\s*null/.test(body),
    'BUG: clearTimers() must clear and null this.stabilityTimer alongside reconnectTimer and keepAliveInterval.',
  );
});

test('Stability timer is also cancelled at the top of on("open") to avoid accumulation', () => {
  // If the WS reconnects during the stability window of a prior session,
  // the new on('open') would arm a fresh stabilityTimer. The old one must
  // be cleared first so we don't accumulate handles whose bodies all
  // race to reset reconnectAttempts.
  assert.ok(
    /if\s*\(\s*this\.stabilityTimer\s*\)\s*clearTimeout\s*\(\s*this\.stabilityTimer\s*\)\s*;[\s\S]*?this\.stabilityTimer\s*=\s*setTimeout/.test(dgSource),
    'BUG: the on("open") handler must clearTimeout(this.stabilityTimer) BEFORE assigning a new one, so a fast reconnect during the 5s window does not leak timers.',
  );
});
