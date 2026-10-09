#!/usr/bin/env node
// E25: the pre-registered judge-free lines, read from two replays of the fix-up pass on the same drafts.
//   node evidence-rich/report/rule-e25.mjs --ctl e25-ctl --arm e25-sheet --runs er6-dev-main,er6-dev2-main [--prefix ER-C1-] [--blind]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective, answerOf } from '../objective.mjs';
const ER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const blind = args.includes('--blind'); const prefix = opt('prefix', 'ER-');
const items = {}, rows = {};
for (const r of String(opt('runs')).split(',')) { const run = loadRun(path.join(ER, 'results', r)); for (const row of run.rows) { items[row.benchmark_id] = run.ds.byId[row.benchmark_id]; rows[row.benchmark_id] = row; } }
function verdict(item, row, text) {
  const r = { ...row, rendered_answer: text, raw_answer: text };
  const o = objective(item, r); const c = item.oracle ?? {};
  const forb = (c.forbidden_claims ?? []).filter((f) => (f.answer_needles ?? []).length); const t = String(answerOf(r)).toLowerCase().replace(/[*`]/g, '');
  const forbHit = forb.some((f) => f.answer_needles.some((n) => t.includes(String(n).toLowerCase())));
  const calc = !!(c.requires_calculation && c.calculation_oracle); const calcOk = calc ? o.checks.some((x) => x.label === 'calculation result stated' && x.ok) : null;
  const reqOk = o.required_strings.total > 0 ? o.required_strings.found === o.required_strings.total : null;
  return { forbHit, right: (reqOk !== false) && !forbHit && (calcOk !== false) };
}
const load = (n) => fs.readFileSync(path.join(ER, 'results', 'replay', `${n}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((s) => s.id.startsWith(prefix) && items[s.id]);
const q = (xs, p) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null; };
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : '-');
const stat = (name) => {
  const S = load(name).map((s) => { const it = items[s.id], row = rows[s.id]; const d = verdict(it, row, String(row.raw_answer ?? '')); const sh = verdict(it, row, s.text); return { ...s, d, sh, over: /timeout|budget|deadline|abort/i.test(s.outcome) }; });
  const rightDrafts = S.filter((s) => s.d.right);
  return { name, n: S.length, rows: new Set(S.map((s) => s.id)).size, rightDrafts: rightDrafts.length, lost: rightDrafts.filter((s) => !s.sh.right).length, changedRight: rightDrafts.filter((s) => s.changed).length,
    changed: S.filter((s) => s.changed).length, forbShown: S.filter((s) => s.sh.forbHit).length, forbDraft: S.filter((s) => s.d.forbHit).length, repaired: S.filter((s) => s.d.forbHit && !s.sh.forbHit).length,
    gained: S.filter((s) => !s.d.right && s.sh.right).length, p50: q(S.map((s) => s.ms), 0.5), p90: q(S.map((s) => s.ms), 0.9), over: S.filter((s) => s.over).length, outcomes: S.reduce((a, s) => { const k = s.outcome.replace(/:.*/, ''); a[k] = (a[k] ?? 0) + 1; return a; }, {}), S };
};
const C = stat(opt('ctl')), A = stat(opt('arm'));
for (const x of [C, A]) console.log(`${x.name}: ${x.n} samples of ${x.rows} rows; right drafts ${x.rightDrafts}; of those no longer right as shown ${x.lost} (${pct(x.lost, x.rightDrafts)} %), text changed ${x.changedRight} (${pct(x.changedRight, x.rightDrafts)} %); all drafts changed ${x.changed} (${pct(x.changed, x.n)} %); forbidden string as shown ${x.forbShown} (as drafted ${x.forbDraft}; repaired ${x.repaired}); not right as drafted and right as shown ${x.gained}; pass ms p50 ${x.p50} p90 ${x.p90}; not finished in budget ${x.over} (${pct(x.over, x.n)} %); outcomes ${JSON.stringify(x.outcomes)}`);
const pp = (x, d) => 100 * x / Math.max(1, d);
const L = (n, ok, t) => console.log(`${n}. ${ok ? 'holds' : 'FAILS'}: ${t}`);
L(1, pp(A.lost, A.rightDrafts) <= pp(C.lost, C.rightDrafts) + 1, `right drafts no longer right as shown ${pct(C.lost, C.rightDrafts)} % -> ${pct(A.lost, A.rightDrafts)} %`);
L(2, pp(A.changedRight, A.rightDrafts) <= pp(C.changedRight, C.rightDrafts) + 3, `right drafts whose text changes ${pct(C.changedRight, C.rightDrafts)} % -> ${pct(A.changedRight, A.rightDrafts)} %`);
L(3, A.forbShown <= C.forbShown && A.repaired >= C.repaired, `forbidden string as shown ${C.forbShown} -> ${A.forbShown}; repaired ${C.repaired} -> ${A.repaired}`);
L(4, A.p50 - C.p50 <= 150 && A.p90 - C.p90 <= 300 && pp(A.over, A.n) <= pp(C.over, C.n) + 1, `pass time p50 ${C.p50} -> ${A.p50} ms, p90 ${C.p90} -> ${A.p90} ms; not finished in budget ${pct(C.over, C.n)} % -> ${pct(A.over, A.n)} %`);
if (!blind) { const by = (x) => { const m = {}; for (const s of x.S) { const k = items[s.id].mode; (m[k] ??= { n: 0, ch: 0, lost: 0 }); m[k].n++; if (s.changed) m[k].ch++; if (s.d.right && !s.sh.right) m[k].lost++; } return m; }; const c = by(C), a = by(A); console.log('\n| mode | samples | changed ctl | changed arm | right drafts lost ctl | arm |\n|---|---|---|---|---|---|'); for (const k of Object.keys(c)) console.log(`| ${k} | ${c[k].n} | ${c[k].ch} | ${a[k]?.ch ?? '-'} | ${c[k].lost} | ${a[k]?.lost ?? '-'} |`); }
