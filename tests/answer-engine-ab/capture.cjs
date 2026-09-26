// tests/answer-engine-ab/capture.cjs — one A/B arm. Run through run.cjs, not directly.
//
// Captures the EXACT payload the overlay answer engine sends to the provider, for a
// fixed set of questions, under one condition (AB_CONDITION):
//   A  all three Hindsight flags pinned OFF by env     (what users had before 2026-09-25:
//                                                       saving a server flipped nothing)
//   B  NO flag env — whatever the real hindsight-config:set wrote decides (what setting
//      Hindsight up now does). The save runs twice: without the pane's enableMemory
//      opt-in (must leave memory off), then with it.
//   C  all three pinned ON by env, incl. live recall  (control — MUST differ where
//                                                       recall can run, or the harness is blind)
//
// Two real answer paths, only the provider call replaced:
//   typed chat   the real `gemini-chat-stream` IPC handler out of the compiled ipcHandlers
//                bundle, driving a REAL LLMHelper whose custom-provider dispatch is spied
//   live answer  the real IntelligenceEngine.runWhatShouldISay (the overlay's what-to-say
//                path), with LLMHelper.streamChat spied — the e2e-wiring.cjs recipe
// Hindsight is configured through the real hindsight-config:set / :test handlers against a
// fake server that `fetch` answers locally (no network): /health 200, recall → one memory.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

const root = path.resolve(__dirname, '..', '..');
const d = (p) => path.join(root, 'dist-electron/electron', p);
const COND = process.env.AB_CONDITION || 'A';
// AB_V3=0 drives the legacy / promptSystemV2 fallback path of both answer surfaces
// (the default is V3, the main system). The control arm needs it: Hindsight live
// recall sits AFTER V3's early return in gemini-chat-stream, so on the default path
// it is unreachable whatever the flags say.
process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = process.env.AB_V3 === '0' ? '0' : '1';
// AB_MEETING=1 puts the turn inside a meeting: a real mode whose source is the
// transcript (created through the real ModesManager), plus a live transcript. Needed by
// the control pair (A0m/C0m): in General mode a typed question's owner resolves to
// "unknown", and both the source-owner law and the Context OS memory policy admit
// Hindsight only for transcript/mixed/profile owners — so without a meeting even the
// fallback path never recalls, and a control could not show a difference.
const MEETING = process.env.AB_MEETING === '1';
const TRANSCRIPT = '[Them]: Let us pick up the budget for next quarter.\n[Me]: Sure, where did we land?';
const OUT = process.env.AB_OUT;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `natively-ab-${COND}-`));
process.env.NATIVELY_TEST_USERDATA = userData;

// A and C pin the flags by ENV (env wins over settings at read time); B leaves them to
// the settings the real save handler writes, so B tests the change, not the env.
const ARM = COND.replace(/m?$/, '').replace(/0$/, ''); // A0/B0/C0 fallback; *m in a meeting
const HS_FLAG_ENV = ['NATIVELY_HINDSIGHT_MEMORY', 'NATIVELY_HINDSIGHT_POST_MEETING_RETAIN', 'NATIVELY_HINDSIGHT_LIVE_RECALL'];
for (const k of HS_FLAG_ENV) {
  if (ARM === 'B') delete process.env[k];
  else process.env[k] = ARM === 'C' ? '1' : '0';
}

