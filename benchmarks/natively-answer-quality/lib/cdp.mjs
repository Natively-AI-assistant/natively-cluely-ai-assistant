// CDP plumbing for the answer baseline. Talks to ONE isolated `npm run dev:agent`
// instance whose root is NATIVELY_ROOT (never the developer's own app, never the
// shared checkout's agent-browser.json unless NATIVELY_ROOT points there).
import fs from 'node:fs';
import path from 'node:path';

export const APP_ROOT = path.resolve(process.env.NATIVELY_ROOT || process.cwd());

export function cdpPort() {
  return Number(JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'agent-browser.json'), 'utf8')).cdp);
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${cdpPort()}/json`)).json();
}

async function attach(matchFn, label) {
  let list = [];
  for (let i = 0; i < 60; i++) {
    try { list = await targets(); } catch { list = []; }
    if (list.some(matchFn)) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  const t = list.find(matchFn);
  if (!t) throw new Error(`no ${label} target on cdp ${cdpPort()} (is the app up? agent-browser.json can hold a dead port)`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, timeout = 240000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  return { evaluate, close: () => ws.close(), url: t.url };
}

/** launcher = e2e/IPC control plane; overlay = the window that really sends typed asks and Cmd+Enter. */
export async function connectApp() {
  const launcher = await attach(t => t.url.includes('window=launcher'), 'launcher');
  const overlay = await attach(t => /[?&]window=overlay$/.test(t.url), 'overlay');
  const invoke = (channel, ...args) => launcher.evaluate(`window.electronAPI.e2eInvoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`);
  return { launcher, overlay, invoke, close() { launcher.close(); overlay.close(); } };
}
