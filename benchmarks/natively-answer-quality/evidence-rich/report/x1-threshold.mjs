#!/usr/bin/env node
// X1: whole-pack threshold arms, read judge-free from results/x1/t<threshold>/threshold-<mode>-<surface>.jsonl and
// ref-count-<mode>-<surface>.jsonl.   node evidence-rich/report/x1-threshold.mjs [--arms 12000,24000,48000]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const arms = String(opt('arms', '12000,24000,48000')).split(',').map(Number);
const L = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null; };
const mx = (a) => { const s = a.filter((x) => x != null); return s.length ? Math.round(Math.max(...s)) : null; };
const all = {};
for (const T of arms) for (const surface of ['hotkey', 'typed']) {
  const rows = L(path.join(ER, 'results', 'x1', `t${T}`, `threshold-general-${surface}.jsonl`)); if (!rows.length) continue;
  console.log(`\n## threshold ${T}, ${surface}  (${rows.length} turns; errors ${rows.filter((r) => r.err || r.timed_out).length})`);
  console.log('| file tokens | whole file in request | named: in request / right | list: in request / in answer | sum: inputs / right | current: new+old in request / gives new / old only | first word median / max ms | prompt tokens (median) | pass changed text | lost by pass | app RSS MB |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const size of [...new Set(rows.map((r) => r.file_tokens_nominal))]) {
    const g = rows.filter((r) => r.file_tokens_nominal === size); const named = g.filter((r) => r.kind === 'named'); const list = g.find((r) => r.kind === 'list'); const sum = g.find((r) => r.kind === 'sum'); const cur = g.find((r) => r.kind === 'current');
    const whole = med(g.map((r) => r.prompt_user_chars)) > g[0].file_chars; const lost = named.filter((r) => r.in_draft && !r.in_answer).length + (list ? Math.max(0, list.facts_in_draft - list.facts_in_answer) : 0) + (sum && sum.correct_in_draft && !sum.correct ? 1 : 0);
    const rec = { T, surface, size, whole, named_req: named.filter((r) => r.E_in_request).length, named_right: named.filter((r) => r.in_answer).length, list_req: list?.facts_in_request, list_ans: list?.facts_in_answer, sum_inputs: sum?.inputs_in_request, sum_right: !!sum?.correct, cur_new: !!cur?.new_in_request, cur_old: !!cur?.old_in_request, gives_current: !!cur?.gives_current, stale_only: !!cur?.stale_only, ttft: med(g.map((r) => r.ttft_ms)), ttft_max: mx(g.map((r) => r.ttft_ms)), tokens: med(g.map((r) => r.provider_prompt_tokens)), changed: g.filter((r) => r.draft_differs).length, lost, rss: mx(g.map((r) => r.app_rss_mb)), errors: g.filter((r) => r.err || r.timed_out).length };
    (all[`${T}|${surface}`] ??= []).push(rec);
    console.log(`| ${g[0].file_tokens_est} | ${whole ? 'yes' : 'no'} | ${rec.named_req}/7 · ${rec.named_right}/7 | ${rec.list_req}/7 · ${rec.list_ans}/7 | ${rec.sum_inputs}/2 · ${rec.sum_right ? 'right' : 'WRONG'} | ${rec.cur_new ? 'new' : '-'}${rec.cur_old ? '+old' : ''} · ${rec.gives_current ? 'yes' : 'NO'} · ${rec.stale_only ? 'YES' : 'no'} | ${rec.ttft} / ${rec.ttft_max} | ${rec.tokens} | ${rec.changed}/10 | ${rec.lost} | ${rec.rss} |`);
  }
}
for (const T of arms) { const rows = L(path.join(ER, 'results', 'x1', `t${T}`, 'ref-count-general-hotkey.jsonl')); if (!rows.length) continue;
  console.log(`\n## threshold ${T}, six files (spoken): ` + [...new Set(rows.map((r) => r.file_tokens_est))].map((ft) => { const g = rows.filter((r) => r.file_tokens_est === ft); return `6 x ${ft} = ${6 * ft}: fact in request ${g.filter((r) => r.E_in_request).length}/${g.length}, right ${g.filter((r) => r.in_answer).length}/${g.length}, files in request ${med(g.map((r) => r.files_in_request))}/6, prompt tokens ${med(g.map((r) => r.provider_prompt_tokens))}`; }).join(' | ')); }
if (args.includes('--lines')) {
  const base = 12000;
  for (const T of arms.filter((t) => t !== base)) { console.log(`\n### lines for ${T} against ${base} (sizes above 12,000 and at most ${T})`);
    for (const surface of ['hotkey', 'typed']) { const c = (all[`${T}|${surface}`] ?? []).filter((r) => r.size > 12000 && r.size <= T), b = (all[`${base}|${surface}`] ?? []).filter((r) => r.size > 12000 && r.size <= T); if (!c.length || !b.length) continue;
      const bBy = Object.fromEntries(b.map((r) => [r.size, r]));
      const L1 = c.every((r) => r.list_ans >= 6), L2 = c.every((r) => r.sum_right && r.gives_current && !r.stale_only), L3 = c.every((r) => r.named_right >= (bBy[r.size]?.named_right ?? 0));
      const dT = med(c.map((r) => r.ttft)) - med(b.map((r) => r.ttft)); const L4 = surface !== 'hotkey' ? null : dT <= 400 && c.every((r) => r.ttft_max <= 5000);
      const L5 = c.reduce((n, r) => n + r.lost, 0) <= b.reduce((n, r) => n + r.lost, 0), L6 = c.every((r) => r.errors === 0);
      console.log(`  ${surface}: 1 list >= 6/7 on every size: ${L1 ? 'holds' : 'FAILS'} | 2 sum right and current value given: ${L2 ? 'holds' : 'FAILS'} | 3 named not below the 12,000 arm: ${L3 ? 'holds' : 'FAILS'} | 4 first word median ${dT >= 0 ? '+' : ''}${dT} ms${L4 === null ? ' (typed: reported, not a line)' : L4 ? ': holds' : ': FAILS'} | 5 lost by the pass ${b.reduce((n, r) => n + r.lost, 0)} -> ${c.reduce((n, r) => n + r.lost, 0)}: ${L5 ? 'holds' : 'FAILS'} | 6 no error: ${L6 ? 'holds' : 'FAILS'}`); } }
}
