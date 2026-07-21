// test/harness-longsession/golden-trace-driver.cjs
//
// Campaign 2, Phase 0 — the Long-Context Golden Trace (loop2.md §2.1).
//
// Replays a scripted ~25-minute interview transcript into the REAL
// SessionTracker + IntelligenceEngine + WhatToAnswerLLM live-answer path
// (compiled dist-electron modules — same code the app runs), fast-forwarding
// simulated time via Date.now() monkeypatch so we don't sleep 25 real minutes.
// At simulated minutes 2, 10, 18, 24 we trigger the exact answer-button path
// (IntelligenceEngine.runWhatShouldISay) on a real interviewer question and
// dump the full prompt composition to traces2/golden-longctx-N.txt.
//
// Reuses the proven harness.cjs bootstrap pattern (electron stub, node:sqlite
// shim, compiled-module loader) so this drives the REAL backend (natively-api
// on localhost:3000, NATIVELY_FORCE_PRIMARY_GEN=minimax) — R4.
//
// Usage:
//   NATIVELY_TRACE_LONGCTX=1 NATIVELY_API_URL=http://localhost:3000 \
//     node test/harness-longsession/golden-trace-driver.cjs

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(REPO_ROOT, 'dist-electron');
const TRACES_DIR = path.join(REPO_ROOT, 'traces2');

// ── 0. env / clock setup ─────────────────────────────────────────────────
process.env.NATIVELY_TRACE_LONGCTX = '1';
process.env.NATIVELY_API_URL = process.env.NATIVELY_API_URL || 'http://localhost:3000';

function loadEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

// Clock abstraction (3AM resolution rule §7): fast-forward simulated time by
// monkeypatching Date.now globally for this process. SessionTracker's
// getContext()/evictOldEntries() use Date.now() directly, so shifting the
// process clock is the only way to simulate 25 minutes without sleeping.
let _clockOffsetMs = 0;
const _origDateNow = Date.now.bind(Date);
Date.now = () => _origDateNow() + _clockOffsetMs;
function advanceClockMs(ms) { _clockOffsetMs += ms; }
function simNow() { return Date.now(); }

// ── 1. electron stub + sqlite shim (reused pattern from benchmarks harness) ─
let _electronStubInstalled = false;
function installElectronStub(userDataDir) {
  if (_electronStubInstalled) return;
  _electronStubInstalled = true;
  const noop = () => {};
  const stub = {
    app: {
      getPath: (name) => (name === 'userData' ? userDataDir : os.tmpdir()),
      getName: () => 'natively',
      getVersion: () => '0.0.0-longsession-trace',
      isPackaged: false,
      whenReady: () => Promise.resolve(),
      on: noop, once: noop, quit: noop,
      requestSingleInstanceLock: () => true,
      setLoginItemSettings: noop,
    },
    BrowserWindow: class { static getAllWindows() { return []; } constructor() {} },
    ipcMain: { on: noop, once: noop, handle: noop, removeHandler: noop, emit: noop },
    ipcRenderer: { on: noop, send: noop, invoke: () => Promise.resolve() },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
    nativeTheme: { shouldUseDarkColors: false, on: noop },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 900 } }), getAllDisplays: () => [] },
    shell: { openExternal: () => Promise.resolve() },
    dialog: {}, Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({}) },
    Tray: class {}, globalShortcut: { register: noop, unregister: noop, unregisterAll: noop },
    desktopCapturer: { getSources: () => Promise.resolve([]) },
    systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: () => Promise.resolve(true) },
    powerMonitor: { on: noop },
    session: { defaultSession: { webRequest: { onHeadersReceived: noop } } },
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return stub;
    if (request === 'better-sqlite3') return BetterSqlite3Shim;
    return origLoad.apply(this, arguments);
  };
}

