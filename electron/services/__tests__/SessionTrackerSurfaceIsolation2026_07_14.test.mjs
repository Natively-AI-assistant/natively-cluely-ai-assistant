// Surface isolation (real-app source-switch repair, 2026-07-14, Phase 9).
//
// ROOT CAUSE this pins: SessionTracker is ONE shared instance across every
// conversational surface (manual chat, What-to-Answer live suggestions,
// screenshot-triggered code-hint/brainstorm, phone-mirror). A WTA answer
// written via addAssistantMessage(text, wd, 'what_to_answer') landed in the
// SAME lastAssistantMessage/assistantResponseHistory that manual-chat's
// follow-up-referent code read with NO surface filter — so an anaphoric
// manual-chat question ("what processor controls it?") could resolve against
// whatever the WTA path happened to answer moments earlier on a live meeting
// transcript, not the user's own manual-chat conversation.
//
// THE FIX: addAssistantMessage/getLastAssistantMessage/getAssistantResponseHistory
// gained an OPTIONAL `surface` parameter. Passing no surface preserves the
// exact prior shared behavior (legitimate cross-surface continuity — e.g. live
// transcript refinement-intent detection reading "did the assistant just say
// something on ANY surface" — is untouched). Passing a surface scopes strictly
// to that surface's own history.
//
// Requires: npm run build:electron.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const { SessionTracker } = await import(pathToFileURL(path.join(distDir, 'SessionTracker.js')).href);
const intelligenceEngineSrc = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

function freshTracker() {
  return new SessionTracker();
}

