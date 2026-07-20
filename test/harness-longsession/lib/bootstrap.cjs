// test/harness-longsession/lib/bootstrap.cjs
//
// Shared REAL-PATH bootstrap for every Phase 2 harness script (Script A/B/C,
// the short-session smoke suite, and any future long-session driver).
//
// Extracted from `golden-trace-driver.cjs` / `short-session-smoke.cjs`
// (Phase 0's Golden Trace tooling) per loop2.md §4's instruction to REUSE that
// bootstrap wholesale rather than rebuilding it. This module is the single
// place that owns:
//   - the electron-stub (BrowserWindow/ipcMain/safeStorage/etc. no-op shim)
//   - the `better-sqlite3` → `node:sqlite` shim (BetterSqlite3Shim)
//   - a Date.now() monkeypatch for simulated-clock fast-forwarding (no real
//     sleeping across a 30-simulated-minute session)
//   - loading `.env` the same way the existing drivers do (no `dotenv` dep)
//   - constructing the REAL compiled (dist-electron) LLMHelper / SessionTracker
//     / IntelligenceEngine, wired to the REAL local natively-api backend
//     (NATIVELY_API_URL, setNativelyKey, setModel('natively') — routes to
//     MiniMax-M3 when the backend has NATIVELY_FORCE_PRIMARY_GEN=minimax)
//   - OPTIONALLY constructing the REAL DatabaseManager + RAGManager-equivalent
//     (VectorStore + EmbeddingPipeline, Gemini-backed) + ModesManager, wired
//     together exactly as electron/main.ts does, for scripts that need mode
//     reference-file retrieval (Script B) or profile ingestion (Script A).
//
// Every consumer requires this module once per process (it installs global
// module-loader hooks and monkeypatches Date.now — do not require it twice in
// the same process with different tmp userData dirs).
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(REPO_ROOT, 'dist-electron');

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

// ── Simulated clock (fast-forward, no real sleeping) ────────────────────────
let _clockOffsetMs = 0;
let _clockInstalled = false;
function installClock() {
  if (_clockInstalled) return;
  _clockInstalled = true;
  const origDateNow = Date.now.bind(Date);
  Date.now = () => origDateNow() + _clockOffsetMs;
}
function advanceClockMs(ms) { _clockOffsetMs += ms; }
function advanceClockToMinute(targetMinute, lastMinuteRef) {
  const deltaMinutes = targetMinute - lastMinuteRef.value;
  if (deltaMinutes > 0) advanceClockMs(deltaMinutes * 60 * 1000);
  lastMinuteRef.value = targetMinute;
}
function simNow() { return Date.now(); }

