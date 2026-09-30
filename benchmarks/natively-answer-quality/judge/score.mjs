#!/usr/bin/env node
// Merges judge outputs, computes the OFFICIAL overall (weighted dimensions + hard caps, in code), and aggregates.
//   node judge/score.mjs --name <batchset>[,<batchset2>] [--by run|mode] [--json out.json] [--worst 10]
// Reads judge/maps/<name>.json and judge/out/<name>/*.json. Prints per run x mode tables.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const names = String(opt('name', '')).split(',').filter(Boolean);

export const WEIGHTS = { correctness: 0.15, grounding: 0.20, role_fidelity: 0.15, direct_usefulness: 0.15, relevance: 0.10, speakability_usability: 0.10, cognitive_load: 0.05, concision: 0.05, continuity: 0.025, mode_fit: 0.025 };
export const SEVERE_FLAGS = ['unsupported_personal_claim', 'unsupported_company_claim', 'unsupported_policy_claim', 'fabricated_meeting_history', 'unsupported_research_claim', 'role_confusion', 'speaker_confusion', 'major_factual_error', 'code_incorrect', 'pi_leak', 'cross_mode_context_leak', 'unsafe_commitment', 'retrieval_failure'];

export function officialOverall(j, mode) {
  const sc = j.scores ?? {};
  let o = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) o += w * Math.max(0, Math.min(10, Number(sc[k] ?? 0)));
  const f = new Set(j.hard_flags ?? []);
  const caps = [];
  if (f.has('major_factual_error')) caps.push(4);
  if (f.has('code_incorrect') && j.code_central) caps.push(4);
  if (f.has('unsupported_personal_claim')) caps.push(5);
  if (f.has('unsupported_company_claim') || f.has('unsupported_policy_claim') || f.has('unsafe_commitment')) caps.push(4);
  if (f.has('fabricated_meeting_history')) caps.push(4);
  if (f.has('role_confusion') || f.has('speaker_confusion')) caps.push(4);
  if (f.has('unsupported_research_claim')) caps.push(mode === 'seminar' ? 3 : 5);
  if (f.has('pi_leak') || f.has('cross_mode_context_leak')) caps.push(2);
  const capped = caps.length ? Math.min(o, ...caps) : o;
  return { raw: +o.toFixed(3), overall: +capped.toFixed(3), capped: caps.length > 0 && capped < o };
}

const pct = (v, p) => { const a = [...v].sort((x, y) => x - y); if (!a.length) return null; const r = (p / 100) * (a.length - 1); const lo = Math.floor(r), hi = Math.ceil(r); return a[lo] + (a[hi] - a[lo]) * (r - lo); };
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const f2 = (x) => (x == null ? '-' : x.toFixed(2));

export function loadJudged(batchNames) {
  const out = [];
  for (const name of batchNames) {
    const map = JSON.parse(fs.readFileSync(path.join(HERE, 'maps', `${name}.json`), 'utf8'));
    const dir = path.join(HERE, 'out', name);
    const got = {};
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : []) {
      let arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!Array.isArray(arr)) arr = arr.results ?? arr.items ?? [];
      for (const j of arr) if (j?.jid && map[j.jid]) got[j.jid] = j;
    }
    const missing = Object.keys(map).filter(k => !got[k]);
    if (missing.length) console.error(`[${name}] ${missing.length} of ${Object.keys(map).length} items not judged yet`);
    for (const [jid, m] of Object.entries(map)) if (got[jid]) out.push({ jid, set: name, ...m, judge: got[jid] });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const judged = loadJudged(names);
  const modeOf = (r) => r.judge.mode ?? r.benchmark_id;
  // attach mode from run rows
  const ROOT = path.join(HERE, '..');
  const rowCache = {};
  for (const r of judged) {
    const dir = path.join(ROOT, 'results', r.run_id);
    rowCache[r.run_id] ??= Object.fromEntries(fs.readFileSync(path.join(dir, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(x => [x.benchmark_id, x]));
    r.row = rowCache[r.run_id][r.benchmark_id];
    r.mode = r.row?.mode;
    Object.assign(r, officialOverall(r.judge, r.mode));
    r.flags = r.judge.hard_flags ?? [];
  }
  const runsSeen = [...new Set(judged.map(r => r.run_id))];
  const modes = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];
  const summary = {};
  for (const run of runsSeen) {
    console.log(`\n### ${run}`);
    console.log('| mode | n | mean | median | p10 | hard-fail % | grounding | role | correct | useful | concise | top flags |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
    for (const m of [...modes, 'ALL']) {
      const rs = judged.filter(r => r.run_id === run && (m === 'ALL' || r.mode === m));
      if (!rs.length) continue;
      const ov = rs.map(r => r.overall);
      const hf = rs.filter(r => r.flags.some(f => SEVERE_FLAGS.includes(f))).length / rs.length * 100;
      const dim = (k) => mean(rs.map(r => Number(r.judge.scores?.[k] ?? 0)));
      const fc = {};
      for (const r of rs) for (const f of r.flags) fc[f] = (fc[f] ?? 0) + 1;
      const top = Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
      (summary[run] ??= {})[m] = { n: rs.length, mean: mean(ov), median: pct(ov, 50), p10: pct(ov, 10), hard_fail_pct: hf, grounding: dim('grounding'), role: dim('role_fidelity'), correctness: dim('correctness'), usefulness: dim('direct_usefulness'), concision: dim('concision'), flags: fc };
      console.log(`| ${m} | ${rs.length} | ${f2(mean(ov))} | ${f2(pct(ov, 50))} | ${f2(pct(ov, 10))} | ${hf.toFixed(1)} | ${f2(dim('grounding'))} | ${f2(dim('role_fidelity'))} | ${f2(dim('correctness'))} | ${f2(dim('direct_usefulness'))} | ${f2(dim('concision'))} | ${top} |`);
    }
  }
  const W = Number(opt('worst', 0));
  if (W) {
    for (const run of runsSeen) {
      console.log(`\n#### worst ${W} — ${run}`);
      for (const r of judged.filter(r => r.run_id === run).sort((a, b) => a.overall - b.overall).slice(0, W))
        console.log(`- ${r.benchmark_id} (${r.mode}) ${r.overall.toFixed(2)} [${r.flags.join(', ')}] ${r.judge.specific_problem ?? r.judge.one_sentence_reason}`);
    }
  }
  if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ summary, rows: judged.map(r => ({ run_id: r.run_id, benchmark_id: r.benchmark_id, mode: r.mode, overall: r.overall, raw: r.raw, capped: r.capped, flags: r.flags, scores: r.judge.scores, reason: r.judge.one_sentence_reason, problem: r.judge.specific_problem, improvement: r.judge.minimal_improvement })) }, null, 1));
}
