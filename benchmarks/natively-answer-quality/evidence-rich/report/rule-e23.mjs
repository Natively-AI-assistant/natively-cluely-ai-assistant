#!/usr/bin/env node
// E23 / E24: which recorded prompts each arm changes, and the pre-registered lines read from the replays.
//   node evidence-rich/report/rule-e23.mjs select e23|e24 <run,run>            ids whose prompt the arm changes
//   node evidence-rich/report/rule-e23.mjs show <run,run>                       what the pairing rule rejects, per profile
//   node evidence-rich/report/rule-e23.mjs read --base <arm> --arm <arm> [--prefix ER-D] [--kinds a,b] [--blind]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e23 from '../replay-variants/e23-experience-pairing.mjs';
import * as e24 from '../replay-variants/e24-posting-only-story.mjs';
import { loadRun } from '../objective.mjs';
const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const cmd = args[0];
const prompts = (runs) => runs.split(',').flatMap((r) => { const run = loadRun(path.join(HERE, 'results', r)); return run.rows.map((row) => ({ run: r, row, item: run.ds.byId[row.benchmark_id], user: (run.wire[row.benchmark_id]?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n') })); });

if (cmd === 'select') {
  const v = args[1] === 'e24' ? e24 : e23;
  console.log(prompts(args[2]).filter((p) => p.user && v.transform({ system: '', user: p.user }).user !== p.user).map((p) => p.row.benchmark_id).join(','));
} else if (cmd === 'show') {
  const seen = new Map(); let rows = 0, changed = 0, noWhole = 0, removedChars = [];
  for (const p of prompts(args[1])) {
    if (!p.user) continue; const a = e23.analyse(p.user); if (!a.length) continue; rows++;
    const after = e23.transform({ system: '', user: p.user }).user; if (after !== p.user) { changed++; removedChars.push(p.user.length - after.length); }
    for (const r of a) { if (!r.hasWhole && r.entries.length) noWhole++; const key = `${p.row.pi_state}`; if (!seen.has(key)) seen.set(key, new Map()); for (const e of r.entries) { const pr = r.rejected.find((x) => x.entry === e)?.problem ?? (r.hasWhole ? 'kept' : 'kept (no résumé text in the prompt)'); seen.get(key).set(`${e.role} @ ${e.company}`, pr); } }
  }
  removedChars.sort((a, b) => a - b);
  console.log(`rows with résumé evidence ${rows}; prompt changes on ${changed}; rows with derived entries but no whole résumé in the prompt ${noWhole}; characters removed median ${removedChars[removedChars.length >> 1] ?? 0}`);
  for (const [k, m] of seen) { console.log(`\npi_state ${k}`); for (const [e, pr] of m) console.log(`  ${pr.padEnd(26)} ${e.slice(0, 150)}`); }
} else if (cmd === 'read') {
  const load = (n) => fs.readFileSync(path.join(HERE, 'results', 'replay', `gen-${n}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const prefix = opt('prefix', 'ER-'); /* --kinds: category prefixes */ const blind = args.includes('--blind'); const kinds = opt('kinds') ? new Set(opt('kinds').split(',')) : null;
  const ds = {}; for (const f of fs.readdirSync(path.join(HERE, 'datasets'))) for (const it of JSON.parse(fs.readFileSync(path.join(HERE, 'datasets', f), 'utf8')).items) ds[it.id] = it;
  const squash = (t) => String(t ?? '').replace(/[\s,*_`]/g, '').toLowerCase();
  // a sample is RIGHT when it has every required string, no forbidden string, and the calculation result where there is one
  const right = (s, it) => {
    const c = it.oracle?.calculation_oracle; const calcOk = !it.oracle?.requires_calculation || !c ? true : (c.accepted_forms ?? []).some((f) => squash(s.text).includes(squash(f)));
    return (s.required === 0 || s.all_required) && s.forbidden.length === 0 && calcOk;
  };
  const pick = (rows) => rows.filter((s) => s.id.startsWith(prefix) && !s.err && (!kinds || [...kinds].some((k) => String(ds[s.id]?.category ?? '').startsWith(k))));
  const A = pick(load(opt('base'))), B = pick(load(opt('arm')));
  const by = (rows) => { const m = new Map(); for (const s of rows) { if (!m.has(s.id)) m.set(s.id, []); m.get(s.id).push(s); } return m; };
  const a = by(A), b = by(B); const ids = [...a.keys()].filter((id) => b.has(id));
  const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : 0);
  const boot = (ds2) => { if (!ds2.length) return [0, 0]; const out = []; let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; for (let i = 0; i < 4000; i++) { let t = 0; for (let j = 0; j < ds2.length; j++) t += ds2[Math.floor(rnd() * ds2.length)]; out.push(t / ds2.length); } out.sort((x, y) => x - y); return [out[100], out[3899]]; };
  const pct = (x) => (100 * x).toFixed(1);
  const withReq = ids.filter((id) => a.get(id)[0].required > 0);
  const dReq = withReq.map((id) => share(b.get(id), (s) => s.all_required) - share(a.get(id), (s) => s.all_required));
  const ciReq = boot(dReq);
  const reqA = share(withReq.flatMap((id) => a.get(id)), (s) => s.all_required), reqB = share(withReq.flatMap((id) => b.get(id)), (s) => s.all_required);
  const forbA = ids.flatMap((id) => a.get(id)).filter((s) => s.forbidden.length).length, forbB = ids.flatMap((id) => b.get(id)).filter((s) => s.forbidden.length).length;
  const dRight = ids.map((id) => share(b.get(id), (s) => right(s, ds[id])) - share(a.get(id), (s) => right(s, ds[id])));
  const ciRight = boot(dRight);
  const rA = share(ids.flatMap((id) => a.get(id).map((s) => right(s, ds[id]))), Boolean), rB = share(ids.flatMap((id) => b.get(id).map((s) => right(s, ds[id]))), Boolean);
  const fell = ids.filter((id) => a.get(id).filter((s) => right(s, ds[id])).length >= 3 && b.get(id).filter((s) => right(s, ds[id])).length <= 1);
  const rose = ids.filter((id) => a.get(id).filter((s) => right(s, ds[id])).length <= 1 && b.get(id).filter((s) => right(s, ds[id])).length >= 3);
  const med = (xs) => { const v = xs.filter((x) => x != null).sort((x, y) => x - y); return v[v.length >> 1] ?? null; };
  console.log(`${opt('base')} -> ${opt('arm')}  prefix ${prefix}${kinds ? ` kinds ${[...kinds].join('+')}` : ''}: ${ids.length} rows, ${A.length} / ${B.length} samples`);
  console.log(`  samples with every required string (${withReq.length} rows): ${pct(reqA)} % -> ${pct(reqB)} %; paired change ${pct(dReq.reduce((x, y) => x + y, 0) / Math.max(1, dReq.length))} points (95 % ${pct(ciReq[0])} to ${pct(ciReq[1])})`);
  console.log(`  samples with a forbidden string: ${forbA} -> ${forbB}`);
  console.log(`  right samples (required, no forbidden, calculation): ${pct(rA)} % -> ${pct(rB)} %; paired change ${pct(dRight.reduce((x, y) => x + y, 0) / Math.max(1, dRight.length))} points (95 % ${pct(ciRight[0])} to ${pct(ciRight[1])})`);
  console.log(`  rows that rose (<=1 right -> >=3 right): ${rose.length}${blind ? '' : ' ' + rose.join(' ')}; rows that fell (>=3 -> <=1): ${fell.length}${blind ? '' : ' ' + fell.join(' ')}`);
  console.log(`  first visible character: median ${med(A.map((s) => s.ms_visible))} -> ${med(B.map((s) => s.ms_visible))} ms; shown length median ${med(A.map((s) => s.text.length))} -> ${med(B.map((s) => s.text.length))} chars`);
} else { console.error('usage: rule-e23.mjs select e23|e24 <runs> | show <runs> | read --base A --arm B [--prefix P] [--kinds k,k] [--blind]'); process.exit(2); }
