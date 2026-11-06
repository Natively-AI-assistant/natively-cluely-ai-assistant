// A question typed while the previous answer still streams (2026-11-06): it is
// sent (it used to be silently dropped), and what the replaced stream still
// sends never reaches the new question's card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReplacedChatStream, resolveChatStreamToken } from '../chatStreamGuard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const overlay = fs.readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');

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
  assert.ok(body.indexOf('replacedChatStreamFloorRef.current = lastDesktopChatStreamIdRef.current;') < release);
  assert.match(body, /const mySubmit = \+\+manualSubmitSeqRef\.current;/);
  assert.match(body, /\} catch \(err\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*if \(mySubmit !== manualSubmitSeqRef\.current\) return;/);
  assert.match(body, /if \(mySubmit === manualSubmitSeqRef\.current\) manualSubmitInFlightRef\.current = false;/);
});

test('wiring: token, done and error of a replaced stream are dropped before anything else', () => {
  assert.match(overlay, /if \(activeDirectAssistRef\.current\) return;\s*if \(isReplacedChatStream\(replacedChatStreamFloorRef\.current, meta\?\.streamId, \(meta as any\)\?\.source\)\) return;\s*noteDesktopChatStreamId/);
  assert.match(overlay, /if \(isReplacedChatStream\(replacedChatStreamFloorRef\.current, data\?\.streamId, \(data as any\)\?\.source\)\) return;\s*noteDesktopChatStreamId/);
  assert.match(overlay, /if \(isReplacedChatStream\(replacedChatStreamFloorRef\.current, meta\?\.streamId, meta\?\.source\)\) return;\s*if \(typeof meta\?\.streamId === 'number'/);
});
