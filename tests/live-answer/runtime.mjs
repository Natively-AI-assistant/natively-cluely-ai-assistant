// Runtime-truth benchmark runner (second spec, 2026-09-29).
//
// node tests/live-answer/runtime.mjs <label> <set> [--models=a,b] [--surfaces=hotkey,typed,wta] [--only=ids]
//   set: base | extra | followups | context | smoke
//
// Needs the isolated instance started with NATIVELY_E2E=1 and
// NATIVELY_PROMPT_DEBUG=1 (see README). Every answer row carries the wire
// record of the request that produced it (provider, model, params, system
// prompt hash, messages, raw response) and the composition note it links to
// (persona action, chatSurface, prompt source). System prompts are stored once
// per hash in <label>.systems.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { connect, setup, setMode, askTyped, askHotkey, askWTA, promptDebug, memoryProbe } from './cdp.mjs';

const require = createRequire(import.meta.url);
const spec = require('./spec2.cjs');
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = process.argv[2];
const set = process.argv[3] || 'base';
const models = arg('models', 'gemini-3.1-flash-lite,deepseek-flash').split(',').filter(Boolean);
const surfaces = arg('surfaces', 'hotkey,typed').split(',').filter(Boolean);
const only = arg('only', '').split(',').filter(Boolean);
const N = Math.max(1, Number(arg('n', '1')) || 1);
const GAP = Math.max(0, Number(arg('gap', '0')) || 0);   // ms to wait before each ask (auto-answer cooldown)
if (!label) { console.error('usage: runtime.mjs <label> <set>'); process.exit(2); }

const RESULTS = process.env.LIVE_ANSWER_RESULTS ? path.resolve(process.env.LIVE_ANSWER_RESULTS) : path.resolve(new URL('./results/', import.meta.url).pathname);
fs.mkdirSync(RESULTS, { recursive: true });
const outFile = path.join(RESULTS, `${label}.jsonl`);
const sysFile = path.join(RESULTS, `${label}.systems.json`);
const systems = fs.existsSync(sysFile) ? JSON.parse(fs.readFileSync(sysFile, 'utf8')) : {};

const c = await connect();

function wireOf(dbg) {
  const records = dbg?.records ?? [];
  // Gemini cache creations: remember name → system text, so a request that
  // references the cache (and carries no systemInstruction) can be resolved.
  for (const r of records) {
    if (/cachedContents/.test(r.path || '') && r.system && r.response) {
      try { const name = JSON.parse(r.response).name; if (name) systems[`cache:${name}`] = r.system; } catch { /* not JSON */ }
    }
  }
  const main = [...records].reverse().find(r => r.note && !/cachedContents/.test(r.path || '')) ?? records[records.length - 1] ?? null;
  if (main) systems[main.systemSha] = main.system;
  if (main && !main.system && main.params?.cachedContent && systems[`cache:${main.params.cachedContent}`]) {
    main.system = systems[`cache:${main.params.cachedContent}`];
    main.systemSha = `cache:${main.params.cachedContent}`;
  }
  return {
    enabled: dbg?.enabled ?? false,
    main: main && {
      seq: main.seq, provider: main.provider, model: main.model, host: main.host, path: main.path,
      params: main.params, stream: main.stream, blocked: main.blocked, status: main.status,
      systemSha: main.systemSha, systemChars: (main.system || '').length,
      messages: main.messages, response: (main.response || '').slice(0, 40000), note: main.note,
    },
    aux: records.filter(r => r !== main).map(r => ({
      provider: r.provider, model: r.model, status: r.status, blocked: r.blocked,
      systemHead: (r.system || '').slice(0, 140), userHead: (r.messages?.[r.messages.length - 1]?.text || '').slice(0, 100),
    })),
    notes: (dbg?.notes ?? []).map(n => ({ surface: n.surface, promptSource: n.promptSource, tier: n.tier, mode: n.mode, extra: n.extra })),
    adapter: (dbg?.adapter ?? []).map(a => ({ provider: a.provider, classification: a.classification })),
  };
}

