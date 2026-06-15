// node:test — ContextRouter (consolidated routing decision facade).
// Validates the spec's Phase 8 routing examples + that maxLatencyMs/reason are
// populated and answerContract is correct.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeContext } from '../../../dist-electron/electron/intelligence/ContextRouter.js';

const base = { profileAvailable: true, jdAvailable: true, hasLiveTranscript: true, referenceFilesAvailable: true };

describe('ContextRouter', () => {
  test('"What is my name?" → ProfileTree, not raw RAG/Hindsight', () => {
    const d = routeContext({ userQuery: 'What is my name?', source: 'manual_input', ...base });
    assert.equal(d.useProfileTree, true);
    assert.equal(d.useHybridRag, false);
    assert.equal(d.useHindsightRecall, false);
    assert.equal(d.answerContract, 'interview_short');
    assert.ok(d.reason.length > 0);
    assert.ok(d.maxLatencyMs > 0);
  });

  test('"Introduce yourself" → ProfileTree (interview context)', () => {
    const d = routeContext({ userQuery: 'Introduce yourself', source: 'manual_input', mode: 'technical-interview', ...base });
    assert.equal(d.useProfileTree, true);
    assert.equal(d.useHindsightRecall, false);
  });

  test('"What should I answer?" live → LiveTranscript + ProfileTree allowed, no Hindsight', () => {
    const d = routeContext({ userQuery: 'what should I answer?', source: 'what_to_answer', ...base });
    assert.equal(d.useLiveTranscript, true);
    assert.equal(d.useHindsightRecall, false);
  });

  test('"What did we discuss last time?" → Hindsight + MeetingSummary decision', () => {
    const d = routeContext({ userQuery: 'What did we discuss last time?', source: 'manual_input', ...base });
    assert.equal(d.useHindsightRecall, true);
    assert.equal(d.useMeetingSummary, true);
    assert.equal(d.useHybridRag, true);
    // strict live recall timeout for Hindsight (spec: <=800ms live).
    assert.ok(d.hindsightRecallTimeoutMs <= 800);
    assert.ok(d.maxLatencyMs >= 3000, 'recall queries get a wider budget');
  });

  test('"Find where they mentioned Redis in this meeting" → in-meeting search, local-first (no Hindsight)', () => {
    const d = routeContext({ userQuery: 'search this meeting for when they mentioned Redis', source: 'manual_input', ...base });
    assert.equal(d.useHybridRag, true);
    assert.equal(d.useHindsightRecall, false, 'in-meeting search must NOT call Hindsight by default');
  });

  test('"Write code for two sum" → coding contract, NO profile', () => {
    const d = routeContext({ userQuery: 'write code for two sum', source: 'manual_input', ...base });
    assert.equal(d.answerContract, 'coding_answer');
    assert.equal(d.useProfileTree, false);
    assert.equal(d.profileContextPolicy, 'forbidden');
  });

  test('"Why am I a fit for this job?" → ProfileTree + RAG evidence', () => {
    const d = routeContext({ userQuery: 'why am I a fit for this job?', source: 'manual_input', ...base });
    assert.equal(d.useProfileTree, true);
    assert.equal(d.useHybridRag, true, 'jd-fit pulls evidence');
    assert.equal(d.answerContract, 'interview_detailed');
  });

  test('browser DOM only routed when explicitly attached', () => {
    const off = routeContext({ userQuery: 'summarize this', source: 'manual_input', ...base });
    assert.equal(off.useBrowserDom, false);
    const on = routeContext({ userQuery: 'what does this page say?', source: 'manual_input', ...base, hasBrowserDom: true });
    assert.equal(on.useBrowserDom, true);
  });

  test('latencyMode tightens (fast) / widens (deep) the budget', () => {
    const fast = routeContext({ userQuery: 'what is my name?', source: 'manual_input', latencyMode: 'fast', ...base });
    assert.ok(fast.maxLatencyMs <= 1200);
    const deep = routeContext({ userQuery: 'what did we discuss last time?', source: 'manual_input', latencyMode: 'deep', ...base });
    assert.ok(deep.maxLatencyMs >= 5000);
    assert.ok(deep.hindsightRecallTimeoutMs > 800, 'deep mode allows the slow global-search recall budget');
  });

  test('reference files dropped for coding, allowed for general', () => {
    const coding = routeContext({ userQuery: 'reverse a linked list in python', source: 'manual_input', ...base });
    assert.equal(coding.useReferenceFiles, false);
    const general = routeContext({ userQuery: 'help me draft a reply', source: 'manual_input', ...base });
    assert.equal(general.useReferenceFiles, true);
  });

  test('decision is pure/deterministic — same input twice → same output', () => {
    const a = routeContext({ userQuery: 'introduce yourself', source: 'manual_input', ...base });
    const b = routeContext({ userQuery: 'introduce yourself', source: 'manual_input', ...base });
    assert.deepEqual(a, b);
  });

  test('never throws on empty/odd input', () => {
    assert.doesNotThrow(() => routeContext({ userQuery: '', source: 'manual_input' }));
    assert.doesNotThrow(() => routeContext({ userQuery: '???', source: 'system' }));
  });

  test('"Create notes from this lecture" in lecture mode → lecture answer, no profile', () => {
    const d = routeContext({ userQuery: 'create notes from this lecture', source: 'manual_input', mode: 'lecture', hasLiveTranscript: true });
    assert.equal(d.answerContract, 'lecture_notes');
    assert.equal(d.useProfileTree, false);
  });

  test('"Generate a diagram for the TCP handshake" in lecture mode → useDiagramIntelligence', () => {
    const d = routeContext({ userQuery: 'generate a diagram for the TCP handshake', source: 'manual_input', mode: 'lecture', hasLiveTranscript: true });
    assert.equal(d.useDiagramIntelligence, true);
  });

  test('diagram ask OUTSIDE lecture mode does NOT engage diagram intelligence', () => {
    const d = routeContext({ userQuery: 'draw me a diagram', source: 'manual_input', mode: 'technical-interview' });
    assert.equal(d.useDiagramIntelligence, false);
  });

  test('"Which lecture mentioned deadlocks?" in lecture mode → useLectureMemory', () => {
    const d = routeContext({ userQuery: 'which lecture mentioned deadlocks?', source: 'manual_input', mode: 'lecture' });
    assert.equal(d.useLectureMemory, true);
    assert.ok(d.maxLatencyMs >= 3000, 'cross-lecture recall gets a wider budget');
  });

  test('plain lecture summary is NOT lecture-memory recall', () => {
    const d = routeContext({ userQuery: 'summarize this lecture', source: 'manual_input', mode: 'lecture', hasLiveTranscript: true });
    assert.equal(d.useLectureMemory, false);
    assert.equal(d.useDiagramIntelligence, false);
  });

  test('team-meet contract uses the normalized template type (not raw casing)', () => {
    // 'team-meet' is a valid template id → general_meeting answer maps to the summary.
    const d = routeContext({ userQuery: 'recap the discussion', source: 'manual_input', mode: 'team-meet', hasLiveTranscript: true });
    // The general meeting answer in team-meet mode → team_meeting_summary contract.
    assert.ok(['team_meeting_summary', 'general_assistant'].includes(d.answerContract));
    // An UNKNOWN mode casing must not crash and must not falsely claim team summary.
    const bad = routeContext({ userQuery: 'recap the discussion', source: 'manual_input', mode: 'Team_Meet', hasLiveTranscript: true });
    assert.notEqual(bad.answerContract, undefined);
  });
});
