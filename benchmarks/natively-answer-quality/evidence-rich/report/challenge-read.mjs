#!/usr/bin/env node
// Judge-free reading of a run of the challenge, challenge-val or code1 set: deterministic checks only (obj-3).
//   node evidence-rich/report/challenge-read.mjs <run>[,<run>] [--blind] [--list]
// --blind: aggregates only, no id (challenge-val). --list: one line per failing row (never with --blind).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective, answerOf, OBJECTIVE_VERSION } from '../objective.mjs';
const ER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const blind = args.includes('--blind'); const list = args.includes('--list') && !blind;
const rows = [];
for (const r of String(args.find((a) => !a.startsWith('--'))).split(',')) { const run = loadRun(path.join(ER, 'results', r));
  for (const row of run.rows) { const it = run.ds.byId[row.benchmark_id]; if (!it) continue; const o = objective(it, row); const c = it.oracle ?? {};
    const calc = !!(c.requires_calculation && c.calculation_oracle); const isDate = calc && (/\d{4}-\d{2}-\d{2}|date\(|datetime\(|time\(|business|timedelta|weekday/i.test(String(c.calculation_oracle.expression)) || /date|time|day|month|year|week|hour|minute/i.test(String(c.calculation_oracle.unit)));
    const code = !!(c.requires_code_validation && c.code_oracle); const ct = o.checks.find((x) => x.label === 'code tests'); const notRun = code && !ct;
    const forb = (c.forbidden_claims ?? []).filter((f) => (f.answer_needles ?? []).length); const text = String(answerOf(row)).toLowerCase().replace(/[*`]/g, '');
    const forbHit = forb.some((f) => f.answer_needles.some((n) => text.includes(String(n).toLowerCase())));
    const kind = code ? 'code' : calc ? (isDate ? 'date or time' : 'calculation') : it.condition === 'conflict_stale' ? 'version conflict' : it.condition === 'missing_evidence' ? 'absent fact' : it.condition === 'followup' ? 'follow-up' : 'which value';
    const calcOk = calc ? o.checks.some((x) => x.label === 'calculation result stated' && x.ok) : null; const wrongKnown = calc ? o.checks.some((x) => x.label === 'calculation result' && !x.ok) : null;
    const reqOk = o.required_strings.total ? o.required_strings.found === o.required_strings.total : null;
    // one verdict per row: right when its own check passes (calc -> result stated; code -> tests; else every required string and no forbidden string)
    const right = code ? (ct ? ct.ok : false) : calc ? (calcOk && !forbHit) : (reqOk !== false && !forbHit);
    rows.push({ id: it.id, mode: it.mode, kind, cond: it.condition, surface: it.surface, calc, calcOk, wrongKnown, code, codeOk: ct ? ct.ok : null, codeDetail: ct?.detail ?? null, notRun, reqOk, forbHit, right, flags: o.flags, ttft: row.ttft_ms, answered: row.success !== false, answer: String(answerOf(row)).replace(/\s+/g, ' ').slice(0, 230), q: it.question, want: calc ? `${c.calculation_oracle.result} (${String(c.calculation_oracle.expression).slice(0, 80)})` : null });
  } }
const pct = (a, f) => `${a.filter(f).length}/${a.length} (${a.length ? (100 * a.filter(f).length / a.length).toFixed(0) : '-'} %)`;
console.log(`checks ${OBJECTIVE_VERSION}; ${rows.length} rows, ${rows.filter((r) => r.answered).length} answered; first word median ${Math.round([...rows.map((r) => r.ttft).filter((x) => x != null)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0)} ms`);
console.log(`right by the row's own deterministic check: ${pct(rows, (r) => r.right)}`);
console.log('\n| kind | rows | right | calc result stated | known wrong result | forbidden string | code tests pass | code not executed |\n|---|---|---|---|---|---|---|---|');
for (const k of [...new Set(rows.map((r) => r.kind))].sort()) { const g = rows.filter((r) => r.kind === k); const c = g.filter((r) => r.calc), d = g.filter((r) => r.code);
  console.log(`| ${k} | ${g.length} | ${pct(g, (r) => r.right)} | ${c.length ? pct(c, (r) => r.calcOk) : '-'} | ${c.length ? c.filter((r) => r.wrongKnown).length : '-'} | ${g.filter((r) => r.forbHit).length} | ${d.length ? pct(d, (r) => r.codeOk) : '-'} | ${d.length ? d.filter((r) => r.notRun).length : '-'} |`); }
console.log('\n| mode | rows | right |\n|---|---|---|'); for (const m of [...new Set(rows.map((r) => r.mode))]) { const g = rows.filter((r) => r.mode === m); console.log(`| ${m} | ${g.length} | ${pct(g, (r) => r.right)} |`); }
console.log(`\nspoken ${pct(rows.filter((r) => r.surface === 'hotkey'), (r) => r.right)} · typed ${pct(rows.filter((r) => r.surface === 'typed'), (r) => r.right)}`);
if (list) for (const r of rows.filter((x) => !x.right)) console.log(`\n${r.id} [${r.kind}/${r.cond}/${r.surface}]${r.forbHit ? ' FORBIDDEN' : ''}${r.wrongKnown ? ' KNOWN-WRONG' : ''}${r.code ? ` code: ${r.codeDetail ?? 'not executed'}` : ''}\n  Q: ${r.q.replace(/\s+/g, ' ').slice(0, 200)}${r.want ? `\n  WANT: ${r.want}` : ''}\n  A: ${r.answer}`);
