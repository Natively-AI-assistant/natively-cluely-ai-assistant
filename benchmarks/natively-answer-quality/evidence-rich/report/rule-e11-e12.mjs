// E11 lines 2–4 and E12 lines 3–4 on the single dev run er-dev-e12, against er-dev-m1 and er-dev-m1r (Opus, old charter).
import { loadRun, funnel, readJsonl } from '../objective.mjs';
const squash = (t) => String(t ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').replace(/\[Page \d+\]/g, ' ').replace(/\s+/g, '').toLowerCase();
const med = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const S = {};
for (const tag of ['m1', 'm1r', 'e12']) {
  const run = loadRun(`evidence-rich/results/er-dev-${tag}`); const J = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/er-dev-${tag}.opus.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j.official]));
  const s = { delivered: 0, had: 0, allDelivered: 0, required: 0, typedFirst: [], heardFirst: [], all: [], heard: [], hard: 0, hardHeard: 0, judged: 0 };
  for (const row of run.rows) {
    const item = run.ds.byId[row.benchmark_id]; const w = run.wire[row.benchmark_id]; const gen = squash((w?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n'));
    const needles = (item?.oracle?.required_facts ?? []).flatMap((f) => f.doc_needles ?? f.answer_needles ?? []).filter((x) => String(x).length >= 4);
    s.had += needles.length; s.delivered += needles.filter((x) => gen.includes(squash(x))).length;
    const fn = funnel(item, row, run); if (fn.evidence_required) { s.required++; if (fn.evidence_delivered === true) s.allDelivered++; }
    const ft = row.ttft_ms ?? null; (row.surface === 'typed' ? s.typedFirst : s.heardFirst).push(ft);
    const o = J[row.benchmark_id]; if (o) { s.judged++; s.all.push(o.overall); if (o.hard_fail) s.hard++; if (row.surface !== 'typed') { s.heard.push(o.overall); if (o.hard_fail) s.hardHeard++; } }
  }
  S[tag] = s;
  console.log(`${tag.padEnd(4)} needed-fact strings in the prompt ${s.delivered}/${s.had}; rows with every needed fact ${s.allDelivered}/${s.required}; first word median typed ${med(s.typedFirst)} ms, heard ${med(s.heardFirst)} ms; Opus mean ${mean(s.all).toFixed(3)} (n ${s.judged}), hard ${s.hard}; heard mean ${mean(s.heard).toFixed(3)}, heard hard ${s.hardHeard}`);
}
const { m1, m1r, e12 } = S; const L = (n, ok, d) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  (${d})`);
L('E11.2 delivered ≥ min(m1, m1r)', e12.delivered >= Math.min(m1.delivered, m1r.delivered), `${e12.delivered} vs min ${Math.min(m1.delivered, m1r.delivered)}`);
L('E11.3 typed first word ≤ max + 150 ms', med(e12.typedFirst) <= Math.max(med(m1.typedFirst), med(m1r.typedFirst)) + 150, `${med(e12.typedFirst)} vs max ${Math.max(med(m1.typedFirst), med(m1r.typedFirst))}`);
L('E11.4 mean ≥ min − 0.05; hard ≤ max + 2', mean(e12.all) >= Math.min(mean(m1.all), mean(m1r.all)) - 0.05 && e12.hard <= Math.max(m1.hard, m1r.hard) + 2, `${mean(e12.all).toFixed(3)} vs min ${Math.min(mean(m1.all), mean(m1r.all)).toFixed(3)}; hard ${e12.hard} vs max ${Math.max(m1.hard, m1r.hard)}`);
L('E12.3 heard first word ≤ max + 150 ms', med(e12.heardFirst) <= Math.max(med(m1.heardFirst), med(m1r.heardFirst)) + 150, `${med(e12.heardFirst)} vs max ${Math.max(med(m1.heardFirst), med(m1r.heardFirst))}`);
L('E12.4 heard mean ≥ min − 0.05; heard hard ≤ max + 2', mean(e12.heard) >= Math.min(mean(m1.heard), mean(m1r.heard)) - 0.05 && e12.hardHeard <= Math.max(m1.hardHeard, m1r.hardHeard) + 2, `${mean(e12.heard).toFixed(3)} vs min ${Math.min(mean(m1.heard), mean(m1r.heard)).toFixed(3)}; hard ${e12.hardHeard} vs max ${Math.max(m1.hardHeard, m1r.hardHeard)}`);
