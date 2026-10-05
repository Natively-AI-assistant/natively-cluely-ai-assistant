#!/usr/bin/env node
// Two judges on the SAME answers: how far do they agree? Rows are matched by item id and kept only when the answer
// text is identical in the two runs (a composite run shares most rows with the run it was built from).
//   node astra/agreement.mjs --a astra/out/<set>/<run>.jsonl --run-a results/<run> --b astra/out/<set>/<run>.jsonl --run-b results/<run> [--label-a x --label-b y]
// Prints aggregates only (safe for the holdout set): means, correlation, hard-fail agreement, per-mode means.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const jl = (f) => fs.readFileSync(path.resolve(ROOT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const judged = (f) => Object.fromEntries(jl(f).filter((j) => j.ok && j.official && (j.repeat ?? 0) === 0).map((j) => [j.benchmark_id, j]));
const answers = (dir) => Object.fromEntries(jl(path.join(dir, 'natively_benchmark_full.jsonl')).map((r) => [r.benchmark_id, String(r.rendered_answer ?? r.raw_answer ?? '')]));
const A = judged(opt('a')); const B = judged(opt('b')); const ta = answers(opt('run-a')); const tb = answers(opt('run-b'));
const ids = Object.keys(A).filter((id) => B[id] && ta[id] !== undefined && ta[id] === tb[id]);
const la = opt('label-a', 'A'); const lb = opt('label-b', 'B');
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const pearson = (x, y) => { const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return n / Math.sqrt(dx * dy); };
const rank = (x) => { const o = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(x.length); for (let i = 0; i < o.length;) { let j = i; while (j < o.length && o[j][0] === o[i][0]) j++; for (let k = i; k < j; k++) r[o[k][1]] = (i + j - 1) / 2; i = j; } return r; };
const x = ids.map((id) => A[id].official.overall); const y = ids.map((id) => B[id].official.overall);
const ha = ids.map((id) => !!A[id].official.hard_fail); const hb = ids.map((id) => !!B[id].official.hard_fail);
const both = ids.filter((_, i) => ha[i] && hb[i]).length; const onlyA = ids.filter((_, i) => ha[i] && !hb[i]).length; const onlyB = ids.filter((_, i) => !ha[i] && hb[i]).length; const neither = ids.length - both - onlyA - onlyB;
const po = (both + neither) / ids.length; const pe = ((both + onlyA) / ids.length) * ((both + onlyB) / ids.length) + ((neither + onlyB) / ids.length) * ((neither + onlyA) / ids.length);
console.log(`${ids.length} answers judged by both (${la}, ${lb})`);
console.log(`mean ${la} ${mean(x).toFixed(2)}   mean ${lb} ${mean(y).toFixed(2)}   ${lb} − ${la} ${(mean(y) - mean(x) >= 0 ? '+' : '') + (mean(y) - mean(x)).toFixed(2)}`);
console.log(`Pearson ${pearson(x, y).toFixed(2)}   Spearman ${pearson(rank(x), rank(y)).toFixed(2)}   within 1.0 point ${Math.round(100 * ids.filter((_, i) => Math.abs(x[i] - y[i]) <= 1).length / ids.length)}%   mean |difference| ${mean(x.map((v, i) => Math.abs(v - y[i]))).toFixed(2)}`);
console.log(`hard fails: both ${both}, only ${la} ${onlyA}, only ${lb} ${onlyB}, neither ${neither}   kappa ${((po - pe) / (1 - pe)).toFixed(2)}`);
console.log(`| mode | n | ${la} | ${lb} | hard fails ${la} | hard fails ${lb} |`); console.log('|---|---:|---:|---:|---:|---:|');
const modes = [...new Set(ids.map((id) => A[id].mode))].sort();
for (const m of modes) { const s = ids.filter((id) => A[id].mode === m); console.log(`| ${m} | ${s.length} | ${mean(s.map((id) => A[id].official.overall)).toFixed(2)} | ${mean(s.map((id) => B[id].official.overall)).toFixed(2)} | ${s.filter((id) => A[id].official.hard_fail).length} | ${s.filter((id) => B[id].official.hard_fail).length} |`); }
// Do the two judges order the modes the same way?
const ma = modes.map((m) => mean(ids.filter((id) => A[id].mode === m).map((id) => A[id].official.overall))); const mb = modes.map((m) => mean(ids.filter((id) => A[id].mode === m).map((id) => B[id].official.overall)));
console.log(`mode-mean rank correlation ${pearson(rank(ma), rank(mb)).toFixed(2)}`);