// ── electron stub (BrowserWindow / ipcMain / safeStorage / etc.) ───────────
let _electronStubInstalled = false;
function installElectronStub(userDataDir) {
  if (_electronStubInstalled) return;
  _electronStubInstalled = true;
  const noop = () => {};
  const stub = {
    app: {
      getPath: (name) => (name === 'userData' ? userDataDir : os.tmpdir()),
      getName: () => 'natively',
      getVersion: () => '0.0.0-longsession-harness',
      isPackaged: false,
      whenReady: () => Promise.resolve(),
      on: noop, once: noop, quit: noop,
      requestSingleInstanceLock: () => true,
      setLoginItemSettings: noop,
      getAppPath: () => REPO_ROOT,
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

// ── better-sqlite3 -> node:sqlite shim (identical to golden-trace-driver) ──
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

/**
 * Full bootstrap: env + clock + electron stub + a scratch userData dir, then
 * constructs the REAL compiled LLMHelper/SessionTracker/IntelligenceEngine
 * wired to the local natively-api backend. Optionally also constructs the
 * REAL DatabaseManager + VectorStore + EmbeddingPipeline (Gemini-backed) +
 * ModesManager + KnowledgeOrchestrator stack, wired together the same way
 * electron/main.ts does, for scripts that need profile ingestion (Script A)
 * or mode reference-file retrieval (Script B).
 *
 * @param {object} opts
 * @param {boolean} [opts.withKnowledgeStack] - wire DatabaseManager/RAGManager
 *   equivalents + KnowledgeOrchestrator + ModesManager. Default false (Golden
 *   Trace / smoke-suite parity — transcript/prompt-assembly path only).
 * @param {string} [opts.tmpPrefix] - mkdtemp prefix, defaults to 'longsession-harness-'.
 * @returns {Promise<object>} ctx (async because withKnowledgeStack awaits real
 *   Gemini embedding-pipeline initialization).
 */
async function bootstrap(opts = {}) {
  loadEnv();
  installClock();

  process.env.NATIVELY_TRACE_LONGCTX = process.env.NATIVELY_TRACE_LONGCTX || '1';
  process.env.NATIVELY_API_URL = process.env.NATIVELY_API_URL || 'http://localhost:3000';
  // Campaign 2 longsession (2026-07-20, iteration 55): calibrate-and-enable
  // the answer-relevance guard for harness runs. Empirically tuned against
  // run-047's full corpus (50 presses, 11 G3-pass / 39 G3-fail, live
  // MiniMax-M3 backend): threshold 0.15 (the existing default in
  // AnswerRelevanceChecker.ts) achieves TP=24, FP=0, F1=0.762 — perfect
  // precision on this corpus, recovering ~62% of G3-failing presses with
  // ZERO risk of regenerating a currently-passing one. The flag stays
  // off-by-default in production (SettingsManager opt-in only) but the
  // harness always exercises it so future iterations get real-world
  // accuracy data accumulated automatically.
  process.env.NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE = process.env.NATIVELY_ANSWER_RELEVANCE_GUARD_LIVE || '1';

  // Fallback auth: if no real NATIVELY_API_KEY is set (nothing in this repo's
  // .env provisions one — it's meant to come from the invoking shell), fall
  // back to the same NATIVELY_E2E local-test bypass that LLMHelper.hasNatively()
  // / generateWithNatively() / streamWithNatively() already support, and that
  // test/harness/run-benchmark.mjs already relies on for its Playwright E2E
  // runs. This only engages when NATIVELY_API_KEY is absent, so it can never
  // change behavior for an invocation that does have a real key.
  if (!process.env.NATIVELY_API_KEY && !process.env.NATIVELY_E2E) {
    process.env.NATIVELY_E2E = '1';
    process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN = process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN
      || process.env.NATIVELY_LOCAL_TEST_TOKEN
      || 'local-test';
  }

  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), opts.tmpPrefix || 'longsession-harness-'));
  installElectronStub(tmpUserData);
  require('node:sqlite');

  const { LLMHelper } = req('electron/LLMHelper.js');
  const { SessionTracker } = req('electron/SessionTracker.js');
  const { IntelligenceEngine } = req('electron/IntelligenceEngine.js');

  const llmHelper = new LLMHelper(
    undefined, false, undefined, undefined,
    process.env.GROQ_API_KEY, process.env.OPENAI_API_KEY, process.env.CLAUDE_API_KEY, undefined,
  );
  try { llmHelper.setNativelyKey(process.env.NATIVELY_API_KEY || null); } catch (e) { console.warn('[bootstrap] setNativelyKey failed', e && e.message); }
  try { llmHelper.setModel('natively'); } catch (e) { console.warn('[bootstrap] setModel(natively) failed', e && e.message); }

  const session = new SessionTracker();
  const engine = new IntelligenceEngine(llmHelper, session);
  try { engine.initializeLLMs(); } catch (e) { console.warn('[bootstrap] initializeLLMs failed', e && e.message); }

  const ctx = {
    tmpUserData,
    llmHelper,
    session,
    engine,
    advanceClockMs,
    advanceClockToMinute,
    simNow,
    req,
  };

  if (opts.withKnowledgeStack) {
    const { DatabaseManager } = req('electron/db/DatabaseManager.js');
    const dbm = DatabaseManager.getInstance();
    if (!dbm.isAvailable()) {
      throw new Error('DatabaseManager failed to initialize under the shim — cannot build knowledge stack.');
    }
    const { VectorStore } = req('electron/rag/VectorStore.js');
    const { EmbeddingPipeline } = req('electron/rag/EmbeddingPipeline.js');
    const vectorStore = new VectorStore(dbm.getDb(), dbm.getDbPath(), dbm.getExtPath());
    const embeddingPipeline = new EmbeddingPipeline(dbm.getDb(), vectorStore);

    // Real production embedding cascade: Gemini key pool (same env vars
    // electron/main.ts reads) -> Ollama -> bundled local ONNX. Gemini is
    // real, cheap (embeddings, not generation), and verified working under
    // this exact shim during harness construction.
    const geminiKeys = [];
    const addKey = (k) => { const v = (k || '').trim(); if (v && !geminiKeys.includes(v)) geminiKeys.push(v); };
    for (const n of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6', 'GOOGLE_API_KEY']) {
      addKey(process.env[n]);
    }
    await embeddingPipeline.initialize({
      openaiKey: process.env.OPENAI_API_KEY,
      geminiKey: geminiKeys[0],
      geminiKeys,
      ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    });

    const { KnowledgeDatabaseManager } = req('premium/electron/knowledge/KnowledgeDatabaseManager.js');
    const { KnowledgeOrchestrator } = req('premium/electron/knowledge/KnowledgeOrchestrator.js');
    const knowledgeDb = new KnowledgeDatabaseManager(dbm.getDb());
    const knowledgeOrchestrator = new KnowledgeOrchestrator(knowledgeDb);

    const joinContents = (contents) =>
      (Array.isArray(contents) ? contents : [contents])
        .map((c) => (typeof c === 'string' ? c : (c && c.text) || ''))
        .filter(Boolean)
        .join('\n\n');
    knowledgeOrchestrator.setGenerateContentFn(async (contents) => llmHelper.generateContentStructured(joinContents(contents)));
    knowledgeOrchestrator.setEmbedFn(async (text) => (await embeddingPipeline.getEmbeddingWithFallback(text)).embedding);
    if (typeof knowledgeOrchestrator.setEmbedQueryFn === 'function') {
      knowledgeOrchestrator.setEmbedQueryFn(async (text) => embeddingPipeline.getEmbeddingForQuery(text));
    }
    llmHelper.setKnowledgeOrchestrator(knowledgeOrchestrator);

    const { ModesManager } = req('electron/services/ModesManager.js');
    const modesManager = ModesManager.getInstance();
    modesManager.setSharedEmbeddingPipeline(embeddingPipeline);
    modesManager.ensureSeeded();

    // Campaign 2 longsession (2026-07-19, run-032/033/034/045 forensics): esbuild's
    // build-electron.js bundles EVERY .ts file as its OWN independent entry
    // point (bundle:true with one entryPoint per source file, no code-
    // splitting — splitting requires format:'esm' and this build targets
    // format:'cjs'). That means `IntelligenceEngine.js` (required above) and
    // `ModesManager.js` (required here) each carry their OWN separately-
    // bundled copy of the ModesManager class — including its own private
    // `static instance` singleton field. `engine.whatToAnswerLLM` internally
    // calls `ModesManager.getInstance()` from ITS bundle's copy, which is a
    // COMPLETELY DIFFERENT object than the `modesManager` configured just
    // above (different in-memory state: no shared embedding pipeline, no
    // seeded mode, no indexed reference files — even though the underlying
    // SQLite file IS shared, since that's real disk I/O, not in-memory
    // singleton state). Live-confirmed via a temporary stack-trace
    // instrumentation in DatabaseManager.getInstance() (added, tested,
    // reverted): the SAME class shows up as constructed 5 TIMES within one
    // script's single process, each from a different bundled file's private
    // copy — confirmed via `grep -c "class _DatabaseManager"` across
    // dist-electron/electron/ showing 31 separate files each with their own
    // embedded copy (18 for ModesManager).
    //
    // In the REAL packaged app this is harmless — Electron only ever loads
    // ONE entry point (dist-electron/electron/main.js per package.json
    // "main"), so every transitive `require()` esbuild can statically
    // resolve gets inlined into THAT one bundle and shares one consistent
    // set of class definitions internally (confirmed: main.js's own
    // `ModesManager.getInstance()` call sites all route through esbuild's
    // shared `init_ModesManager()` lazy-init inside the SAME output file).
    // This bug is a property of the test harness's practice of `req()`-ing
    // multiple separately-bundled top-level .js files and expecting them to
    // share singleton state, which esbuild's per-entry-point architecture
    // does not provide.
    //
    // Fix: force `engine`'s internally-bundled WhatToAnswerLLM to use THIS
    // (correctly seeded + embedding-pipeline-injected) modesManager instance
    // instead of falling back to its own bundle's un-seeded
    // `ModesManager.getInstance()` copy. `WhatToAnswerLLM.modesManager` is a
    // TypeScript `private` field with no runtime enforcement, and
    // `getModesManager()` only calls `ModesManager.getInstance()` when this
    // field is falsy (electron/llm/WhatToAnswerLLM.ts:105-111) — so setting
    // it here is exactly the officially-supported injection seam (the
    // constructor already accepts an optional `modesManager` param for this
    // exact purpose; we can't use the constructor since `engine` already
    // built its own `WhatToAnswerLLM` internally in `initializeLLMs()`, so
    // we assign the field directly instead).
    //
    // NOTE (iteration 45): a first attempt at this exact fix appeared to
    // cause every script-b press to return a null answer with zero
    // NativelyAPI calls attempted. Re-testing after a full revert showed the
    // null-answer regression PERSISTED even without this fix — it was
    // actually caused by a concurrent session's uncommitted, in-progress
    // edits to IntelligenceEngine.ts (a `const` vs `var` scoping bug in
    // their own new code, since fixed and committed in their own iter3).
    // This fix was never the actual cause; re-applying it now that the
    // workspace is clean (verified via `git status` showing both files
    // committed).
    if (engine.whatToAnswerLLM) {
      engine.whatToAnswerLLM.modesManager = modesManager;
    }

    ctx.dbm = dbm;
    ctx.vectorStore = vectorStore;
    ctx.embeddingPipeline = embeddingPipeline;
    ctx.knowledgeOrchestrator = knowledgeOrchestrator;
    ctx.modesManager = modesManager;
  }

  return ctx;
}

