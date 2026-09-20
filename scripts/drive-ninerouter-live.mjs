/**
 * Plain-spawn + CDP driver for Natively.
 *
 * NOT Playwright's _electron, deliberately: a Playwright-launched Electron
 * writes safeStorage credentials a normally-launched app cannot decrypt, and
 * saving a credential is exactly what this drive has to prove. Plain spawn with
 * an ISOLATED userData keeps safeStorage working.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = '/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/ninerouter-provider';
const ELECTRON = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PORT = 9346;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-drive-'));
const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'nr-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log('[drive]', ...a);

const child = spawn(ELECTRON, [
  APP_DIR,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${USER_DATA}`,
  '--no-sandbox',
], { env: { ...process.env, NODE_ENV: 'production', NATIVELY_DRIVE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });

const appLog = [];
child.stdout.on('data', d => { appLog.push(String(d)); });
child.stderr.on('data', d => { appLog.push(String(d)); });
child.on('exit', (c) => log('electron exited', c));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

/** Minimal CDP client over the websocket. */
async function connect(wsUrl) {
  // Node's built-in WebSocket — no 'ws' dependency needed in the scratchpad.
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
    return r.result.value;
  };
  return { ws, send, evaluate };
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  log('userData:', USER_DATA);
  // Wait for the debug endpoint.
  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await targets(); if (list.length) break; } catch { /* not up yet */ }
    await sleep(1000);
  }
  if (!list?.length) { log('NO CDP TARGETS'); log(appLog.join('').slice(-3000)); process.exit(1); }
  log('targets:', list.map(t => `${t.title} :: ${t.url.slice(0, 80)}`).join(' | '));

  let evaluate = null;
  for (const t of list.filter(t => t.type === 'page' && !t.url.startsWith('devtools://'))) {
    try {
      const c = await connect(t.webSocketDebuggerUrl);
      const has = await c.evaluate(`typeof window.electronAPI?.setNinerouterConfig`);
      log('window', t.url.split('/').pop(), '-> setNinerouterConfig is', has);
      if (has === 'function') { evaluate = c.evaluate; break; }
      if (!evaluate && has !== 'undefined') { evaluate = c.evaluate; }
    } catch (e) { log('window connect failed:', e.message); }
  }
  if (!evaluate) { log('no window exposes electronAPI'); process.exit(1); }

  // ── 1. the preload bridge actually exposes the 9Router channels ──────────
  const api = await evaluate(`JSON.stringify({
    setNinerouterConfig: typeof window.electronAPI?.setNinerouterConfig,
    getAvailableNinerouterModels: typeof window.electronAPI?.getAvailableNinerouterModels,
    refreshNinerouterModels: typeof window.electronAPI?.refreshNinerouterModels,
    testNinerouterConnection: typeof window.electronAPI?.testNinerouterConnection,
  })`);
  const apiTypes = JSON.parse(api);
  check('preload exposes all four 9Router channels',
    Object.values(apiTypes).every(v => v === 'function'), JSON.stringify(apiTypes));

  // ── 2. Test Connection reaches the real instance ─────────────────────────
  const probe = await evaluate(`window.electronAPI.testNinerouterConnection({ baseURL: 'http://localhost:20128/v1', apiKey: '' }).then(r => JSON.stringify(r))`);
  const probeR = JSON.parse(probe);
  check('Test Connection round-trips through IPC to the live instance',
    probeR.reason === 'auth' && probeR.status === 401, JSON.stringify(probeR).slice(0, 140));

  const probeBad = await evaluate(`window.electronAPI.testNinerouterConnection({ baseURL: 'http://localhost:20128/dashboard', apiKey: '' }).then(r => JSON.stringify(r))`);
  check('a wrong base URL is reported unreachable, not "works"',
    JSON.parse(probeBad).reason === 'unreachable', JSON.parse(probeBad).error?.slice(0, 90));

  // ── 3. save the config (this is the safeStorage write) ───────────────────
  const saved = await evaluate(`window.electronAPI.setNinerouterConfig({ apiKey: '', baseURL: 'http://localhost:20128/v1' }).then(r => JSON.stringify(r))`);
  check('setNinerouterConfig persists', JSON.parse(saved).success === true, saved);

  // ── 4. discovery: the real catalogue comes back through IPC ──────────────
  const models = await evaluate(`window.electronAPI.refreshNinerouterModels().then(m => JSON.stringify(m))`);
  const list2 = JSON.parse(models);
  check('refreshNinerouterModels returns the live catalogue',
    Array.isArray(list2) && list2.length > 0, `${list2.length} models, e.g. ${list2.slice(0, 3).join(', ')}`);

  // ── 5. the credential read-back the settings card prefills from ──────────
  const creds = await evaluate(`window.electronAPI.getStoredCredentials().then(c => JSON.stringify({
    hasNinerouterBaseURL: c.hasNinerouterBaseURL, ninerouterBaseURL: c.ninerouterBaseURL }))`);
  const credsR = JSON.parse(creds);
  check('getStoredCredentials reports 9Router as configured',
    credsR.hasNinerouterBaseURL === true && credsR.ninerouterBaseURL === 'http://localhost:20128/v1',
    creds);

  // ── 6. opt-in: tick one model, and only that one becomes selectable ──────
  const pick = list2[0];
  await evaluate(`window.electronAPI.setCloudEnabledModels('ninerouter', ${JSON.stringify([`ninerouter/${pick}`])})`);
  const enabled = await evaluate(`window.electronAPI.getStoredCredentials().then(c => JSON.stringify(c.cloudEnabledModels?.ninerouter || []))`);
  check('the opt-in allow-list stores the prefixed id',
    JSON.parse(enabled).includes(`ninerouter/${pick}`), enabled);

  // ── 7. the ticked model is actually selectable as the default ────────────
  const setDefault = await evaluate(`window.electronAPI.setDefaultModel(${JSON.stringify(`ninerouter/${pick}`)}).then(() => window.electronAPI.getCurrentLlmConfig()).then(c => JSON.stringify({ modelId: c.modelId, displayName: c.displayName }))`);
  check('a ticked 9Router model becomes the active model',
    JSON.parse(setDefault).modelId === `ninerouter/${pick}`, setDefault);

  // ── 8. PHASE 3: the embeddings panel sees 9Router ───────────────────────
  const cat = await evaluate(`window.electronAPI.getEmbeddingCatalog().then(r => JSON.stringify(
    (r.providers||[]).map(p => ({ id: p.id, cloud: p.cloud, available: p.available, n: (p.models||[]).length, endpoint: p.endpoint }))))`);
  const provs = JSON.parse(cat);
  const nr = provs.find(p => p.id === 'ninerouter');
  check('the embedding catalogue offers 9Router',
    !!nr && nr.n > 0, JSON.stringify(nr));
  check('9Router is flagged CLOUD in the panel, despite the localhost endpoint',
    nr?.cloud === true, `cloud=${nr?.cloud} endpoint=${nr?.endpoint}`);

  fs.writeFileSync(path.join(SHOTS, 'app.log'), appLog.join(''));
  log('--- app log tail ---');
  log(appLog.join('').split('\n').filter(l => /9Router|ninerouter/i.test(l)).slice(-12).join('\n'));

  const failed = results.filter(r => !r.pass);
  log(`\n${results.length - failed.length}/${results.length} checks passed`);
  child.kill('SIGTERM');
  await sleep(500);
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  log('DRIVER ERROR', e.message);
  log(appLog.join('').slice(-3000));
  child.kill('SIGTERM');
  process.exit(1);
});
