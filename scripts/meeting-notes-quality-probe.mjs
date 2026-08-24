// Opt-in live quality probe. Makes REAL LLM calls — never runs in CI.
//
//   RUN_NOTES_QUALITY_PROBE=1 node scripts/meeting-notes-quality-probe.mjs --meeting <id-prefix>
//   RUN_NOTES_QUALITY_PROBE=1 node scripts/meeting-notes-quality-probe.mjs <transcript.json>
//
// Two input modes:
//   --meeting <id-prefix>   Loads a real meeting's transcript (read-only) from the local
//                           Natively sqlite DB (~/Library/Application Support/Natively/natively.db
//                           on macOS, %APPDATA%/Natively/natively.db on Windows) via the `sqlite3`
//                           CLI in -readonly mode. Rows come from `transcripts` (meeting_id,
//                           speaker, content, timestamp_ms) and are mapped to the
//                           { speaker, text, timestamp, final } shape assembleSummary expects
//                           (note: the DB column is `content`, not `text`).
//   <transcript.json>       An array of { speaker, text, timestamp, final } — the original
//                           file-argument mode from the task-6 brief, kept as a fallback.
//
// This is an instrument, not a test: no assertions, only a printed report. It never writes to
// the database and never persists the generated summary anywhere. It also never prints
// transcript content or meeting titles — only counts, section titles, and a short (<200 char)
// excerpt of the generated overview, because the source data is the user's real meeting.
//
// Section vocabulary defaults to 'sales' for the JSON-file mode (matching the original brief)
// and to 'technical-interview' for --meeting mode, sourced from ModesManager's
// TEMPLATE_NOTE_SECTIONS so the measured sections match content the transcript can actually
// supply. Override either with --sections <modeTemplateType>.
//
// --meeting mode shells out to the `sqlite3` CLI (via execFileSync) to read the local DB
// read-only. That binary ships on macOS and most Linux distros but not on a stock Windows
// install, so --meeting mode is macOS/Linux-practical; the <transcript.json> file mode has
// no such dependency and works everywhere.
if (process.env.RUN_NOTES_QUALITY_PROBE !== '1') {
  console.log('Set RUN_NOTES_QUALITY_PROBE=1 to run. This makes real LLM calls.');
  process.exit(0);
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import Module from 'node:module';

// LLMHelper's compiled bundle requires('electron') at several call sites (ModelVersionManager's
// persistence path, BrowserWindow-based helpers, etc.). Under plain `node`, `require('electron')`
// resolves to the path string of the electron binary (npm's `electron` package's normal
// non-Electron behavior), so `.app` is undefined and the LLMHelper constructor throws. Running
// under `ELECTRON_RUN_AS_NODE=1 electron` does not fix this either — in that mode `electron`
// resolves to an empty object, still no `app`/`safeStorage`. Neither gives real credentials
// anyway (this probe supplies those directly from .env, matching ProcessingHelper's own
// non-Ollama construction path), so the only thing actually needed here is a harmless `app`
// shim so ModelVersionManager can build a scratch persistence path. This mirrors the house
// pattern other electron-touching unit tests use (e.g.
// electron/services/__tests__/Issue322KeychainPersistence.test.mjs) — a Module._load hijack
// returning a fake `electron` module, not a real Electron runtime.
const probeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-quality-probe-'));
const fakeElectron = {
  app: {
    getPath: () => probeUserData,
    getName: () => 'Natively',
    getVersion: () => '0.0.0-probe',
    isPackaged: false,
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s)),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
  },
  BrowserWindow: class {},
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  nativeTheme: { shouldUseDarkColors: false },
};
const origModuleLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return origModuleLoad.call(this, request, ...rest);
};

// dotenv, loaded the same way ProcessingHelper does for dev: real provider keys for this
// machine live in .env and are what the app itself falls back to before CredentialsManager
// (which needs a running Electron app + OS keychain) takes over.
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve('.env') });
} catch {
  // dotenv not available — fall back to whatever is already in the environment.
}

