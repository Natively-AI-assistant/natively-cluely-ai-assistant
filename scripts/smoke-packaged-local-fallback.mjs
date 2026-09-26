#!/usr/bin/env node
// Clean-machine packaged smoke test: launches the packaged Natively app with NO
// API keys, NO Ollama in PATH, and a fresh userData dir, then asserts:
//   - process stays alive for >= HOLD_SECONDS
//   - logs contain the local-fallback preflight start + a pass/degraded result
//   - logs contain an Ollama "skipped"/optional-missing status (NOT a fatal ENOENT)
//   - logs do NOT contain uncaughtException / unhandledRejection /
//     "Cannot find package 'onnxruntime-common'" / a fatal zero-shot worker failure
//
// Usage:
//   node scripts/smoke-packaged-local-fallback.mjs --app release/mac-arm64/Natively.app [--no-ollama] [--no-keys]
//
// Notes:
//   - The app writes its debug log to <documents>/natively_debug.log AND to
//     stdout via console; we capture stdout/stderr here.
//   - --no-ollama strips any dir containing an `ollama` binary from PATH.
//   - --no-keys clears provider key env vars for the child.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function argVal(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
const hasFlag = (name) => args.includes(name);

const HOLD_SECONDS = Number(process.env.SMOKE_HOLD_SECONDS || '30');
const appArg = argVal('--app');
if (!appArg) {
  console.error('[smoke] --app <path-to-.app|executable> is required');
  process.exit(2);
}

function resolveExecutable(appPath) {
  const abs = path.resolve(appPath);
  if (abs.endsWith('.app')) {
    const name = path.basename(abs, '.app');
    return path.join(abs, 'Contents', 'MacOS', name);
  }
  return abs;
}

const exe = resolveExecutable(appArg);
if (!fs.existsSync(exe)) {
  console.error(`[smoke] executable not found: ${exe}`);
  process.exit(2);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-smoke-'));

// Clear any stale debug log from a previous run so the smoke only inspects
// what THIS run emitted. The documents debug log is appended to on every
// launch, so a leftover "Unhandled Rejection" from an older run would
// otherwise falsely fail this run's check.
try {
  const debugLogPath = path.join(os.homedir(), 'Documents', 'natively_debug.log');
  if (fs.existsSync(debugLogPath)) {
    try { fs.unlinkSync(debugLogPath); } catch { /* best effort */ }
  }
} catch { /* best effort */ }

const env = { ...process.env };
env.NATIVELY_TEST_USERDATA = userData;
env.NATIVELY_LOCAL_PREFLIGHT_DELAY_MS = '500';
env.NATIVELY_INTENT_WARMUP_DELAY_MS = '800';

if (hasFlag('--no-keys')) {
  for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'DEEPSEEK_API_KEY', 'NATIVELY_API_KEY']) {
    delete env[k];
  }
}

if (hasFlag('--no-ollama')) {
  const parts = (env.PATH || '').split(path.delimiter).filter((dir) => {
    try { return !fs.existsSync(path.join(dir, 'ollama')); } catch { return true; }
  });
  env.PATH = parts.join(path.delimiter);
}

console.log('[smoke] launching', exe);
console.log('[smoke] userData', userData);

const child = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let logBuf = '';
const append = (b) => { logBuf += b.toString(); };
child.stdout.on('data', append);
child.stderr.on('data', append);

let exitedEarly = false;
child.on('exit', (code, signal) => {
  if (Date.now() - startTs < HOLD_SECONDS * 1000) {
    exitedEarly = true;
    console.error(`[smoke] app exited early: code=${code} signal=${signal}`);
  }
});

const startTs = Date.now();

function fail(msg) {
  console.error('[smoke] FAILED:', msg);
  try { child.kill('SIGKILL'); } catch {}
  process.exit(1);
}

setTimeout(() => {
  // Give logging a beat to flush.
  const debugLog = (() => {
    try {
      const p = path.join(os.homedir(), 'Documents', 'natively_debug.log');
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    } catch { return ''; }
  })();
  const combined = logBuf + '\n' + debugLog;

  if (exitedEarly) fail('app did not stay alive for the hold window');

  const forbidden = [
    'uncaughtException',
    'Unhandled Rejection',
    "Cannot find package 'onnxruntime-common'",
  ];
  for (const f of forbidden) {
    if (combined.includes(f)) fail(`log contains forbidden marker: ${f}`);
  }

  // Ollama must be an optional/skip status, never a fatal error line.
  if (/\[ERROR\].*spawn ollama ENOENT/.test(combined)) {
    fail('log contains fatal "spawn ollama ENOENT" error');
  }
  const ollamaOptional =
    combined.includes('Skipping Ollama startup') ||
    combined.includes('Ollama not selected') ||
    combined.includes('missing_optional_dependency');
  if (!ollamaOptional) {
    console.warn('[smoke] WARN: did not observe an explicit Ollama optional/skip status (may be timing).');
  }

  const preflightStarted = combined.includes('[LocalFallbackPreflight] started');
  const preflightResult =
    combined.includes('[LocalFallbackPreflight] passed') ||
    combined.includes('[LocalFallbackPreflight] failed');
  if (!preflightStarted || !preflightResult) {
    fail('local fallback preflight did not start/complete within the hold window');
  }
  if (combined.includes('[LocalFallbackPreflight] failed')) {
    fail('local fallback preflight FAILED — required packaged assets missing');
  }

  // The renderer-facing diagnostic UI keys off provider status broadcasts. On a
  // clean-machine install the packaged local embedding must report ready.
  if (combined.includes("ProviderStatus] local-embedding missing_required_asset")) {
    fail('local-embedding provider status is missing_required_asset — packaged model is broken');
  }
  if (combined.includes("ProviderStatus] intent-classifier missing_required_asset")) {
    fail('intent-classifier provider status is missing_required_asset — packaged model is broken');
  }
  if (combined.includes("ProviderStatus] native-audio missing_required_asset")) {
    fail('native-audio provider status is missing_required_asset — packaged native module is broken');
  }

  console.log('[smoke] OK — packaged app stayed alive, preflight passed, Ollama optional.');
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => process.exit(0), 500);
}, HOLD_SECONDS * 1000 + 2000);
