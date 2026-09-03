/**
 * VerboseLoggingFullCapture2026_09_03.test.mjs
 *
 * Settings > General > Advanced > "Verbose debug logging". ON means FULL
 * capture: the four trace producers open and user content stays readable.
 * Credentials are scrubbed either way. Covers:
 *   - the globalThis anchor (a module-local flag was invisible across
 *     esbuild's per-entry bundles — a real shipped bug: main.js set the flag,
 *     SessionTracker.js never saw it),
 *   - the flag driving redactForLog's content axis,
 *   - ON reaching the four trace gates,
 *   - contextDebugLevel being raised and RESTORED, never clobbered.
 *
 * The gate call sites are reached through lazy require() wrapped in try/catch
 * that fails closed, so a typo becomes a silently missing log rather than a
 * crash. They are pinned by source assertion for the same reason
 * RerankerSettingsAccessors2026_09_01 exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const verboseLog = require(path.join(repoRoot, 'dist-electron/electron/verboseLog.js'));
const redactor = require(path.join(repoRoot, 'dist-electron/electron/utils/redactForLog.js'));

// ── the flag ────────────────────────────────────────────────────────────────

test('the flag round-trips', () => {
  const { setVerboseLoggingFlag, isVerboseLogging } = verboseLog;
  try {
    setVerboseLoggingFlag(true);
    assert.equal(isVerboseLogging(), true);
    setVerboseLoggingFlag(false);
    assert.equal(isVerboseLogging(), false);
    setVerboseLoggingFlag(true);
    assert.equal(isVerboseLogging(), true);
  } finally {
    setVerboseLoggingFlag(true);
  }
});

test('the flag is anchored on globalThis, not a module-local let', () => {
  // esbuild bundles every .ts as its own entry, so a module-local flag gave
  // main.js, SessionTracker.js and StealthKeyboardManager.js three private
  // copies. Verified in the built output before this fix.
  const { setVerboseLoggingFlag } = verboseLog;
  try {
    setVerboseLoggingFlag(true);
    assert.equal(globalThis.__nativelyVerboseLoggingV1__?.on, true,
      'flag not on globalThis — per-bundle copies will diverge again');
  } finally {
    setVerboseLoggingFlag(true);
  }
});

test('ON opens redactForLog content axis; OFF falls back to standard, not nothing', () => {
  // OFF must still redact rather than disable redaction: main.ts's console
  // patch writes EVERY console line to the log whether or not the flag is on.
  const { setVerboseLoggingFlag } = verboseLog;
  try {
    setVerboseLoggingFlag(true);
    assert.equal(redactor.getLogRedactionLevel(), 'full');
    assert.ok(redactor.redactForLog([{ answer: 'PAIRED_CANARY' }]).includes('PAIRED_CANARY'));

    setVerboseLoggingFlag(false);
    assert.equal(redactor.getLogRedactionLevel(), 'standard');
    assert.ok(!redactor.redactForLog([{ answer: 'PAIRED_CANARY' }]).includes('PAIRED_CANARY'));

    // Credentials are scrubbed in BOTH states — the axis that is never a choice.
    for (const on of [true, false]) {
      setVerboseLoggingFlag(on);
      assert.ok(!redactor.redactForLog([{ apiKey: 'SECRET_CANARY' }]).includes('SECRET_CANARY'),
        `credential leaked with verbose=${on}`);
    }
  } finally {
    setVerboseLoggingFlag(true);
  }
});

// ── full capture is OPT-IN (code review 2026-09-03, finding 1) ─────────────

test('CONTENT CAPTURE IS OPT-IN: a fresh install does not log user content', () => {
  // Regression guard for the review's critical finding. ON now means "record
  // my conversations verbatim to ~/Documents/natively_debug.log". When the
  // flag defaulted ON, every fresh install did that with no user action, while
  // redactForLog's own docblock claimed 'full' was opt-in from Settings.
  const prevEnv = process.env.NATIVELY_VERBOSE_LOGGING;
  delete process.env.NATIVELY_VERBOSE_LOGGING;
  delete globalThis.__nativelyVerboseLoggingV1__;
  delete globalThis.__nativelyLogRedactionLevelV1__;
  try {
    assert.equal(verboseLog.isVerboseLogging(), false,
      'the flag must default OFF — ON means full content capture');
    assert.equal(redactor.getLogRedactionLevel(), 'standard',
      'redaction must default to standard, never full');
    assert.ok(!redactor.redactForLog([{ transcript: 'PRIVATE_MEETING' }]).includes('PRIVATE_MEETING'),
      'a fresh install must not write user content to the log');
  } finally {
    if (prevEnv === undefined) delete process.env.NATIVELY_VERBOSE_LOGGING;
    else process.env.NATIVELY_VERBOSE_LOGGING = prevEnv;
    verboseLog.setVerboseLoggingFlag(true);
  }
});

test('AppState reads the setting with an OFF default, not ON', () => {
  const src = read('electron/main.ts');
  assert.match(src, /get\('verboseLogging'\) \?\? false/,
    'defaulting to true re-enables content capture for every install');
  assert.doesNotMatch(src, /get\('verboseLogging'\) \?\? true/);
});

test('NATIVELY_VERBOSE_LOGGING=1 opts in from a terminal', () => {
  const src = read('electron/verboseLog.ts');
  assert.match(src, /v === '1' \|\| v === 'true'/);
});

// ── the displaced contextDebugLevel survives a restart (finding 4) ─────────

test('the displaced contextDebugLevel is PERSISTED, not an in-memory field', () => {
  // ON -> quit -> relaunch -> OFF would skip the restore branch with an
  // in-memory field, pinning contextDebugLevel at 'verbose' forever.
  const src = read('electron/main.ts');
  assert.match(src, /settings\.set\('contextDebugLevelBeforeVerbose', current\)/);
  assert.match(src, /settings\.get\('contextDebugLevelBeforeVerbose'\)/);
  assert.ok(!src.includes('_contextDebugLevelBeforeFull'),
    'in-memory field still present — it does not survive a restart');
  assert.match(read('electron/services/SettingsManager.ts'),
    /contextDebugLevelBeforeVerbose\?: 'off' \| 'standard' \| 'verbose';/);
});

// ── the refused write reaches the UI (finding 3) ───────────────────────────

test('set-verbose-logging IPC reports a refused settings write', () => {
  const src = read('electron/ipcHandlers.ts');
  const h = src.slice(src.indexOf("safeHandle('set-verbose-logging'"));
  const body = h.slice(0, h.indexOf('\n  });'));
  assert.match(body, /const persisted = appState\.setVerboseLogging\(enabled\)/);
  assert.match(body, /settings_write_refused/);
  assert.doesNotMatch(body, /appState\.setVerboseLogging\(enabled\);\s*\n\s*return \{ success: true \};/,
    'return value discarded — the signature change is a no-op');
});

// ── uncapped trace payloads ─────────────────────────────────────────────────

test('redactSecretsOnly keeps a LONG answer whole — no silent 8000-char clip', () => {
  // Regression: routing [TRACE:ANSWER] through the 'full' level clipped every
  // string at MAX_FULL_LEN. Coding answers with code blocks clear 8000
  // routinely, and wta-read-session.mjs --full would print a clipped answer
  // while advertising "untruncated". Every canary in the KEPT-at-full test was
  // short, so nothing caught it.
  const long = 'A'.repeat(20000);
  const out = redactor.redactSecretsOnly({ answer: long, apiKey: 'SECRET_CANARY', base64: 'BLOB' });
  assert.equal(out.answer.length, 20000, 'answer was truncated');
  assert.equal(out.apiKey, '[REDACTED]', 'credential must still be scrubbed when uncapped');
  assert.equal(out.base64, '[REMOVED]', 'base64 must still be dropped by key');
});

test('redactForLog keeps its own caps — uncapping is redactSecretsOnly only', () => {
  const long = 'B'.repeat(9000);
  assert.equal(JSON.parse(redactor.redactForLog([{ note: long }], 'standard')).note.length, 120);
  assert.equal(JSON.parse(redactor.redactForLog([{ note: long }], 'full')).note.length, 8000);
});

// ── gate wiring (source-pinned; lazy require + fail-closed catch) ───────────

test('ON opens the answer-text gate in IntelligenceEngine', () => {
  const src = read('electron/IntelligenceEngine.ts');
  assert.match(src, /require\('\.\/verboseLog'\)\.isVerboseLogging\(\)/);
  assert.match(src, /NATIVELY_TRACE_ANSWERS === '1' \|\| fullDebug/);
});

test('ON opens the PI telemetry gate', () => {
  const src = read('electron/llm/piTelemetry.ts');
  assert.match(src, /require\('\.\.\/verboseLog'\)\.isVerboseLogging\(\)/);
});

test('pre-stringified trace payloads are credential-scrubbed at the source', () => {
  // These reach redactForLog as STRINGS, so the key-level redactor never sees
  // them. Scrubbing before JSON.stringify is the only thing standing between a
  // future credential-carrying field and the log file.
  assert.match(read('electron/IntelligenceEngine.ts'), /JSON\.stringify\(redactSecretsOnlyForTrace\(/);
  assert.match(read('electron/context-intelligence/orchestration/engine-bridge.ts'), /JSON\.stringify\(redactTracePayload\(/);
});

test('setVerboseLogging raises contextDebugLevel and RESTORES it, never clobbers', () => {
  const src = read('electron/main.ts');
  // Returns boolean, not void: a degraded store refuses the write and the UI
  // must not claim success — see RefusedSettingWriteReported2026_08_21.
  assert.match(src, /public setVerboseLogging\(enabled: boolean\): boolean/);
  assert.match(src, /return persisted;/);
  assert.match(src, /setVerboseLoggingFlag\(enabled\)/);
  // contextDebugLevel is an INDEPENDENT setting with its own selector
  // (IntelligenceSettings -> context-debug:set-level). Only ever RAISE it, and
  // restore what was displaced.
  assert.match(src, /contextDebugLevelBeforeVerbose/);
  assert.match(src, /setContextDebugLevel\('verbose'\)/);
  assert.doesNotMatch(src, /setContextDebugLevel\(\s*enabled \? 'verbose' : 'off'\s*\)/,
    'must not clobber the user\u2019s Intelligence-settings choice');
});

test('the settings UI is a single toggle, with no leftover level control', () => {
  const src = read('src/components/SettingsOverlay.tsx');
  assert.match(src, /setVerboseLogging\?\.\(newState\)/);
  assert.ok(!src.includes('debugLogLevel'), 'leftover three-way level state in the UI');
  assert.match(src, /Export debug logs/);
});

test('the export handler collects all four artifact kinds', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(src, /safeHandle\('export-debug-logs'/);
  assert.match(src, /natively_debug\.log\.prev/, 'the prior session is where a crash lives');
  assert.match(src, /system-info\.json/);
  assert.match(src, /shell\.showItemInFolder/);
  // Cross-platform: no hardcoded platform paths in the export path.
  const handler = src.slice(src.indexOf("safeHandle('export-debug-logs'"));
  const body = handler.slice(0, handler.indexOf('\n  });'));
  assert.ok(!/[/\\](tmp|Users|Library)[/\\]|C:\\\\/.test(body), 'hardcoded OS path in export handler');
  assert.match(body, /app\.getPath\('documents'\)/);
  assert.match(body, /app\.getPath\('logs'\)/);
});

test('no leftover debugLogLevel plumbing anywhere', () => {
  for (const rel of ['electron/services/SettingsManager.ts', 'electron/main.ts',
                     'electron/ipcHandlers.ts', 'electron/preload.ts',
                     'electron/verboseLog.ts', 'src/types/electron.d.ts']) {
    assert.ok(!read(rel).includes('debugLogLevel'), `leftover debugLogLevel in ${rel}`);
  }
});
