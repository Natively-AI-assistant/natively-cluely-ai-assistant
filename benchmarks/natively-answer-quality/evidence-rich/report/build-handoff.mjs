// Builds docs/HANDOFF-ER.md: a hand-written head (first argument) plus sections generated from git, the app source,
// the replay variants, the experiment log and the runs that still exist.
//   node evidence-rich/report/build-handoff.mjs <head.md> [app worktree with cand/e19]
// The blind holdout is reported in aggregates only: its questions and answers are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadRun, funnel, readJsonl, answerOf, splitGist } from '../objective.mjs';

const [headFile, appWt = '/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/er-main'] = process.argv.slice(2);
const ROOT = '/Users/evin/natively-cluely-ai-assistant';
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const out = [fs.readFileSync(headFile, 'utf8').trimEnd(), ''];
const P = (s = '') => out.push(s);
const fence = (t, lang = '') => { P('```' + lang); P(String(t).replace(/```/g, "'''").trimEnd()); P('```'); };

// ---- 10. commits ----
P('## 10. Commits on main that make up this work');
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
];
const log = git(['log', 'origin/main', '--since=2026-10-02', '--reverse', '--format=%h\t%ad\t%s', '--date=format:%Y-%m-%d']).trim().split('\n').map((l) => l.split('\t'));
for (const [h, d, s] of log) {
  if (!SUBJECTS.some((x) => s.includes(x))) continue;
  const files = git(['show', '--stat=200', '--format=', h]).trim().split('\n').slice(0, -1).map((l) => l.split('|')[0].trim()).filter(Boolean);
  P(`- \`${h}\` ${d} — ${s}`);
  for (const f of files) P(`  - \`${f}\``);
}
P('');
P('Not on main: `cand/e19` (`73b18d97`), one commit: `electron/llm/claimVerifier.ts`, a new test `electron/llm/__tests__/ClaimVerifierAbsenceIsNotAClaim2026_10_07.test.mjs`, and an updated assertion in `ClaimVerifier2026_09_30.test.mjs`.');
P('');

// ---- 11. prompts ----
P('## 11. The fix-up pass: its instructions, the E19 change, and every wording that was tried');
P('');
const cvMain = git(['show', 'origin/main:electron/llm/claimVerifier.ts']);
const block = (src) => { const i = src.indexOf('const LIST_THEN_REWRITE = `'); const j = src.indexOf('`;', i); return src.slice(i + 'const LIST_THEN_REWRITE = `'.length, j).trim(); };
P('### 11.1 `LIST_THEN_REWRITE` as it is on main');
P('');
P('This block is appended to the pass\'s system prompt in every mode. The mode-specific opening (who is speaking, what counts as their own claim) is built by `claimVerifierSystemPrompt` in the same file.');
P('');
fence(block(cvMain));
P('');
P('### 11.2 The E19 change (branch `cand/e19`, not on main)');
P('');
let cvE19 = null; try { cvE19 = fs.readFileSync(path.join(appWt, 'electron/llm/claimVerifier.ts'), 'utf8'); } catch { /* worktree absent */ }
const OLD = 'general knowledge; what the other person said; what the material states.';
if (cvE19 && !block(cvE19).includes(OLD)) {
  const b = block(cvE19); const i = b.indexOf('general knowledge; what the other person said; what the material states;'); const j = b.indexOf('\n', i);
  P('The sentence that ended:'); P(''); fence(OLD); P(''); P('now ends:'); P(''); fence(b.slice(i, j));
} else { P('Sentence added to the end of the "Never list these" list:'); P(''); fence(fs.readFileSync(new URL('../replay-variants/e19-absence.mjs', import.meta.url), 'utf8').match(/export const NEW = `([\s\S]*?)`;/)?.[1] ?? '(see replay-variants/e19-absence.mjs)'); }
P('');
P('### 11.3 Variants tried in replay, with their verdicts');
P('');
const VERDICT = { 'e6-v1.mjs': 'E6 v1 — not kept (2026-10-03)', 'e6-v2.mjs': 'E6 v2 — not kept (2026-10-03)', 'e9-v1.mjs': 'E9 — nothing concluded (2026-10-04)', 'e15-typed-note.mjs': 'E15, first wording — not kept (2026-10-04); a generator-prompt note, not the pass', 'e15-typed-note-v2.mjs': 'E15, second wording — not kept (2026-10-04)', 'e17-conflict.mjs': 'E17 — not kept (2026-10-05)', 'e18-settled.mjs': 'E18 — not kept (2026-10-06); the conflict line is closed', 'e19-absence.mjs': 'E19 — keep candidate (2026-10-07)' };
const vdir = new URL('../replay-variants/', import.meta.url);
for (const f of Object.keys(VERDICT)) { let src; try { src = fs.readFileSync(new URL(f, vdir), 'utf8'); } catch { continue; } P(`**${VERDICT[f]}** — \`replay-variants/${f}\``); P(''); fence(src, 'js'); P(''); }

// ---- 12. log index ----
P('## 12. Index of the experiment log');
P('');
P('Section headings of `docs/ITERATIONS-ER.md` with their line numbers, and every line that states a verdict. Read the log for the rules as written and the data tables.');
P('');
const logLines = fs.readFileSync(new URL('../docs/ITERATIONS-ER.md', import.meta.url), 'utf8').split('\n');
logLines.forEach((l, i) => { if (/^#{2,3} /.test(l)) P(`- L${i + 1}: ${l.replace(/^#+ /, '').slice(0, 230)}`); else if (/\*\*Verdict|\*\*Every line holds|is a keep candidate|is kept by its rule|\*\*Standing/.test(l)) P(`  - L${i + 1}: ${l.trim().slice(0, 260)}`); });
P('');

// ---- 13. holdout aggregates ----
const J = (n, draft = false) => { const m = new Map(); try { for (const j of readJsonl(`evidence-rich/judge/out/base/${n}${draft ? '.draft' : ''}.astra.jsonl`)) if (j.ok) m.set(j.benchmark_id, j); } catch { /* none */ } return m; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN); const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
P('## 13. Blind holdout: aggregates only');
P('');
P('The holdout\'s questions and answers are deliberately not printed here. They are in `datasets/holdout.json` and the two run folders; do not read them to design a change.');
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

// ---- 14. every development question ----
P('## 14. Every development question, with the answers that still exist');
P('');
P('630 questions: dev (270) and dev2 (360). For each: what was asked, what a correct answer contains, and the answer of **main `f4cd986d`** (run `er4-dev-main` / `er4-dev2-main`, 2026-10-06) with its gpt-6-astra score. Where the fix-up pass changed the draft, the draft is shown too.');
P('');
P('- **E19** lines appear on the 88 questions whose reply E19 changes: the answer of the candidate build in the app (run `er5-*`) and its score.');
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
      if (e19ids.has(it.id) && E?.rowsById[it.id]) { const e = JE.get(it.id); P(`**E19 candidate, in the app**${e ? ` (Astra **${e.official.overall.toFixed(1)}**${e.official.hard_fail ? ' · HARD FAIL' : ''}${(e.judgment.hard_flags ?? []).length ? ` · flags: ${e.judgment.hard_flags.join(', ')}` : ''})` : ''}:`); P(''); P(quote(answerOf(E.rowsById[it.id]))); P(''); }
      if (e16ids.has(it.id) && A?.rowsById[it.id] && N?.rowsById[it.id]) {
        const a = JA.get(it.id), n = JN.get(it.id);
        P(`**Before E16b** (main \`73cf34e6\`${a ? `, Astra ${a.official.overall.toFixed(1)}${a.official.hard_fail ? ' · HARD FAIL' : ''}` : ''}):`); P(''); P(quote(answerOf(A.rowsById[it.id]))); P('');
        P(`**With E16b** (same day, same question${n ? `, Astra ${n.official.overall.toFixed(1)}${n.official.hard_fail ? ' · HARD FAIL' : ''}` : ', shown answer not judged'}):`); P(''); P(quote(answerOf(N.rowsById[it.id]))); P('');
      }
      printed++;
    }
  }
}
const file = new URL('../docs/HANDOFF-ER.md', import.meta.url);
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(`wrote ${file.pathname}: ${out.length} lines, ${(Buffer.byteLength(out.join('\n')) / 1048576).toFixed(2)} MB, ${printed} questions`);
