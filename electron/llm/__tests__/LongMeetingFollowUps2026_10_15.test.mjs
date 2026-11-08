// electron/llm/__tests__/LongMeetingFollowUps2026_10_15.test.mjs
//
// Three defects found by a real-app run of a 3-hour meeting (2026-10-15,
// macOS, DeepSeek-only profile):
//
//  1. generateMeetingSummary had no DeepSeek rung: a DeepSeek-only user got
//     every meeting saved with its summary marked failed.
//  2. Typed "Summarize the key decisions from this meeting so far" counted
//     "this" as pointing at the previous answer, so it was anchored as a
//     rephrasing of the last question heard and answered that question again.
//  3. The live transcript search served a window without its neighbours, so
//     "what budget did we approve?" found "that's the budget, that's approved"
//     and not the figure said a few lines earlier.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const cjs = createRequire(path.join(root, 'package.json'));
const dist = (p) => pathToFileURL(path.join(root, 'dist-electron/electron', p)).href;

// LLMHelper needs `app` (same stub as MeetingSummaryNoGeminiClient2026_09_23).
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'long-meeting-followups-'));
const electronStub = new Module('electron');
electronStub.exports = {
  app: { isReady: () => true, getPath: (n) => (n === 'userData' ? tmpUserData : os.tmpdir()), getAppPath: () => root, getName: () => 'natively-test', getVersion: () => '0.0.0-test', isPackaged: false, on: () => {} },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: { getSources: async () => [] },
  net: { isOnline: () => true },
};
electronStub.loaded = true;
cjs.cache[cjs.resolve('electron')] = electronStub;
const { LLMHelper } = cjs(path.join(root, 'dist-electron/electron/LLMHelper.js'));

function fakeOpenAiClient(calls, label, content = `${label} summary`) {
  return { chat: { completions: { create: async (req) => { calls.push({ label, model: req.model }); return { choices: [{ message: { content } }] }; } } } };
}

describe('1. meeting summary with a DeepSeek key', () => {
  test('DeepSeek only: the summary is generated, not failed', async () => {
    const h = new LLMHelper(undefined, false);
    const calls = [];
    h.deepseekClient = fakeOpenAiClient(calls, 'deepseek');
    h.currentModelId = 'deepseek-flash';
    const out = await h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.');
    assert.match(out, /deepseek summary/);
    assert.equal(calls.length, 1);
  });

  test('DeepSeek selected: it is tried before Groq', async () => {
    const h = new LLMHelper(undefined, false);
    const calls = [];
    h.deepseekClient = fakeOpenAiClient(calls, 'deepseek');
    h.groqClient = fakeOpenAiClient(calls, 'groq');
    h.currentModelId = 'deepseek-flash';
    await h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.');
    assert.deepEqual(calls.map((c) => c.label), ['deepseek']);
  });

  test('another model selected: Groq keeps the summary, DeepSeek is only the fallback', async () => {
    const h = new LLMHelper(undefined, false);
    const calls = [];
    h.deepseekClient = fakeOpenAiClient(calls, 'deepseek');
    h.groqClient = fakeOpenAiClient(calls, 'groq');
    h.currentModelId = 'gpt-5.4';
    const out = await h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.');
    assert.match(out, /groq summary/);
    assert.deepEqual(calls.map((c) => c.label), ['groq']);
  });

  // The same gap existed for every direct key the chain had no rung for.
  for (const [label, model, wire] of [
    ['OpenAI', 'gpt-5.4', (h, calls) => { h.openaiClient = {}; h.generateWithOpenai = async () => { calls.push('openai'); return 'openai summary'; }; }],
    ['Claude', 'claude-sonnet-4-6', (h, calls) => { h.claudeClient = {}; h.generateWithClaude = async () => { calls.push('claude'); return 'claude summary'; }; }],
    ['AgentRouter', 'agentrouter/deepseek-v4-flash', (h, calls) => { h.hasAgentRouterCredential = () => true; h.generateWithAgentRouter = async () => { calls.push('agentrouter'); return 'agentrouter summary'; }; }],
  ]) {
    test(`${label} only and selected: the summary comes from it`, async () => {
      const h = new LLMHelper(undefined, false);
      const calls = [];
      wire(h, calls);
      h.currentModelId = model;
      assert.equal(h.selectedModelTextCall()?.name, label, `routing for ${model}`);
      const out = await h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.');
      assert.match(out, new RegExp(`${label.toLowerCase()} summary`));
      assert.equal(calls.length, 1);
    });
  }

  test('fallback after Gemini: other direct keys, the selected one not retried', async () => {
    const h = new LLMHelper(undefined, false);
    const calls = [];
    h.deepseekClient = { chat: { completions: { create: async () => { calls.push('deepseek'); throw new Error('down'); } } } };
    h.claudeClient = {}; h.generateWithClaude = async () => { calls.push('claude'); return 'claude summary'; };
    h.currentModelId = 'deepseek-flash';
    const warn = console.warn; console.warn = () => {};
    try {
      const out = await h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.');
      assert.match(out, /claude summary/);
    } finally { console.warn = warn; }
    assert.equal(calls.filter((c) => c === 'deepseek').length >= 1, true);
    assert.equal(calls.at(-1), 'claude');
  });

  test('another model selected and Groq failing: DeepSeek still saves the summary', async () => {
    const h = new LLMHelper(undefined, false);
    const calls = [];
    h.deepseekClient = fakeOpenAiClient(calls, 'deepseek');
    h.groqClient = { chat: { completions: { create: async () => { calls.push({ label: 'groq' }); throw new Error('groq down'); } } } };
    h.currentModelId = 'gpt-5.4';
    const warn = console.warn; console.warn = () => {};
    try {
      const out = await h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.');
      assert.match(out, /deepseek summary/);
    } finally { console.warn = warn; }
    assert.equal(calls.at(-1).label, 'deepseek');
  });
});

