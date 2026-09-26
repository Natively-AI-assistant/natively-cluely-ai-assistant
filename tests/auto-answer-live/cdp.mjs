// Tiny CDP helper for the auto-answer live rig: attach to THIS worktree's
// dev:agent (./agent-browser.json) and evaluate in a window by ?window= name.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout: ${what}`)), ms); })]).finally(() => clearTimeout(t));
}

/** .env values are often QUOTED — strip them, never log them. */
export function envKey(name, file = path.join(ROOT, 'natively-api', '.env')) {
  const src = fs.existsSync(file) ? file : '/Users/evin/natively-cluely-ai-assistant/natively-api/.env';
  const line = fs.readFileSync(src, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') || null;
}

export async function connect() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-browser.json'), 'utf8'));
  const browser = await withTimeout(chromium.connectOverCDP(`http://127.0.0.1:${cfg.cdp}`), 20000, 'connectOverCDP');
  let gone = false;
  browser.on('disconnected', () => { gone = true; });
  async function page(win) {
    for (let i = 0; i < 60; i++) {
      const p = browser.contexts().flatMap((c) => c.pages()).find((pg) => {
        try { return !pg.isClosed() && new URL(pg.url()).searchParams.get('window') === win; } catch { return false; }
      });
      if (p) return p;
      await sleep(250);
    }
    throw new Error(gone ? 'APP_GONE' : `no live page for window=${win}`);
  }
  const evalIn = async (win, fn, arg, ms = 30000) => withTimeout((await page(win)).evaluate(fn, arg), ms, `evaluate in ${win}`);
  return { browser, page, evalIn, isGone: () => gone };
}
