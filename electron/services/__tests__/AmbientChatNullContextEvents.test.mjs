// electron/services/__tests__/AmbientChatNullContextEvents.test.mjs
//
// Ambient AI Chat has no meeting/transcript behind it — ever. Before this
// fix, IntelligenceEngine.runRecap / runFollowUp / runFollowUpQuestions
// returned `null` SILENTLY (no event emitted at all) when called with empty
// context, which left the renderer's streaming placeholder bubble open
// forever (no client-side timeout exists). The fix makes each method emit
// its normal SUCCESS-shaped event carrying a graceful fallback message
// instead of staying silent, so the renderer's existing
// finalizeStreamingByIntent(Messages) listener always resolves the
// placeholder.
//
// Uses the same real-engine-plus-real-SessionTracker pattern as
// IntelligenceEngineFalseNoContentClaim.test.mjs (electron/services/__tests__).
//
// Part 2 of this file is a genuine cross-seam test: it feeds the EXACT
// payload the real compiled engine emits into the REAL
// finalizeStreamingByIntentMessages (src/lib/overlayMessagePersistence.mjs —
// the same function NativelyInterface.tsx's finalizeStreamingByIntent
// callback delegates to for all three of these events, confirmed by
// reading NativelyInterface.tsx's onIntelligenceRefinedAnswer /
// onIntelligenceRecap / onIntelligenceFollowUpQuestionsUpdate handlers) and
// asserts a pre-seeded open streaming placeholder is resolved. This
// validates the actual end-to-end promise ("no forever-spinning bubble"),
// not two disconnected halves.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const enginePath = path.resolve(repoRoot, 'dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(repoRoot, 'dist-electron/electron/SessionTracker.js');
const overlayMessagePersistencePath = path.resolve(repoRoot, 'src/lib/overlayMessagePersistence.mjs');
const require = createRequire(import.meta.url);

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
  };
}

async function makeEmptyEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  // A brand-new SessionTracker with NO transcript and NO prior assistant
  // message — the permanent state of an ambient chat session (no meeting
  // ever started, so no transcript can ever exist).
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  // Truthy stubs so each method reaches its "no context" branch instead of
  // short-circuiting on "LLM not initialized" (a separate, pre-existing
  // guard this fix does not touch).
  engine.recapLLM = { generateStream: async function* () {} };
  engine.followUpQuestionsLLM = { generateStream: async function* () {} };
  return { engine, session };
}

