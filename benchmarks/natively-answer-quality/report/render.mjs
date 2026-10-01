#!/usr/bin/env node
// Renders report/index.html from report/data.json (+ latency-ab.json, examples.json, ARCHITECTURE.md, content.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUES, NOT_FIXED } from './content.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));
const readJ = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const lat = readJ(path.join(ROOT, 'results', 'latency-ab.json'));
const examples = readJ(path.join(HERE, 'examples.json')) ?? [];
const meta = readJ(path.join(HERE, 'meta.json')) ?? {};
const arch = fs.readFileSync(path.join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8');

const MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];
const NAME = { general: 'General', sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', 'looking-for-work': 'Looking for work', lecture: 'Lecture', 'technical-interview': 'Technical Interview', seminar: 'Seminar', 'call-center': 'Call Center', ALL: 'All modes' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (x) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(2));
const f0 = (x) => (x == null || !Number.isFinite(x) ? '–' : Math.round(x).toString());
const f1 = (x) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(1));
const delta = (d, noise = 0.3) => {
  if (d == null || !Number.isFinite(d)) return '<span class="d">–</span>';
  const cls = d >= noise ? 'up' : d <= -noise ? 'down' : 'flat';
  return `<span class="d ${cls}">${d > 0 ? '+' : ''}${d.toFixed(2)}</span>`;
};

