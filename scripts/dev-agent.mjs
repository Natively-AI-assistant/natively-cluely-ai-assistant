// scripts/dev-agent.mjs
//
// Launches an ISOLATED Natively instance for agent UI testing over CDP
// (CLAUDE.md, "Agent UI testing via CDP"). It exists so an agent can drive the
// renderer without colliding with the developer's own running app — which is
// exactly what went wrong before it existed: a second agent attached to a
// contested debug port and spent four rounds reading somebody else's renderer,
// and a plain `electron .` was refused outright by the single-instance lock.
//
// Every instance therefore gets its own:
//
//   CDP port          never 9222/9229, and never the same as another worktree's
//   renderer port     because vite runs --strictPort; a shared port means the
//                     second worktree simply fails to boot
//   userData          worktree-local, so the real profile is never touched
//   single-instance   skipped (main.ts, gated on !app.isPackaged)
//
// It writes ./agent-browser.json so `agent-browser` picks the port up without
// anyone passing --auto-connect.
//
// Node only — no shell scripts, no bash-isms, and every child is spawned
// through an absolute interpreter path rather than a .cmd shim, so this runs
// the same on macOS and Windows (CLAUDE.md, "Shell commands and scripts").

import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { electronArgs, isReservedPort, killPlan } from './devAgentSupport.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_DIR = path.join(ROOT, '.agent');
const USER_DATA = path.join(AGENT_DIR, 'userdata');
const CONFIG = path.join(ROOT, 'agent-browser.json');

/** An ephemeral port the OS just told us is free: bind :0, read it, release it. */
function reservePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => {
        if (isReservedPort(port)) reservePort().then(resolve, reject);
        else resolve(port);
      });
    });
  });
}

/**
 * The worktree's session id. agent-browser owns this concept, so ask it; if it
 * is not installed the launcher must still work, so fall back to a stable hash
 * of the worktree path — same worktree, same id, which is the only property
 * anything depends on.
 */
function sessionId() {
  const r = spawnSync('agent-browser', ['session', 'id', '--scope', 'worktree', '--prefix', 'natively'], {
    encoding: 'utf8',
    shell: false,
  });
  const out = r.status === 0 ? String(r.stdout || '').trim() : '';
  if (out) return out;
  const hash = createHash('sha256').update(ROOT).digest('hex').slice(0, 8);
  console.warn('[dev:agent] agent-browser not found; derived session id from the worktree path');
  return `natively-${hash}`;
}

/** Resolve a package's bin through Node, never a platform .cmd shim. */
function binOf(pkgRelative) {
  return path.join(ROOT, 'node_modules', ...pkgRelative.split('/'));
}

function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = connect({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`dev server never came up on ${port}`));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child || child.exitCode !== null || child.signalCode !== null) continue;
    // killPlan owns the platform decision (and is tested for both branches).
    let plan;
    try { plan = killPlan(process.platform, child.pid); } catch { continue; }
    try {
      if (plan.kind === 'spawn') spawnSync(plan.command, plan.args, { shell: false, stdio: 'ignore' });
      else child.kill(plan.signal);
    } catch { /* already gone */ }
  }
  process.exit(code);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));

async function main() {
  const cdpPort = await reservePort();
  const rendererPort = await reservePort();
  const session = sessionId();

  mkdirSync(USER_DATA, { recursive: true });
  // `cdp` is a STRING here, not a number: agent-browser's config parser rejects
  // an integer outright ("invalid type: integer, expected a string") and then
  // silently falls back to launching its OWN browser, so the agent ends up
  // driving about:blank instead of the app.
  writeFileSync(CONFIG, `${JSON.stringify({ cdp: String(cdpPort), session }, null, 2)}\n`);

  console.log(`[dev:agent] cdp=${cdpPort} renderer=${rendererPort} session=${session}`);
  console.log(`[dev:agent] userData=${USER_DATA}`);
  console.log(`[dev:agent] wrote ${path.relative(ROOT, CONFIG)}`);

  // The main-process bundle has to exist before electron can run; the renderer
  // is served by vite, so `npm run build` is deliberately NOT part of this.
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-electron.js')], {
    cwd: ROOT, stdio: 'inherit', shell: false,
  });
  // build-electron EXITS 0 ON FAILURE, so the exit code proves nothing — check
  // that the artifact is actually there.
  if (built.error) throw built.error;
  const mainBundle = path.join(ROOT, 'dist-electron', 'electron', 'main.js');
  if (!existsSync(mainBundle)) {
    throw new Error(`build:electron produced no ${path.relative(ROOT, mainBundle)} (it exits 0 on failure)`);
  }

  const vite = spawn(process.execPath, [
    binOf('vite/bin/vite.js'),
    '--host', '127.0.0.1',
    '--port', String(rendererPort),
    '--strictPort',
  ], { cwd: ROOT, stdio: 'inherit', shell: false });
  children.push(vite);
  vite.on('exit', (code) => { if (!shuttingDown) { console.error(`[dev:agent] vite exited (${code})`); shutdown(code ?? 1); } });

  await waitForPort(rendererPort);

  // electronArgs adds --user-data-dir: NATIVELY_AGENT_USER_DATA alone left the
  // credentials file pointing at the real profile (see devAgentSupport.mjs).
  const app = spawn(electronPath, electronArgs(ROOT, cdpPort, USER_DATA), {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NATIVELY_RENDERER_PORT: String(rendererPort),
      NATIVELY_AGENT_USER_DATA: USER_DATA,
    },
  });
  children.push(app);

  console.log(`[dev:agent] ready — agent-browser tab`);
  app.on('exit', (code) => { if (!shuttingDown) shutdown(code ?? 0); });
}

main().catch((err) => {
  console.error('[dev:agent]', err?.message || err);
  shutdown(1);
});