describe('runFollowUp with no prior assistant message (fresh Ambient AI Chat session)', () => {
  test('emits refined_answer with a non-empty fallback message and the requested intent, does not throw', async () => {
    const { engine } = await makeEmptyEngine();
    const events = [];
    engine.on('refined_answer', (text, intent) => events.push({ text, intent }));

    const result = await engine.runFollowUp('make_shorter');

    assert.equal(result, null, 'return value is still null (unchanged) — only the event is new');
    assert.equal(events.length, 1, 'exactly one refined_answer event must fire');
    assert.equal(typeof events[0].text, 'string');
    assert.ok(events[0].text.trim().length > 0, 'fallback message must be non-empty');
    assert.equal(events[0].intent, 'make_shorter', 'intent must be threaded through so the renderer resolves the correct placeholder');
  });

  test('does not leave the engine mode stuck (no setMode side effect to worry about — verified via no throw / no pending promise)', async () => {
    const { engine } = await makeEmptyEngine();
    let threw = false;
    try {
      await engine.runFollowUp('clarify_point');
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
  });
});

describe('runRecap with no transcript (fresh Ambient AI Chat session)', () => {
  test('emits recap with a non-empty fallback message, does not throw', async () => {
    const { engine } = await makeEmptyEngine();
    const events = [];
    engine.on('recap', (text) => events.push(text));

    const result = await engine.runRecap();

    assert.equal(result, null);
    assert.equal(events.length, 1, 'exactly one recap event must fire');
    assert.equal(typeof events[0], 'string');
    assert.ok(events[0].trim().length > 0, 'fallback message must be non-empty');
  });
});

describe('runFollowUpQuestions with no transcript and no manual context (fresh Ambient AI Chat session)', () => {
  test('emits follow_up_questions_update with a non-empty fallback message, does not throw', async () => {
    const { engine } = await makeEmptyEngine();
    const events = [];
    engine.on('follow_up_questions_update', (text) => events.push(text));

    const result = await engine.runFollowUpQuestions();

    assert.equal(result, null);
    assert.equal(events.length, 1, 'exactly one follow_up_questions_update event must fire');
    assert.equal(typeof events[0], 'string');
    assert.ok(events[0].trim().length > 0, 'fallback message must be non-empty');
  });
});

// ── Seam test: real engine payload -> real renderer message-persistence fn ──

describe('cross-seam: engine fallback payload resolves a real open streaming placeholder', () => {
  test('refined_answer payload finalizes the open follow_up placeholder row (no forever-spinning bubble)', async () => {
    const { finalizeStreamingByIntentMessages } = await import(pathToFileURL(overlayMessagePersistencePath).href);
    const { engine } = await makeEmptyEngine();
    let captured = null;
    engine.on('refined_answer', (text, intent) => { captured = { text, intent }; });
    await engine.runFollowUp('make_shorter');
    assert.ok(captured, 'engine must have emitted refined_answer');

    // Mirrors NativelyInterface.tsx's prepareIntelligenceStreamPlaceholder('make_shorter')
    // having mounted an open row before the IPC round-trip resolves.
    const rowsWithOpenPlaceholder = [
      { id: 'u1', role: 'user', text: 'make it shorter' },
      { id: 'ph-1', role: 'system', text: '', intent: captured.intent, isStreaming: true },
    ];
    const resolved = finalizeStreamingByIntentMessages(rowsWithOpenPlaceholder, captured.intent, captured.text);
    const row = resolved.find((m) => m.id === 'ph-1');
    assert.ok(row, 'placeholder row must still exist');
    assert.equal(row.isStreaming, false, 'placeholder must be sealed, not left spinning forever');
    assert.equal(row.text, captured.text);
  });

  test('recap payload finalizes the open recap placeholder row', async () => {
    const { finalizeStreamingByIntentMessages } = await import(pathToFileURL(overlayMessagePersistencePath).href);
    const { engine } = await makeEmptyEngine();
    let captured = null;
    engine.on('recap', (text) => { captured = text; });
    await engine.runRecap();
    assert.ok(captured);

    const rowsWithOpenPlaceholder = [
      { id: 'ph-recap', role: 'system', text: '', intent: 'recap', isStreaming: true },
    ];
    const resolved = finalizeStreamingByIntentMessages(rowsWithOpenPlaceholder, 'recap', captured);
    const row = resolved.find((m) => m.id === 'ph-recap');
    assert.ok(row);
    assert.equal(row.isStreaming, false);
    assert.equal(row.text, captured);
  });

  test('follow_up_questions_update payload finalizes the open follow_up_questions placeholder row', async () => {
    const { finalizeStreamingByIntentMessages } = await import(pathToFileURL(overlayMessagePersistencePath).href);
    const { engine } = await makeEmptyEngine();
    let captured = null;
    engine.on('follow_up_questions_update', (text) => { captured = text; });
    await engine.runFollowUpQuestions();
    assert.ok(captured);

    const rowsWithOpenPlaceholder = [
      { id: 'ph-fuq', role: 'system', text: '', intent: 'follow_up_questions', isStreaming: true },
    ];
    const resolved = finalizeStreamingByIntentMessages(rowsWithOpenPlaceholder, 'follow_up_questions', captured);
    const row = resolved.find((m) => m.id === 'ph-fuq');
    assert.ok(row);
    assert.equal(row.isStreaming, false);
    assert.equal(row.text, captured);
  });
});
