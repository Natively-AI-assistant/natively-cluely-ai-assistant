// Source-pinned guards for issue #552 (typed chat during a meeting).
//
// The defects these pin were each invisible at runtime: a phantom accessor
// behind `as any` + optional chaining, a port scoped to an id no meeting
// sets, and a pre-flight that returned before history was passed. None of
// them errored. Pinning the SHAPE is how they stay fixed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', '..', rel), 'utf8');
const between = (src, start, end) => {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `marker not found: ${start}`);
  const b = src.indexOf(end, a);
  assert.ok(b > a, `end marker not found: ${end}`);
  return src.slice(a, b);
};

describe('what-to-answer meeting evidence', () => {
  const engine = read('electron/IntelligenceEngine.ts');
  test('the engine no longer scopes its meeting port by the metadata id, and no phantom accessor remains', () => {
    assert.doesNotMatch(engine, /ragRetrieverProvider/, 'renamed to the RAGManager-shaped provider');
    assert.match(engine, /setMeetingRagProvider\(/);
    assert.match(engine, /resolveMeetingEvidence\(\{/);
    assert.doesNotMatch(engine, /getSessionTracker/);
  });
  test('the resolved scope id reaches the WTA turn scope', () => {
    // The builder is ~150 lines; slice a generous window from its head rather
    // than hunting for its closing brace.
    const a = engine.indexOf('private v3ModeRetrievalContext(');
    assert.ok(a >= 0, 'v3ModeRetrievalContext must exist');
    const ctx = engine.slice(a, a + 14000);
    assert.match(ctx, /resolveMeetingEvidence\(\{/);
    assert.match(ctx, /scopeMeetingId = meeting\.scopeMeetingId/);
    assert.match(ctx, /meetingId: scopeMeetingId \?\? meetingId/);
  });
  test('IntelligenceManager exposes a real getMeetingMetadata and the renamed provider', () => {
    const im = read('electron/IntelligenceManager.ts');
    assert.match(im, /getMeetingMetadata\(\): any \{\s*return this\.session\.getMeetingMetadata\(\);/);
    assert.match(im, /setMeetingRagProvider\(/);
    assert.doesNotMatch(im, /setRagRetrieverProvider/);
  });
  test('main.ts wires the RAGManager itself, not just its retriever', () => {
    const main = read('electron/main.ts');
    assert.match(main, /setMeetingRagProvider\?\.\(\s*\(\) => this\.ragManager \?\? null,?\s*\)/);
    assert.doesNotMatch(main, /setRagRetrieverProvider/);
  });
});

describe('manual-chat V3 meeting evidence', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const v3 = between(ipc, '// ── CONTEXT INTELLIGENCE V3 — wired manual-chat surface', 'const composed = await buildV3Prompt({');
  test('the phantom getSessionTracker chain is gone from the whole file', () => {
    assert.doesNotMatch(ipc, /getSessionTracker/);
  });
  test('the V3 block resolves meeting evidence through the shared resolver with the ring session id', () => {
    assert.match(v3, /resolveMeetingEvidence\(\{/);
    const call = between(v3, 'resolveMeetingEvidence({', '});');
    assert.match(call, /sessionId: v3ConversationKey,/, 'the resolver must be scoped to the ring session id');
    assert.match(v3, /const v3ConversationKey = v3ConversationSessionId\(appState, senderId\);/);
    assert.match(v3, /segments: .*getCurrentMeetingTranscript/);
    assert.doesNotMatch(v3, /wantsMeeting/, 'the availability flag that was always false must not survive');
  });
  test('the resolved scope id is what the turn scope carries', () => {
    const scope = between(ipc, 'const composed = await buildV3Prompt({', 'retrieval: port,');
    assert.match(scope, /v3MeetingEvidence\.scopeMeetingId \? \{ meetingId: v3MeetingEvidence\.scopeMeetingId \} : \{\}/);
  });
});
