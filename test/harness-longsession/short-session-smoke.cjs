// test/harness-longsession/short-session-smoke.cjs
//
// Campaign 2, R8 — "DO NOT DEGRADE SHORT SESSIONS." A minimal 5-minute
// short-session smoke suite that must stay GREEN after every Phase 1 fix. This
// is intentionally small and fast (a handful of presses in the first 5
// simulated minutes) — it is NOT the full Phase 2 harness (that's a separate,
// larger 30-minute 3-script benchmark built later). Its only job is to catch a
// long-session fix that accidentally regresses the common, already-working
// short-session case.
//
// Reuses the same real-path bootstrap as golden-trace-driver.cjs (electron
// stub, compiled dist-electron modules, real natively-api backend on
// localhost:3000, MiniMax-M3 via NATIVELY_FORCE_PRIMARY_GEN=minimax).
//
// Exit code 0 = smoke PASSED (all checks green). Exit code 1 = smoke FAILED
// (prints the specific failing check).
//
// Usage:
//   node test/harness-longsession/short-session-smoke.cjs

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(REPO_ROOT, 'dist-electron');

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

let _clockOffsetMs = 0;
const _origDateNow = Date.now.bind(Date);
Date.now = () => _origDateNow() + _clockOffsetMs;
function advanceClockMs(ms) { _clockOffsetMs += ms; }

let _electronStubInstalled = false;
function installElectronStub(userDataDir) {
  if (_electronStubInstalled) return;
  _electronStubInstalled = true;
  const noop = () => {};
  const stub = {
    app: {
      getPath: (name) => (name === 'userData' ? userDataDir : os.tmpdir()),
      getName: () => 'natively',
      getVersion: () => '0.0.0-smoke',
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

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'shortsmoke-'));
installElectronStub(tmpUserData);
require('node:sqlite');

const { LLMHelper } = req('electron/LLMHelper.js');
const { SessionTracker } = req('electron/SessionTracker.js');
const { IntelligenceEngine } = req('electron/IntelligenceEngine.js');

const llmHelper = new LLMHelper(undefined, false, undefined, undefined, undefined, undefined, undefined, undefined);
try { llmHelper.setNativelyKey(process.env.NATIVELY_API_KEY || null); } catch {}
try { llmHelper.setModel('natively'); } catch {}
const session = new SessionTracker();
const engine = new IntelligenceEngine(llmHelper, session);
try { engine.initializeLLMs(); } catch {}

const capturedTraceLines = [];
const origConsoleLog = console.log;
console.log = (...args) => {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  if (line.includes('[TRACE:LONGCTX]')) capturedTraceLines.push({ line });
  origConsoleLog(...args);
};

// 5-minute short session, 2 presses (typical short-interview usage).
const SCRIPT = [
  { atMinute: 0.1, channel: 'interviewer', text: 'Hi, thanks for joining. Can you hear me okay?' },
  { atMinute: 0.3, channel: 'user', text: 'Yes, I can hear you fine.' },
  { atMinute: 0.5, channel: 'interviewer', text: 'Can you walk me through your most recent project?' },
  { atMinute: 1.0, channel: 'user', text: 'I built a real-time data pipeline using Kafka and Flink.' },
  // PROBE 1 — minute 1.5
  { atMinute: 1.5, channel: 'interviewer', text: 'What was the hardest technical challenge in that project?' },

  { atMinute: 2.0, channel: 'user', text: 'Scaling the consumer group without introducing rebalance storms was the hardest part.' },
  { atMinute: 2.5, channel: 'interviewer', text: 'How did you resolve that?' },
  { atMinute: 3.0, channel: 'user', text: 'We tuned the session timeout and moved to cooperative sticky assignment.' },
  { atMinute: 3.5, channel: 'interviewer', text: 'Good. Let\'s talk about your experience with testing.' },
  { atMinute: 4.0, channel: 'user', text: 'I favor a testing pyramid with heavy unit test coverage.' },
  // PROBE 2 — minute 4.5
  { atMinute: 4.5, channel: 'interviewer', text: 'Why do you want to work here specifically?' },
];
const PROBE_MINUTES = [1.5, 4.5];

function toRole(channel) { return channel === 'user' ? 'user' : 'interviewer'; }

async function feedSegment(entry) {
  session.addTranscript({ speaker: toRole(entry.channel), text: entry.text, timestamp: Date.now(), final: true, confidence: 0.95 });
}

async function pressAnswerButton() {
  capturedTraceLines.length = 0;
  let answer = null;
  let threw = null;
  try {
    answer = await engine.runWhatShouldISay(undefined, 0.8, undefined, { skipCooldown: true, forceFresh: true });
  } catch (e) {
    threw = e && (e.stack || e.message || String(e));
  }
  return { answer, threw, traceLines: [...capturedTraceLines] };
}

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  origConsoleLog(`[smoke] ${cond ? 'PASS' : 'FAIL'}: ${name}`);
}

