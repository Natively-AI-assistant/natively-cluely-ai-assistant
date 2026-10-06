// E16c rule: drafts replayed twice per build on the 80 rows E16b changes.  ER_JUDGE=astra node evidence-rich/report/rule-e16c.mjs
import fs from 'node:fs';
import { readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'astra';
const ids = JSON.parse(fs.readFileSync('evidence-rich/results/replay/e16c-ids.json', 'utf8'));
const PAIR = { 'er-dev-e13c': 'er-dev-e16b', 'er-dev2-e13c': 'er-dev2-e16b' };
const J = (name) => { const m = new Map(); for (const j of readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`)) if (j.ok) m.set(j.benchmark_id, j); return m; };
const FL = new Set(['unsupported_personal_claim', 'wrong_profile_used']);
const rows = []; let missing = 0;
for (const [ctl, nw] of Object.entries(PAIR)) { const C = [0, 1].map((k) => J(`rg-e16c-ctl-k${k}--${ctl}`)), N = [0, 1].map((k) => J(`rg-e16c-new-k${k}--${nw}`));
  for (const id of ids[ctl]) { const c = C.map((m) => m.get(id)).filter(Boolean), n = N.map((m) => m.get(id)).filter(Boolean); if (c.length < 2 || n.length < 2) { missing++; continue; }
    const mean = (a) => a.reduce((s, j) => s + j.official.overall, 0) / a.length; const hard = (a) => a.filter((j) => j.official.hard_fail).length / a.length; const fl = (a) => a.filter((j) => (j.judgment.hard_flags ?? []).some((x) => FL.has(x))).length;
    rows.push({ id, c: mean(c), n: mean(n), hc: hard(c), hn: hard(n), fc: fl(c), fn: fl(n) }); } }
const f = (x, d = 2) => x.toFixed(d); const sum = (a) => a.reduce((x, y) => x + y, 0);
const d = rows.map((r) => r.n - r.c); const md = sum(d) / rows.length; const sd = Math.sqrt(sum(d.map((x) => (x - md) ** 2)) / Math.max(1, rows.length - 1)); const ci = 1.96 * sd / Math.sqrt(rows.length);
const up = rows.filter((r) => r.n - r.c > 1.5), down = rows.filter((r) => r.n - r.c < -1.5);
console.log(`judge ${JUDGE}; rows with both replays of both builds judged: ${rows.length} of 80${missing ? ` (NOT YET: ${missing})` : ''}`);
const L = (n, ok, t) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  (${t})`);
L('1 mean of (new − control) ≥ +0.25', md >= 0.25, `${f(sum(rows.map((r) => r.c)) / rows.length)} → ${f(sum(rows.map((r) => r.n)) / rows.length)}, ${md >= 0 ? '+' : ''}${f(md)} ±${f(ci)}`);
L('2 hard fails ≤ control', sum(rows.map((r) => r.hn)) <= sum(rows.map((r) => r.hc)), `${f(sum(rows.map((r) => r.hc)), 1)} → ${f(sum(rows.map((r) => r.hn)), 1)}`);
L('3 rows falling by more than 1.5 ≤ half the rows rising by more than 1.5', down.length <= up.length / 2, `rise ${up.length}, fall ${down.length}`);
L('4 replays flagged unsupported_personal_claim / wrong_profile_used ≤ control + 2', sum(rows.map((r) => r.fn)) <= sum(rows.map((r) => r.fc)) + 2, `${sum(rows.map((r) => r.fc))} → ${sum(rows.map((r) => r.fn))}`);
console.log('  rise:', up.map((r) => `${r.id} ${f(r.c, 1)}→${f(r.n, 1)}`).join(', ')); console.log('  fall:', down.map((r) => `${r.id} ${f(r.c, 1)}→${f(r.n, 1)}`).join(', '));