function scoreTable(pair, label) {
  if (!pair) return '<p class="muted">Not measured.</p>';
  const rows = [...MODES, 'ALL'].map((m) => {
    const b = pair.base.modes[m], x = pair.fix.modes[m];
    if (!b || !x) return '';
    return `<tr class="${m === 'ALL' ? 'total' : ''}"><th scope="row">${NAME[m]}</th><td>${f2(b.mean)}</td><td>${f2(x.mean)}</td><td>${delta(x.mean - b.mean)}</td>`
      + `<td>${b.hard_fail_n}<span class="of">/${b.n}</span></td><td>${x.hard_fail_n}<span class="of">/${x.n}</span></td><td>${f2(b.p10)} → ${f2(x.p10)}</td></tr>`;
  }).join('');
  return `<div class="tw"><table><caption>${esc(label)}</caption><thead><tr><th>Mode</th><th>Baseline</th><th>Fixed</th><th>Change</th><th>Hard fails before</th><th>Hard fails after</th><th>p10</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function devTable() {
  if (!data.dev?.length) return '';
  const head = data.dev.map((d) => `<th>${esc(d.label ?? d.run.replace('aq-dev-', ''))}</th>`).join('');
  const rows = [...MODES, 'ALL'].map((m) => `<tr class="${m === 'ALL' ? 'total' : ''}"><th scope="row">${NAME[m]}</th>${data.dev.map((d) => {
    const s = d.modes[m];
    return s ? `<td>${f2(s.mean)} <span class="of">${f0(s.hard_fail_pct)}%</span></td>` : '<td class="muted">–</td>';
  }).join('')}</tr>`).join('');
  return `<div class="tw"><table><caption>Development set, 40 questions per mode. Score / share of answers with a hard failure.</caption><thead><tr><th>Mode</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function dimsTable(pair) {
  if (!pair) return '';
  const rows = [...MODES, 'ALL'].map((m) => {
    const x = pair.fix.modes[m], b = pair.base.modes[m];
    if (!x) return '';
    return `<tr class="${m === 'ALL' ? 'total' : ''}"><th scope="row">${NAME[m]}</th><td>${f2(x.mean)}</td><td>${f2(x.median)}</td><td>${f2(x.p10)}</td><td>${f1(x.hard_fail_pct)}%</td>`
      + `<td>${f2(x.grounding)} ${delta(x.grounding - b.grounding)}</td><td>${f2(x.role)} ${delta(x.role - b.role)}</td><td>${f2(x.correctness)}</td><td>${f2(x.usefulness)}</td><td>${f2(x.concision)}</td></tr>`;
  }).join('');
  return `<div class="tw"><table><caption>Final set after the fixes: judge dimensions (change vs baseline for grounding and role).</caption><thead><tr><th>Mode</th><th>Mean</th><th>Median</th><th>p10</th><th>Hard fail</th><th>Grounding</th><th>Role</th><th>Correct</th><th>Useful</th><th>Concise</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function flagsTable(pair) {
  if (!pair) return '';
  const keys = ['unsupported_personal_claim', 'unsupported_company_claim', 'unsupported_policy_claim', 'unsafe_commitment', 'fabricated_meeting_history', 'unsupported_research_claim', 'role_confusion', 'speaker_confusion', 'retrieval_failure', 'important_question_unanswered', 'major_factual_error', 'code_incorrect', 'visible_internal_reasoning', 'context_source_exposure', 'coaching_instead_of_answer', 'pi_leak'];
  const b = pair.base.modes.ALL.flags, x = pair.fix.modes.ALL.flags;
  const rows = keys.map((k) => `<tr><th scope="row">${k.replace(/_/g, ' ')}</th><td>${b[k] ?? 0}</td><td>${x[k] ?? 0}</td></tr>`).join('');
  return `<div class="tw"><table class="narrow"><caption>Hard flags raised by the judge (all modes)</caption><thead><tr><th>Flag</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function groundingTable(runB, runF) {
  const ob = data.objective[runB], of = data.objective[runF];
  if (!ob || !of) return '';
  const rows = [...MODES, 'ALL'].map((m) => {
    const b = ob[m], x = of[m];
    if (!b || !x) return '';
    return `<tr class="${m === 'ALL' ? 'total' : ''}"><th scope="row">${NAME[m]}</th>`
      + `<td>${f0(b.ref_evidence_in_prompt_pct)}% → ${f0(x.ref_evidence_in_prompt_pct)}%</td>`
      + `<td>${f0(b.ref_needles_in_prompt_pct)}% → ${f0(x.ref_needles_in_prompt_pct)}% <span class="of">n=${x.ref_needle_rows}</span></td>`
      + `<td>${f0(b.needles_used_in_answer_pct)}% → ${f0(x.needles_used_in_answer_pct)}%</td>`
      + `<td>${x.pi_eligible_rows ? `${f0(b.pi_evidence_in_prompt_pct)}% → ${f0(x.pi_evidence_in_prompt_pct)}%` : '<span class="muted">n/a</span>'}</td>`
      + `<td>${x.pi_needle_rows ? `${f0(b.pi_needles_in_prompt_pct)}% → ${f0(x.pi_needles_in_prompt_pct)}%` : '<span class="muted">n/a</span>'}</td>`
      + `<td>${b.pi_leak_rows} → ${x.pi_leak_rows}</td></tr>`;
  }).join('');
  return `<div class="tw"><table><caption>Evidence reliability, baseline → fixed. A needle is a short exact fact the answer depends on.</caption><thead><tr><th>Mode</th><th>Attached file reached prompt</th><th>File needles reached prompt</th><th>Needles used in answer</th><th>PI evidence reached prompt</th><th>PI needles reached prompt</th><th>PI leaks (objective)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function perfTable(runB, runF) {
  const ob = data.objective[runB], of = data.objective[runF];
  if (!ob || !of) return '';
  const r = (label, b, x) => `<tr><th scope="row">${label}</th><td>${b}</td><td>${x}</td></tr>`;
  const A = ob.ALL, B = of.ALL;
  return `<div class="tw"><table class="narrow"><caption>Final-set runs (sequential runs hours apart; see the paired test for a controlled comparison)</caption><thead><tr><th>Measure</th><th>Baseline</th><th>Fixed</th></tr></thead><tbody>`
    + r('First token, mean', f0(A.ttft.mean) + ' ms', f0(B.ttft.mean) + ' ms')
    + r('First token, median', f0(A.ttft.p50) + ' ms', f0(B.ttft.p50) + ' ms')
    + r('First token, p90 / p95 / p99', `${f0(A.ttft.p90)} / ${f0(A.ttft.p95)} / ${f0(A.ttft.p99)} ms`, `${f0(B.ttft.p90)} / ${f0(B.ttft.p95)} / ${f0(B.ttft.p99)} ms`)
    + r('Full answer, median / p95', `${f0(A.total.p50)} / ${f0(A.total.p95)} ms`, `${f0(B.total.p50)} / ${f0(B.total.p95)} ms`)
    + r('Words, p10 / median / p90', `${f0(A.words.p10)} / ${f0(A.words.p50)} / ${f0(A.words.p90)}`, `${f0(B.words.p10)} / ${f0(B.words.p50)} / ${f0(B.words.p90)}`)
    + r('Answers over 30 s spoken', f1(A.over_30s_pct) + '%', f1(B.over_30s_pct) + '%')
    + r('Answers with headings', f1(A.headings_pct) + '%', f1(B.headings_pct) + '%')
    + r('Screen text replaced after streaming', f1(A.raw_vs_rendered_diff_pct) + '%', f1(B.raw_vs_rendered_diff_pct) + '%')
    + r('Second model request (correction pass)', f1(A.second_pass_pct) + '%', f1(B.second_pass_pct) + '%')
    + r('Errors', A.errors, B.errors)
    + '</tbody></table></div>';
}

function latencyAB() {
  if (!lat) return '<p class="muted">The paired latency test has not run yet.</p>';
  const q = (a, p) => { a = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const r = (p / 100) * (a.length - 1); const lo = Math.floor(r), hi = Math.ceil(r); return a[lo] + (a[hi] - a[lo]) * (r - lo); };
  const A = lat.labelA, B = lat.labelB;
  const col = (lbl, k) => lat.rows.map((r) => r[lbl][k]);
  const d = (k) => lat.rows.map((r) => (r[B][k] ?? NaN) - (r[A][k] ?? NaN));
  const row = (name, k, unit) => `<tr><th scope="row">${name}</th><td>${f0(q(col(A, k), 50))}${unit}</td><td>${f0(q(col(B, k), 50))}${unit}</td><td>${f0(q(col(A, k), 90))}${unit}</td><td>${f0(q(col(B, k), 90))}${unit}</td><td>${f0(q(d(k), 50))}${unit}</td></tr>`;
  return `<div class="tw"><table><caption>Paired test: ${lat.rows.length} identical questions, both builds interleaved in the same window (ABBA order), no files or profile</caption><thead><tr><th>Measure</th><th>Baseline p50</th><th>Fixed p50</th><th>Baseline p90</th><th>Fixed p90</th><th>Paired median Δ</th></tr></thead><tbody>`
    + row('First token', 'ttft', ' ms') + row('Full answer', 'total', ' ms') + row('Prompt tokens', 'inTok', '') + '</tbody></table></div>';
}

function worst(label) {
  const w = data.worst[label] ?? [];
  return w.slice(0, 10).map((r) => `<article class="case"><header><span class="chip">${NAME[r.mode]}</span><span class="score">${r.overall.toFixed(1)}</span><span class="flags">${r.flags.map((f) => f.replace(/_/g, ' ')).join(' · ')}</span></header>`
    + `<p class="q">${esc(r.question)}</p><blockquote>${esc(r.answer).slice(0, 700)}</blockquote><p class="why"><b>Problem.</b> ${esc(r.problem)}</p>${r.improvement ? `<p class="why"><b>Minimal fix.</b> ${esc(r.improvement)}</p>` : ''}</article>`).join('');
}

function examplesHtml() {
  if (!examples.length) return '<p class="muted">Examples are selected after the final judging.</p>';
  return examples.map((e) => `<article class="ab"><header><h3>${esc(e.title)}</h3><span class="chip">${NAME[e.mode]}</span><span class="src">${esc(e.id)} · ${esc(e.set)}</span></header>`
    + `<p class="q"><span class="lbl">${e.surface === 'hotkey' ? 'Heard' : 'Typed'}</span> ${esc(e.question)}</p>`
    + `<div class="pair"><div><div class="lbl">Before <span class="score">${f1(e.before.score)}</span></div><blockquote>${esc(e.before.answer)}</blockquote><p class="why">${esc(e.before.note)}</p></div>`
    + `<div><div class="lbl">After <span class="score">${f1(e.after.score)}</span></div><blockquote>${esc(e.after.answer)}</blockquote><p class="why">${esc(e.after.note)}</p></div></div></article>`).join('');
}

const issuesHtml = ISSUES.map((i) => `<article class="issue" id="issue-${i.id}"><h3>${esc(i.title)}</h3>`
  + `<dl><dt>Root cause</dt><dd>${esc(i.rootCause)}</dd><dt>Where</dt><dd><ul>${i.files.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul></dd>`
  + `<dt>Fix</dt><dd>${esc(i.fix)}</dd><dt>Why it holds</dt><dd>${esc(i.robust)}</dd>`
  + `<dt>Tests</dt><dd><ul>${i.tests.map((t) => `<li><code>${esc(t)}</code></li>`).join('')}</ul></dd><dt>Commits</dt><dd>${i.commits.map((c) => `<code>${c}</code>`).join(' ')}</dd></dl></article>`).join('');

const notFixed = NOT_FIXED.map((n) => `<li><b>${esc(n.title)}.</b> ${esc(n.body)}</li>`).join('');
const P = data.pairs;
const fin = P.final, hold = P.holdout;
const topline = (p) => (p ? `${f2(p.base.modes.ALL.mean)} → ${f2(p.fix.modes.ALL.mean)}` : '–');
const hard = (p) => (p ? `${p.base.modes.ALL.hard_fail_n} → ${p.fix.modes.ALL.hard_fail_n} of ${p.fix.modes.ALL.n}` : '–');

const html = `<title>Natively Answer Quality</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: one reading column (72ch) with wide tables allowed to scroll; summary strip first, evidence after. */
:root{
  --bg:#f6f7f9; --panel:#ffffff; --fg:#17202b; --muted:#5b6778; --rule:#dde2ea;
  --accent:#1d5f7a; --up:#1f7a4d; --down:#b3261e; --flat:#6b7686; --chip:#e7eef3; --quote:#f0f3f7;
  --display:"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0f141a;--panel:#161d25;--fg:#e4e9ef;--muted:#9aa6b5;--rule:#2a3441;--accent:#6fb3cf;--up:#5cc28d;--down:#f08a80;--flat:#8e99a8;--chip:#1f2a35;--quote:#1a222c;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f141a;--panel:#161d25;--fg:#e4e9ef;--muted:#9aa6b5;--rule:#2a3441;--accent:#6fb3cf;--up:#5cc28d;--down:#f08a80;--flat:#8e99a8;--chip:#1f2a35;--quote:#1a222c;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.6 var(--body)}
.wrap{max-width:1040px;margin:0 auto;padding-inline:20px;padding-block:32px 64px}
h1,h2,h3{font-family:var(--display);text-wrap:balance;line-height:1.2}
h1{font-size:2.2rem;margin:0 0 .3rem;font-weight:600;letter-spacing:-.01em}
h2{font-size:1.45rem;margin:2.6rem 0 .6rem;padding-top:1rem;border-top:1px solid var(--rule);font-weight:600}
h3{font-size:1.1rem;margin:0 0 .5rem;font-weight:600}
p,li,dd{max-width:72ch}
.lede{color:var(--muted);max-width:72ch;margin:0}
.muted{color:var(--muted)}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:1.4rem 0}
.stat{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:12px 14px;min-width:0}
.stat .k{font:500 .72rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.stat .v{font:600 1.35rem/1.3 var(--display);font-variant-numeric:tabular-nums;margin-top:4px}
.stat .s{color:var(--muted);font-size:.85rem}
.tw{overflow-x:auto;margin:.8rem 0 1.2rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;font-variant-numeric:tabular-nums;background:var(--panel)}
table.narrow{max-width:640px}
caption{caption-side:top;text-align:left;color:var(--muted);font-size:.85rem;padding:0 0 6px}
th,td{padding:7px 10px;border-bottom:1px solid var(--rule);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
thead th{font:500 .72rem/1.3 var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
tr.total th,tr.total td{font-weight:600;border-top:2px solid var(--rule)}
.of{color:var(--muted);font-size:.8em;margin-left:2px}
.d{font:500 .85em var(--mono);padding:1px 6px;border-radius:4px}
.d.up{color:var(--up)} .d.down{color:var(--down)} .d.flat{color:var(--flat)}
.issue,.case,.ab{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:14px 16px;margin:12px 0;min-width:0}
dl{display:grid;grid-template-columns:8.5rem 1fr;gap:6px 14px;margin:0}
dt{font:500 .72rem/1.9 var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
dd{margin:0;min-width:0}
dd ul{margin:0;padding-left:1.1rem}
code{font:0.85em var(--mono);background:var(--chip);padding:1px 5px;border-radius:3px;overflow-wrap:anywhere}
.chip{font:500 .72rem var(--mono);background:var(--chip);color:var(--accent);padding:2px 8px;border-radius:999px;letter-spacing:.03em}
.case header,.ab header{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:baseline;margin-bottom:6px}
.score{font:600 .9rem var(--mono);color:var(--fg)}
.flags,.src{font:.75rem var(--mono);color:var(--muted)}
.q{margin:.3rem 0;font-weight:500}
.lbl{font:500 .72rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-right:6px}
blockquote{margin:.4rem 0;padding:8px 12px;background:var(--quote);border-radius:4px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem}
.why{font-size:.88rem;color:var(--muted);margin:.3rem 0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.pair>div{min-width:0}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.cols>div{min-width:0}
details{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:10px 16px;margin:10px 0}
summary{cursor:pointer;font-weight:600;font-family:var(--display)}
#arch{overflow-x:auto}
#arch table{font-size:.82rem}
#arch th,#arch td{white-space:normal;text-align:left}
#arch pre{overflow-x:auto;background:var(--quote);padding:10px;border-radius:4px;font:.8rem/1.45 var(--mono)}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:640px){.pair{grid-template-columns:1fr} dl{grid-template-columns:1fr} h1{font-size:1.7rem}}
</style>
<div class="wrap">
<header>
<h1>Natively Answer Quality</h1>
<p class="lede">Nine modes, measured on the real app and graded by a blind judge. Baseline is main at <code>04333d2d</code>; the fixed build is branch <code>fix/answer-quality-9modes</code> at <code>${esc(meta.fixCommit ?? '')}</code>. Generation model: deepseek-flash (the app default with one DeepSeek key). Judge: isolated Claude subagents that never saw which build wrote an answer.</p>
</header>
<div class="strip">
<div class="stat"><div class="k">Final set, mean score</div><div class="v">${topline(fin)}</div><div class="s">${fin ? fin.fix.modes.ALL.n : '–'} questions, out of 10</div></div>
<div class="stat"><div class="k">Final set, hard failures</div><div class="v">${hard(fin)}</div><div class="s">invented facts, role confusion, wrong code…</div></div>
<div class="stat"><div class="k">Holdout, mean score</div><div class="v">${topline(hold)}</div><div class="s">questions never used for tuning</div></div>
<div class="stat"><div class="k">Holdout, hard failures</div><div class="v">${hard(hold)}</div><div class="s">judge noise ±0.1 per mode mean</div></div>
</div>
${meta.verdict ? `<p>${meta.verdict}</p>` : ''}

<h2 id="scorecard">Scorecard</h2>
<p class="muted">A change of 0.3 or more is shown in colour. Below that it is within judge noise plus run-to-run variation.</p>
${scoreTable(fin, 'Final regression set: frozen 848 questions + 100 General + 90 hard grounding cases')}
${scoreTable(hold, 'Holdout set: 270 questions written by separate agents and never inspected while fixing')}
${flagsTable(fin)}

<h2 id="iterations">Iterations</h2>
<p>Each iteration ran the full development set on the real app and was judged blind. The development set was the only one looked at while fixing.</p>
${devTable()}
${meta.iterationNotes ?? ''}

<h2 id="fixes">What was wrong and what changed</h2>
${issuesHtml}

<h2 id="grounding">Grounding</h2>
<p>Every reference-file and profile item carries needles: short exact facts from the material that a correct answer needs. The harness checks whether each needle reached the prompt and whether the answer used it. The PI leak count is objective: profile evidence found in the wire prompt of a mode that may not use it.</p>
${groundingTable(fin?.base.run, fin?.fix.run)}
${meta.groundingNotes ?? ''}

<h2 id="performance">Realtime performance</h2>
${latencyAB()}
${perfTable(fin?.base.run, fin?.fix.run)}
${meta.perfNotes ?? ''}

<h2 id="judge">Judge results by mode</h2>
${dimsTable(fin)}

<h2 id="examples">Before and after</h2>
${examplesHtml()}

<h2 id="worst">The ten worst answers after the fixes</h2>
<p class="muted">From the final set, lowest judge score first. These are what still needs work.</p>
${worst('final')}

<h2 id="open">Not fixed</h2>
<ul>${notFixed}</ul>

<h2 id="method">Method and validation</h2>
${meta.methodHtml ?? ''}

<h2 id="architecture">Architecture</h2>
<p>How an answer is produced today, traced through the code before any change. Line numbers refer to <code>04333d2d</code>.</p>
<details><summary>Full architecture map</summary><div id="arch"></div></details>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script>
(function(){var md=${JSON.stringify(arch).replace(/</g, '\\u003c')};var el=document.getElementById('arch');
try{el.innerHTML=window.marked?window.marked.parse(md):'';}catch(e){}
if(!el.innerHTML){var pre=document.createElement('pre');pre.textContent=md;el.appendChild(pre);}})();
</script>`;
fs.writeFileSync(path.join(HERE, 'index.html'), html);
console.log('wrote report/index.html', (html.length / 1024).toFixed(0) + ' KB');
