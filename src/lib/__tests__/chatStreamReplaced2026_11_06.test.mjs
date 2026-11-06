// A question typed while the previous answer still streams (2026-11-06): it is
// sent (it used to be silently dropped), and what the replaced stream still
// sends never reaches the new question's card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReplacedChatStream, isStaleDesktopChatEvent, resolveChatStreamToken } from '../chatStreamGuard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const overlay = fs.readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

test('a desktop stream at or below the floor is replaced; newer ones are not', () => {
  assert.equal(isReplacedChatStream(7, 7, undefined), true);
  assert.equal(isReplacedChatStream(7, 6, 'desktop'), true);
  assert.equal(isReplacedChatStream(7, 8, 'desktop'), false);
});

test('no floor yet, or an id-less event: never dropped (back-compat)', () => {
  assert.equal(isReplacedChatStream(null, 3, undefined), false);
  assert.equal(isReplacedChatStream(7, undefined, undefined), false);
});

test('the phone\'s streams are never "replaced" by a desktop question', () => {
  assert.equal(isReplacedChatStream(7, 5, 'phone'), false);
  assert.equal(isReplacedChatStream(7, 5, 'phone-mirror'), false);
});

test('why the floor is needed: after the claim, the old stream\'s token would be adopted', () => {
  // The new question clears the adopted id and claims the desktop surface; a
  // late token of the old stream (id 7) then wins the empty slot.
  const d = resolveChatStreamToken(null, 7, 'desktop', undefined);
  assert.equal(d.accept, true);
  assert.equal(isReplacedChatStream(7, 7, undefined), true, 'so the floor drops it first');
});

test('wiring: the send releases the in-flight flag before it waits for the answer', () => {
  const body = overlay.split('const handleManualSubmit = async () => {')[1].split('const handleCustomButton = async')[0];
  const release = body.indexOf('manualSubmitInFlightRef.current = false;\n      await window.electronAPI.streamGeminiChat(');
  assert.ok(release > 0, 'released just before the round-trip');
  assert.ok(body.indexOf('awaitingChatStreamStartRef.current = true;') < release, 'armed before the send');
  assert.match(body, /const mySubmit = \+\+manualSubmitSeqRef\.current;/);
  assert.match(body, /\} catch \(err\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*if \(mySubmit !== manualSubmitSeqRef\.current\) return;/);
  assert.match(body, /if \(mySubmit === manualSubmitSeqRef\.current\) manualSubmitInFlightRef\.current = false;/);
});

test('wiring: token, done and error of a replaced stream are dropped before anything else', () => {
  assert.match(overlay, /if \(activeDirectAssistRef\.current\) return;\s*if \(staleDesktopChatEvent\(meta\?\.streamId, \(meta as any\)\?\.source\)\) return;\s*const decision = resolveChatStreamToken\(/);
  assert.match(overlay, /if \(staleDesktopChatEvent\(data\?\.streamId, \(data as any\)\?\.source\)\) return;/);
  assert.match(overlay, /if \(staleDesktopChatEvent\(meta\?\.streamId, meta\?\.source\)\) return;\s*if \(typeof meta\?\.streamId === 'number'/);
});

// The review's case (2026-11-06): Q1 still "Thinking" (no token, so no id
// the overlay had seen) when Q2 is sent. Q1's first token used to claim Q2's
// card: its id was above every id seen, and Q2's card had no stream yet.
test('an older question with no token yet cannot claim the new card: dropped until the new stream starts', () => {
  const q1 = 8;
  const q2 = 9;
  const sent = { awaitingStart: true, floor: 7 };
  assert.equal(isStaleDesktopChatEvent(sent, q1, undefined), true, 'Q1\'s first token, before Q2 started');
  const started = { awaitingStart: false, floor: q2 - 1 };
  assert.equal(isStaleDesktopChatEvent(started, q1, undefined), true, 'and after');
  assert.equal(isStaleDesktopChatEvent(started, q2, undefined), false, 'Q2 itself is kept');
  assert.equal(isStaleDesktopChatEvent(sent, 3, 'phone'), false, 'a phone stream is never dropped');
  assert.equal(isStaleDesktopChatEvent({ awaitingStart: false, floor: null }, 5, undefined), false, 'nothing sent yet');
});

test('wiring: main names the stream before anything else of it; the overlay floors on it; every typed send arms the wait', () => {
  assert.match(ipc, /_chatStreamsBySender\.set\(senderId, \{ streamId: myStreamId, controller: myController \}\);\s*(?:\/\/[^\n]*\n\s*)*try \{ event\.sender\.send\('gemini-stream-started', \{ streamId: myStreamId \}\); \}/);
  const handler = ipc.split('const _geminiChatStreamHandler = async (')[1].split('const myStreamId = ++_chatStreamId;')[0];
  assert.doesNotMatch(handler, /event\.sender\.send\(/, 'nothing reaches the overlay before the id exists');
  assert.match(overlay, /onGeminiStreamStarted\(\(data\) => \{\s*if \(typeof data\?\.streamId !== 'number'\) return;\s*replacedChatStreamFloorRef\.current = data\.streamId - 1;\s*awaitingChatStreamStartRef\.current = false;/);
  const sends = overlay.split('await window.electronAPI.streamGeminiChat(').length - 1;
  // Each call has the arm within the 12 lines before it.
  const lines = overlay.split('\n');
  const armed = lines.filter((l, n) => l.includes('await window.electronAPI.streamGeminiChat(')
    && lines.slice(Math.max(0, n - 12), n).some((x) => x.includes('awaitingChatStreamStartRef.current = true;'))).length;
  assert.equal(armed, sends, 'every streamGeminiChat call is armed');
});

test('a replaced V3 stream ends quietly: no legacy run, no fallback counted', () => {
  const at = ipc.indexOf('} catch (v3Err: any) {');
  const body = ipc.slice(at, at + 1800);
  assert.match(body, /if \(_chatStreamsBySender\.get\(senderId\)\?\.streamId !== myStreamId\) \{[\s\S]{0,200}return null;\s*\}/);
  assert.ok(body.indexOf('return null;') < body.indexOf('recordV3Fallback'));
});

test('typed text after Enter survives the screenshot wait: the input is cleared before it', () => {
  const body = overlay.split('const handleManualSubmit = async () => {')[1].split('const handleCustomButton = async')[0];
  const clear = body.indexOf("setInputValue('');");
  assert.ok(clear > 0 && clear < body.indexOf('await pendingShotsRef.current.settle()'));
});