/**
 * Capture console.log lines tagged `[TRACE:LONGCTX]` into an array, restoring
 * the original console.log via the returned `restore()`. Mirrors the pattern
 * used by golden-trace-driver.cjs so every script gets the same per-press
 * trace-line capture (question_extracted / prompt_assembled / etc.) with a
 * resettable window.
 */
function installTraceCapture() {
  const capturedTraceLines = [];
  const origConsoleLog = console.log;
  console.log = (...args) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (line.includes('[TRACE:LONGCTX]')) capturedTraceLines.push({ t: simNow(), line });
    origConsoleLog(...args);
  };
  return {
    lines: capturedTraceLines,
    reset() { capturedTraceLines.length = 0; },
    restore() { console.log = origConsoleLog; },
    log: origConsoleLog,
  };
}

function toRole(channel) {
  // SessionTracker.mapSpeakerToRole: 'user' -> user, 'assistant' -> assistant, else interviewer.
  return channel === 'user' ? 'user' : 'interviewer';
}

/** Feed one timeline segment into the REAL rolling transcript store, same path STT uses. */
function feedSegment(session, entry) {
  session.addTranscript({
    speaker: toRole(entry.channel),
    text: entry.text,
    timestamp: simNow(),
    final: true,
    confidence: 0.95,
  });
}

