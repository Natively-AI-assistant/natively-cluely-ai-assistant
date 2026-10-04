// Paired rule check for the autopilot series (cc judge by default): node evidence-rich/report/rule-pair.mjs <control run> <candidate run>
// Prints the lines used by E13-style rules: delivery, rows that gained their evidence, no-document rows, all rows, first word.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'cc';
const [ca, cb] = process.argv.slice(2);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f = (x, d = 2) => (x == null ? 'n/a' : x.toFixed(d));
const load = (name) => { const run = loadRun(`evidence-rich/results/${name}`); const J = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j.official])); return { run, J }; };
const A = load(ca), B = load(cb); const P = [];
for (const ra of A.run.rows) { const rb = B.run.rowsById[ra.benchmark_id]; const a = A.J[ra.benchmark_id], b = B.J[ra.benchmark_id]; if (!rb || !a || !b) continue; const item = A.run.ds.byId[ra.benchmark_id]; P.push({ item, ra, rb, a, b, fa: funnel(item, ra, A.run), fb: funnel(item, rb, B.run) }); }
const line = (l, xs) => { const d = xs.map((p) => p.b.overall - p.a.overall); console.log(`${l.padEnd(58)} n ${String(xs.length).padStart(3)}  ${f(mean(xs.map((p) => p.a.overall)))} → ${f(mean(xs.map((p) => p.b.overall)))}  Δ ${f(mean(d))}  hard ${xs.filter((p) => p.a.hard_fail).length} → ${xs.filter((p) => p.b.hard_fail).length}`); };
console.log(`judge ${JUDGE}; pairs ${P.length}; ${ca} → ${cb}`);
const req = P.filter((p) => p.fa.evidence_required);
console.log(`rows with every needed fact in the prompt: ${req.filter((p) => p.fa.evidence_delivered === true).length} → ${req.filter((p) => p.fb.evidence_delivered === true).length} of ${req.length}`);
line('all rows', P);
line('evidence missing in control, delivered in candidate', req.filter((p) => p.fa.evidence_delivered === false && p.fb.evidence_delivered === true));
line('evidence delivered in control, missing in candidate', req.filter((p) => p.fa.evidence_delivered === true && p.fb.evidence_delivered === false));
line('need no document (missing + irrelevant)', P.filter((p) => ['missing_evidence', 'irrelevant_source'].includes(p.item.condition)));
for (const c of ['grounded_single', 'multi_source', 'conflict_stale', 'missing_evidence', 'irrelevant_source', 'followup']) line(`condition ${c}`, P.filter((p) => p.item.condition === c));
line('heard', P.filter((p) => p.ra.surface !== 'typed')); line('typed', P.filter((p) => p.ra.surface === 'typed'));
for (const m of [...new Set(P.map((p) => p.item.mode))]) line(`mode ${m}`, P.filter((p) => p.item.mode === m));
const fw = (rows, typed) => med(rows.filter((r) => (r.surface === 'typed') === typed).map((r) => r.ttft_ms));
console.log(`first word median: heard ${f(fw(A.run.rows, false), 0)} → ${f(fw(B.run.rows, false), 0)} ms; typed ${f(fw(A.run.rows, true), 0)} → ${f(fw(B.run.rows, true), 0)} ms`);
