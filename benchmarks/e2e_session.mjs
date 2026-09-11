// PHASE 23/24 — REAL Natively sessions through the real Electron app.
//
// Not an API benchmark. This launches the actual app, uploads real files through
// __e2e__:upload-reference-file-from-path (which calls the SAME
// ingestModeReferenceFile use case the file-dialog upload does, so parsing,
// chunking, embedding and persistence are the production path), waits on real
// durable index state, then asks real questions through the real hybrid
// retriever.
//
// Isolation: each simulated user gets its own userData directory seeded with the
// real credentials, so N instances are N genuinely independent desktop clients
// sharing one Natively API key — which is what "concurrent users" actually means
// for this product.
import { spawn } from 'node:child_process';
import { mkdirSync, cpSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = '/Users/evin/natively-cluely-ai-assistant';
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');
const REAL_USERDATA = path.join(os.homedir(), 'Library/Application Support/Natively');

export async function launchInstance({ id, port }) {
  const ud = path.join(os.tmpdir(), `natively-e2e-${id}-${Date.now()}`);
  mkdirSync(ud, { recursive: true });
  // Seed ONLY what authenticates the session. userData is multi-GB; copying it
  // whole would dominate the measurement and is unnecessary.
  for (const f of ['credentials.enc', 'settings.json', 'Preferences']) {
    const src = path.join(REAL_USERDATA, f);
    if (existsSync(src)) { try { cpSync(src, path.join(ud, f)); } catch {} }
  }
  const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), [
    path.join(ROOT, 'dist-electron/electron/main.js'),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${ud}`,
  ], {
    cwd: ROOT,
    env: { ...process.env,
      NATIVELY_E2E: '1',
      NATIVELY_E2E_REFERENCE_ROOT: FIXTURES,
      NATIVELY_TEST_USERDATA: ud,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', d => log.push(String(d)));
  child.stderr.on('data', d => log.push(String(d)));
  return { id, port, child, ud, log };
}

export async function attach(port, tries = 120) {
  const { pathToFileURL } = await import('node:url');
  const { chromium } = await import(pathToFileURL(path.join(ROOT,'node_modules/playwright/index.js')).href);
  // A chrome-error:// page is a real page object whose evaluate() HANGS rather
  // than throwing, so an unbounded probe against one waits forever. Skip those
  // outright and put a deadline on every probe.
  const probe = (pg) => Promise.race([
    pg.evaluate(() => !!(window.electronAPI && window.electronAPI.e2eInvoke)).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 3000)),
  ]);
  let browser = null;
  for (let i = 0; i < tries; i++) {
    try {
      browser = browser || await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
      const pages = browser.contexts().flatMap(c => c.pages())
        .filter(pg => !pg.url().startsWith('chrome-error'));
      for (const pg of pages) {
        if (await probe(pg)) return { b: browser, p: pg };
      }
    } catch { try { await browser?.close(); } catch {} browser = null; }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`could not attach to CDP on ${port}`);
}

export const inv = (p, ch, ...args) =>
  p.evaluate(([c, a]) => window.electronAPI.e2eInvoke(c, ...a), [ch, args]);
export const api = (p, fn, ...args) =>
  p.evaluate(([f, a]) => window.electronAPI[f](...a), [fn, args]);
