// Builds docs/HANDOFF-ER.md, the single handoff file: a hand-written head (report/handoff-head.md, sections 1 to 11)
// plus sections and appendices generated from git, the app source, the replay variants, the experiment log, the
// investigation documents and the runs that still exist.
//   node evidence-rich/report/build-handoff.mjs [head.md]        (run from benchmarks/natively-answer-quality/)
// The blind holdout is reported in aggregates only: its questions and answers are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadRun, funnel, readJsonl, answerOf, splitGist } from '../objective.mjs';

const [headFile = new URL('./handoff-head.md', import.meta.url).pathname] = process.argv.slice(2);
const ROOT = '/Users/evin/natively-cluely-ai-assistant';
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const out = [fs.readFileSync(headFile, 'utf8').trimEnd(), ''];
const P = (s = '') => out.push(s);
const fence = (t, lang = '') => { P('```' + lang); P(String(t).replace(/```/g, "'''").trimEnd()); P('```'); };

// ---- 12. commits ----
P('## 12. Commits on main that make up this work');
P('');
P('Hashes are post-rewrite (2026-10-06). Listed oldest first. Files are the ones each commit touches.');
P('');
const SUBJECTS = [
  'a reference pack that fits the prompt is read whole', 'the claim pass is shown the whole prompt', 'hidden working written as tool-call markup',
  'a résumé and job description that fit the prompt are handed over whole', 'a file of the mode handed over whole is not removed',
  'typed chat reaches the model verbatim', 'long answers get 48,000 chars', 'the heard corrected-answer repair inherits the whole answer prompt',
  'a named fact outranks pieces sharing only common words', 'older speech comes back for long questions', 'a turn the classifier answers without retrieval still reads',
  "the rerank's confidence gate keeps the pre-E11 score", 'in a meeting only TYPED questions query the bundled embedder',
  'a turn that retrieves plans the whole profile and the whole pack', 'a résumé or job description handed over whole is not removed',
  'the claim pass does not list a statement of absence',
];
const COMMITS = [];
const log = git(['log', 'origin/main', '--since=2026-10-02', '--reverse', '--format=%h\t%ad\t%s', '--date=format:%Y-%m-%d']).trim().split('\n').map((l) => l.split('\t'));
for (const [h, d, s] of log) {
  if (!SUBJECTS.some((x) => s.includes(x))) continue;
  const files = git(['show', '--stat=200', '--format=', h]).trim().split('\n').slice(0, -1).map((l) => l.split('|')[0].trim()).filter(Boolean);
  COMMITS.push([h, d, s]);
  P(`- \`${h}\` ${d} — ${s}`);
  for (const f of files) P(`  - \`${f}\``);
}
P('');
P('All sixteen are on GitHub `main`. The last, `73b18d97` (E19), was landed and pushed on 2026-10-09. Appendix A prints each commit message and diff in full.');
P('');

// ---- 13. prompts ----
P('## 13. The fix-up pass: its instructions, the E19 change, and every wording that was tried');
P('');
const cvMain = git(['show', 'origin/main:electron/llm/claimVerifier.ts']);
const block = (src) => { const i = src.indexOf('const LIST_THEN_REWRITE = `'); const j = src.indexOf('`;', i); return src.slice(i + 'const LIST_THEN_REWRITE = `'.length, j).trim(); };
P('### 13.1 `LIST_THEN_REWRITE` as it is on main (with E19)');
P('');
P('This block is appended to the pass\'s system prompt in every mode. The mode-specific opening (who is speaking, what counts as their own claim) is built by `claimVerifierSystemPrompt` in the same file.');
P('');
fence(block(cvMain));
P('');
P('### 13.2 The E19 change (`73b18d97`, on main since 2026-10-09)');
P('');
const cvBefore = git(['show', '73b18d97^:electron/llm/claimVerifier.ts']);
const lineWith = (b, s) => { const i = b.indexOf(s); return i < 0 ? null : b.slice(i, b.indexOf('\n', i) < 0 ? undefined : b.indexOf('\n', i)); };
const NEVER = 'Never list these, they are not claims that need a record:';
P('The "Never list these" sentence before E19:'); P(''); fence(lineWith(block(cvBefore), NEVER) ?? '(not found)'); P('');
P('and on main now:'); P(''); fence(lineWith(block(cvMain), NEVER) ?? '(not found)'); P('');
P('### 13.3 Variants tried in replay, with their verdicts');
P('');
const VERDICT = { 'e6-v1.mjs': 'E6 v1 — not kept (2026-10-03)', 'e6-v2.mjs': 'E6 v2 — not kept (2026-10-03)', 'e9-v1.mjs': 'E9 — nothing concluded (2026-10-04)', 'e15-typed-note.mjs': 'E15, first wording — not kept (2026-10-04); a generator-prompt note, not the pass', 'e15-typed-note-v2.mjs': 'E15, second wording — not kept (2026-10-04)', 'e17-conflict.mjs': 'E17 — not kept (2026-10-05)', 'e18-settled.mjs': 'E18 — not kept (2026-10-06); the conflict line is closed', 'e19-absence.mjs': 'E19 — kept, on main since 2026-10-09', 'e20-version-conflict.mjs': 'E20 — not kept (2026-10-09); a rail on the pass output, not a wording' };
const vdir = new URL('../replay-variants/', import.meta.url);
for (const f of Object.keys(VERDICT)) { let src; try { src = fs.readFileSync(new URL(f, vdir), 'utf8'); } catch { continue; } P(`**${VERDICT[f]}** — \`replay-variants/${f}\``); P(''); fence(src, 'js'); P(''); }

const logLines = fs.readFileSync(new URL('../docs/ITERATIONS-ER.md', import.meta.url), 'utf8').split('\n');

// ---- 14. holdout aggregates ----
const J = (n, draft = false) => { const m = new Map(); try { for (const j of readJsonl(`evidence-rich/judge/out/base/${n}${draft ? '.draft' : ''}.astra.jsonl`)) if (j.ok) m.set(j.benchmark_id, j); } catch { /* none */ } return m; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN); const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
P('## 14. Blind holdout: aggregates only');
P('');
P('The holdout\'s questions and answers are deliberately not printed here. They are in `datasets/holdout.json` and the run folders; do not read them to design a change. E19\'s holdout reading is in section 7.6.');
P('');
for (const n of ['er-holdout-m3', 'er-holdout-e16b3']) {
  let run; try { run = loadRun(`evidence-rich/results/${n}`); } catch { continue; } const j = J(n); const R = [...j.values()].map((x) => ({ it: run.ds.byId[x.benchmark_id], row: run.rowsById[x.benchmark_id], o: x.official.overall, hard: x.official.hard_fail, fl: x.judgment.hard_flags ?? [] }));
  P(`**${n}** (${n === 'er-holdout-m3' ? 'main `73cf34e6`, before E16b' : 'main + E16b: the code now on main'}): ${R.length} rows, mean ${mean(R.map((r) => r.o)).toFixed(3)}, hard fails ${R.filter((r) => r.hard).length}.`);
  P('');
  P('| Question type | Rows | Mean | Hard fails |'); P('|---|---|---|---|');
  const by = {}; for (const r of R) (by[r.it.condition] ??= []).push(r); for (const [k, v] of Object.entries(by).sort()) P(`| ${k} | ${v.length} | ${f2(mean(v.map((r) => r.o)))} | ${v.filter((r) => r.hard).length} |`);
  P('');
  const fl = {}; for (const r of R) for (const x of r.fl) fl[x] = (fl[x] ?? 0) + 1; P(`Flags (rows): ${Object.entries(fl).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
  P('');
}

// ---- Appendix A: every landed change in full ----
P('---'); P('');
P('## Appendix A: every landed change in full');
P('');
P('The commit message (which states what was measured and why the change was made) and the complete diff, tests included, oldest first. Hashes are post-rewrite (2026-10-06).');
P('');
COMMITS.forEach(([h, d, s], n) => {
  P(`### A.${n + 1} \`${h}\` ${d} — ${s}`);
  P('');
  const body = git(['show', '-s', '--format=%b', h]).split('\n').filter((l) => !/^Co-Authored-By:|^\(cherry picked from/.test(l)).join('\n').trim();
  if (body) { P(body.split('\n').map((l) => `> ${l}`).join('\n')); P(''); }
  fence(git(['show', '--format=', h]), 'diff');
  P('');
});

// ---- Appendix B: the complete experiment log ----
const demote = (text, by) => { let inFence = false; return text.split('\n').map((l) => { if (/^\s*```/.test(l)) { inFence = !inFence; return l; } if (inFence) return l; const m = l.match(/^(#{1,6}) (.*)$/); if (!m) return l; const lvl = m[1].length + by; return lvl <= 6 ? `${'#'.repeat(lvl)} ${m[2]}` : `**${m[2]}**`; }).join('\n'); };
P('---'); P('');
P('## Appendix B: the complete experiment log');
P('');
P('`docs/ITERATIONS-ER.md`, printed whole: every rule as written before measuring, every data table, every verdict. Commit hashes in entries before 2026-10-06 are pre-rewrite; find those commits by message. Where this log and the sections above disagree, the log wins.');
P('');
P('### B.0 Index');
P('');
P('Entry headings with their line numbers in `docs/ITERATIONS-ER.md`, and every line that states a verdict.');
P('');
logLines.forEach((l, i) => { if (/^#{2,3} /.test(l)) P(`- L${i + 1}: ${l.replace(/^#+ /, '').slice(0, 230)}`); else if (/\*\*Verdict|\*\*Every line holds|is a keep candidate|is kept by its rule|\*\*Standing/.test(l)) P(`  - L${i + 1}: ${l.trim().slice(0, 260)}`); });
P('');
P('### B.1 The log');
P('');
P(demote(logLines.join('\n').trimEnd(), 2));
P('');

// ---- Appendix C: the investigation documents ----
P('---'); P('');
P('## Appendix C: the investigation documents');
P('');
P('Printed as they were written, with the date of their last commit. They are history: where one disagrees with sections 1 to 14, the sections are current. Not printed: `EVIDENCE-CORPUS.md` (the index of the 104 synthetic files, 155 KB) and the two authoring briefs `AUTHORING-ER.md` and `AUTHORING-ER-DEV2.md`; read them in the benchmark folder.');
P('');
const DOCS = [["EVIDENCE-RICH-QUALITY.md","The first quality report (2026-10-03, Claude Opus 5.5 as provisional judge): the baseline and E1"],["BASELINE-PLAN.md","How the baseline would be read, written before any row was judged"],["LOG.md","The session log of 2026-10-03: building the benchmark and running the baseline"],["CONTEXT-LIMITS.md","Every active limit on what reaches the model (the findings Evin picked fixes for)"],["CONTEXT-TRUNCATION-TESTS.md","The in-app probes behind those findings"],["PROMPT-BUDGET.md","The prompt budget on 2026-10-04 and a proposed token-aware policy; the proposal is NOT implemented"],["CLAIM-VERIFIER-CONTEXT-PARITY.md","Does the fix-up pass see what the answer model saw? (the measurement behind E5 and E10)"],["REFERENCE-INGESTION-LIMITS.md","What happens to an uploaded reference file, stage by stage"],["REFERENCE-EVIDENCE-REPORT.md","Reference files from upload to prompt, on the four baseline runs"],["PI-LIMITS.md","Profile Intelligence (résumé and job description): limits"],["PI-EVIDENCE-REPORT.md","Profile Intelligence: what went in, what the app kept, what reached the prompt"]];
const WT = new URL('../../../../', import.meta.url).pathname;
DOCS.forEach(([name, what], n) => {
  let text; try { text = fs.readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8'); } catch { return; }
  let when = ''; try { when = git(['log', '-1', '--format=%ad', '--date=format:%Y-%m-%d', '--', `benchmarks/natively-answer-quality/evidence-rich/docs/${name}`], WT).trim(); } catch { /* unknown */ }
  P(`### C.${n + 1} \`docs/${name}\` — ${what}${when ? ` (last changed ${when})` : ''}`);
  P('');
  P(demote(text.trimEnd(), 3));
  P('');
});

// ---- Appendix D: every development question ----
P('---'); P('');
P('## Appendix D: every development question, with the answers that still exist');
P('');
P('630 questions: dev (270) and dev2 (360). For each: what was asked, what a correct answer contains, and the answer of **main `f4cd986d`** (run `er4-dev-main` / `er4-dev2-main`, 2026-10-06) with its gpt-6-astra score. Where the fix-up pass changed the draft, the draft is shown too.');
P('');
P('- **E19** lines appear on the 88 questions whose reply E19 changes: the answer of that build in the app (run `er5-*`) and its score. E19 is on main since 2026-10-09, so on those questions this is what main now does.');
P('- **E16b** lines appear on the 80 questions whose prompt E16b changes: the answer before E16b (main `73cf34e6`, run `er3-*-ctl`) and after (run `er3-*-new`), both from the app. The "after" build is what main now runs.');
P('- Answers of earlier iterations (E1 to E15, the first E16 runs, E17, E18) were lost on 2026-10-06 and cannot be shown.');
P('- Scores are 0 to 10. "HARD FAIL" marks an answer the judge capped for a serious error; the flags say which.');
P('');
const clean = (t) => splitGist(String(t ?? '')).body.replace(/\r/g, '').trim();
const quote = (t) => clean(t).split('\n').map((l) => `> ${l}`).join('\n');
const tryRun = (n) => { try { return loadRun(`evidence-rich/results/${n}`); } catch { return null; } };
const sets = [['dev', 'er4-dev-main', 'er5-dev-e19', 'er3-dev-ctl', 'er3-dev-new'], ['dev2', 'er4-dev2-main', 'er5-dev2-e19', 'er3-dev2-ctl', 'er3-dev2-new']];
const e19ids = new Set(JSON.parse(fs.readFileSync('evidence-rich/results/replay/astra-plan-e19.json', 'utf8')).e19pairs.map((p) => p.id));
const e16ids = (() => { const p = JSON.parse(fs.readFileSync('evidence-rich/results/replay/e16c-ids.json', 'utf8')); return new Set([...p['er-dev-e13c'], ...p['er-dev2-e13c']]); })();
const NAME = { general: 'General', sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', 'looking-for-work': 'Looking for work', lecture: 'Lecture', 'technical-interview': 'Technical Interview', seminar: 'Seminar', 'call-center': 'Call Center' };
let printed = 0;
for (const [part, base, e19, e16a, e16b] of sets) {
  const B = tryRun(base); if (!B) { P(`_(run ${base} not found)_`); continue; } const JB = J(base), JD = J(base, true);
  const E = tryRun(e19), JE = J(e19); const A = tryRun(e16a), JA = J(e16a); const N = tryRun(e16b), JN = J(e16b);
  const modes = [...new Set(B.ds.items.map((i) => i.mode))];
  for (const mode of modes) {
    const items = B.ds.items.filter((i) => i.mode === mode);
    const scored = items.map((i) => JB.get(i.id)?.official.overall).filter(Number.isFinite);
    P(`### ${NAME[mode] ?? mode} — ${part} (${items.length} questions; main scores ${f2(mean(scored))} on ${scored.length} judged)`);
    P('');
    for (const it of items) {
      const row = B.rowsById[it.id]; const j = JB.get(it.id);
      P(`#### ${it.id} · ${it.condition} · ${it.surface === 'typed' ? 'typed' : 'heard'}${it.pi_state && it.pi_state !== 'none' ? ` · profile ${it.pi_state}` : ''}`);
      P('');
      if (Array.isArray(it.prior_transcript) && it.prior_transcript.length) { P('Said before:'); P(''); P(it.prior_transcript.map((s) => `> ${typeof s === 'string' ? s : `${s.speaker ?? ''}: ${s.text ?? ''}`}`).join('\n')); P(''); }
      P(`**Question:** ${String(it.question).replace(/\n+/g, ' ')}`);
      P('');
      if (it.oracle?.expected_behavior_note) { P(`**A correct answer:** ${it.oracle.expected_behavior_note}`); P(''); }
      if (!row) { P('_Not asked in the baseline run._'); P(''); continue; }
      const fn = funnel(it, row, B);
      const score = j ? `**${j.official.overall.toFixed(1)}**${j.official.hard_fail ? ' · HARD FAIL' : ''}${(j.judgment.hard_flags ?? []).length ? ` · flags: ${j.judgment.hard_flags.join(', ')}` : ''}` : 'not judged';
      P(`**Main's answer** (Astra ${score}${fn.evidence_required ? ` · needed facts in the prompt: ${fn.evidence_delivered === true ? 'yes' : 'NO'}` : ''}):`);
      P(''); P(quote(answerOf(row))); P('');
      if (row.answer_differs_raw_vs_rendered && clean(row.raw_answer) && clean(row.raw_answer) !== clean(answerOf(row))) {
        const d = JD.get(it.id); P(`Draft before the fix-up pass${d ? ` (Astra ${d.official.overall.toFixed(1)}${d.official.hard_fail ? ' · HARD FAIL' : ''})` : ''}:`); P(''); P(quote(row.raw_answer)); P('');
      }
      if (e19ids.has(it.id) && E?.rowsById[it.id]) { const e = JE.get(it.id); P(`**With E19, in the app**${e ? ` (Astra **${e.official.overall.toFixed(1)}**${e.official.hard_fail ? ' · HARD FAIL' : ''}${(e.judgment.hard_flags ?? []).length ? ` · flags: ${e.judgment.hard_flags.join(', ')}` : ''})` : ''}:`); P(''); P(quote(answerOf(E.rowsById[it.id]))); P(''); }
      if (e16ids.has(it.id) && A?.rowsById[it.id] && N?.rowsById[it.id]) {
        const a = JA.get(it.id), n = JN.get(it.id);
        P(`**Before E16b** (main \`73cf34e6\`${a ? `, Astra ${a.official.overall.toFixed(1)}${a.official.hard_fail ? ' · HARD FAIL' : ''}` : ''}):`); P(''); P(quote(answerOf(A.rowsById[it.id]))); P('');
        P(`**With E16b** (same day, same question${n ? `, Astra ${n.official.overall.toFixed(1)}${n.official.hard_fail ? ' · HARD FAIL' : ''}` : ', shown answer not judged'}):`); P(''); P(quote(answerOf(N.rowsById[it.id]))); P('');
      }
      printed++;
    }
  }
}
// ---- Appendix E: the supplementary questions ----
P('---'); P('');
P('## Appendix E: the supplementary questions');
P('');
P('Two development-side sets used in the first rounds (E1 to E9). Their run folders were lost on 2026-10-06, so no answers can be shown; their numbers are in Appendix B. A third file, `supp-oracle-sources.json` (223 items), is derived from the development questions and holds which source backs each oracle fact; it adds no questions.');
P('');
for (const [name, title, extra] of [['supp-counterfactual', 'Counterfactual: the same question under different evidence', (i) => `${i.cf_family ?? ''} · variant ${i.cf_variant ?? ''} · ${i.evidence_state ?? ''}`], ['supp-isolation', 'Isolation: does material of another mode or profile leak in', (i) => `${i.iso_kind ?? ''}${i.pi_condition ? ` · profile ${i.pi_condition}` : ''}`]]) {
  let ds; try { ds = JSON.parse(fs.readFileSync(`evidence-rich/datasets/${name}.json`, 'utf8')); } catch { continue; }
  P(`### ${title} (${ds.items.length} questions)`); P('');
  for (const it of ds.items) {
    P(`#### ${it.id} · ${NAME[it.mode] ?? it.mode} · ${it.condition ?? ''} · ${it.surface === 'typed' ? 'typed' : 'heard'} · ${extra(it)}`); P('');
    if (Array.isArray(it.prior_transcript) && it.prior_transcript.length) { P('Said before:'); P(''); P(it.prior_transcript.map((s) => `> ${typeof s === 'string' ? s : `${s.speaker ?? ''}: ${s.text ?? ''}`}`).join('\n')); P(''); }
    P(`**Question:** ${String(it.question).replace(/\n+/g, ' ')}`); P('');
    if (it.oracle?.expected_behavior_note) { P(`**A correct answer:** ${it.oracle.expected_behavior_note}`); P(''); }
  }
}

// The blind holdout must not be printed: checked in code, counts only.
{
  const text = out.join('\n'); const h = JSON.parse(fs.readFileSync('evidence-rich/datasets/holdout.json', 'utf8')).items;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const flat = norm(text);
  const leakedQ = h.filter((i) => norm(i.question).length >= 30 && flat.includes(norm(i.question))).length;
  const leakedId = h.filter((i) => text.includes(i.id)).length;
  if (leakedQ || leakedId) { console.error(`REFUSED: ${leakedQ} holdout questions and ${leakedId} holdout ids would be printed`); process.exit(1); }
  console.log(`holdout check: 0 of ${h.length} questions and 0 ids appear in the file`);
}
const file = new URL('../docs/HANDOFF-ER.md', import.meta.url);
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(`wrote ${file.pathname}: ${out.length} lines, ${(Buffer.byteLength(out.join('\n')) / 1048576).toFixed(2)} MB, ${printed} questions`);