/**
 * Invoke the REAL answer-button handler and time first-token/completion
 * latency. Latency is measured on REAL monotonic wall time (process.hrtime),
 * NOT the simulated Date.now() clock — Date.now() is monkeypatched to
 * fast-forward simulated session minutes and never reflects how long the
 * REAL network call to the REAL backend actually took (Gate G8 needs the
 * latter).
 */
async function pressAnswerButton(engine, traceCapture, opts = {}) {
  traceCapture.reset();
  const hrStart = process.hrtime.bigint();
  let firstTokenAtMs = null;
  const onToken = () => {
    if (firstTokenAtMs === null) {
      firstTokenAtMs = Number(process.hrtime.bigint() - hrStart) / 1e6;
    }
  };
  // suggested_answer_token fires per-chunk on the real engine; listen once per
  // press so we can compute a first-token latency in addition to completion.
  const handler = () => onToken();
  engine.on('suggested_answer_token', handler);

  let answer = null;
  let threw = null;
  try {
    answer = await engine.runWhatShouldISay(opts.question, opts.confidence ?? 0.8, undefined, {
      skipCooldown: true,
      forceFresh: true,
      ...opts.engineOptions,
    });
  } catch (e) {
    threw = e && (e.stack || e.message || String(e));
  } finally {
    engine.off('suggested_answer_token', handler);
  }
  const latencyRealMs = Number(process.hrtime.bigint() - hrStart) / 1e6;

  return {
    answer,
    threw,
    latencyRealMs,
    firstTokenRealMs: firstTokenAtMs,
    traceLines: [...traceCapture.lines],
  };
}

module.exports = {
  REPO_ROOT,
  DIST,
  loadEnv,
  installClock,
  advanceClockMs,
  advanceClockToMinute,
  simNow,
  installElectronStub,
  BetterSqlite3Shim,
  req,
  bootstrap,
  installTraceCapture,
  toRole,
  feedSegment,
  pressAnswerButton,
};
