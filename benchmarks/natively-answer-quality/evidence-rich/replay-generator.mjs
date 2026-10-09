#!/usr/bin/env node
// Replay recorded ANSWER prompts straight to DeepSeek, k samples each, and grade them without a judge (the oracle's
// fixed strings). For measuring the generator's own variance on a class of turns and the effect of a prompt variant.
//   node evidence-rich/replay-generator.mjs --runs er-dev-e13 --select calc|all|<id,id> --k 6 --name base
//        [--variant evidence-rich/replay-variants/<file>.mjs]   (exports transform({ system, user, item }) → { system, user })
// Output: results/replay/gen-<name>.jsonl. Direct DeepSeek (deepseek-flash, temperature 0.2, seed 7, thinking off),
// the app's own request; the [[CALC]] block is removed with the app's own stripCalcScratch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun } from './objective.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const CS = await import(path.join(HERE, 'results', '.cv', 'calcScratch.mjs'));
const KEY = (fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8').match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const variant = opt('variant') ? await import(path.resolve(opt('variant'))) : null;
const name = opt('name', 'base'); const K = Number(opt('k', 6)); const select = String(opt('select', 'calc'));
const OUT = path.join(HERE, 'results', 'replay', `gen-${name}.jsonl`); fs.mkdirSync(path.dirname(OUT), { recursive: true });
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return `${j.run}|${j.id}|${j.k}`; }) : []);
const squash = (t) => String(t ?? '').replace(/[\s,*_`]/g, '').toLowerCase();
const tasks = [];
for (const runName of String(opt('runs')).split(',')) {
  const run = loadRun(path.join(HERE, 'results', runName)); const systems = JSON.parse(fs.readFileSync(path.join(HERE, 'results', runName, 'systems.json'), 'utf8'));
  for (const row of run.rows) {
    const w = run.wire[row.benchmark_id]; if (!w) continue; const item = run.ds.byId[row.benchmark_id];
    const user = (w.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n'); const system = systems[w.system_sha]; if (!system || !user) continue;
    const pick = select === 'all' ? true : select === 'calc' ? /# Calculation\n/.test(user) : select === 'typed' ? row.surface === 'typed' : select === 'heard' ? row.surface !== 'typed' : select.split(',').includes(row.benchmark_id);
    if (!pick) continue;
    const req = (item.oracle?.required_facts ?? []).filter((r) => (r.answer_needles ?? []).length); const forb = (item.oracle?.forbidden_claims ?? []).filter((c) => (c.answer_needles ?? []).length);
    const p = variant ? variant.transform({ system, user, item }) : { system, user };
    for (let k = 0; k < K; k++) if (!done.has(`${runName}|${row.benchmark_id}|${k}`)) tasks.push({ run: runName, id: row.benchmark_id, k, ...p, req, forb, mode: item.mode, condition: item.condition });
  }
}
console.log(`arm ${name}: ${tasks.length} calls`);
// Has a character the user would see arrived? Without a scratch block: as soon as there is text that cannot be an open
// tag. With one: once its close tag is followed by text. (A block the model never closes is timed at the end.)
const OPEN = /^\s*\[\[?\s*calc\s*\]\]?/i; const CLOSE = /\[{1,2}\s*\/\s*calc\s*\]{1,2}/i;
function isVisible(text) {
  const t = text.replace(/^\s+/, ''); if (!t) return false;
  if (OPEN.test(t)) { const m = t.match(CLOSE); return !!m && t.slice(m.index + m[0].length).trim().length > 0; }
  return t.length > 12 || !'[[calc]]'.startsWith(t.replace(/\s+/g, '').toLowerCase());
}
async function one(t) {
  const t0 = Date.now(); let text = ''; let err = null; let first = null; let visible = null;
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-flash', stream: true, temperature: 0.2, seed: 7, max_tokens: 8192, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: t.system }, { role: 'user', content: t.user }] }) });
    if (!res.ok) throw new Error(`deepseek ${res.status}`);
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of res.body) { if (visible === null && isVisible(text)) visible = Date.now() - t0; buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const b = line.slice(5).trim(); if (b === '[DONE]') continue; try { const d = JSON.parse(b).choices?.[0]?.delta?.content ?? ''; if (d) { text += d; if (first === null) first = Date.now() - t0; } } catch { /* */ } } }
  } catch (e) { err = String(e.message).slice(0, 80); }
  const stripped = CS.stripCalcScratch(text); const shown = stripped.text.trim(); const visibleAt = text.indexOf('[[/CALC]]');
  const hits = t.req.map((r) => r.answer_needles.some((n) => squash(shown).includes(squash(n))));
  const forbidden = t.forb.filter((c) => c.answer_needles.some((n) => squash(shown).includes(squash(n)))).map((c) => c.kind ?? 'forbidden');
  return { run: t.run, id: t.id, k: t.k, mode: t.mode, condition: t.condition, err, ms_first: first, ms_visible: visible ?? (shown ? Date.now() - t0 : null), ms_total: Date.now() - t0, calc_block: !!stripped.scratch, calc_chars: stripped.scratch?.length ?? 0, shown_chars: shown.length,
    required: t.req.length, required_hit: hits.filter(Boolean).length, all_required: t.req.length > 0 && hits.every(Boolean), forbidden, text: shown, scratch: stripped.scratch ?? null };
}
let next = 0, n = 0;
await Promise.all(Array.from({ length: Number(opt('concurrency', 3)) }, async () => { while (next < tasks.length) { const t = tasks[next++]; const r = await one(t); fs.appendFileSync(OUT, JSON.stringify(r) + '\n'); if (++n % 30 === 0) console.log(`${n}/${tasks.length}`); } }));
console.log('done', n);