function rowBlobsToBuffer(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Uint8Array && !Buffer.isBuffer(v)) row[k] = Buffer.from(v);
  }
  return row;
}
function makeSqliteShim(filename) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename);
  class StmtShim {
    constructor(st) { this.st = st; }
    get(...p) { return rowBlobsToBuffer(this.st.get(...p)); }
    all(...p) { const rows = this.st.all(...p); return Array.isArray(rows) ? rows.map(rowBlobsToBuffer) : rows; }
    run(...p) { return this.st.run(...p); }
    pluck() { return this; }
    raw() { return this; }
    iterate(...p) { return (this.st.all(...p) || []).map(rowBlobsToBuffer)[Symbol.iterator](); }
  }
  return {
    _db: db,
    prepare(sql) { return new StmtShim(db.prepare(sql)); },
    exec(sql) { db.exec(sql); return this; },
    pragma(stmt) { try { db.exec('PRAGMA ' + stmt + ';'); } catch {} return undefined; },
    transaction(fn) {
      return (...args) => {
        db.exec('BEGIN');
        try { const r = fn(...args); db.exec('COMMIT'); return r; }
        catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
      };
    },
    function() {},
    close() { try { db.close(); } catch {} },
  };
}
function BetterSqlite3Shim(filename) {
  if (!(this instanceof BetterSqlite3Shim)) return new BetterSqlite3Shim(filename);
  const impl = makeSqliteShim(filename);
  this.prepare = (sql) => impl.prepare(sql);
  this.exec = (sql) => { impl.exec(sql); return this; };
  this.pragma = (stmt) => impl.pragma(stmt);
  this.transaction = (fn) => impl.transaction(fn);
  this.function = () => this;
  this.loadExtension = () => this;
  this.close = () => impl.close();
  this.open = true;
  this.name = filename;
}

function req(rel) {
  const p = path.join(DIST, rel);
  if (!fs.existsSync(p)) throw new Error(`Compiled module missing: ${p}. Run \`npm run build:electron\` first.`);
  return require(p);
}

// ── 2. bootstrap a scratch userData + DB (no live-app mutation) ────────────
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'longsession-trace-'));
installElectronStub(tmpUserData);

const dbPath = path.join(tmpUserData, 'natively.db');
// Touch an empty DB file; DatabaseSync creates the schema-less file, and the
// modules under test (SessionTracker/IntelligenceEngine/WhatToAnswerLLM) do
// not require the knowledge DB schema for this trace — it exercises the
// transcript/prompt-assembly path, not doc-grounded retrieval.
require('node:sqlite');

const { LLMHelper } = req('electron/LLMHelper.js');
const { SessionTracker } = req('electron/SessionTracker.js');
const { IntelligenceEngine } = req('electron/IntelligenceEngine.js');

const llmHelper = new LLMHelper(
  undefined, false, undefined, undefined,
  process.env.GROQ_API_KEY, process.env.OPENAI_API_KEY, process.env.CLAUDE_API_KEY, undefined,
);
// Route through the real natively-api backend (NATIVELY_API_URL env, set
// above) using the project's own Natively key — this is the same "natively"
// provider the shipped app uses when the user hasn't configured direct
// provider keys, and the backend on localhost:3000 is running with
// NATIVELY_FORCE_PRIMARY_GEN=minimax (confirmed in server.js) so this
// exercises the real MiniMax M3 path end-to-end (R4).
try { llmHelper.setNativelyKey(process.env.NATIVELY_API_KEY || null); } catch (e) { console.warn('[driver] setNativelyKey failed', e && e.message); }
try { llmHelper.setModel('natively'); } catch (e) { console.warn('[driver] setModel(natively) failed', e && e.message); }

const session = new SessionTracker();
const engine = new IntelligenceEngine(llmHelper, session);
try { engine.initializeLLMs(); } catch (e) { console.warn('[driver] initializeLLMs failed', e && e.message); }

// ── 3. capture console.log lines tagged [TRACE:LONGCTX] ────────────────────
const capturedTraceLines = [];
const origConsoleLog = console.log;
console.log = (...args) => {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  if (line.includes('[TRACE:LONGCTX]')) capturedTraceLines.push({ t: simNow(), line });
  origConsoleLog(...args);
};