describe('SessionTracker surface isolation (Phase 9)', () => {
  test('no-surface calls (legacy callers) behave EXACTLY as before: shared lastAssistantMessage sees every write', () => {
    const s = freshTracker();
    s.addAssistantMessage('This is the first assistant answer, written with no surface tag at all.');
    s.addAssistantMessage('This is the second assistant answer, also with no surface tag.');
    assert.equal(s.getLastAssistantMessage(), 'This is the second assistant answer, also with no surface tag.');
    assert.equal(s.getAssistantResponseHistory().length, 2);
  });

  test('a WTA-tagged write does NOT appear under a manual_chat-scoped read', () => {
    const s = freshTracker();
    s.addAssistantMessage('This is a live What-to-Answer suggestion about the meeting topic.', undefined, 'what_to_answer');
    assert.equal(s.getLastAssistantMessage('manual_chat'), null,
      'a WTA answer must never surface as the manual-chat surface\'s own last message');
    assert.equal(s.getLastAssistantMessage('what_to_answer'), 'This is a live What-to-Answer suggestion about the meeting topic.');
  });

  test('the shared (no-surface) read STILL sees a WTA write — cross-surface continuity for legitimate consumers is preserved', () => {
    const s = freshTracker();
    s.addAssistantMessage('This is a live What-to-Answer suggestion about the meeting topic.', undefined, 'what_to_answer');
    assert.equal(s.getLastAssistantMessage(), 'This is a live What-to-Answer suggestion about the meeting topic.',
      'the shared getter (no surface arg) must be untouched — refinement-intent detection on the live transcript still needs it');
  });

  test('manual-chat and WTA turns interleave without cross-contaminating each other\'s surface-scoped view', () => {
    const s = freshTracker();
    s.addAssistantMessage('Manual chat answer number one about the users uploaded thesis document.', undefined, 'manual_chat');
    s.addAssistantMessage('A WTA live suggestion about something the interviewer just asked verbally.', undefined, 'what_to_answer');
    s.addAssistantMessage('Manual chat answer number two continuing the same thesis conversation.', undefined, 'manual_chat');

    assert.equal(s.getLastAssistantMessage('manual_chat'), 'Manual chat answer number two continuing the same thesis conversation.');
    assert.equal(s.getLastAssistantMessage('what_to_answer'), 'A WTA live suggestion about something the interviewer just asked verbally.');
    // The shared view sees whichever surface wrote MOST RECENTLY.
    assert.equal(s.getLastAssistantMessage(), 'Manual chat answer number two continuing the same thesis conversation.');
  });

  test('a surface with no turns yet returns null, never a different surface\'s answer', () => {
    const s = freshTracker();
    s.addAssistantMessage('Only a phone-mirror answer has been written so far in this session.', undefined, 'phone_mirror');
    assert.equal(s.getLastAssistantMessage('manual_chat'), null);
    assert.equal(s.getLastAssistantMessage('what_to_answer'), null);
    assert.equal(s.getLastAssistantMessage('phone_mirror'), 'Only a phone-mirror answer has been written so far in this session.');
  });

  test('getAssistantResponseHistory(surface) filters to exactly that surface\'s turns, in order', () => {
    const s = freshTracker();
    s.addAssistantMessage('Manual chat turn one is a reasonably long sentence for the length filter.', undefined, 'manual_chat');
    s.addAssistantMessage('WTA turn one is also a reasonably long sentence for the length filter.', undefined, 'what_to_answer');
    s.addAssistantMessage('Manual chat turn two continues the manual conversation with more detail.', undefined, 'manual_chat');
    s.addAssistantMessage('Screenshot code hint turn is triggered from an uploaded screenshot image.', undefined, 'screenshot');

    const manualHistory = s.getAssistantResponseHistory('manual_chat');
    assert.equal(manualHistory.length, 2);
    assert.ok(manualHistory.every((r) => r.surface === 'manual_chat'));
    assert.equal(manualHistory[0].text, 'Manual chat turn one is a reasonably long sentence for the length filter.');
    assert.equal(manualHistory[1].text, 'Manual chat turn two continues the manual conversation with more detail.');

    const wtaHistory = s.getAssistantResponseHistory('what_to_answer');
    assert.equal(wtaHistory.length, 1);

    // No-surface call is unfiltered (legacy behavior) — sees all 4 turns.
    assert.equal(s.getAssistantResponseHistory().length, 4);
  });

  test('every AssistantResponse entry from a surface-tagged write carries that surface; legacy (no-tag) entries carry none', () => {
    const s = freshTracker();
    s.addAssistantMessage('An untagged legacy write behaving exactly as it always has before this fix.');
    s.addAssistantMessage('A tagged manual-chat write using the new optional surface parameter.', undefined, 'manual_chat');
    const all = s.getAssistantResponseHistory();
    assert.equal(all[0].surface, undefined);
    assert.equal(all[1].surface, 'manual_chat');
  });

  // ── Wiring regression guard (code-review round 2) ──────────────────────────
  //
  // The 7 tests above pin SessionTracker's own logic, but a real defect
  // shipped in the FIRST version of this fix: runManualAnswer (the manual-chat
  // fallback path, IPC-invoked via submit-manual-question) was mistagged
  // 'what_to_answer' instead of 'manual_chat' — invisible to code review's own
  // unit tests because they never touch IntelligenceEngine.ts's actual call
  // sites. A full IntelligenceEngine integration test is disproportionate
  // (heavy LLM/session setup); a source-guard test — the same pattern already
  // used elsewhere in this repo (e.g. OkfPhase0FalseRefusalGuard.test.mjs) —
  // pins the actual tag at the actual call site instead.
  test('IntelligenceEngine.runManualAnswer tags its addAssistantMessage call manual_chat, not what_to_answer', () => {
    const fnStart = intelligenceEngineSrc.indexOf('async runManualAnswer(');
    assert.ok(fnStart >= 0, 'expected to find runManualAnswer in IntelligenceEngine.ts');
    // Bound the search to this function's body (next method/closing brace at
    // the same indent level is `runCodeHint`, the next MODE handler).
    const fnEnd = intelligenceEngineSrc.indexOf('async runCodeHint(', fnStart);
    assert.ok(fnEnd > fnStart, 'expected to find the next method (runCodeHint) bounding runManualAnswer');
    const body = intelligenceEngineSrc.slice(fnStart, fnEnd);
    assert.match(body, /addAssistantMessage\([^)]*'manual_chat'\)/,
      'runManualAnswer must tag its addAssistantMessage write manual_chat (it is the manual-chat fallback path, confirmed by its own pushUsage({source: \'manual_chat\'}) call)');
    assert.doesNotMatch(body, /addAssistantMessage\([^)]*'what_to_answer'\)/,
      'runManualAnswer must NOT be tagged what_to_answer — that mislabels a manual-chat answer as a WTA suggestion');
  });
});
