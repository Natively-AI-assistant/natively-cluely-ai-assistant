#!/usr/bin/env node
// The numbers of the final report, from judged sets and recorded runs. Prints Markdown.
//   node astra/final-report.mjs --suffix -c2 --start aq2-dev-cur --kept aq2-dev-fix6 --final aq2-dev-fix10 \
//        --holdout-start aq-holdout-fix2 --holdout-kept aq2-holdout-fix6 --holdout-final aq2-holdout-fix10 \
//        [--verifier tools/variants/_claimVerifier-fix10.mjs] [--worst 20]
// Sections: per-mode score / p10 / hard fails (dev and holdout), hard-fail categories, objective validators, latency
// (TTFT and total, p50 / p95), claim-verifier invocation and replacement rates, the worst remaining dev answers.
// Holdout is reported in aggregate only: its items are never listed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRun } from './judge.mjs';
import { answerOf } from './envelope.mjs';
import { validate } from '../validators/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const sfx = opt('suffix', '');
const MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];
const NAME = { general: 'General', sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', 'looking-for-work': 'Looking for work', lecture: 'Lecture', 'technical-interview': 'Technical interview', seminar: 'Seminar', 'call-center': 'Call Center' };

const judged = (set, run) => {
  const f = path.join(HERE, 'out', `${set}${sfx}`, `${run}.jsonl`);
  const last = {};
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; const j = JSON.parse(l); if (j.ok && (j.repeat ?? 0) === 0) last[j.benchmark_id] = j; }
  return last;
};
const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const pct = (x, p) => { if (!x.length) return NaN; const s = [...x].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');

function scoreTable(title, set, cols) {
  const J = cols.map(([label, run]) => [label, run ? judged(set, run) : {}]);
  console.log(`\n### ${title}\n`);
  console.log(`| Mode | ${J.map(([l]) => `${l} mean | p10 | hard fails`).join(' | ')} |`);
  console.log(`|---|${J.map(() => '---:|---:|---:').join('|')}|`);
  // A column judged on fewer than 90% of a mode's items is PARTIAL (a batch ran out): its mean is marked † and is
  // not comparable with the full columns; under a quarter of the items it is not shown at all.
  const count = (j, m) => Object.values(j).filter((x) => m === 'ALL' || x.mode === m).length;
  let partial = false;
  for (const m of [...MODES, 'ALL']) {
    const full = Math.max(...J.map(([, j]) => count(j, m)));
    const cells = J.map(([, j]) => {
      const v = Object.values(j).filter((x) => m === 'ALL' || x.mode === m); const s = v.map((x) => x.official.overall);
      if (!v.length || v.length < 0.25 * full) return `— | — | ${v.length ? `(${v.length} judged)` : '—'}`;
      const mark = v.length < 0.9 * full ? '†' : ''; if (mark) partial = true;
      return `${f2(mean(s))}${mark} | ${f1(pct(s, 0.1))} | ${v.filter((x) => x.official.hard_fail).length}/${v.length}`;
    });
    console.log(`| ${m === 'ALL' ? '**All**' : NAME[m]} | ${cells.join(' | ')} |`);
  }
  if (partial) console.log('\n† partial: judged on fewer than 90% of that mode\'s items (the judge batch ran out). Use the paired lines below, which compare common items only.');
  return J;
}
function pairedLine(set, a, b) {
  const A = judged(set, a), B = judged(set, b); const d = Object.keys(A).filter((id) => B[id]).map((id) => B[id].official.overall - A[id].official.overall);
  if (!d.length) return;
  const m = mean(d); const sd = Math.sqrt(d.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, d.length - 1));
  console.log(`\nPaired on ${d.length} common items, ${b} − ${a}: ${m >= 0 ? '+' : ''}${m.toFixed(2)} (±${(1.96 * sd / Math.sqrt(d.length)).toFixed(2)}).`);
}
function categories(title, set, run) {
  const J = Object.values(judged(set, run)).filter((j) => j.official.hard_fail);
  console.log(`\n### ${title}\n`);
  console.log('| Mode | hard fails | by flag |');
  console.log('|---|---:|---|');
  for (const m of [...MODES, 'ALL']) { const v = J.filter((j) => m === 'ALL' || j.mode === m); const c = {}; for (const j of v) for (const fl of j.official.flags) c[fl] = (c[fl] ?? 0) + 1; console.log(`| ${m === 'ALL' ? '**All**' : NAME[m]} | ${v.length} | ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '—'} |`); }
}
function runStats(dir) {
  if (!dir || !fs.existsSync(path.join(ROOT, 'results', dir, 'natively_benchmark_full.jsonl'))) return null;
  const run = loadRun(path.join(ROOT, 'results', dir));
  let val = 0, pass = 0; const fails = [];
  for (const row of run.rows) { const it = run.items[row.benchmark_id]; if (!it) continue; const v = validate(it, answerOf(row), run.ds); if (v.verdict === 'n/a') continue; val++; if (v.verdict === 'pass') pass++; else fails.push(row.benchmark_id); }
  const ok = run.rows.filter((r) => r.success !== false && r.ttft_ms != null);
  return { run, val, pass, fails, n: run.rows.length, ttft: ok.map((r) => r.ttft_ms), total: ok.map((r) => r.total_latency_ms) };
}
const strip = (s) => String(s ?? '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '').trim();

const dev = [['Starting', opt('start')], ['Kept', opt('kept')], ['Final', opt('final')]].filter(([, r]) => r);
const hold = [['Starting', opt('holdout-start')], ['Kept', opt('holdout-kept')], ['Final', opt('holdout-final')]].filter(([, r]) => r);
console.log(`## Scores (judge gpt-6-astra, result sets abs-*${sfx})`);
scoreTable('Dev set', 'abs-dev', dev);
if (opt('start') && opt('final')) pairedLine('abs-dev', opt('start'), opt('final'));
if (opt('kept') && opt('final')) pairedLine('abs-dev', opt('kept'), opt('final'));
if (hold.length) { scoreTable('Holdout (aggregate only)', 'abs-holdout', hold); if (opt('holdout-start') && opt('holdout-final')) pairedLine('abs-holdout', opt('holdout-start'), opt('holdout-final')); if (opt('holdout-kept') && opt('holdout-final')) pairedLine('abs-holdout', opt('holdout-kept'), opt('holdout-final')); }
if (opt('final')) categories(`Hard-fail categories, dev, ${opt('final')}`, 'abs-dev', opt('final'));
if (opt('holdout-final')) categories(`Hard-fail categories, holdout, ${opt('holdout-final')}`, 'abs-holdout', opt('holdout-final'));

console.log('\n## Objective validators and latency (recorded runs)\n');
console.log('| Run | rows | validators pass | TTFT p50 / p95 ms | total p50 / p95 ms |');
console.log('|---|---:|---:|---:|---:|');
const cv = opt('verifier') ? await import(pathToFileURL(path.resolve(ROOT, opt('verifier'))).href) : null;
const finals = [];
for (const [label, r] of [...dev, ...hold]) {
  const s = runStats(r); if (!s) continue;
  console.log(`| ${label} \`${r}\` | ${s.n} | ${s.pass}/${s.val}${s.fails.length && !/holdout/.test(r) ? ` (fails: ${s.fails.join(', ')})` : ''} | ${Math.round(pct(s.ttft, 0.5))} / ${Math.round(pct(s.ttft, 0.95))} | ${Math.round(pct(s.total, 0.5))} / ${Math.round(pct(s.total, 0.95))} |`);
  if (label === 'Final') finals.push([r, s]);
}
if (cv) {
  console.log('\n## Claim verifier: how often it runs and how often it replaces the text\n');
  console.log('Invocation = the turn passes the verifier\'s gate (mode, surface, question, draft). Replacement = the shown text differs from the streamed draft.\n');
  for (const [r, s] of finals) {
    console.log(`**${r}**\n`);
    console.log('| Mode | turns | verifier runs | text replaced | spoken turns replaced |');
    console.log('|---|---:|---:|---:|---:|');
    const by = {};
    for (const row of s.run.rows) {
      for (const k of [row.mode, 'ALL']) {
        const m = (by[k] ??= { n: 0, gated: 0, repl: 0, hk: 0, hkRepl: 0 });
        m.n++;
        const surface = row.surface_path === 'typed' ? 'typed' : 'spoken';
        if (cv.claimVerifierKind({ modeId: row.mode, question: row.question, draft: row.raw_answer ?? '', surface })) m.gated++;
        const replaced = row.rendered_answer != null && strip(row.rendered_answer) !== strip(row.raw_answer);
        if (replaced) m.repl++;
        if (surface === 'spoken') { m.hk++; if (replaced) m.hkRepl++; }
      }
    }
    for (const m of [...MODES, 'ALL']) { const x = by[m]; if (!x) continue; console.log(`| ${m === 'ALL' ? '**All**' : NAME[m]} | ${x.n} | ${x.gated} (${Math.round(100 * x.gated / x.n)}%) | ${x.repl} (${Math.round(100 * x.repl / x.n)}%) | ${x.hkRepl}/${x.hk} |`); }
    console.log('');
  }
}
if (opt('final')) {
  const N = Number(opt('worst', 20));
  const J = Object.values(judged('abs-dev', opt('final'))).sort((a, b) => a.official.overall - b.official.overall).slice(0, N);
  const s = runStats(opt('final'));
  console.log(`\n## The ${N} worst remaining dev answers (${opt('final')})\n`);
  for (const j of J) {
    const row = s?.run.rowsById[j.benchmark_id];
    console.log(`**${j.benchmark_id}** — ${NAME[j.mode]} — ${j.official.overall.toFixed(1)}${j.official.flags.length ? ` — ${j.official.flags.join(', ')}` : ''}`);
    if (row) { console.log(`\n> Q: ${String(row.question).replace(/\s+/g, ' ').slice(0, 220)}\n>\n> A: ${strip(answerOf(row)).replace(/\s+/g, ' ').slice(0, 420)}`); }
    console.log(`\n*Judge:* ${String(j.judgment.specific_issue ?? '').replace(/\s+/g, ' ').slice(0, 400)}\n`);
  }
}