const HS = 'http://127.0.0.1:18888';
const MEMORY_TEXT = 'AB-MEMORY-MARKER: last time the team agreed the budget cap is 40k';
// Recall results carry what a real Hindsight 0.8.2 RecallResult can: tags (the retain's
// `meeting:<id>` among them) and a document_id. Whether a real server copies a
// document's tags onto the facts it extracts is NOT proven here. The Launcher's memory
// search (query SEARCH_QUERY) also gets a second, untagged fact; every other recall (the
// live-answer path) gets the tagged one only, so answer payloads stay comparable.
const AB_MEETING_ID = 'a0b1c2d3-0000-4000-8000-00000000ab01';
const SEARCH_QUERY = 'budget cap';
const UNLINKED_TEXT = 'AB-UNLINKED-MEMORY: the vendor shortlist is Acme and Globex';
const taggedFact = { text: MEMORY_TEXT, type: 'world', tags: ['user:local', 'visibility:private', 'org:personal', 'source:meeting_summary', 'mode:team-meet', `meeting:${AB_MEETING_ID}`], document_id: AB_MEETING_ID, mentioned_at: '2026-09-20T10:00:00Z' };
const untaggedFact = { text: UNLINKED_TEXT, type: 'world' };
const fetchLog = [];
// Stubbed BEFORE any bundle loads: /v1/trial/start must never be reached for real.
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
  fetchLog.push(`${method} ${url.replace(/\?.*$/, '')}`);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith(HS) && url.endsWith('/health')) return json({ status: 'healthy' });
  if (url.startsWith(HS) && url.includes('/memories/recall')) {
    let body = init && typeof init.body === 'string' ? init.body : '';
    if (!body && input && typeof input === 'object' && typeof input.clone === 'function') { try { body = await input.clone().text(); } catch { /* no body */ } }
    let query = ''; try { query = JSON.parse(body || '{}').query || ''; } catch { /* not JSON */ }
    return json({ results: query === SEARCH_QUERY ? [taggedFact, untaggedFact] : [taggedFact] });
  }
  if (url.startsWith(HS)) return json({ success: true });
  return json({ error: 'not_stubbed' }, 503);
};

const noop = () => {};
const handlers = new Map();
const fakeElectron = {
  app: { isReady: () => true, getPath: () => userData, getAppPath: () => root, isPackaged: false, getVersion: () => '0.0.0-ab', getName: () => 'natively-ab', on: noop, once: noop, off: noop, removeAllListeners: noop, whenReady: () => Promise.resolve() },
  BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [] }),
  ipcMain: { handle: (c, fn) => handlers.set(c, fn), handleOnce: (c, fn) => handlers.set(c, fn), on: noop, once: noop, off: noop, removeHandler: noop, removeListener: noop, removeAllListeners: noop, listenerCount: () => 0, emit: noop },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(String(s)), decryptString: (b) => Buffer.from(b).toString() },
  dialog: {}, desktopCapturer: {}, shell: {}, systemPreferences: {}, nativeTheme: { on: noop }, screen: { on: noop },
  powerMonitor: { on: noop }, session: {}, globalShortcut: {}, Menu: {}, Tray: {}, clipboard: {},
};
const realLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? fakeElectron : realLoad.call(this, request, ...rest); };

const realLog = console.log.bind(console);
console.log = noop; console.warn = noop; console.info = noop; console.debug = noop;

// ── typed chat ───────────────────────────────────────────────────────────────
function spiedHelper(LLMHelper, calls) {
  const helper = new LLMHelper(undefined, false);
  helper.customProvider = { id: 'spy-provider', name: 'spy', curlCommand: 'noop' };
  helper.getDeniedOutboundScopes = () => [];
  helper.streamWithCustom = async function* (message, context, _img, systemPrompt) {
    calls.push({ via: 'stream', message: message || '', context: context || '', systemPrompt: systemPrompt || '' });
    yield 'Here is the answer.';
  };
  helper.executeCustomProvider = async function (_cmd, combined, systemPrompt, message, context) {
    calls.push({ via: 'oneshot', message: message || '', context: context || '', systemPrompt: systemPrompt || '', combined: combined || '' });
    return 'Here is the answer.';
  };
  return helper;
}

function softProxy(base) {
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; if (k === 'then') return undefined; return () => undefined; } });
}

const QUESTIONS = [
  { id: 'normal', text: 'What is our pricing for the enterprise tier?' },
  { id: 'backward', text: 'What did we discuss last time about the budget?' },
  { id: 'coding', text: 'Write a function to reverse a linked list in Python.' },
];

