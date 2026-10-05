// Minimal CDP driver for the isolated dev:agent instance (launcher window).
import fs from 'node:fs';
import path from 'node:path';

export const W = process.env.NATIVELY_ROOT || process.cwd();

export function readEnv() {
  const txt = fs.readFileSync(path.join(W, '.env'), 'utf8');
  return Object.fromEntries(txt.split('\n').map(l => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean)
    .map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
}

export async function connect() {
  const { cdp } = JSON.parse(fs.readFileSync(path.join(W, 'agent-browser.json'), 'utf8'));
  let targets = [];
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch { targets = []; }
    if (targets.some(t => t.url.includes('window=launcher'))) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  const launcher = targets.find(t => t.url.includes('window=launcher'));
  if (!launcher) throw new Error('no launcher window on cdp ' + cdp);
  const ws = new WebSocket(launcher.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, timeout = 180000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const invoke = (channel, ...args) => evaluate(`window.electronAPI.e2eInvoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`);
  return { ws, evaluate, invoke, close: () => ws.close() };
}

export async function setup(c, model) {
  const env = readEnv();
  const r = await c.evaluate(`(async () => {
    const api = window.electronAPI; const out = {};
    out.gem = await api.setGeminiApiKey(${JSON.stringify(env.GEMINI_API_KEY || '')});
    out.ds = await api.setDeepseekApiKey(${JSON.stringify(env.DEEPSEEK_API_KEY || '')});
    out.pro = await api.e2eInvoke('__e2e__:enable-pro');
    out.model = await api.setModel(${JSON.stringify(model)});
    try { out.def = await api.setDefaultModel(${JSON.stringify(model)}); } catch (e) { out.def = String(e); }
    out.cfg = await api.getCurrentLlmConfig();
    return out;
  })()`);
  return { gem: r.gem?.success, ds: r.ds?.success, pro: r.pro, model: r.model, cfg: r.cfg };
}

export async function setMode(c, template) {
  return c.evaluate(`(async () => {
    const api = window.electronAPI; const modes = await api.modesGetAll();
    // The BUILT-IN mode: custom modes share a templateType ("RT Project Notes"
    // is a General-template mode), and the first match used to win — the
    // 2026-09-29 baseline ran 272/300 no-context rows in a custom mode with a
    // notes file attached before this was caught.
    const mode = modes.find(m => m.templateType === ${JSON.stringify(template)} && (m.isBuiltin ?? m.builtIn) === true)
      ?? modes.find(m => m.templateType === ${JSON.stringify(template)});
    if (!mode) return { error: 'no mode' };
    const a = await api.modesSetActive(mode.id);
    return { id: mode.id, name: mode.name, a };
  })()`);
}

const t0 = () => Date.now();
export async function askWTA(c, question, extra = {}) {
  const s = t0();
  const r = await c.invoke('__e2e__:ask', { question, timeoutMs: 90000, ...extra });
  return { surface: 'wta', final: r?.answer ?? '', raw: r?.streamedTokens ?? '', ok: !!r?.success, err: r?.success ? undefined : JSON.stringify(r).slice(0, 300), ms: Date.now() - s };
}
export async function askTyped(c, question, extra = {}, priorTurns = [], opts = {}) {
  if (opts.reset !== false) await c.invoke('__e2e__:reset-session');
  for (const t of priorTurns) await c.invoke('__e2e__:inject-transcript', { speaker: t.speaker, text: t.text, final: true });
  const s = t0();
  const r = await c.invoke('__e2e__:manual-ask', { question, timeoutMs: 90000, ...extra });
  return { surface: 'typed', final: r?.answer ?? '', raw: r?.streamedTokens ?? '', ok: !!r?.success, err: r?.success ? undefined : JSON.stringify(r).slice(0, 300), ms: Date.now() - s };
}

// Faithful Cmd+Enter: the OVERLAY renderer calls generateWhatToSay() with NO
// question after the interviewer line lands in the transcript — exactly what
// handleWhatToSay does. Tokens are timed from the overlay's own batch stream.
export async function connectTarget(match) {
  const { cdp } = JSON.parse(fs.readFileSync(path.join(W, 'agent-browser.json'), 'utf8'));
  const targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json();
  const t = targets.find(x => x.url.includes(match));
  if (!t) throw new Error('no target ' + match);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, timeout = 180000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  return { evaluate, close: () => ws.close() };
}
export async function askHotkey(c, overlay, question, priorTurns = [], opts = {}) {
  if (opts.reset !== false) await c.invoke('__e2e__:reset-session');
  for (const t of priorTurns) await c.invoke('__e2e__:inject-transcript', { speaker: t.speaker, text: t.text, final: true });
  await c.invoke('__e2e__:inject-transcript', { speaker: 'interviewer', text: question, final: true });
  const r = await c.evaluate(`(async () => {
    const api = window.electronAPI; const t0 = performance.now(); const toks = []; let final = null;
    const off1 = api.onIntelligenceTokenBatch((d) => { if (d && d.kind === 'suggested_answer') for (const it of d.items || []) toks.push([Math.round(performance.now() - t0), it.token]); });
    const off2 = api.onIntelligenceSuggestedAnswer((d) => { final = d; });
    let ret, err;
    try { ret = await api.generateWhatToSay(); } catch (e) { err = String(e); }
    await new Promise(r => setTimeout(r, 400));
    try { off1(); off2(); } catch {}
    return { ret, err, final: final && final.answer, question: final && final.question, toks, ms: Math.round(performance.now() - t0) };
  })()`);
  const raw = (r.toks || []).map(x => x[1]).join('');
  const finalText = r.final ?? (typeof r.ret === 'string' ? r.ret : r.ret?.answer) ?? '';
  const firstMs = r.toks?.[0]?.[0] ?? null;
  const first2s = firstMs == null ? '' : (r.toks || []).filter(x => x[0] <= firstMs + 1500).map(x => x[1]).join('');
  return { surface: 'hotkey', final: finalText, raw, ok: !!finalText, err: finalText ? undefined : (r.err || JSON.stringify(r.ret).slice(0, 200)), ms: r.ms, firstTokenMs: firstMs, first1500ms: first2s, heardQuestion: r.question };
}

// Dev-only prompt recorder (NATIVELY_PROMPT_DEBUG=1): wire records + notes.
export async function promptDebug(c, { clear = true, last = 50 } = {}) {
  return c.invoke('__e2e__:prompt-debug', { clear, last });
}
export async function memoryProbe(c) {
  return c.invoke('__e2e__:memory-probe', { prompts: 0 });
}
// Extra provider keys for the provider canary. Claude has no key in .env, so a
// dummy one is set and its host must be in NATIVELY_PROMPT_DEBUG_BLOCK_HOSTS.
export async function setKeys(c, keys) {
  return c.evaluate(`(async () => {
    const api = window.electronAPI; const out = {}; const k = ${JSON.stringify(keys)};
    if (k.openai) out.openai = await api.setOpenaiApiKey(k.openai);
    if (k.openrouter) out.openrouter = await api.setOpenrouterApiKey(k.openrouter);
    if (k.claude) out.claude = await api.setClaudeApiKey(k.claude);
    if (k.natively) out.natively = await api.setNativelyApiKey(k.natively);
    return out;
  })()`);
}
export async function useModel(c, model) {
  return c.evaluate(`(async () => {
    const api = window.electronAPI; const out = {};
    out.model = await api.setModel(${JSON.stringify(model)});
    try { out.def = await api.setDefaultModel(${JSON.stringify(model)}); } catch (e) { out.def = String(e); }
    out.cfg = await api.getCurrentLlmConfig();
    return out;
  })()`);
}
