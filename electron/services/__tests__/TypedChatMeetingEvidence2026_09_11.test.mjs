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
    // Sliced to the next method's signature (a unique, stable marker) rather
    // than a fixed char count — a fixed window silently stops covering the
    // block it means to pin if the builder grows past it (M7a, review).
    const ctx = between(engine, 'private v3ModeRetrievalContext(', 'private async buildV3ForTranscriptSurface(');
    assert.match(ctx, /resolveMeetingEvidence\(\{/);
    assert.match(ctx, /scopeMeetingId = meeting\.scopeMeetingId/);
    assert.match(ctx, /meetingId: scopeMeetingId \?\? meetingId/);
  });
  test('v3ModeRetrievalContext also exposes inLiveMeeting (task 7b)', () => {
    const ctx = between(engine, 'private v3ModeRetrievalContext(', 'private async buildV3ForTranscriptSurface(');
    assert.match(ctx, /inLiveMeeting = meeting\.inLiveMeeting/);
    assert.match(ctx, /inLiveMeeting,\s*\n\s*port,/, 'inLiveMeeting must be on the returned context object');
  });
  // EVERY buildV3Prompt call built from v3ModeRetrievalContext()/_ctx passes
  // inLiveMeeting through — not just one surface. There are three such call
  // sites in this file (assist/clarify/brainstorm/code-hint via
  // buildV3ForTranscriptSurface, the WTA surface in
  // runWhatShouldISayInner, and the engine's own manual-chat surface in
  // runManualAnswerInner) and the brief's quoted scope shape
  // (`meetingId: ctx.meetingId ?? undefined`) does not discriminate between
  // two of them, so all three are pinned rather than guessing which one was
  // meant.
  test('the transcript-surface builder (assist/clarify/brainstorm/code-hint) passes inLiveMeeting through (task 7b)', () => {
    const builder = between(engine, 'private async buildV3ForTranscriptSurface(', 'async runFollowUp(');
    assert.match(builder, /inLiveMeeting: ctx\.inLiveMeeting,/);
  });
  test('the WTA surface (runWhatShouldISayInner) passes inLiveMeeting through (task 7b)', () => {
    const marker = 'meetingId: _ctx.meetingId ?? meetingMarker ?? undefined,';
    const idx = engine.indexOf(marker);
    assert.ok(idx >= 0, 'WTA scope construction must exist');
    assert.match(engine.slice(Math.max(0, idx - 400), idx), /inLiveMeeting: _ctx\.inLiveMeeting,/);
  });
  test("the engine's own manual-chat surface (runManualAnswerInner) passes inLiveMeeting through (task 7b)", () => {
    // This call's scope comment names itself explicitly ("like every other
    // surface"), making it a unique, stable anchor distinct from the WTA
    // scope above.
    const marker = 'THE resolver, like every other surface.';
    const idx = engine.indexOf(marker);
    assert.ok(idx >= 0, 'the manual-chat scope comment must exist');
    assert.match(engine.slice(Math.max(0, idx - 1000), idx), /inLiveMeeting: _ctx\.inLiveMeeting,/);
  });
  test('IntelligenceManager exposes the renamed provider, and dropped the dead getMeetingMetadata passthrough', () => {
    const im = read('electron/IntelligenceManager.ts');
    // I3 (final review pass on #552): nothing called this passthrough — WTA
    // reads `this.session.getMeetingMetadata()` directly, and manual-chat V3
    // never needed a meeting-metadata id (resolveMeetingEvidence keys off the
    // live JIT index id instead). Pinning dead API is how it comes back.
    assert.doesNotMatch(im, /getMeetingMetadata\(\): any/);
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
  test('the turn tells the classifier it is inside a live meeting (task 7b)', () => {
    const scope = between(ipc, 'const composed = await buildV3Prompt({', 'retrieval: port,');
    assert.match(scope, /inLiveMeeting: v3MeetingEvidence\.inLiveMeeting,/);
  });
});