async function ask(surface, q, prior = [], opts = {}) {
  if (GAP) await new Promise((res) => setTimeout(res, GAP));
  let r;
  try {
    if (surface === 'hotkey') r = await askHotkey(c, null, q, prior, opts);
    else if (surface === 'typed') r = await askTyped(c, q, {}, prior, opts);
    else r = await askWTA(c, q);
  } catch (e) { r = { surface, ok: false, err: String(e).slice(0, 300), final: '', raw: '' }; }
  const dbg = await promptDebug(c, { clear: true });
  return { ...r, wire: wireOf(dbg) };
}

function write(rec) {
  // Contamination guard: a no-context row must not carry reference-file or
  // profile evidence (a wrong active mode or a leftover profile would).
  if (rec.set !== 'context') {
    const txt = (rec.wire?.main?.messages ?? []).map(m => m.text).join('\n');
    if (/source_type="(REFERENCE_FILE|RESUME|CANDIDATE_FILE|PROFILE[A-Z_]*)"/.test(txt)) {
      rec.contaminated = true;
      console.error(`CONTAMINATED ${rec.id} ${rec.surface} ${rec.model}: reference/profile evidence in a no-context row`);
    }
  }
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  const m = rec.wire?.main;
  console.log(`${rec.id}${rec.turn ? '#' + rec.turn : ''} ${rec.surface} ${rec.model} ${rec.ok ? 'ok' : 'ERR ' + (rec.err || '')} ${rec.ms}ms [${m ? `${m.provider}/${m.model} ${m.note?.promptSource ?? 'no-note'} ${m.note?.extra?.turnFacts?.personaAction ?? ''}` : 'no-wire'}] ${JSON.stringify((rec.final || '').slice(0, 90))}`);
}

async function modeFor(key) {
  const builtIn = { general: 'general', 'looking-for-work': 'looking-for-work' };
  if (builtIn[key]) return setMode(c, builtIn[key]);
  const custom = {
    cv: { name: 'RT CV', template: 'looking-for-work', file: 'priya_raman_resume.txt', content: spec.RESUME },
    notes: { name: 'RT Project Notes', template: 'general', file: 'checkout_project_notes.txt', content: spec.PROJECT_NOTES },
    office: { name: 'RT Office Notes', template: 'general', file: 'office_notes.txt', content: spec.IRRELEVANT_NOTES },
  }[key];
  if (!custom) throw new Error('unknown mode ' + key);
  let modes = await c.evaluate(`window.electronAPI.modesGetAll()`);
  let m = modes.find(x => x.name === custom.name);
  if (!m) {
    const r = await c.evaluate(`window.electronAPI.modesCreate({ name: ${JSON.stringify(custom.name)}, templateType: ${JSON.stringify(custom.template)} })`);
    m = r?.mode ?? r;
    if (!m?.id) { modes = await c.evaluate(`window.electronAPI.modesGetAll()`); m = modes.find(x => x.name === custom.name); }
    const add = await c.invoke('__e2e__:add-reference-file', { modeId: m.id, fileName: custom.file, content: custom.content });
    console.log(`created mode ${custom.name}: file attached=${add?.success} ${add?.error || ''}`);
    await c.invoke('__e2e__:prewarm-mode', m.id);
  }
  await c.evaluate(`window.electronAPI.modesSetActive(${JSON.stringify(m.id)})`);
  return { id: m.id, name: m.name };
}

async function withProfile(on) {
  if (!on) return c.invoke('__e2e__:clear-profile');
  const file = path.join(os.tmpdir(), `rt-resume-${process.pid}.txt`);
  fs.writeFileSync(file, spec.RESUME);
  const r = await c.invoke('__e2e__:ingest-profile-doc', { filePath: file, docType: 'resume' });
  console.log('profile ingest:', JSON.stringify({ success: r?.success, error: r?.error, hasStructuredResume: r?.hasStructuredResume }));
  return r;
}

