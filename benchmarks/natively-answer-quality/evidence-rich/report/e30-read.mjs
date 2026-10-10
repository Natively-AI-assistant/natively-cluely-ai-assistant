#!/usr/bin/env node
// E30: the documents-first build in the app against main's recorded runs of the same questions (judge-free, obj-3).
//   node evidence-rich/report/e30-read.mjs --cand er11-dev-e28b,er11-dev2-e28b --main er6-dev-main,er6-dev2-main [--label development]
//   node evidence-rich/report/e30-read.mjs --cand er11-dev-e28b --main er11-dev-main --latency      (same-hour pair: first word)
// Prints counts and medians only: no ids, questions or answers, so it is safe on the unread sets.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective, answerOf, OBJECTIVE_VERSION } from '../objective.mjs';
const ER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PROFILE = new Set(['looking-for-work', 'technical-interview']);
const AGAIN = '# The question again (answer this)\n';
const oneMeeting = (s) => s.replace(/session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'session_0');
const q = (xs, p) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? Math.round(v[Math.min(v.length - 1, Math.floor(p * v.length))]) : null; };
const pc = (a, b) => (b ? `${(100 * a / b).toFixed(1)} %` : '–');

function verdict(item, row) {
  const o = objective(item, row); const c = item.oracle ?? {};
  const forb = (c.forbidden_claims ?? []).filter((f) => (f.answer_needles ?? []).length); const t = String(answerOf(row)).toLowerCase().replace(/[*`]/g, '');
  const forbHit = forb.some((f) => f.answer_needles.some((n) => t.includes(String(n).toLowerCase())));
  const calc = !!(c.requires_calculation && c.calculation_oracle); const calcOk = calc ? o.checks.some((x) => x.label === 'calculation result stated' && x.ok) : null;
  const reqOk = o.required_strings.total > 0 ? o.required_strings.found === o.required_strings.total : null;
  return { forbHit, right: (reqOk !== false) && !forbHit && (calcOk !== false) };
}
// The layout of one recorded request: where the evidence section and the repeated question sit in the user message.
function layout(user) {
  const hasEvidence = /<evidence\b/.test(user);
  const first = user.startsWith('# Evidence (untrusted data');
  const i = user.indexOf('# Question\n'); let body = null;
  if (i >= 0) { const rest = user.slice(i + '# Question\n'.length); const j = rest.search(/\n\n(?:# |<presentation_instruction|<user_instructions)/); body = (j < 0 ? rest : rest.slice(0, j)).trim(); }
  const again = user.lastIndexOf(AGAIN);
  const endsWithQuestion = again >= 0 && body !== null && user.slice(again + AGAIN.length).trim() === body;
  const evEnd = user.lastIndexOf('</evidence>');
  return { hasEvidence, first, again: again >= 0, endsWithQuestion, questionFirst: user.startsWith('# Question\n'), prefix: hasEvidence && first ? oneMeeting(user.slice(0, evEnd)) : null };
}
function read(names) {
  const rows = [];
  for (const n of names.split(',')) { const run = loadRun(path.join(ER, 'results', n));
    for (const row of run.rows) { const item = run.ds.byId[row.benchmark_id]; if (!item) continue;
      const user = (run.wire[row.benchmark_id]?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
      rows.push({ id: row.benchmark_id, run: n, mode: item.mode, profile: PROFILE.has(item.mode), v: verdict(item, row), lay: layout(user),
        answered: !!row.success && !!String(answerOf(row)).trim(), err: row.error_type ?? null, timeout: !!row.timeout,
        edited: row.answer_differs_raw_vs_rendered === true, second: Number(row.second_pass_requests ?? 0), surface: row.surface, ttft: row.ttft_ms,
        inTok: row.input_tokens, cached: row.cached_input_tokens, key: `${n}|${item.mode}|${row.evidence_config ?? item.evidence_config}` }); } }
  return rows;
}
const C = read(opt('cand')), M = read(opt('main')); const label = opt('label', 'rows');
const mById = new Map(M.map((r) => [r.id, r])); const P = C.filter((r) => mById.has(r.id)).map((c) => ({ c, m: mById.get(c.id) }));
console.log(`checks ${OBJECTIVE_VERSION}; candidate ${opt('cand')} (${C.length} rows) against main ${opt('main')} (${M.length} rows); ${P.length} questions in both`);

if (args.includes('--latency')) {
  for (const [name, f] of [['spoken', (r) => r.surface !== 'typed'], ['typed', (r) => r.surface === 'typed']]) {
    const xs = P.filter((p) => f(p.c)); const m50 = q(xs.map((p) => p.m.ttft), 0.5), c50 = q(xs.map((p) => p.c.ttft), 0.5);
    console.log(`first word, ${name} (${xs.length}): main median ${m50} / p90 ${q(xs.map((p) => p.m.ttft), 0.9)} ms -> candidate ${c50} / ${q(xs.map((p) => p.c.ttft), 0.9)} ms (median ${c50 - m50 >= 0 ? '+' : ''}${c50 - m50} ms) ${c50 - m50 <= 150 ? 'HOLDS' : 'FAILS'} (line 6: not more than 150 ms later)`);
  }
  process.exit(0);
}
// 1. built as replayed
const withEv = C.filter((r) => r.lay.hasEvidence), without = C.filter((r) => !r.lay.hasEvidence);
const okEv = withEv.filter((r) => r.lay.first && r.lay.endsWithQuestion).length, okNo = without.filter((r) => !r.lay.again && r.lay.questionFirst).length;
console.log(`1. layout: ${withEv.length} requests carry evidence, ${okEv} have it first and end with the repeated question; ${without.length} carry none, ${okNo} keep the old layout ${okEv === withEv.length && okNo === without.length ? 'HOLDS' : 'FAILS'}`);
const mainNew = M.filter((r) => r.lay.again).length; console.log(`   (main's recorded requests with a repeated question: ${mainNew})`);
// 2. answered
const bad = C.filter((r) => !r.answered || r.err || r.timeout).length;
console.log(`2. answered: ${C.length - bad} of ${C.length}; errors or timeouts or empty: ${bad} ${bad === 0 ? 'HOLDS' : 'FAILS'}`);
// 3 / 4. right by the fixed checks
const line = (name, xs, forbMargin) => { if (!xs.length) return; const mr = xs.filter((p) => p.m.v.right).length, cr = xs.filter((p) => p.c.v.right).length, mf = xs.filter((p) => p.m.v.forbHit).length, cf = xs.filter((p) => p.c.v.forbHit).length;
  const d = 100 * (cr - mr) / xs.length; const up = xs.filter((p) => p.c.v.right && !p.m.v.right).length, down = xs.filter((p) => !p.c.v.right && p.m.v.right).length;
  console.log(`${name} (${xs.length}): right ${mr} (${pc(mr, xs.length)}) -> ${cr} (${pc(cr, xs.length)}), ${d >= 0 ? '+' : ''}${d.toFixed(1)} points (wrong -> right ${up}, right -> wrong ${down}); forbidden-string rows ${mf} -> ${cf}${forbMargin == null ? '' : ` ${d >= -2.0 && cf <= mf + forbMargin ? 'HOLDS' : 'FAILS'} (not more than 2.0 points below; forbidden at most main + ${forbMargin})`}`); };
line(`3/4. right by the fixed checks, ${label}`, P, Number(opt('forbidden-margin', 5)));
line('     the seven modes without a profile', P.filter((p) => !p.c.profile), null);
line('     the two profile modes (E23 and E26 also differ)', P.filter((p) => p.c.profile), null);
if (args.includes('--by-mode')) for (const m of [...new Set(P.map((p) => p.c.mode))].sort()) line(`     ${m}`, P.filter((p) => p.c.mode === m), null);
// 5. the pass and the repair
const sh = (xs, f) => 100 * xs.filter(f).length / Math.max(1, xs.length);
const me = sh(P.map((p) => p.m), (r) => r.edited), ce = sh(P.map((p) => p.c), (r) => r.edited), m2 = sh(P.map((p) => p.m), (r) => r.second >= 2), c2 = sh(P.map((p) => p.c), (r) => r.second >= 2);
const mp = sh(P.map((p) => p.m), (r) => r.second >= 1), cp = sh(P.map((p) => p.c), (r) => r.second >= 1);
console.log(`5. shown answer differs from the draft: ${me.toFixed(1)} % -> ${ce.toFixed(1)} %; rows with a second request: ${mp.toFixed(1)} % -> ${cp.toFixed(1)} %; with two: ${m2.toFixed(1)} % -> ${c2.toFixed(1)} % ${Math.abs(ce - me) <= 5 && c2 <= m2 + 2 ? 'HOLDS' : 'FAILS'} (edited within 5 points; two second requests at most main + 2 points)`);
// context: how often the evidence prefix repeats from one question to the next inside one run, mode and file set
let same = 0, pairs = 0; const last = new Map();
for (const r of C) { if (!r.lay.prefix) continue; if (last.has(r.key)) { pairs++; if (last.get(r.key) === r.lay.prefix) same++; } last.set(r.key, r.lay.prefix); }
console.log(`   context: consecutive questions on the same files whose whole evidence section is byte-identical (session id aside): ${same} of ${pairs} (${pc(same, pairs)})`);
console.log(`   context: first word median, spoken ${q(P.filter((p) => p.c.surface !== 'typed').map((p) => p.m.ttft), 0.5)} -> ${q(P.filter((p) => p.c.surface !== 'typed').map((p) => p.c.ttft), 0.5)} ms, typed ${q(P.filter((p) => p.c.surface === 'typed').map((p) => p.m.ttft), 0.5)} -> ${q(P.filter((p) => p.c.surface === 'typed').map((p) => p.c.ttft), 0.5)} ms (different hours: not a line)`);