function parseArgs(argv) {
  const out = { meetingIdPrefix: null, transcriptPath: null, sections: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--meeting') { out.meetingIdPrefix = argv[++i]; continue; }
    if (a === '--sections') { out.sections = argv[++i]; continue; }
    if (!a.startsWith('--') && !out.transcriptPath) { out.transcriptPath = a; continue; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.meetingIdPrefix && !args.transcriptPath) {
  console.error('usage: --meeting <id-prefix>   OR   <transcript.json>');
  process.exit(1);
}

function defaultDbPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Natively', 'natively.db');
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'Natively', 'natively.db');
}

/**
 * Loads one meeting's transcript read-only via the `sqlite3` CLI (avoids needing a
 * native module built for the Electron ABI just to read rows). Never opens the DB
 * for write; never prints row content.
 */
function loadTranscriptFromDb(idPrefix) {
  const dbPath = process.env.NATIVELY_DB_PATH || defaultDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Natively DB not found at ${dbPath}. Set NATIVELY_DB_PATH to override.`);
  }

  // sqlite3's CLI has no first-class bind-parameter flag for a one-shot `sqlite3 db "SQL"`
  // invocation, so true prepared-statement parameterization isn't available here. Instead
  // of interpolating argv (idPrefix) or a DB-derived value (meetingId) straight into the SQL
  // text, run every value through this escaper first — doubling embedded single quotes is
  // the standard SQL-literal escape and closes the quote-breakout injection path that raw
  // interpolation of argv left open (idPrefix comes directly from process.argv).
  const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const runSql = (sql) => execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  const meetingsRaw = runSql(`SELECT id FROM meetings WHERE id LIKE ${sqlString(`${idPrefix}%`)} LIMIT 2;`);
  const meetings = meetingsRaw.trim() ? JSON.parse(meetingsRaw) : [];
  if (meetings.length === 0) throw new Error(`No meeting found with id prefix "${idPrefix}".`);
  if (meetings.length > 1) throw new Error(`Meeting id prefix "${idPrefix}" is ambiguous (matches ${meetings.length} meetings).`);
  const meetingId = meetings[0].id;

  const rowsRaw = runSql(
    `SELECT speaker, content, timestamp_ms FROM transcripts WHERE meeting_id = ${sqlString(meetingId)} ORDER BY timestamp_ms ASC;`
  );
  const rows = rowsRaw.trim() ? JSON.parse(rowsRaw) : [];
  if (rows.length === 0) throw new Error(`Meeting ${idPrefix} has no transcript rows.`);

  // Map the DB column `content` -> the `text` field assembleSummary expects.
  const transcript = rows.map(r => ({
    speaker: r.speaker || 'unknown',
    text: r.content || '',
    timestamp: r.timestamp_ms || 0,
    final: true,
  }));
  return { transcript, meetingId, segmentCount: rows.length };
}

let transcript;
let sourceDescription;
if (args.meetingIdPrefix) {
  const loaded = loadTranscriptFromDb(args.meetingIdPrefix);
  transcript = loaded.transcript;
  sourceDescription = `DB meeting id-prefix ${args.meetingIdPrefix} (${loaded.segmentCount} segments)`;
} else {
  transcript = JSON.parse(fs.readFileSync(args.transcriptPath, 'utf8'));
  sourceDescription = `file ${args.transcriptPath} (${transcript.length} segments)`;
}

const base = path.resolve('dist-electron/electron');
const { MeetingContextAssembler } = await import(pathToFileURL(path.join(base, 'services/meeting/MeetingContextAssembler.js')).href);
const { LLMHelper } = await import(pathToFileURL(path.join(base, 'LLMHelper.js')).href);
const { TEMPLATE_NOTE_SECTIONS } = await import(pathToFileURL(path.join(base, 'services/ModesManager.js')).href);

const modeTemplateType = args.sections || (args.meetingIdPrefix ? 'technical-interview' : 'sales');
const modeNoteSections = TEMPLATE_NOTE_SECTIONS[modeTemplateType];
if (!modeNoteSections) {
  console.error(`Unknown --sections value "${modeTemplateType}". Known: ${Object.keys(TEMPLATE_NOTE_SECTIONS).join(', ')}`);
  process.exit(1);
}

// Construct LLMHelper exactly the way ProcessingHelper does for its env-var fallback path
// (the non-Ollama branch) — real dev credentials from .env, not an empty-credential instance.
// This is deliberate: `new LLMHelper()` with no arguments has no provider keys, falls through
// the entire ladder, and would measure nothing.
const apiKey = process.env.GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const claudeApiKey = process.env.CLAUDE_API_KEY;
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const nvidiaNimApiKey = process.env.NVIDIA_NIM_API_KEY;

if (!apiKey && !groqApiKey && !openaiApiKey && !claudeApiKey && !deepseekApiKey && !nvidiaNimApiKey) {
  console.error('No provider API keys found in the environment (.env). Refusing to run a probe that would measure nothing.');
  process.exit(1);
}

const llmHelper = new LLMHelper(apiKey, false, undefined, undefined, groqApiKey, openaiApiKey, claudeApiKey, deepseekApiKey, nvidiaNimApiKey);

console.log(`source             ${sourceDescription}`);
console.log(`sections template  ${modeTemplateType} (${modeNoteSections.length} sections)`);
console.log(`credentials        gemini=${apiKey ? 'yes' : 'no'} groq=${groqApiKey ? 'yes' : 'no'} openai=${openaiApiKey ? 'yes' : 'no'} claude=${claudeApiKey ? 'yes' : 'no'} deepseek=${deepseekApiKey ? 'yes' : 'no'} nvidia=${nvidiaNimApiKey ? 'yes' : 'no'}`);

const started = Date.now();
const { summary, meta } = await new MeetingContextAssembler(llmHelper).assembleSummary({
  transcript,
  title: 'Probe',
  modeTemplateType,
  modeNoteSections,
  polishSummary: true,
  generateFollowUpDraft: false,
  startedAtMs: started,
  startedAtIso: new Date(started).toISOString(),
});

if (!summary) {
  console.error('NO SUMMARY PRODUCED', meta);
  process.exit(1);
}

const bullets = summary.sections.flatMap(s => s.bullets.map(b => b.text));
// The duplication metric. "Reads mechanical" numerically = tldr lines that appear
// verbatim in the body, because a mechanical writer lifts them from exactly there.
const dupes = summary.tldr.filter(line => bullets.some(b => b.trim() === line.trim())).length;

console.log('');
console.log('=== MEASURE GATE: meeting-notes quality probe ===');
console.log(`elapsed            ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`strategy           ${meta.strategy}  (chunks: ${meta.chunkCount})`);
console.log(`generation         provider=${summary.generation?.provider ?? 'n/a'} model=${summary.generation?.model ?? 'n/a'} durationMs=${summary.generation?.durationMs ?? 'n/a'}`);
console.log(`coverage           ${Math.round((summary.sourceQuality?.transcriptCoverage ?? 0) * 100)}%`);
console.log(`total bullets      ${bullets.length}`);
for (const s of summary.sections) console.log(`  ${s.title.padEnd(22)} ${s.bullets.length}`);
console.log(`tldr lines         ${summary.tldr.length}`);
console.log(`overview words     ${(summary.overview || '').split(/\s+/).filter(Boolean).length}`);
console.log(`VERBATIM DUPES     ${dupes} of ${summary.tldr.length} tldr lines are copied from the body`);
for (const w of summary.sourceQuality?.warnings || []) console.log(`sourceQuality warning   ${w}`);
for (const w of summary.generation?.warnings || []) console.log(`GENERATION WARNING (chunk/provider fallback)   ${w}`);

// Short, privacy-bounded qualitative excerpt only — never the transcript.
if (summary.overview) {
  const excerpt = summary.overview.slice(0, 180);
  console.log('');
  console.log(`overview excerpt   "${excerpt}${summary.overview.length > 180 ? '…' : ''}"`);
}