// ── 4. scripted 25-minute interview (software-engineer, resume-free —
//      Phase 0 only needs REAL transcript/prompt-assembly behavior, not
//      doc-grounded retrieval correctness) ─────────────────────────────────
// Each entry: { atMinute, channel: 'interviewer'|'user', text }
// Minute 0 = session start. Filler turns simulate realistic meeting noise
// between the four probe questions at minutes 2, 10, 18, 24.
const SCRIPT = [
  { atMinute: 0.1, channel: 'interviewer', text: 'Hi, thanks for joining today. Can you hear me okay?' },
  { atMinute: 0.3, channel: 'user', text: 'Yes, I can hear you fine, thanks.' },
  { atMinute: 0.5, channel: 'interviewer', text: 'Great. Let\'s get started. Can you walk me through your most recent project and what you built?' },
  { atMinute: 1.0, channel: 'user', text: 'Sure, I recently built a real-time data pipeline using Kafka and Flink for stream processing at my last role.' },
  { atMinute: 1.5, channel: 'interviewer', text: 'What specific challenges did you run into with the Kafka pipeline, and how did you scale it?' },
  // PROBE 1 — minute 2
  { atMinute: 2.0, channel: 'interviewer', text: 'Tell me about a time you had to debug a really difficult production issue.' },

  { atMinute: 2.5, channel: 'user', text: 'One time we had a memory leak in a long-running consumer process that took us three days to trace.' },
  { atMinute: 3.0, channel: 'interviewer', text: 'How did you eventually find the root cause?' },
  { atMinute: 3.5, channel: 'user', text: 'We used heap snapshots and eventually found an unbounded cache that never evicted old entries.' },
  { atMinute: 4.0, channel: 'interviewer', text: 'That makes sense. Let\'s switch topics — what is your experience with distributed systems and consensus algorithms?' },
  { atMinute: 4.5, channel: 'user', text: 'I have worked with Raft in the context of a custom key-value store, and I am familiar with Paxos conceptually.' },
  { atMinute: 5.0, channel: 'interviewer', text: 'Can you explain the difference between strong and eventual consistency?' },
  { atMinute: 5.5, channel: 'user', text: 'Strong consistency guarantees a linearizable view of the data, while eventual consistency allows replicas to briefly diverge but converge over time.' },
  { atMinute: 6.0, channel: 'interviewer', text: 'Good. Now, small talk — did you have any trouble finding parking today?' },
  { atMinute: 6.3, channel: 'user', text: 'No, it was easy, thanks for asking.' },
  { atMinute: 6.6, channel: 'interviewer', text: 'Great. Let\'s talk about your experience with microservices architecture.' },
  { atMinute: 7.0, channel: 'user', text: 'I designed and split a monolith into about a dozen services over the course of a year.' },
  { atMinute: 7.5, channel: 'interviewer', text: 'What was the hardest part of that migration?' },
  { atMinute: 8.0, channel: 'user', text: 'Probably managing data consistency across service boundaries during the strangler-fig rollout.' },
  { atMinute: 8.5, channel: 'interviewer', text: 'Interesting. Let\'s talk about databases now — what is your experience with PostgreSQL performance tuning?' },
  { atMinute: 9.0, channel: 'user', text: 'I have optimized slow queries using EXPLAIN ANALYZE and added targeted indexes, and tuned autovacuum settings for high-write tables.' },
  { atMinute: 9.5, channel: 'interviewer', text: 'Good background. Now a slightly different question.' },
  // PROBE 2 — minute 10
  { atMinute: 10.0, channel: 'interviewer', text: 'What are your salary expectations for this role?' },

  { atMinute: 10.5, channel: 'user', text: 'I am looking for something in the range of one hundred sixty to one hundred eighty thousand, depending on the full package.' },
  { atMinute: 11.0, channel: 'interviewer', text: 'Understood, thanks for sharing that. Let\'s go back to technical topics — how do you approach system design interviews?' },
  { atMinute: 11.5, channel: 'user', text: 'I start by clarifying requirements and scale, then sketch a high-level architecture before diving into components.' },
  { atMinute: 12.0, channel: 'interviewer', text: 'Can you design a URL shortener at a high level?' },
  { atMinute: 12.5, channel: 'user', text: 'Sure — a hash-based ID generator, a key-value store for the mapping, and a cache layer in front for hot reads.' },
  { atMinute: 13.0, channel: 'interviewer', text: 'What would you do differently at massive scale, say a billion requests a day?' },
  { atMinute: 13.5, channel: 'user', text: 'I would shard the key-value store, add read replicas, and put a CDN in front of the redirect endpoint.' },
  { atMinute: 14.0, channel: 'interviewer', text: 'Good. Let\'s talk about your leadership experience — have you mentored junior engineers?' },
  { atMinute: 14.5, channel: 'user', text: 'Yes, I mentored two junior engineers over the past year, doing weekly pairing sessions and code review.' },
  { atMinute: 15.0, channel: 'interviewer', text: 'What is a time you disagreed with a technical decision your team made?' },
  { atMinute: 15.5, channel: 'user', text: 'We disagreed on whether to adopt GraphQL, and I eventually built a small prototype to demonstrate the tradeoffs.' },
  { atMinute: 16.0, channel: 'interviewer', text: 'How did that resolve?' },
  { atMinute: 16.5, channel: 'user', text: 'The team agreed to adopt GraphQL for the public API but keep REST internally.' },
  { atMinute: 17.0, channel: 'interviewer', text: 'Let\'s talk about testing practices — what is your philosophy on unit versus integration tests?' },
  { atMinute: 17.5, channel: 'user', text: 'I favor a testing pyramid — many fast unit tests, fewer integration tests, and a small number of end-to-end tests.' },
  { atMinute: 17.8, channel: 'interviewer', text: 'Good. One more question on this topic before we move on.' },
  // PROBE 3 — minute 18
  { atMinute: 18.0, channel: 'interviewer', text: 'Going back to the memory leak you mentioned earlier — how long did it take your team to ship the fix after finding the root cause?' },

  { atMinute: 18.5, channel: 'user', text: 'Once we found the unbounded cache, the fix itself only took about half a day to write and deploy.' },
  { atMinute: 19.0, channel: 'interviewer', text: 'Good. Let\'s discuss cloud infrastructure — what is your experience with Kubernetes?' },
  { atMinute: 19.5, channel: 'user', text: 'I have managed production clusters, written custom operators, and set up horizontal pod autoscaling.' },
  { atMinute: 20.0, channel: 'interviewer', text: 'What is the difference between a StatefulSet and a Deployment?' },
  { atMinute: 20.5, channel: 'user', text: 'A StatefulSet provides stable network identity and ordered, persistent storage for each pod, while a Deployment treats pods as interchangeable.' },
  { atMinute: 21.0, channel: 'interviewer', text: 'Good. How do you approach incident response and on-call rotations?' },
  { atMinute: 21.5, channel: 'user', text: 'We follow a blameless postmortem process and rotate on-call weekly across a team of six.' },
  { atMinute: 22.0, channel: 'interviewer', text: 'What monitoring and observability tools have you used?' },
  { atMinute: 22.5, channel: 'user', text: 'Primarily Prometheus and Grafana for metrics, and Jaeger for distributed tracing.' },
  { atMinute: 23.0, channel: 'interviewer', text: 'Good. Let\'s wrap up with a broader question.' },
  { atMinute: 23.3, channel: 'user', text: 'Sounds good.' },
  { atMinute: 23.6, channel: 'interviewer', text: 'Before we finish, one last thing.' },
  // PROBE 4 — minute 24
  { atMinute: 24.0, channel: 'interviewer', text: 'Why do you want to work here specifically, and what makes you a good fit for this role?' },
];

