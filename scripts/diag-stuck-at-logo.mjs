#!/usr/bin/env node
/**
 * Feedback loop for: stuck on black logo splash, never reaches Start Natively.
 *
 * Signals (any one → RED):
 *   1. Log contains: UNRESPONSIVE — ... "stuck at logo"
 *   2. StabilityHeartbeat reports launcher Tab rssMB >= LAUNCHER_RSS_RED_MB
 *      within OBSERVE_MS after "App is ready"
 *
 * Green:
 *   After OBSERVE_MS, no UNRESPONSIVE and peak launcher rssMB < LAUNCHER_RSS_RED_MB
 *
 * Usage:
 *   node scripts/diag-stuck-at-logo.mjs --log PATH        # analyze existing log
 *   node scripts/diag-stuck-at-logo.mjs --start           # kill leftovers, npm start, observe
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const wantStart = process.argv.includes('--start');
const logArgIdx = process.argv.indexOf('--log');
const logFromArg = logArgIdx >= 0 ? process.argv[logArgIdx + 1] : null;

const OBSERVE_MS = Number(process.env.LOGO_DIAG_OBSERVE_MS || 45000);
const READY_TIMEOUT_MS = Number(process.env.LOGO_DIAG_READY_MS || 120000);
const LAUNCHER_RSS_RED_MB = Number(process.env.LOGO_DIAG_RSS_RED_MB || 1500);

const UNRESPONSIVE_RE =
  /UNRESPONSIVE[^\n]*stuck at logo|UNRESPONSIVE — renderer stopped pumping/i;
const READY_RE = /App is ready/;
const LAUNCHER_RSS_RE = /\{ type: 'Tab', rssMB: (\d+), pid: \d+, win: 'launcher' \}/g;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function analyze(text) {
  const unresponsive = UNRESPONSIVE_RE.test(text);
  const readyIdx = text.search(READY_RE);
  const ready = readyIdx >= 0;

  let peakLauncherRss = 0;
  let launcherSamples = 0;
  for (const m of text.matchAll(LAUNCHER_RSS_RE)) {
    launcherSamples += 1;
    peakLauncherRss = Math.max(peakLauncherRss, Number(m[1]));
  }

  const rssRed = peakLauncherRss >= LAUNCHER_RSS_RED_MB;
  const red = unresponsive || rssRed;
  return {
    ready,
    unresponsive,
    peakLauncherRss,
    launcherSamples,
    rssRed,
    red,
    reason: unresponsive
      ? 'renderer UNRESPONSIVE (stuck at logo)'
      : rssRed
        ? `launcher rssMB peak ${peakLauncherRss} >= ${LAUNCHER_RSS_RED_MB}`
        : 'ok',
  };
}

function killLeftovers() {
  spawnSync('pkill', ['-f', 'natively-cluely-ai-assistant/node_modules/.bin/electron'], {
    stdio: 'ignore',
  });
  spawnSync('pkill', ['-f', 'natively-cluely-ai-assistant/node_modules/electron/dist/Electron.app'], {
    stdio: 'ignore',
  });
  spawnSync('pkill', ['-f', 'vite --port 5180'], { stdio: 'ignore' });
  sleep(1500);
}

function findDefaultLog() {
  const terminals = path.join(
    process.env.HOME || '',
    '.cursor/projects/Users-son-do-natively-cluely-ai-assistant/terminals',
  );
  if (!fs.existsSync(terminals)) return null;
  const files = fs
    .readdirSync(terminals)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => {
      const p = path.join(terminals, f);
      return { p, m: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.m - a.m);
  for (const { p } of files) {
    const head = fs.readFileSync(p, 'utf8').slice(0, 2000);
    if (/npm start|app:dev|electron:dev/.test(head)) return p;
  }
  return files[0]?.p || null;
}

function main() {
  let child = null;
  let logPath = logFromArg;

  try {
    if (wantStart) {
      killLeftovers();
      logPath = path.join(repoRoot, '.scratch/diag-stuck-at-logo.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '');
      const out = fs.openSync(logPath, 'a');
      child = spawn('npm', ['start'], {
        cwd: repoRoot,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', out, out],
        detached: true,
      });
      console.log(`[diag-logo] started npm start pid=${child.pid} log=${logPath}`);

      const t0 = Date.now();
      while (Date.now() - t0 < READY_TIMEOUT_MS) {
        const text = fs.readFileSync(logPath, 'utf8');
        if (READY_RE.test(text)) break;
        if (/exit_code:/.test(text)) throw new Error('npm start exited before App is ready');
        sleep(400);
      }
      if (!READY_RE.test(fs.readFileSync(logPath, 'utf8'))) {
        throw new Error(`Timed out waiting for App is ready (${READY_TIMEOUT_MS}ms)`);
      }
      console.log(`[diag-logo] App is ready — observing ${OBSERVE_MS}ms for stuck-at-logo signals`);
      sleep(OBSERVE_MS);
    } else {
      if (!logPath) logPath = findDefaultLog();
      if (!logPath || !fs.existsSync(logPath)) {
        throw new Error('No --log given and no npm start terminal log found');
      }
      console.log(`[diag-logo] analyzing existing log: ${logPath}`);
    }

    const text = fs.readFileSync(logPath, 'utf8');
    const result = analyze(text);
    console.log('[diag-logo] result:', JSON.stringify(result, null, 2));
    if (!result.ready && !wantStart) {
      console.log('[diag-logo] WARN: App is ready not found in log — still evaluating hang signals');
    }

    if (result.red) {
      console.log(
        `[diag-logo] RED — ${result.reason} (user symptom: stuck on logo, never reaches Start Natively)`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `[diag-logo] GREEN — no UNRESPONSIVE; launcher peak rssMB=${result.peakLauncherRss} < ${LAUNCHER_RSS_RED_MB}`,
      );
      process.exitCode = 0;
    }
  } finally {
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(child.pid, 'SIGTERM');
        } catch {
          /* ignore */
        }
      }
      killLeftovers();
    }
  }
}

try {
  main();
} catch (err) {
  console.error('[diag-logo] FATAL', err);
  process.exit(2);
}
