/**
 * analyze-results.mjs — cluster + summarize a phase results file into a failure
 * analysis markdown. Reads test-results/intelligence-e2e/<prefix>-results.json.
 *
 *   node tests/intelligence/e2e/analyze-results.mjs [--in=phase-1-1000] [--out=phase-1-failure-analysis]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'test-results', 'intelligence-e2e');
const args = process.argv.slice(2);
const getArg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const IN = getArg('in', 'phase-1-1000');
const OUT = getArg('out', 'phase-1-failure-analysis');

const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${IN}-results.json`), 'utf8'));
const results = data.results.filter(Boolean);
const clean = results.filter((r) => !r.provider_empty && !r.error);
const fails = clean.filter((r) => !r.pass);

// cluster failures by normalized reason
const clusters = {};
for (const f of fails) {
  for (const reason of (f.failure_reason || '').split('; ')) {
    const key = reason.replace(/:.*/, '').trim() || 'unknown';
    clusters[key] = clusters[key] || { count: 0, examples: [] };
    clusters[key].count++;
    if (clusters[key].examples.length < 6) clusters[key].examples.push({ id: f.id, mode: f.mode, surface: f.surface, type: f.answer_type, reason, preview: (f.actual_answer_preview || '').slice(0, 100), q: f.question });
  }
}

const byMode = {}; const bySurface = {}; const byType = {};
for (const r of clean) {
  byMode[r.mode] = byMode[r.mode] || { t: 0, p: 0 }; byMode[r.mode].t++; if (r.pass) byMode[r.mode].p++;
  bySurface[r.surface] = bySurface[r.surface] || { t: 0, p: 0 }; bySurface[r.surface].t++; if (r.pass) bySurface[r.surface].p++;
  byType[r.answer_type] = byType[r.answer_type] || { t: 0, p: 0 }; byType[r.answer_type].t++; if (r.pass) byType[r.answer_type].p++;
}

const L = []; const W = (s = '') => L.push(s);
W(`# ${IN} — Failure Analysis`); W();
W(`- total ${results.length} · clean ${clean.length} · provider-unavailable ${results.length - clean.length} · **fails ${fails.length}** (${((100 * fails.length) / Math.max(1, clean.length)).toFixed(1)}% of clean)`); W();
W('## Failure clusters (by reason)'); W('| cluster | count |'); W('|---|---:|');
for (const [k, v] of Object.entries(clusters).sort((a, b) => b[1].count - a[1].count)) W(`| ${k} | ${v.count} |`);
W();
for (const [k, v] of Object.entries(clusters).sort((a, b) => b[1].count - a[1].count)) {
  W(`### ${k} (${v.count})`);
  for (const e of v.examples) W(`- \`${e.id}\` [${e.mode}/${e.surface} → ${e.type}] **${e.reason}** — Q: "${e.q}" — \`${e.preview}\``);
  W();
}
W('## Pass rate by mode'); W('| mode | pass | total | % |'); W('|---|---:|---:|---:|');
for (const [m, v] of Object.entries(byMode).sort((a, b) => (a[1].p / a[1].t) - (b[1].p / b[1].t))) W(`| ${m} | ${v.p} | ${v.t} | ${((100 * v.p) / v.t).toFixed(0)}% |`);
W();
W('## Pass rate by surface'); W('| surface | pass | total | % |'); W('|---|---:|---:|---:|');
for (const [s, v] of Object.entries(bySurface).sort((a, b) => (a[1].p / a[1].t) - (b[1].p / b[1].t))) W(`| ${s} | ${v.p} | ${v.t} | ${((100 * v.p) / v.t).toFixed(0)}% |`);
W();
W('## Pass rate by answerType (worst 15)'); W('| answerType | pass | total | % |'); W('|---|---:|---:|---:|');
for (const [t, v] of Object.entries(byType).sort((a, b) => (a[1].p / a[1].t) - (b[1].p / b[1].t)).slice(0, 15)) W(`| ${t} | ${v.p} | ${v.t} | ${((100 * v.p) / v.t).toFixed(0)}% |`);
W();
// human-likeness flag tally
const hlFlags = {};
for (const r of clean) for (const fl of (r.human_flags || [])) hlFlags[fl] = (hlFlags[fl] || 0) + 1;
W('## Human-likeness flags (clean rows)'); W('| flag | count |'); W('|---|---:|');
for (const [k, v] of Object.entries(hlFlags).sort((a, b) => b[1] - a[1])) W(`| ${k} | ${v} |`);
W();

fs.writeFileSync(path.join(OUT_DIR, `${OUT}.md`), L.join('\n') + '\n');
console.log(`[analyze] ${fails.length} fails / ${clean.length} clean → ${OUT}.md`);
console.log('[analyze] top clusters:', Object.entries(clusters).sort((a, b) => b[1].count - a[1].count).slice(0, 6).map(([k, v]) => `${k}:${v.count}`).join(' '));