const PROBE_MINUTES = [2.0, 10.0, 18.0, 24.0];

function toRole(channel) {
  // SessionTracker.mapSpeakerToRole: 'user' -> user, 'assistant' -> assistant, else interviewer.
  return channel === 'user' ? 'user' : 'interviewer';
}

async function feedSegment(entry) {
  session.addTranscript({
    speaker: toRole(entry.channel),
    text: entry.text,
    timestamp: simNow(),
    final: true,
    confidence: 0.95,
  });
}

async function pressAnswerButton(probeMinute) {
  capturedTraceLines.length = 0; // reset capture window for this press
  const t0 = simNow();
  let answer = null;
  let threw = null;
  try {
    answer = await engine.runWhatShouldISay(undefined, 0.8, undefined, {
      skipCooldown: true,
      forceFresh: true,
    });
  } catch (e) {
    threw = e && (e.stack || e.message || String(e));
  }
  const t1 = simNow();
  return { probeMinute, answer, threw, latencyMs: t1 - t0, traceLines: [...capturedTraceLines] };
}

function fmtDump(result) {
  const L = [];
  const W = (s = '') => L.push(s);
  W(`=== GOLDEN TRACE — minute ${result.probeMinute} ===`);
  W(`Simulated latency (clock-advance only, not real wall time): ${result.latencyMs}ms`);
  W('');
  const qLine = result.traceLines.find(l => l.line.includes('question_extracted'));
  const pLine = result.traceLines.find(l => l.line.includes('prompt_assembled'));
  if (qLine) {
    W('--- [TRACE:LONGCTX] question_extracted ---');
    W(qLine.line);
    try {
      const parsed = JSON.parse(qLine.line.replace('[TRACE:LONGCTX] question_extracted ', ''));
      W('');
      W(`  contextItemsCount:      ${parsed.contextItemsCount}`);
      W(`  transcriptTurnsCount:   ${parsed.transcriptTurnsCount}`);
      W(`  rawTranscriptChars:     ${parsed.rawTranscriptChars}`);
      W(`  preparedTranscriptChars:${parsed.preparedTranscriptChars}`);
      W(`  latestQuestion:         "${parsed.latestQuestion}"`);
      W(`  questionType:           ${parsed.questionType}`);
      W(`  confidence:             ${parsed.confidence}`);
    } catch { /* dump raw only */ }
  } else {
    W('--- [TRACE:LONGCTX] question_extracted: NOT FOUND (extraction may have early-returned) ---');
  }
  W('');
  if (pLine) {
    W('--- [TRACE:LONGCTX] prompt_assembled ---');
    W(pLine.line);
    try {
      const parsed = JSON.parse(pLine.line.replace('[TRACE:LONGCTX] prompt_assembled ', ''));
      W('');
      W(`  systemPromptChars:      ${parsed.systemPromptChars} (~${parsed.systemPromptTokensEst} tok)`);
      W(`  userMessageChars:       ${parsed.userMessageChars} (~${parsed.userMessageTokensEst} tok)`);
      W(`  transcriptForPromptChars: ${parsed.transcriptForPromptChars}`);
      W(`  workingTranscriptChars:   ${parsed.workingTranscriptChars}`);
      W(`  cleanedTranscriptChars:   ${parsed.cleanedTranscriptChars}`);
      W(`  assemblerBudget:          ${parsed.assemblerBudget}`);
      W(`  totalTokensUsedByAssembler: ${parsed.totalTokensUsedByAssembler}`);
      W(`  maxContextTokens:         ${parsed.maxContextTokens}`);
      W(`  modelId:                  ${parsed.modelId}`);
      W(`  answerPlanQuestion:              "${parsed.answerPlanQuestion}"`);
      W(`  answerPlanQuestionSurvivesInPrompt: ${parsed.answerPlanQuestionSurvivesInPrompt}`);
      W('');
      W('  blockTypes:');
      for (const b of (parsed.blockTypes || [])) W(`    - ${b.type} (${b.trustLevel}): ${b.chars} chars`);
      W('');
      W('  userMessageTail (last 800 chars sent to provider):');
      W('  ---');
      W(parsed.userMessageTail);
      W('  ---');
    } catch { /* dump raw only */ }
  } else {
    W('--- [TRACE:LONGCTX] prompt_assembled: NOT FOUND (prompt assembly may not have been reached) ---');
  }
  W('');
  W('--- Raw model answer ---');
  W(result.answer === null ? '(null — no answer emitted)' : result.answer);
  if (result.threw) {
    W('');
    W('--- THREW ---');
    W(result.threw);
  }
  W('');
  W('--- ALL captured [TRACE:LONGCTX] lines for this press ---');
  for (const l of result.traceLines) W(l.line);
  return L.join('\n') + '\n';
}