describe('rag:query-live records its turn', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const live = between(ipc, "safeHandle('rag:query-live'", "safeHandle('rag:query-global'");
  const helper = between(ipc, 'function recordLiveRagTurn(', '\n  }\n');
  test('the streamed answer is accumulated and handed to the recorder on a clean completion, with the mode captured before streaming', () => {
    assert.match(live, /ragLiveAnswer \+= chunk/);
    // C1 (final review pass on #552): the mode must be captured BEFORE the
    // stream starts — a switch mid-stream must be detectable by comparing
    // against a snapshot taken at request time, not at completion time.
    assert.match(live, /const manualActiveMode = ModesManager\.getInstance\(\)\.getActiveMode\(\);/);
    assert.match(live, /if \(!abortController\.signal\.aborted\) \{\s*event\.sender\.send\('rag:stream-complete', \{ live: true \}\);\s*recordLiveRagTurn\(event\.sender\.id, query, ragLiveAnswer, manualActiveMode\);/);
  });
  test('the recorder writes every history sink V3 writes', () => {
    assert.match(helper, /recordAnswerSummary\(\s*v3ConversationSessionId\(appState, senderId\)/);
    assert.match(helper, /addTranscript\?\.\(\{ text: query, speaker: 'user'/);
    assert.match(helper, /addAssistantMessage\?\.\(ragLiveAnswer, undefined, 'manual_chat'\)/);
    assert.match(helper, /_manualConversationMemory\.record\(\{/);
    assert.match(helper, /logUsage\?\.\('rag_live', query, ragLiveAnswer\)/);
  });
  test('the recorded turn is ANCHORED — it moves the follow-up anchor (task 7b)', () => {
    // This turn completed synchronously and is certainly the newest, unlike
    // the deferred what-to-answer writer — see recordAnswerSummary's `opts`
    // docblock for why only this call site may anchor. Sliced from the call
    // site itself (not `between(..., ');')`) because the call's own comments
    // contain "orchestrate();", which would end the slice early.
    const idx = helper.indexOf('recordAnswerSummary(');
    assert.ok(idx >= 0, 'recordAnswerSummary call must exist in the helper');
    assert.match(helper.slice(idx, idx + 1200), /\{\s*anchor:\s*true\s*\}/);
  });
  test('a truncated stream (RAGManager coda) records the user turn but not the answer', () => {
    assert.match(helper, /ragLiveTruncated/);
    // M6 (review): the helper detects truncation against the EXPORTED
    // constant, not a re-typed copy of the string, so pin the constant name
    // rather than the literal English text it happens to hold today.
    assert.match(helper, /RAG_STREAM_INCOMPLETE_CODA/);
    const logUsageIdx = helper.indexOf('logUsage');
    const truncatedGuardIdx = helper.indexOf('if (ragLiveTruncated)');
    // M7b (review): indexOf returns -1 on no match, and `-1 < -1` is false —
    // a missing `logUsage` and a missing truncation guard would BOTH make
    // this pass vacuously. Assert both markers actually exist first.
    assert.ok(logUsageIdx >= 0, 'logUsage call must exist in the helper');
    assert.ok(truncatedGuardIdx >= 0, 'the truncation early-return must exist in the helper');
    assert.ok(logUsageIdx < truncatedGuardIdx, 'usage is logged before the truncation early-return');
  });
  test('the mode-bleeding guard skips answer-side sinks when the mode changed mid-stream', () => {
    // C1 (BUG-MODE-BLEEDING): the same class of leak the V3 site was fixed
    // for — modes:set-active clears memory/ring for the OUTGOING mode without
    // aborting this stream, so recording after a switch must be gated the
    // same way the V3 site gates it.
    assert.match(helper, /liveModeIdAtRecord/);
    assert.match(helper, /liveModeIdAtRecord !== \(manualActiveMode\?\.id \?\? null\)/);
  });
  test('the gate uses getLiveMeetingId, not the literal live id', () => {
    assert.match(live, /ragManager\.getLiveMeetingId\(\)/);
    assert.doesNotMatch(live, /'live-meeting-current'/);
  });
});

describe('debug-inject-transcript feeds the JIT live indexer too (A1, final review pass)', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const inject = between(ipc, "safeHandle('debug-inject-transcript'", "safeHandle('get-recent-meetings'");
  test('every injected segment also reaches RAGManager.feedLiveTranscript, mirroring the real STT handler', () => {
    // Without this, im.addTranscript() alone never produced JIT chunks, so a
    // test run could never exercise the semantic meeting port half of
    // resolveMeetingEvidence — only the BM25 live-transcript port.
    assert.match(inject, /feedLiveTranscript\(/);
  });
});

describe('renderer typed chat', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const submit = between(ui, 'const handleManualSubmit = async () => {', '// Refresh the latest-handler ref on every render');
  test('typed submit goes straight to streamGeminiChat with the conversation context — no RAG pre-flight', () => {
    assert.doesNotMatch(submit, /ragQueryLive/);
    assert.match(submit, /streamGeminiChat\(\s*userText \|\| 'Analyze this screenshot',[\s\S]*conversationContextForSubmit/);
  });
  test('the voice path still queries live RAG (it is legacy-owned via skipSystemPrompt)', () => {
    const voice = between(ui, 'const handleAnswerNow = async () => {', 'const selectSkill = useCallback');
    assert.match(voice, /ragQueryLive\?\.\(question\)/);
  });
});
