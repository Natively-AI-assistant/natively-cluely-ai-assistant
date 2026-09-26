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

/**
 * A key from the environment, else from an .env file: NATIVELY_ENV_FILE, then
 * this checkout's natively-api/.env (a worktree's submodule dir is often empty —
 * point NATIVELY_ENV_FILE at the main checkout's). Values there are often
 * QUOTED and can carry trailing spaces: trim, unquote, trim. Never logged.
 */
export function envKey(name) {
  if (process.env[name]) return process.env[name].trim();
  const file = [process.env.NATIVELY_ENV_FILE, path.join(ROOT, 'natively-api', '.env')].find((f) => f && fs.existsSync(f));
  if (!file) return null;
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '').trim() || null;
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