async function main() {
  origConsoleLog(`[smoke] backend=${process.env.NATIVELY_API_URL} tmpUserData=${tmpUserData}`);
  let lastMinute = 0;
  let probeIdx = 0;
  const results = [];

  for (const entry of SCRIPT) {
    const deltaMinutes = entry.atMinute - lastMinute;
    if (deltaMinutes > 0) advanceClockMs(deltaMinutes * 60 * 1000);
    lastMinute = entry.atMinute;
    await feedSegment(entry);

    while (probeIdx < PROBE_MINUTES.length && entry.atMinute >= PROBE_MINUTES[probeIdx]) {
      const result = await pressAnswerButton();
      results.push(result);
      probeIdx++;
    }
  }

  // Checks: no throws, no null answers, question extraction present + reasonable
  // confidence, question survives into the assembled prompt (R8 baseline).
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const probeMin = PROBE_MINUTES[i];
    check(`press@${probeMin}min: no exception`, !r.threw);
    check(`press@${probeMin}min: answer is non-null`, r.answer !== null);
    check(`press@${probeMin}min: answer is non-empty`, Boolean(r.answer && r.answer.trim().length > 0));

    const qLine = r.traceLines.find(l => l.line.includes('question_extracted'));
    check(`press@${probeMin}min: question_extracted trace present`, Boolean(qLine));
    if (qLine) {
      try {
        const parsed = JSON.parse(qLine.line.replace('[TRACE:LONGCTX] question_extracted ', ''));
        check(`press@${probeMin}min: latestQuestion non-empty`, Boolean(parsed.latestQuestion && parsed.latestQuestion.trim()));
        check(`press@${probeMin}min: confidence >= 0.5`, (parsed.confidence ?? 0) >= 0.5);
      } catch (e) {
        failures.push(`press@${probeMin}min: question_extracted trace unparseable (${e.message})`);
      }
    }

    const pLine = r.traceLines.find(l => l.line.includes('prompt_assembled'));
    check(`press@${probeMin}min: prompt_assembled trace present`, Boolean(pLine));
    if (pLine) {
      try {
        const parsed = JSON.parse(pLine.line.replace('[TRACE:LONGCTX] prompt_assembled ', ''));
        check(`press@${probeMin}min: answerPlanQuestionSurvivesInPrompt`, parsed.answerPlanQuestionSurvivesInPrompt === true);
      } catch (e) {
        failures.push(`press@${probeMin}min: prompt_assembled trace unparseable (${e.message})`);
      }
    }

    // No amplifier regression: the honest-fallback fix must never itself throw
    // or silently null a short-session press.
    const sentinelLine = r.traceLines.find(l => l.line.includes('nonanswer_sentinel_discard'));
    if (sentinelLine) {
      check(`press@${probeMin}min: sentinel discard still produced a non-null answer`, r.answer !== null);
    }
  }

  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}

  console.log = origConsoleLog;
  if (failures.length > 0) {
    origConsoleLog(`\n[smoke] FAILED — ${failures.length} check(s) failed:`);
    for (const f of failures) origConsoleLog(`  - ${f}`);
    process.exit(1);
  } else {
    origConsoleLog(`\n[smoke] PASSED — all ${results.length * 6 - 1} checks green (5-minute short-session smoke, R8).`);
    process.exit(0);
  }
}

main().catch(e => {
  console.log = origConsoleLog;
  console.error('[smoke] FATAL', e && e.stack || e);
  process.exit(1);
});