const pick = (items) => (only.length ? items.filter(i => only.includes(i.id)) : items);

for (const model of models) {
  const s = await setup(c, model);
  console.log('setup', model, JSON.stringify({ gem: s.gem, ds: s.ds, provider: s.cfg?.provider, modelId: s.cfg?.model }));
  // Harness check: after a reset, the V3 conversation state must be empty.
  await c.invoke('__e2e__:reset-session');
  const probe = await memoryProbe(c);
  const liveTurns = (probe?.states ?? []).filter(st => st.key && probe.conversationSessionId && String(st.key).includes(probe.conversationSessionId)).reduce((n, st) => n + (st.turns?.length ?? 0), 0);
  console.log('reset check: conversationSessionId', probe?.conversationSessionId, 'turns in live session state', liveTurns, 'total states', probe?.states?.length);

  if (set === 'base' || set === 'extra' || set === 'smoke') {
    const items = pick(set === 'extra' ? spec.EXTRA : set === 'smoke' ? spec.BASE.slice(0, 3) : spec.BASE);
    await modeFor('general');
    for (let sample = 1; sample <= N; sample++) for (const it of items) for (const surface of surfaces) {
      const r = await ask(surface, it.q);
      write({ label, set, id: it.id, kind: it.kind, q: it.q, model, mode: 'general', surface, sample, ...r });
    }
  }

  if (set === 'tasks') {
    await modeFor('general');
    for (const it of pick(spec.TASKS)) for (const surface of surfaces) {
      if (surface === 'wta') continue;
      const r = await ask(surface, it.q, it.prior || []);
      write({ label, set, id: it.id, kind: it.kind, q: it.q, model, mode: 'general', surface, ...r });
    }
  }

  if (set === 'followups') {
    await modeFor('general');
    for (const ch of pick(spec.FOLLOWUPS)) for (const surface of surfaces) {
      if (surface === 'wta') continue;
      const t1 = await ask(surface, ch.parent);
      write({ label, set, id: ch.id, kind: ch.kind, chain: ch.id, turn: 1, q: ch.parent, model, mode: 'general', surface, ...t1 });
      let spoken = t1.final || '';
      // An interruption: the interviewer cuts in after the user's first sentence.
      if (ch.interrupt) spoken = (spoken.split(/(?<=[.!?])\s+/)[0] || spoken);
      const prior = surface === 'hotkey' && spoken ? [{ speaker: 'user', text: spoken.replace(/\[\[GIST\]\].*$/s, '').trim() }] : [];
      const t2 = await ask(surface, ch.follow, prior, { reset: false });
      write({ label, set, id: ch.id, kind: ch.kind, chain: ch.id, turn: 2, q: ch.follow, parentQ: ch.parent, parentAnswer: t1.final, model, mode: 'general', surface, ...t2 });
    }
  }

  if (set === 'context') {
    const items = pick(spec.CONTEXT);
    const plain = items.filter(i => !i.profile);
    const profiled = items.filter(i => i.profile);
    await withProfile(false);
    for (const it of plain) for (const surface of surfaces) {
      if (surface === 'wta') continue;
      await modeFor(it.mode);
      const r = await ask(surface, it.q, it.prior || []);
      write({ label, set, id: it.id, ctx: it.ctx, q: it.q, model, mode: it.mode, surface, ...r });
    }
    if (profiled.length) {
      await withProfile(true);
      for (const it of profiled) for (const surface of surfaces) {
        if (surface === 'wta') continue;
        await modeFor(it.mode);
        const r = await ask(surface, it.q, it.prior || []);
        write({ label, set, id: it.id, ctx: it.ctx, q: it.q, model, mode: it.mode, surface, ...r });
      }
      await withProfile(false);
    }
  }
}

fs.writeFileSync(sysFile, JSON.stringify(systems));
await setMode(c, 'general');
c.close();
process.exit(0);
