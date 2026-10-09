#!/usr/bin/env node
// E26: the candidate's app run on the profile modes against main's recorded runs of the same rows (judge-free, obj-3).
//   node evidence-rich/report/e26-read.mjs --cand er9-dev-e26,er9-dev2-e26,... --main er6-dev-main,er6-dev2-main,...
// Rows of unread sets (challenge-val, prov1-val) are only ever counted, never printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective, answerOf, OBJECTIVE_VERSION } from '../objective.mjs';
import * as e23 from '../replay-variants/e23-experience-pairing.mjs';
const ER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k) => args[args.indexOf(`--${k}`) + 1];
const MODES = new Set(['looking-for-work', 'technical-interview']); const BLIND = /^ER-(CV1|PVV1|H)-/;
function verdict(item, row) {
  const o = objective(item, row); const c = item.oracle ?? {};
  const forb = (c.forbidden_claims ?? []).filter((f) => (f.answer_needles ?? []).length); const t = String(answerOf(row)).toLowerCase().replace(/[*`]/g, '');
  const forbHit = forb.some((f) => f.answer_needles.some((n) => t.includes(String(n).toLowerCase())));
  const calc = !!(c.requires_calculation && c.calculation_oracle); const calcOk = calc ? o.checks.some((x) => x.label === 'calculation result stated' && x.ok) : null;
  const reqOk = o.required_strings.total > 0 ? o.required_strings.found === o.required_strings.total : null;
  return { forbHit, right: (reqOk !== false) && !forbHit && (calcOk !== false) };
}
function read(names) {
  const out = new Map(); const modes = {}; let rejected = 0, withEntries = 0, promptRows = 0; const rejectedSeen = new Map();
  for (const n of names.split(',')) { const run = loadRun(path.join(ER, 'results', n));
    for (const row of run.rows) { const it = run.ds.byId[row.benchmark_id]; if (!it || !MODES.has(it.mode)) continue;
      const v = verdict(it, row); const user = (run.wire[row.benchmark_id]?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
      const a = user ? e23.analyse(user) : []; if (user) promptRows++; const ent = a.reduce((x, r) => x + r.entries.length, 0); if (ent) withEntries++;
      for (const r of a) for (const x of r.rejected) { rejected++; if (!BLIND.test(row.benchmark_id)) rejectedSeen.set(`${x.entry.role} @ ${x.entry.company}`, x.problem); }
      modes[row.pi_extraction_mode ?? 'none'] = (modes[row.pi_extraction_mode ?? 'none'] ?? 0) + 1;
      out.set(row.benchmark_id, { id: row.benchmark_id, it, row, v, answered: !!row.success && !!String(answerOf(row)).trim(), err: row.error_type ?? null, timeout: !!row.timeout, ttft: row.ttft_ms, kind: String(it.category ?? ''), derivedBlocks: a.reduce((x, r) => x + r.derived.length, 0) });
    } }
  return { rows: out, modes, rejected, withEntries, promptRows, rejectedSeen };
}
const q = (xs, p) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(v.length * p))]) : null; };
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : '-');
const C = read(opt('cand')), M = read(opt('main'));
const ids = [...C.rows.keys()].filter((id) => M.rows.has(id));
console.log(`checks ${OBJECTIVE_VERSION}; candidate ${C.rows.size} rows, main ${M.rows.size} rows, ${ids.length} in both`);
console.log(`1. extraction mode per row: candidate ${JSON.stringify(C.modes)} · main ${JSON.stringify(M.modes)}`);
console.log(`2. derived experience entries the pairing rule rejects, over all recorded prompts: candidate ${C.rejected} (rows with entries ${C.withEntries} of ${C.promptRows}) · main ${M.rejected} (rows with entries ${M.withEntries} of ${M.promptRows})`);
for (const [e, p] of C.rejectedSeen) console.log(`      candidate, rejected: ${p}  ${e.slice(0, 120)}`);
const part = (name, f) => { const x = ids.filter(f); const c = x.filter((id) => C.rows.get(id).v.right).length, m = x.filter((id) => M.rows.get(id).v.right).length; console.log(`   ${name.padEnd(46)} ${String(x.length).padStart(3)} rows: main ${m} (${pct(m, x.length)} %) -> candidate ${c} (${pct(c, x.length)} %); forbidden-string rows ${x.filter((id) => M.rows.get(id).v.forbHit).length} -> ${x.filter((id) => C.rows.get(id).v.forbHit).length}`); return { n: x.length, c, m }; };
console.log('3. rows right by the fixed checks');
const all = part('all rows', () => true);
part('looking-for-work', (id) => C.rows.get(id).it.mode === 'looking-for-work'); part('technical-interview', (id) => C.rows.get(id).it.mode === 'technical-interview');
part('development (dev + dev2)', (id) => /^ER-D2?-/.test(id)); part('challenge + challenge-val', (id) => /^ER-C(V)?1-/.test(id)); part('prov1 + prov1-val', (id) => /^ER-PVV?1-/.test(id));
const emp = part('which employer / length of time (prov sets)', (id) => /^prov_(employer|time)/.test(C.rows.get(id).kind));
part('own history, posting only (prov sets)', (id) => /^prov_(history|own_history)/.test(C.rows.get(id).kind));
const sp = ids.filter((id) => C.rows.get(id).row.surface !== 'typed'), ty = ids.filter((id) => C.rows.get(id).row.surface === 'typed');
const mS = q(sp.map((id) => M.rows.get(id).ttft), 0.5), cS = q(sp.map((id) => C.rows.get(id).ttft), 0.5);
console.log(`4. first word, spoken (${sp.length}): main median ${mS} / p90 ${q(sp.map((id) => M.rows.get(id).ttft), 0.9)} ms -> candidate ${cS} / ${q(sp.map((id) => C.rows.get(id).ttft), 0.9)} ms; typed (${ty.length}): ${q(ty.map((id) => M.rows.get(id).ttft), 0.5)} -> ${q(ty.map((id) => C.rows.get(id).ttft), 0.5)} ms; candidate turns over 5 s ${ids.filter((id) => C.rows.get(id).ttft > 5000).length}`);
const bad = [...C.rows.values()].filter((r) => !r.answered || r.err || r.timeout).length;
console.log(`5. candidate rows not answered, with an error or a timeout: ${bad}`);
const L = (n, ok, t) => console.log(`line ${n}: ${ok ? 'holds' : 'FAILS'} (${t})`);
L(1, Object.keys(C.modes).every((k) => k === 'llm' || k === 'none'), 'every profile row extracted by the model');
L(2, C.rejected === 0, 'no derived experience entry rejected');
L(3, 100 * all.c / all.n >= 100 * all.m / all.n - 2 && emp.c >= emp.m, 'all rows not more than 2 points below main; employer and time rows not below');
L(4, cS - mS <= 150 && ids.filter((id) => C.rows.get(id).ttft > 5000).length === 0, `spoken median ${cS - mS >= 0 ? '+' : ''}${cS - mS} ms`);
L(5, bad === 0 && C.rows.size === M.rows.size, 'every row answered');
if (args.includes('--list')) for (const id of ids.filter((x) => !BLIND.test(x) && C.rows.get(x).v.right !== M.rows.get(x).v.right)) { const c = C.rows.get(id), m = M.rows.get(id); console.log(`\n${id} [${c.kind || c.it.condition}] main ${m.v.right ? 'right' : 'wrong'} -> candidate ${c.v.right ? 'right' : 'wrong'}\n  Q: ${String(c.it.question).slice(0, 150)}\n  main: ${String(answerOf(m.row)).replace(/\n+/g, ' ').slice(0, 230)}\n  cand: ${String(answerOf(c.row)).replace(/\n+/g, ' ').slice(0, 230)}`); }
