#!/usr/bin/env node
// Scorecards from external-judge output. node astra/report.mjs --abs abs-dev[,abs-sq,...] [--ab ab-dev-cur-vs-fix1,...] [--worst 10] [--json out.json]
// Absolute: per run × mode — n, mean, median, p10, hard-fail %, hard-fail types, grounding, correctness, role,
// usefulness (official scores from astra/score.mjs: spec weights, caps, validator overrides).
// Pairwise: per set × mode — wins/ties/losses for run B vs run A, with strength.
// Model integrity: every call's returned model id is checked against gpt-6-astra.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mean, median, pct, CRITICAL_FLAGS } from './score.mjs';
import { readJsonl } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const list = (v) => (v ? String(v).split(',').filter(Boolean) : []);
const f2 = (x) => (x == null ? '-' : x.toFixed(2));
const MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];
const out = { absolute: {}, pairwise: {}, integrity: { calls: 0, mismatches: 0, returned_models: {} } };

function integrity(calls) {
  for (const c of calls ?? []) { out.integrity.calls++; const m = c.returned_model ?? '(none)'; out.integrity.returned_models[m] = (out.integrity.returned_models[m] ?? 0) + 1; if (c.model_mismatch) out.integrity.mismatches++; }
}

// ---- absolute ----
const absRows = [];
for (const set of list(opt('abs'))) {
  const dir = path.join(HERE, 'out', set);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl') && x !== 'pairs.jsonl')) {
    const run = f.replace(/\.jsonl$/, '');
    // Median over repeats per item (spec §35); flags by majority.
    const by = {};
    for (const j of readJsonl(path.join(dir, f))) { integrity(j.calls); if (j.ok && j.official) (by[j.benchmark_id] ??= []).push(j); }
    for (const [id, js] of Object.entries(by)) {
      const ov = median(js.map((j) => j.official.overall));
      const flagCount = {}; for (const j of js) for (const fl of j.official.flags) flagCount[fl] = (flagCount[fl] ?? 0) + 1;
      const flags = Object.entries(flagCount).filter(([, n]) => n * 2 > js.length).map(([fl]) => fl);
      const dim = (k) => median(js.map((j) => Number(j.judgment.scores[k])));
      absRows.push({ set, run, id, mode: js[0].mode, overall: ov, hard_fail: js.filter((j) => j.official.hard_fail).length * 2 > js.length, flags,
        grounding: dim('grounding'), correctness: dim('correctness'), role: dim('role_fidelity'), usefulness: dim('direct_usefulness'),
        issue: js[0].judgment.specific_issue, expected: js[0].judgment.expected_behavior, repeats: js.length });
    }
  }
}
if (absRows.length) {
  console.log('| run | mode | n | mean | median | p10 | hard-fail % | critical | grounding | correctness | role | usefulness | top flags |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const run of [...new Set(absRows.map((r) => r.run))]) {
    for (const m of [...MODES, 'ALL']) {
      const rs = absRows.filter((r) => r.run === run && (m === 'ALL' || r.mode === m));
      if (!rs.length) continue;
      const ov = rs.map((r) => r.overall);
      const fc = {}; for (const r of rs) for (const fl of r.flags) fc[fl] = (fc[fl] ?? 0) + 1;
      const crit = rs.filter((r) => r.flags.some((fl) => CRITICAL_FLAGS.includes(fl))).length;
      const row = { n: rs.length, mean: mean(ov), median: median(ov), p10: pct(ov, 10), hard_fail_pct: 100 * rs.filter((r) => r.hard_fail).length / rs.length, critical: crit,
        grounding: mean(rs.map((r) => r.grounding)), correctness: mean(rs.map((r) => r.correctness)), role: mean(rs.map((r) => r.role)), usefulness: mean(rs.map((r) => r.usefulness)), flags: fc };
      (out.absolute[run] ??= {})[m] = row;
      console.log(`| ${run} | ${m} | ${row.n} | ${f2(row.mean)} | ${f2(row.median)} | ${f2(row.p10)} | ${row.hard_fail_pct.toFixed(1)} | ${crit} | ${f2(row.grounding)} | ${f2(row.correctness)} | ${f2(row.role)} | ${f2(row.usefulness)} | ${Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
    }
  }
  const W = Number(opt('worst', 0));
  if (W) for (const run of [...new Set(absRows.map((r) => r.run))]) {
    console.log(`\nworst ${W} — ${run}`);
    for (const r of absRows.filter((r) => r.run === run).sort((a, b) => a.overall - b.overall).slice(0, W)) console.log(`- ${r.id} (${r.mode}) ${r.overall.toFixed(2)} [${r.flags.join(', ')}] ${r.issue}`);
  }
}

// ---- pairwise ----
for (const set of list(opt('ab'))) {
  const dir = path.join(HERE, 'out', set);
  const recs = readJsonl(path.join(dir, 'pairs.jsonl'));
  const map = fs.existsSync(path.join(dir, 'mapping.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'mapping.json'), 'utf8')) : {};
  for (const r of recs) integrity(r.calls);
  // Majority over repeats per item.
  const by = {}; for (const r of recs.filter((x) => x.ok)) (by[r.benchmark_id] ??= []).push(r);
  const res = {};
  for (const [id, rs] of Object.entries(by)) {
    const votes = { a: 0, b: 0, tie: 0 }; for (const r of rs) votes[r.winner]++;
    const winner = votes.b > votes.a && votes.b > votes.tie ? 'b' : votes.a > votes.b && votes.a > votes.tie ? 'a' : 'tie';
    const mode = rs[0].mode;
    for (const k of [mode, 'ALL']) { const x = (res[k] ??= { n: 0, a: 0, b: 0, tie: 0, decisive_b: 0, decisive_a: 0 }); x.n++; x[winner]++; if (winner !== 'tie' && rs.some((r) => r.winner === winner && r.strength === 'decisive')) x[`decisive_${winner}`]++; }
  }
  out.pairwise[set] = { a_run: map.a_run, b_run: map.b_run, by_mode: res };
  console.log(`\npairwise ${set}: ${map.b_run} (B) vs ${map.a_run} (A)`);
  console.log('| mode | n | B wins | ties | A wins | B decisive | A decisive |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const m of [...MODES, 'ALL']) { const x = res[m]; if (x) console.log(`| ${m} | ${x.n} | ${x.b} | ${x.tie} | ${x.a} | ${x.decisive_b} | ${x.decisive_a} |`); }
}
console.log(`\njudge calls: ${out.integrity.calls}, returned models: ${JSON.stringify(out.integrity.returned_models)}, id mismatches: ${out.integrity.mismatches}`);
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ ...out, rows: absRows }, null, 1));