// ── 5. drive the script, fast-forwarding the clock, pressing at probes ─────
async function main() {
  fs.mkdirSync(TRACES_DIR, { recursive: true });
  console.log(`[driver] backend=${process.env.NATIVELY_API_URL} model=natively(minimax-pinned) tmpUserData=${tmpUserData}`);

  let lastMinute = 0;
  let probeIdx = 0;
  const results = [];

  for (const entry of SCRIPT) {
    const deltaMinutes = entry.atMinute - lastMinute;
    if (deltaMinutes > 0) advanceClockMs(deltaMinutes * 60 * 1000);
    lastMinute = entry.atMinute;
    await feedSegment(entry);

    while (probeIdx < PROBE_MINUTES.length && entry.atMinute >= PROBE_MINUTES[probeIdx]) {
      const probeMinute = PROBE_MINUTES[probeIdx];
      origConsoleLog(`\n[driver] === PRESSING ANSWER BUTTON at simulated minute ${probeMinute} ===`);
      const result = await pressAnswerButton(probeMinute);
      results.push(result);
      const dump = fmtDump(result);
      const outPath = path.join(TRACES_DIR, `golden-longctx-${probeMinute}.txt`);
      fs.writeFileSync(outPath, dump);
      origConsoleLog(`[driver] wrote ${outPath}`);
      origConsoleLog(`[driver] answer preview: ${(result.answer || '(null)').slice(0, 200)}`);
      probeIdx++;
    }
  }

  // ── 6. minute-2 vs minute-24 diff summary ─────────────────────────────
  const m2 = results.find(r => r.probeMinute === 2.0);
  const m24 = results.find(r => r.probeMinute === 24.0);
  const diffLines = [];
  const DW = (s = '') => diffLines.push(s);
  DW('=== MINUTE-2 vs MINUTE-24 DIFF SUMMARY ===');
  DW();
  if (m2 && m24) {
    const parse = (r, tag) => {
      const l = r.traceLines.find(x => x.line.includes(tag));
      if (!l) return null;
      try { return JSON.parse(l.line.replace(`[TRACE:LONGCTX] ${tag} `, '')); } catch { return null; }
    };
    const q2 = parse(m2, 'question_extracted');
    const q24 = parse(m24, 'question_extracted');
    const p2 = parse(m2, 'prompt_assembled');
    const p24 = parse(m24, 'prompt_assembled');
    DW(`contextItemsCount:       minute2=${q2?.contextItemsCount ?? 'N/A'}   minute24=${q24?.contextItemsCount ?? 'N/A'}`);
    DW(`extracted question:      minute2="${q2?.latestQuestion ?? 'N/A'}"`);
    DW(`                         minute24="${q24?.latestQuestion ?? 'N/A'}"`);
    DW(`question confidence:     minute2=${q2?.confidence ?? 'N/A'}   minute24=${q24?.confidence ?? 'N/A'}`);
    DW(`userMessageChars:        minute2=${p2?.userMessageChars ?? 'N/A'}   minute24=${p24?.userMessageChars ?? 'N/A'}`);
    DW(`systemPromptChars:       minute2=${p2?.systemPromptChars ?? 'N/A'}   minute24=${p24?.systemPromptChars ?? 'N/A'}`);
    DW(`totalTokensUsedByAssembler: minute2=${p2?.totalTokensUsedByAssembler ?? 'N/A'}   minute24=${p24?.totalTokensUsedByAssembler ?? 'N/A'}`);
    DW(`answerPlanQuestionSurvivesInPrompt: minute2=${p2?.answerPlanQuestionSurvivesInPrompt ?? 'N/A'}   minute24=${p24?.answerPlanQuestionSurvivesInPrompt ?? 'N/A'}`);
    DW();
    DW(`answer (minute2):  ${(m2.answer || '(null)').slice(0, 300)}`);
    DW(`answer (minute24): ${(m24.answer || '(null)').slice(0, 300)}`);
  } else {
    DW('Could not compute diff — missing minute-2 or minute-24 result.');
  }
  const diffPath = path.join(TRACES_DIR, 'golden-longctx-diff-summary.txt');
  fs.writeFileSync(diffPath, diffLines.join('\n') + '\n');
  origConsoleLog(`\n[driver] wrote ${diffPath}`);
  origConsoleLog(diffLines.join('\n'));

  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

main().catch(e => {
  console.log = origConsoleLog;
  console.error('[driver] FATAL', e && e.stack || e);
  process.exit(1);
});
