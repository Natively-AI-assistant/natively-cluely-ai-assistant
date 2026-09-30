#!/usr/bin/env node
// One Markdown file with every question and, for each iteration, the answer and timing — for an outside reviewer.
//   node export-md.mjs [--out <file>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(opt('out', path.join(HERE, 'natively-answers-all-iterations.md')));

const PARTITIONS = [
  { key: 'dev', title: 'Development set (360 questions, 40 per mode)', runs: [
    ['aq-dev-base', 'Baseline', 'main 04333d2d, before any change'],
    ['aq-dev-it1', 'Iteration 1', 'roles named per mode, floors never stated, retrieval fixes (Seminar/Lecture read their files, small files), Profile Intelligence gate + derived-fact filter, GIST not copied/stored, meta-preamble gate, shape-aware coding repairs'],
    ['aq-dev-it2', 'Iteration 2', '+ user-own-facts rule, Sales claims only what material states, typed questions see the meeting transcript, code self-check'],
    ['aq-dev-it4', 'Iteration 4', '+ intro/job-post routing to résumé/JD, "a denial is a claim too", per-turn note on heard commitment questions (iteration 3 was folded into 4)'],
    ['aq-dev-it5sub', 'Iteration 5 (4 modes only)', '+ background/familiarity questions trigger the note, deferral example no longer copied ("send it over today"); re-ran General, Sales, Recruiting, Call Center only'],
    ['aq-dev-it6sub', 'Iteration 6 (3 modes only)', '+ role-noun preamble gate ("The candidate is asking…"), Recruiting outputs only the words; re-ran Recruiting, Lecture, Looking for work only'],
  ] },
  { key: 'holdout', title: 'Holdout set (270 questions, 30 per mode, never used for tuning)', runs: [
    ['aq-holdout-base', 'Baseline', 'main 04333d2d'],
    ['aq-holdout-fix', 'Fixed (iteration 5 build)', 'build 66053623'],
    ['aq-holdout-fix2', 'Fixed (iteration 6 build)', 'build bb41b031'],
  ] },
  { key: 'final', title: 'Final regression set (1,038 questions: frozen 848 + 100 General + 90 hard grounding)', runs: [
    ['aq-final-base', 'Baseline', 'main 04333d2d'],
    ['aq-final-fix2', 'Fixed (iteration 6 build)', 'build bb41b031'],
  ] },
];

const NAME = { general: 'General', sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', 'looking-for-work': 'Looking for work', lecture: 'Lecture', 'technical-interview': 'Technical Interview', seminar: 'Seminar', 'call-center': 'Call Center' };
const readRows = (run) => {
  const f = path.join(HERE, 'results', run, 'natively_benchmark_full.jsonl');
  return fs.existsSync(f) ? Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.benchmark_id, r])) : null;
};
const header = (run) => { const f = path.join(HERE, 'results', run, 'run.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const ms = (x) => (x == null ? 'n/a' : `${Math.round(x)} ms`);
const clean = (a) => String(a ?? '').replace(/\r\n/g, '\n').trim();
const fence = (t) => { const ticks = /```/.test(t) ? '~~~~' : '```'; return `${ticks}text\n${t || '(empty response)'}\n${ticks}`; };

const L = [];
L.push('# Natively answers, every iteration');
L.push('');
L.push(`Generated ${new Date().toISOString()}. Each question appears once, followed by what each build answered and how fast.`);
L.push('');
L.push('**How the answers were produced.** The real Natively Electron app (isolated dev instance) answered every question through its production paths. *Heard* = the line was spoken by the other party and the user pressed the answer hotkey (what-to-say). *Typed* = the user typed the line privately into the overlay. Model: deepseek-flash (the app default with one DeepSeek key). Reference files were attached to the built-in mode; Profile Intelligence (résumé/JD) was loaded where a question lists one.');
L.push('');
L.push('**Timing.** TTFT = time from the request in the app to the first answer text on screen (includes context building, retrieval and the model\'s first token). Total = time until the full answer arrived. Runs were done at different times of day; provider load varies, so compare TTFT across runs with care.');
L.push('');
L.push('**What each marker means.** A trailing `[[GIST]] …` line is a summary chip the app shows under the answer, not spoken text. "(empty response)" means the app produced no text.');
L.push('');
L.push('## Runs');
L.push('');
L.push('| Set | Run | Label | Commit | What changed |');
L.push('|---|---|---|---|---|');
for (const p of PARTITIONS) for (const [run, label, what] of p.runs) {
  const h = header(run);
  if (!h) continue;
  L.push(`| ${p.key} | \`${run}\` | ${label} | \`${(h.git_commit ?? '').slice(0, 8)}\` | ${what} |`);
}
L.push('');

for (const p of PARTITIONS) {
  const ds = JSON.parse(fs.readFileSync(path.join(HERE, 'dataset', `${p.key}.json`), 'utf8'));
  const runs = p.runs.map(([run, label]) => ({ run, label, rows: readRows(run) })).filter((r) => r.rows);
  if (!runs.length) continue;
  L.push(`## ${p.title}`);
  L.push('');
  for (const m of Object.keys(NAME)) {
    const items = ds.items.filter((i) => i.mode === m);
    if (!items.length) continue;
    L.push(`### ${p.key} · ${NAME[m]}`);
    L.push('');
    for (const it of items) {
      const head = it.conversation_id ? ds.items.find((x) => x.conversation_id === it.conversation_id && x.turn_index === 1) : it;
      L.push(`#### ${it.id}${it.conversation_id ? ` (conversation ${it.conversation_id}, turn ${it.turn_index})` : ''}`);
      L.push('');
      L.push(`- **Mode:** ${NAME[m]} · **Surface:** ${it.speaker === 'other' ? 'Heard (other party spoke, hotkey)' : 'Typed (user to Natively)'} · **Category:** ${it.category}`);
      const ctx = head.context_ref ? ds.contexts[head.context_ref] : null;
      if (ctx) L.push(`- **Attached file:** ${ctx.title} (\`${head.context_ref}\`, ${it.context_condition ?? head.context_condition})`);
      const pi = it.pi_ref ?? head.pi_ref;
      if (pi) L.push(`- **Profile loaded:** ${pi}${it.pi_eligible ? '' : ' (this mode must not use it)'}`);
      if (it.turn_index === 1 && it.prior_transcript?.length) {
        L.push('- **Earlier in the conversation:**');
        for (const l of it.prior_transcript) L.push(`  - ${l.speaker === 'other' ? 'Other party' : 'User'}: ${l.text}`);
      }
      if (it.turn_index > 1) L.push('- **Follow-up:** each build received its own previous answers in this conversation.');
      L.push('');
      L.push(`**Question:** ${it.question.includes('\n') ? '\n\n' + fence(it.question) : it.question}`);
      L.push('');
      for (const r of runs) {
        const row = r.rows[it.id];
        if (!row) continue;
        const ans = clean(row.rendered_answer ?? row.raw_answer);
        L.push(`**${r.label}** — TTFT ${ms(row.ttft_ms)} · total ${ms(row.total_latency_ms)}${row.success ? '' : ` · ${row.error_type ?? 'error'}`}`);
        L.push('');
        L.push(fence(ans));
        L.push('');
      }
    }
  }
}
fs.writeFileSync(out, L.join('\n'));
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