async function typedChat() {
  const { LLMHelper } = require(d('LLMHelper.js'));
  const calls = [];
  const helper = spiedHelper(LLMHelper, calls);
  if (MEETING) {
    const { ModesManager } = require(d('services/ModesManager.js'));
    const { buildUserSelectedSourceContract } = require(d('services/modeSourceContract.js'));
    const mm = ModesManager.getInstance();
    const mode = mm.createMode({ name: 'AB team meeting', templateType: 'team-meet' });
    mm.updateMode(mode.id, { sourceContract: buildUserSelectedSourceContract({ defaultOwner: 'transcript' }) });
    mm.setActiveMode(mode.id);
  }
  const intelligenceManager = softProxy({
    getFormattedContext: () => (MEETING ? TRANSCRIPT : ''), getLastAssistantMessage: () => null,
    addAssistantMessage: noop, logUsage: noop, addTranscript: noop,
  });
  const appState = softProxy({
    processingHelper: { getLLMHelper: () => helper },
    getIntelligenceManager: () => intelligenceManager,
    getRAGManager: () => null,
    getIsMeetingActive: () => false,
    getKnowledgeOrchestrator: () => null,
    sendModelChanged: noop,
    reconfigureSttProvider: async () => {},
  });
  const mod = require(d('ipcHandlers.js'));
  try { mod.initializeIpcHandlers(appState); } catch { /* lifecycle wiring at the end — handlers are registered */ }
  for (const ch of ['gemini-chat-stream', 'hindsight-config:set', 'hindsight-config:test']) {
    if (!handlers.has(ch)) throw new Error(`handler ${ch} not registered (${handlers.size} registered)`);
  }
  // Same Hindsight setup in every arm. First a save WITHOUT the pane's opt-in (what
  // typing a key or switching Auto-start OFF sends), then the setup save the pane sends
  // when the user typed an address. Only the flag env differs between arms.
  const { isIntelligenceFlagEnabled } = require(d('intelligence/intelligenceFlags.js'));
  const readFlags = () => ({
    memory: isIntelligenceFlagEnabled('hindsightMemory'),
    retain: isIntelligenceFlagEnabled('hindsightPostMeetingRetain'),
    liveRecall: isIntelligenceFlagEnabled('hindsightLiveRecall'),
  });
  const setNoOptIn = await handlers.get('hindsight-config:set')({}, { baseUrl: HS });
  const flagsAfterNoOptIn = readFlags();
  const set = await handlers.get('hindsight-config:set')({}, { baseUrl: HS, enableMemory: true });
  const flagsAfterSetup = readFlags();
  const test = await handlers.get('hindsight-config:test')({});
  const answerFetchStart = fetchLog.length;
  const out = [];
  for (const q of QUESTIONS) {
    const before = calls.length;
    const sent = [];
    const event = { sender: { id: 1, send: (ch, data) => sent.push(ch), isDestroyed: () => false } };
    await handlers.get('gemini-chat-stream')(event, q.text, undefined, undefined, undefined);
    out.push({ question: q.id, payloads: calls.slice(before) });
  }
  // The recall gate's inputs, so a silent control says WHICH gate closed.
  const { HindsightManager } = require(d('services/HindsightManager.js'));
  const { isBackwardLookingQuery } = require(d('intelligence/ContextRouter.js'));
  const { LongTermMemoryService } = require(d('intelligence/memory/LongTermMemoryService.js'));
  const hm = HindsightManager.getInstance();
  const cfg = hm.getHindsightConfig();
  const gates = {
    activeMode: (() => { try { const { ModesManager } = require(d('services/ModesManager.js')); const i = ModesManager.getInstance().getActiveModeInfo(); return i ? `${i.templateType}:${i.sourceContract?.sourceAuthority}` : null; } catch (e) { return String(e.message); } })(),
    configured: Boolean(cfg),
    available: hm.isAvailable(),
    backward: isBackwardLookingQuery(QUESTIONS[1].text),
    ltmEnabled: LongTermMemoryService.fromFlags({ hindsight: { ...(cfg || {}), timeoutMs: 800 } }).enabled,
  };
  return { hindsightSet: set, hindsightSetNoOptIn: setNoOptIn, flagsAfterNoOptIn, flagsAfterSetup, hindsightTest: test, turns: out, gates, answerFetchStart };
}

// ── live answer (overlay what-to-say) ────────────────────────────────────────
async function liveAnswers() {
  const { IntelligenceEngine } = require(d('IntelligenceEngine.js'));
  const { SessionTracker } = require(d('SessionTracker.js'));
  const out = [];
  for (const q of QUESTIONS) {
    const captured = [];
    const base = {
      setNegotiationCoachingHandler() {}, isUsingOllama() { return false; }, canUseLocalFallback() { return false; },
      getPromptTier() { return 'cloud'; }, getCapabilities() { return { contextWindow: 128000, supportsVision: true }; },
      fitContextForCurrentModel(x) { return x; }, rememberAnswerCall() {},
      async *streamChat(...args) { captured.push({ user: String(args[0] ?? ''), system: String(args[3] ?? '') }); yield 'Here is the answer.'; },
    };
    const helper = new Proxy(base, { get(t, k) { return k in t ? t[k] : undefined; }, has() { return true; } });
    const session = new SessionTracker();
    session.addTranscript({ speaker: 'system', text: q.text, timestamp: 1790000000000, final: true });
    const engine = new IntelligenceEngine(helper, session);
    await engine.runWhatShouldISay(q.text, 0.9, undefined, { skipCooldown: true });
    out.push({ question: q.id, payloads: captured });
  }
  return out;
}