describe('2. "this meeting" is not the previous answer', async () => {
  const { isRefinementFollowUp } = cjs(path.join(root, 'dist-electron/electron/llm/FollowUpResolver.js'));
  const { advance, resolveReference } = await import(dist('context-intelligence/question/conversation-state.js'));

  test('a summary of the meeting is not a refinement', () => {
    for (const q of [
      'Summarize the key decisions from this meeting so far.',
      'Summarize this meeting',
      'Summarise this call for me',
      'Give me the action items from that discussion',
    ]) assert.equal(isRefinementFollowUp(q), false, q);
  });

  test('editing the previous answer still is', () => {
    for (const q of ['summarize that', 'Summarize this', 'make this shorter', 'make it more confident', 'rewrite that answer', 'summarize this answer'])
      assert.equal(isRefinementFollowUp(q), true, q);
  });

  test('the typed summary is not anchored to the last question heard', () => {
    const scope = { userId: 'u', meetingId: 'm' };
    const s = advance(null, { scope, question: 'Sam, did the SRE requisitions get approved?' });
    const r = resolveReference('Summarize the key decisions from this meeting so far.', s, scope);
    assert.doesNotMatch(r.resolved, /rephrasing request/);
    assert.equal(r.resolved, 'Summarize the key decisions from this meeting so far.');
  });
});