// ── what memory is FOR (B arms, after every answer has been captured) ────────
// Saving: the retain the post-meeting save queues (MeetingPersistence's gate + call,
// run here against the flags the real save wrote). Reading: the real
// search:global-meetings handler, which recalls memories as `hindsight:` hits.
async function memoryUse() {
  const { HindsightManager } = require(d('services/HindsightManager.js'));
  const { LongTermMemoryService } = require(d('intelligence/memory/LongTermMemoryService.js'));
  const { isIntelligenceFlagEnabled } = require(d('intelligence/intelligenceFlags.js'));
  const hm = HindsightManager.getInstance();
  const cfg = hm.getHindsightConfig();
  const retainFrom = fetchLog.length;
  let retainQueued = false;
  if (isIntelligenceFlagEnabled('hindsightPostMeetingRetain') && cfg && hm.isAvailable()) {
    const ltm = LongTermMemoryService.fromFlags({ hindsight: cfg });
    if (ltm.enabled) {
      ltm.retainMeetingSummary('ab-meeting-1', 'We agreed the budget cap is 40k.', { userId: hm.localUserId(), meetingId: 'ab-meeting-1' }, 'team-meet');
      retainQueued = true;
    }
  }
  await new Promise((r) => setTimeout(r, 300)); // the retain queue drains on a microtask
  const retainFetches = fetchLog.slice(retainFrom);
  process.env.NATIVELY_GLOBAL_SEARCH_V2 = '1'; // search only; every answer is already captured
  const searchFrom = fetchLog.length;
  const search = await handlers.get('search:global-meetings')({}, { query: SEARCH_QUERY });
  const searchFetches = fetchLog.slice(searchFrom);
  // The Launcher's memory search, against a REAL saved meeting whose id the tagged
  // fact carries (the untagged one must come back unlinked).
  let meetingSaved = null;
  try {
    const { DatabaseManager } = require(d('db/DatabaseManager.js'));
    DatabaseManager.getInstance().saveMeeting({ id: AB_MEETING_ID, title: 'AB budget review', date: '2026-09-20T10:00:00.000Z', duration: '30:00', summary: 'Budget review.', detailedSummary: {}, transcript: [], usage: [] }, Date.parse('2026-09-20T10:00:00Z'), 1_800_000);
    meetingSaved = DatabaseManager.getInstance().getMeetingHeadlines([AB_MEETING_ID]);
  } catch (e) { meetingSaved = String(e && e.message || e); }
  const memFrom = fetchLog.length;
  // Absent on a build without the Launcher memory search (e.g. recording a baseline
  // from an older main) — recorded as missing, so the answer arms still compare.
  const memorySearchHandler = handlers.get('search:memories');
  const memorySearch = memorySearchHandler ? await memorySearchHandler({}, SEARCH_QUERY) : { missing: true };
  return { retainQueued, retainFetches, searchFetches, search, meetingSaved, memorySearch, memorySearchFetches: fetchLog.slice(memFrom) };
}

// A arms (memory pinned OFF): the Launcher's memory search must answer "not enabled"
// without a single network call — the flag is checked before the synthetic config.
async function memorySearchWhileOff() {
  const from = fetchLog.length;
  const handler = handlers.get('search:memories');
  const res = handler ? await handler({}, SEARCH_QUERY) : { missing: true };
  return { res, fetches: fetchLog.slice(from) };
}

(async () => {
  let result;
  try {
    const typed = await typedChat();
    const live = await liveAnswers();
    const answerFetches = fetchLog.slice(typed.answerFetchStart);
    const memory = ARM === 'B' ? await memoryUse() : null;
    const memoryOff = ARM === 'A' ? await memorySearchWhileOff() : null;
    result = { condition: COND, typed, live, answerFetches, memory, memoryOff, fetchLog: [...new Set(fetchLog)] };
  } catch (e) {
    result = { condition: COND, error: String(e && e.stack || e) };
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  realLog(`[ab] ${COND} written`);
  process.exit(0);
})();