describe('3. the best transcript window is served with its neighbours', async () => {
  const port = await import(dist('context-intelligence/retrieval/live-transcript-port.js'));
  const filler = (n, tag) => Array.from({ length: n }, (_, i) => ({ speaker: i % 2 ? 'user' : 'interviewer', text: `${tag} filler line ${i} about rotations, dashboards and on-call handoffs`, final: true }));
  const segments = [
    ...filler(30, 'early'),
    { speaker: 'interviewer', text: 'yeah, okay, so, um, let me do the money thing.', final: true },
    { speaker: 'interviewer', text: 'I went back and forth with finance on this for two weeks, honestly.', final: true },
    { speaker: 'interviewer', text: 'and the number we landed on is four hundred and twelve thousand dollars for Q4.', final: true },
    ...filler(6, 'middle'),
    { speaker: 'user', text: "okay so that's the budget, that's approved, that unblocks the contractor conversation.", final: true },
    ...filler(30, 'late'),
  ];
  const retrieve = (P, q) => P.retrieve({ decision: { query: q, resolvedQuestion: q, scope: { userId: 'u', sessionId: 's' }, claimRequirements: [], retrievalPlan: { shouldRetrieve: true, queries: [q], sourceTypes: ['MEETING_TRANSCRIPT'], maximumCandidates: 20, timeoutMs: 5000 } } });

  test('precondition: the figure and the word "budget" are in different windows', () => {
    const chunks = port.chunkLiveTranscript(segments);
    const fig = chunks.findIndex((c) => /four hundred and twelve/.test(c));
    const bud = chunks.findIndex((c) => /that's the budget/.test(c));
    assert.ok(fig >= 0 && bud >= 0 && fig !== bud && !/that's the budget/.test(chunks[fig]));
    assert.equal(Math.abs(fig - bud), 1, 'neighbouring windows');
  });

  test('"what budget did we approve?" now carries the figure', async () => {
    const P = port.createLiveTranscriptRetrievalPort({ segments, userId: 'u', sessionId: 's' });
    const r = await retrieve(P, 'What budget did we approve for the migration?');
    const top = r.evidence[0];
    assert.match(top.content, /that's the budget/);
    assert.match(top.content, /four hundred and twelve thousand dollars/);
  });

  test('a widened window is not served again, and the shared boundary line appears once', async () => {
    const P = port.createLiveTranscriptRetrievalPort({ segments, userId: 'u', sessionId: 's' });
    const r = await retrieve(P, 'What budget did we approve for the migration?');
    const idx = r.evidence.map((e) => e.chunkIndex);
    const first = idx[0];
    assert.ok(!idx.slice(1).some((i) => Math.abs(i - first) <= 1), `no neighbour of the widened hit repeats: ${idx}`);
    const lines = r.evidence[0].content.split('\n');
    for (let i = 1; i < lines.length; i++) assert.notEqual(lines[i], lines[i - 1]);
  });

  test('cached windows: a growing transcript is searched afresh, and the question itself is still left out', async () => {
    const q = 'What budget did we approve for the migration?';
    const first = await retrieve(port.createLiveTranscriptRetrievalPort({ segments, userId: 'u', sessionId: 's' }), q);
    const again = await retrieve(port.createLiveTranscriptRetrievalPort({ segments, userId: 'u', sessionId: 's' }), q);
    assert.deepEqual(again.evidence.map((e) => e.content), first.evidence.map((e) => e.content), 'same transcript, same evidence');
    const grown = [...segments, ...filler(10, 'later'), { speaker: 'interviewer', text: 'the kestrel launch slipped to march', final: true }, { speaker: 'interviewer', text: q, final: true }];
    const r = await retrieve(port.createLiveTranscriptRetrievalPort({ segments: grown, userId: 'u', sessionId: 's' }), 'When did the kestrel launch slip to?');
    assert.match(r.evidence[0].content, /kestrel launch slipped to march/);
    const asked = await retrieve(port.createLiveTranscriptRetrievalPort({ segments: grown, userId: 'u', sessionId: 's' }), q);
    for (const e of asked.evidence) assert.ok(!e.content.split('\n').some((l) => l.endsWith(q)), 'the question being answered is not its own evidence');
  });

  test('only the best window is widened', async () => {
    const P = port.createLiveTranscriptRetrievalPort({ segments, userId: 'u', sessionId: 's' });
    const r = await retrieve(P, 'rotations dashboards handoffs');
    const max = port.LIVE_TRANSCRIPT_CHUNK_CHARS + 200;
    for (const e of r.evidence.slice(1)) assert.ok(e.content.length <= max, `later windows keep their size (${e.content.length})`);
    assert.equal(port.LIVE_TRANSCRIPT_WIDENED_HITS, 1);
  });
});

describe('4. the rolling meeting recap answers "summarise so far"', async () => {
  const { SessionTracker } = await import(dist('SessionTracker.js'));
  const port = await import(dist('context-intelligence/retrieval/live-transcript-port.js'));
  const settle = () => new Promise((r) => setImmediate(r));
  const say = (s, text, extra = {}) => s.addTranscript({ speaker: 'interviewer', text, timestamp: Date.now(), final: true, ...extra });

  test('one recap per 400 spoken lines; nothing is evicted; answers and typed chat are not recapped', async () => {
    const s = new SessionTracker();
    const prompts = [];
    s.setRecapLLM({ generate: async (p) => { prompts.push(p); return `- part ${prompts.length}`; } });
    for (let i = 0; i < 399; i++) say(s, `spoken ${i}`);
    s.addAssistantMessage('an answer the user saw');
    await settle();
    assert.equal(prompts.length, 0, 'the assistant line does not complete a block');
    say(s, 'spoken 399');
    await settle(); await settle();
    assert.equal(prompts.length, 1);
    assert.doesNotMatch(prompts[0], /an answer the user saw/);
    for (let i = 0; i < 400; i++) say(s, `more ${i}`);
    await settle(); await settle();
    assert.deepEqual(s.getMeetingRecaps().map((r) => r.text), ['- part 1', '- part 2']);
    assert.equal(s.getFullTranscript().length, 801);
  });

  test('a failing recap is retried later, not on every new line', async () => {
    const s = new SessionTracker();
    let calls = 0;
    s.setRecapLLM({ generate: async () => { calls++; throw new Error('down'); } });
    const warn = console.warn; console.warn = () => {};
    try {
      for (let i = 0; i < 600; i++) { say(s, `line ${i}`); if (i % 50 === 0) await settle(); }
      await settle();
    } finally { console.warn = warn; }
    assert.equal(calls, 1);
    assert.deepEqual(s.getMeetingRecaps(), []);
  });

  test('the rendered recap fits the evidence budget however long the meeting', () => {
    const recaps = Array.from({ length: 40 }, (_, i) => ({ lines: 400, text: Array.from({ length: 6 }, (_, j) => `- block ${i} point ${j} ${'x'.repeat(80)}`).join('\n') }));
    const text = port.renderMeetingRecap(recaps);
    assert.ok(text.length <= port.MEETING_RECAP_MAX_CHARS + 40 * 20 + 200, `length ${text.length}`);
    assert.match(text, /Part 1 of 40/); assert.match(text, /Part 40 of 40/);
  });

  test('served first, as a meeting note, only for a question about the whole meeting', async () => {
    const segments = Array.from({ length: 30 }, (_, i) => ({ speaker: 'interviewer', text: `we talked about rollout step ${i}`, final: true }));
    const P = port.createLiveTranscriptRetrievalPort({ segments, userId: 'u', sessionId: 's', recaps: [{ lines: 400, text: '- Budget approved: $412k\n- Code name Kestrel' }] });
    const ask = (q) => P.retrieve({ decision: { query: q, resolvedQuestion: q, scope: { userId: 'u', sessionId: 's' }, claimRequirements: [], retrievalPlan: { shouldRetrieve: true, queries: [q], sourceTypes: ['MEETING_TRANSCRIPT'], maximumCandidates: 20, timeoutMs: 5000 } } });
    const overview = await ask('Summarize the key decisions from this meeting so far.');
    assert.equal(overview.evidence[0].sourceId, 'transcript:recap');
    assert.equal(overview.evidence[0].provenance, 'MEETING_NOTE');
    assert.match(overview.evidence[0].content, /Kestrel/);
    for (const q of ['What was rollout step 12?', 'What did we decide about the mobile app redesign?']) {
      const specific = await ask(q);
      assert.ok(!specific.evidence.some((e) => e.sourceId === 'transcript:recap'), q);
    }
    for (const q of ['Can you catch me up?', 'What are the action items so far?', 'Give me a quick recap']) {
      assert.equal((await ask(q)).evidence[0].sourceId, 'transcript:recap', q);
    }
  });
});

describe('5. the reset shortcut mid-meeting: semantic search forgets what came before too', async () => {
  const { SessionTracker } = await import(dist('SessionTracker.js'));
  const { createMeetingRetrievalPort } = await import(dist('context-intelligence/retrieval/meeting-retrieval-port.js'));
  const { resolveMeetingEvidence } = await import(dist('context-intelligence/retrieval/meeting-evidence.js'));

  test('the session records when a mid-meeting reset began the assistant\'s view; a full reset clears it', () => {
    const s = new SessionTracker();
    assert.equal(s.getAssistantViewStartedAt(), 0);
    const before = Date.now();
    s.reset({ keepMeetingRecord: true });
    assert.ok(s.getAssistantViewStartedAt() >= before);
    s.reset();
    assert.equal(s.getAssistantViewStartedAt(), 0);
  });

  test('chunks that started before the reset are left out; later ones and untimed ones stay', async () => {
    const reset = 1_000_000;
    const retriever = { retrieve: async () => ({ chunks: [
      { meetingId: 'live', text: 'THEM: the acquisition price is $40M', chunkIndex: 0, similarity: 0.9, startMs: reset - 5000 },
      { meetingId: 'live', text: 'THEM: after the reset we picked Friday', chunkIndex: 1, similarity: 0.8, startMs: reset + 5000 },
      { meetingId: 'live', text: 'THEM: a chunk with no time', chunkIndex: 2, similarity: 0.7 },
    ] }) };
    const port = createMeetingRetrievalPort({ retriever, currentMeetingId: 'live', userId: 'u', tokenBudget: 2000, notBeforeMs: reset });
    const q = 'What did we pick?';
    const r = await port.retrieve({ decision: { query: q, resolvedQuestion: q, scope: { userId: 'u', meetingId: 'live' }, claimRequirements: [], retrievalPlan: { shouldRetrieve: true, queries: [q], sourceTypes: ['MEETING_TRANSCRIPT'], maximumCandidates: 20, maximumAcceptedEvidence: 6, timeoutMs: 5000 } } });
    const texts = r.evidence.map((e) => e.content).join('\n');
    assert.doesNotMatch(texts, /\$40M/);
    assert.match(texts, /picked Friday/);
    assert.match(texts, /no time/);
  });

  test('resolveMeetingEvidence passes the reset time to the semantic port', async () => {
    let seen = null;
    const rag = { getLiveMeetingId: () => 'live', getRetriever: () => ({ retrieve: async () => { seen = true; return { chunks: [{ meetingId: 'live', text: 'THEM: old', chunkIndex: 0, similarity: 0.9, startMs: 10 }] }; } }) };
    const ev = resolveMeetingEvidence({ rag, segments: [], allowedSourceTypes: ['MEETING_TRANSCRIPT'], userId: 'u', sessionId: 's', tokenBudget: 2000, notBeforeMs: 100 });
    assert.equal(ev.ports.length, 1);
    const q = 'old?';
    const r = await ev.ports[0].retrieve({ decision: { query: q, resolvedQuestion: q, scope: { userId: 'u', meetingId: 'live' }, claimRequirements: [], retrievalPlan: { shouldRetrieve: true, queries: [q], sourceTypes: ['MEETING_TRANSCRIPT'], maximumCandidates: 20, maximumAcceptedEvidence: 6, timeoutMs: 5000 } } });
    assert.equal(seen, true);
    assert.equal(r.evidence.length, 0);
  });
});

describe('6. semantic and keyword meeting results are merged into one ranking', async () => {
  const { fuseMeetingPorts } = await import(dist('context-intelligence/retrieval/meeting-evidence.js'));
  const item = (id, content, finalScore, sourceId) => ({ evidenceId: id, content, finalScore, sourceId });
  const portOf = (items) => ({ retrieve: async () => ({ evidence: items, attempts: [] }) });
  const ask = (p) => p.retrieve({ decision: {} });

  test('the merged order is by rank in each search, never by raw score, and the scores keep it', async () => {
    const semantic = portOf([item('s1', 'ME: I think we are all here, can everyone hear me', 0.95, 'live-meeting-current')]);
    const keyword = portOf([
      item('k1', 'THEM: budget approved, the contractor conversation is unblocked', 1.0, 'transcript:live'),
      item('k2', 'ME: the new billing service is project Kestrel', 0.62, 'transcript:live'),
    ]);
    const r = await ask(fuseMeetingPorts(semantic, keyword));
    // Each search's #1 first (keyword before semantic on a tie), then each #2.
    assert.deepEqual(r.evidence.map((e) => e.evidenceId), ['k1', 's1', 'k2']);
    // Scores fall with the merged order, so the packer's sort by score keeps it:
    // the semantic chunk's raw 0.95 no longer outranks anything by magnitude.
    for (let i = 1; i < r.evidence.length; i++) assert.ok(r.evidence[i].finalScore < r.evidence[i - 1].finalScore);
  });

  test('a semantic chunk that repeats a keyword window is dropped and lifts that window instead', async () => {
    const semantic = portOf([item('s1', 'THEM: the new billing service is project Kestrel, scope is billing', 0.9, 'live-meeting-current')]);
    const keyword = portOf([
      item('k1', 'THEM: we talked about dashboards and alert noise', 1.0, 'transcript:live'),
      item('k2', 'ME: okay, the new billing service is project Kestrel, scope is billing and metering', 0.6, 'transcript:live'),
    ]);
    const r = await ask(fuseMeetingPorts(semantic, keyword));
    assert.deepEqual(r.evidence.map((e) => e.evidenceId), ['k2', 'k1'], 'agreement of both searches puts the window first; no duplicate');
  });

  test('a failing semantic search leaves the keyword results', async () => {
    const semantic = { retrieve: async () => { throw new Error('vector store closed'); } };
    const keyword = portOf([item('k1', 'THEM: Friday noon', 1.0, 'transcript:live')]);
    const r = await ask(fuseMeetingPorts(semantic, keyword));
    assert.deepEqual(r.evidence.map((e) => e.evidenceId), ['k1']);
    assert.ok(r.attempts.some((a) => a.failed));
  });
});
