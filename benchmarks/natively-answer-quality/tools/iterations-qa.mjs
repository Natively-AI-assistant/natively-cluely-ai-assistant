#!/usr/bin/env node
// Writes docs/ITERATIONS-QA.md: what changed in each iteration, the judged scores per run, and every DEV question with
// the app's response in each run (plus the external judge's score where that run was judged).
// Dev set only: holdout, final and the supplementary sets are blind and are never listed per item.
//   node tools/iterations-qa.mjs            (re-run any time; it reads whatever runs and judgments exist)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'ITERATIONS-QA.md');

// ── the runs, in order, and what each build contains ────────────────────────
const RUNS = [
  { id: 'aq2-dev-cur', label: 'Baseline', commit: '61bb0956', contains: 'main as it was at the start (no change)' },
  { id: 'aq2-dev-fix1', label: 'fix1', commit: 'c3e951f3', contains: 'I1 + I2 + I3 + I4' },
  { id: 'aq2-dev-fix2', label: 'fix2 (I5)', commit: '44418214', contains: 'fix1 + I5' },
  { id: 'aq2-dev-fix3', label: 'fix3', commit: '2a0fcb62', contains: 'fix2 + I6 + I7' },
  { id: 'aq2-dev-fix4', label: 'fix4', commit: '323b7aa4', contains: 'fix3 + I8 (claim verifier)' },
  { id: 'aq2-dev-fix5', label: 'fix5', commit: '2943c1be', contains: 'fix4 + I8b + I9 + I10 + I11 + I13 + I14 (run hit a network outage)' },
  { id: 'aq2-dev-fix6', label: 'fix6', commit: 'f0cf5ad6', contains: 'fix5 + I8c + I15' },
  { id: 'aq2-dev-fix7', label: 'fix7', commit: '57e21fdf', contains: 'fix6 + I16' },
  { id: 'aq2-dev-fix8', label: 'fix8', commit: '13b649c7', contains: 'fix7 + I18 + language rail' },
  { id: 'aq2-dev-fix9', label: 'fix9', commit: '8e30ca40', contains: 'fix8 + I21 + I22 + tidy' },
  { id: 'aq2-dev-fix10', label: 'fix10', commit: '497c9ba9', contains: 'fix9 + claim kinds in the verifier' },
  { id: 'aq2-dev-fix11', label: 'fix11 (candidate)', commit: 'pending', contains: 'fix10 + source-word rail' },
];

const ITERATIONS = [
  ['I1', 'b4e9f29c', 'fix1', 'A small reference corpus is read whole',
    'About 10% of turns with an attached file never got the answering text into the prompt (retrieval picked the wrong chunk, or a fast path skipped it).',
    'When the attached files total 1,400 tokens or less, every file is passed whole — no embedding or reranking. `electron/context-intelligence` retrieval port + plan budget.',
    'Reference text reaching the prompt: dev 76 → 83 of 86 items, final set 168 → 185 of 188.', 'Kept (objective).'],
  ['I2', 'ccceeebb', 'fix1', 'Arithmetic is worked out first, in a hidden scratch block',
    'Live arithmetic was set up wrongly (the gap instead of half the gap; per-warehouse instead of total).',
    'A quantity question with two or more figures gets a `[[CALC]]` block the model fills first; the transport strips it from every surface. `prompt-composer.ts` calculationNotice, `LLMHelper` stream filter.',
    'Replay 23 → 43 of 54 correct; blind supp-quant validators 25 → 31 of 32.', 'Kept (objective).'],
  ['I3', '8c0ba3f2', 'fix1', "The user's own life is remembered, not checked",
    'The no-context rule told the model to say "what it would check" even for the user\'s own biography ("let me check my résumé").',
    'Own-life rule in the persona prompt (`promptSystemV2.ts`).',
    'Epistemic / source-exposure phrasing 12 → 4 of 120 replayed answers.', 'Caused a Team Meet regression → narrowed by I5.'],
  ['I4', '35d548bf', 'fix1', "The recruiting hotkey is the interviewer's spoken words",
    'Spoken recruiting replies were wrapped in coaching ("The candidate is asking…").',
    'Recruiting spoken contract: only the words to say. `promptSystemV2.ts`.',
    'Coaching / meta wrappers 18 → 2 of 66 replayed answers.', 'Kept.'],
  ['I5', '44418214', 'fix2', 'Own-life rule only in the job modes; the "no story" bridge is stripped',
    'I3\'s rule made Team Meet deny things ("I don\'t have a payments migration in my background", 6 of 6).',
    'Rule limited to Looking for work and Technical interview; a leading "I don\'t have a specific story…, so let me…" bridge is removed. `promptSystemV2.ts`, `planningPreamble.ts`.',
    'Judged: baseline 7.78 → 7.86 overall.', 'Kept.'],
  ['I6', '791eb9e8', 'fix3', "A heard question about the user's own life is theirs to answer",
    'General / Sales / Team Meet / Call Center answers invented small personal facts.', 'Personal-life notice with claim-free example shapes. `prompt-composer.ts`.',
    'Objectively neutral.', 'Kept (harmless); the real gain came from I8.'],
  ['I7', 'a8afe122', 'fix3', 'No product material → no product facts',
    'Sales / Call Center with nothing attached invented prices, features and terms.', 'No-material clause in the Sales and Call Center personas.',
    'Objectively neutral.', 'Kept; superseded in effect by I8b / I18.'],
  ['I8', '323b7aa4', 'fix4', 'Claim verifier: a second pass removes what the material does not state',
    'Four prompt wordings moved invented-claim caps by 0–0.5 points. Prompt text was not the lever.',
    'New `electron/llm/claimVerifier.ts`: after the answer streams, one short edit call sees the answer and its own material and removes unsupported claims; deterministic rails decide whether the edit replaces the text. Runs on the hotkey path (`IntelligenceEngine.ts`) and typed chat (`ipcHandlers.ts`). Kill switch `NATIVELY_CLAIM_VERIFIER=0`.',
    'Judged alone (25 per mode): Looking for work +0.84, Sales +0.74, Call Center +0.53, Seminar +0.43. Costs ~0.8 s on the total; the text can change after it streams.', 'Kept.'],
  ['I8b', 'f7f70a16', 'fix5', 'With no product document, product statements are unsupported', 'DSALES-001-type capability claims survived I8.',
    'No-document clause in the verifier prompt for Sales / Call Center.', '46 of 80 Sales / Call Center answers edited offline.', 'Kept.'],
  ['I8c', '73156d89', 'fix6', 'The verifier keeps **highlights**; a formatting-only edit is no edit', 'The verifier dropped bold marks (DSALES-023\'s only "edit").',
    'Prompt line + format-insensitive comparison.', '—', 'Kept.'],
  ['I9', '2943c1be', 'fix5', 'Recruiting heard turns never plan as coding', 'Spoken recruiting questions were routed to the coding contract.',
    '`AnswerPlanner.ts` gate (explicit coding asks keep their routing) + narrower `check if` pattern.', 'W1-5 invariant test kept.', 'Kept.'],
  ['I10', '2943c1be', 'fix5', 'Call Center states the rule, then verifies', 'Answers repeated the identity checklist and never said the refund / credit rule.',
    'Call Center persona clause: say the rule in general terms, then ask for what the procedure needs.', 'Replay: answers state the 30-day and $20 rules.', 'Kept, but with no document it invites invented rules — handled by I18\'s no-document clause.'],
  ['I11', '2943c1be', 'fix5', 'A "Today" line when the material mentions a date', 'The prompt had no date, so expiry and tenure were guessed.',
    '`prompt-composer.ts` todayNotice.', 'Alone it barely helped; with I14 the stale-sheet answers went 0/3 → 3/3.', 'Kept.'],
  ['I13', '2943c1be', 'fix5', 'Team Meet: ask or propose the check (prompt wording)', 'Team Meet replies opened by reporting their own notes.',
    'Persona clause.', 'No effect in the app (the clause quoted the phrases it forbade).', 'Replaced by I15.'],
  ['I14', '2943c1be', 'fix5', 'Documents carry a freshness status (expired / outdated / draft)', 'Expired price sheets and drafts were treated as current.',
    '`mode-retrieval-port.ts` detectDocumentStatus + precedence contract in the composer.', 'Sales conflict validators 1/3 → 3/3.', 'Kept.'],
  ['I15', 'f0cf5ad6', 'fix6', 'A spoken Team Meet / Recruiting reply no longer opens by reporting its own notes', 'I13 did not work.',
    'Deterministic strip of a leading "I don\'t have the notes in front of me…" sentence. `electron/llm/accessLead.ts`.', 'Team Meet epistemic lines 8 → 3.', 'Kept.'],
  ['I16', '57e21fdf', 'fix7', 'The verifier hands back a question only when nothing answers', 'The verifier appended interviewer questions (Looking for work 3 → 18 of 40 answers ended in a question), copying its own prompt example.',
    'Hand-back clause narrowed, example removed.', 'Appended questions 12 → 1. Judged +0.09 (±0.17): neutral.', 'Kept.'],
  ['I18', '1bb90a65', 'fix8', 'The verifier lists what is unsupported, then rewrites; Team Meet and Recruiting are verified too',
    'After the verifier, 18 of 40 Looking-for-work answers were still capped ("Twice a year sounds manageable", "I\'d be looking at a few weeks"). Describing the claims in more words changed nothing.',
    'The verifier writes one hidden line `UNSUPPORTED: … | …`, then `---`, then the reply (`splitVerifierScratch`). Team Meet and Recruiting gated. With no document: Call Center procedures and Sales terms are unsupported too. New rails: never drop a stale-document caution; a one-question edit is allowed when there is no document.',
    'Replayed on fix6\'s drafts and judged: Looking for work 7.33 → 8.20, Call Center 7.07 → 8.25, Team Meet 8.37 → 8.93, Recruiting 8.83 → 9.11, Sales 7.98 → 8.22.', 'Built; in-app judge read pending (11:00 UTC batch).'],
  ['Language rail', '13b649c7', 'fix8', "The verifier never changes the reply's language",
    'The verifier sometimes REPLACED an English reply with a Hindi one (3 of 360 answers in fix6 and in fix7): the app\'s language instruction rides on every system prompt.',
    'Prompt pins the draft\'s language; an edit in a different script is never shipped.', 'fix8: 0 non-English answers.', 'Kept.'],
  ['I21', 'd923fce9', 'fix9', 'Every spoken General turn is verified', 'Every capped General answer was an invented fact about the user that the gate never caught.',
    '`claimVerifierKind` takes the surface; spoken General always verified, typed keeps the narrow gate.', 'Replay judged 8.53 → 8.80, hard fails 5 → 1.', 'Built; judge read pending.'],
  ['I22', 'd923fce9', 'fix9', 'Every Seminar turn is verified, with the research as the subject', 'Seminar caps were claims about the research the paper does not make.',
    'Seminar gate always on; subject = the presenter\'s research.', 'Replay judged 8.64 → 8.99, hard fails 3 → 1.', 'Built; judge read pending.'],
  ['Tidy', '8e30ca40', 'fix9', 'A verified reply keeps its closing quotation mark and has no doubled spaces', 'Found by reading fix8\'s edits: 6 of 149 lost a closing quote, 35 had doubled spaces.',
    '`tidyEdit` in `claimVerifier.ts`.', '—', 'Kept.'],
  ['Claim kinds', '497c9ba9', 'fix10', 'The verifier leaves decisions, ownership and small commitments alone, and surfaces a conflict',
    'I18 over-verified: of 149 in-app edits, 36 turned the answer into a question and 26 removed a decision or ownership ("I can take this one" → "I\'ll come back on who\'s picking it up"; the pads-and-rotors decision → a question).',
    'The list step takes only three kinds — a past fact, a fact about the speaker, a consequential promise — and names what is never a claim (a decision made now, taking a task, a recommendation, a small commitment). A `CONFLICT:` line names two values the material gives; the reply must not assert either. An emptied answer gets a short holding line, never a question back.',
    'In the app (dev): edits 149 → 115, turned into a question 36 → 3, decisions removed 26 → 13, spoken turns replaced 117 → 95 of 245; validators 8/9 unchanged.', 'Built; judge and holdout read pending under charter v2.'],
];

const REJECTED = [
  ['Conflict wording ("two values within one document")', 'no change in replay'],
  ['Past-event notice ("why did you leave", the gap)', 'invented-reason proxy unchanged or worse'],
  ['"Use the specifics" nudge', 'within sampling noise'],
  ['I13 Team Meet wording', 'no effect in the app → replaced by the deterministic I15'],
  ['Removing the Today line (I17)', 'not needed: the Team Meet "regression" was the judge reading "tomorrow" a day late; fixed in the judge envelope'],
  ['Verifier wording with more rules per claim kind (scratch-v2)', '7.99 vs 8.20, sampling noise'],
  ['I19 technical second look for Technical interview', 'found 2 of 7 known errors; one of its two fixes was wrong'],
  ['I20 list facts the documents hold that the answer left out', '−0.01 (±0.20)'],
  ['I23 "what to say instead" rules for Looking for work', '+0.13 (±0.44); the judge capped the reframed motives too'],
  ['I24 verifier stops after "UNSUPPORTED: none"', 'no latency gain (the cost is the round trip)'],
  ['A bigger generator (deepseek-v4-pro)', '7.61 vs 7.80 on the same prompts, more hard fails'],
];

// ── data ────────────────────────────────────────────────────────────────────
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const FAILED_RE = /didn.t come through from the AI provider|couldn.t generate an answer just now|No answer came back this time|^Connection error\.?$/i;
const runs = RUNS.map((r) => {
  const rows = readJsonl(path.join(ROOT, 'results', r.id, 'natively_benchmark_full.jsonl'));
  const judged = {};
  for (const j of readJsonl(path.join(ROOT, 'astra', 'out', 'abs-dev', `${r.id}.jsonl`))) if (j.ok && (j.repeat ?? 0) === 0) judged[j.benchmark_id] = j;
  return { ...r, rows: Object.fromEntries(rows.map((x) => [x.benchmark_id, x])), n: rows.length, judged };
}).filter((r) => r.n > 0);
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, 'dataset', 'dev.json'), 'utf8'));
const items = dataset.items ?? dataset;
const MODE_NAME = Object.fromEntries((dataset.modes ?? []).map((m) => [m.key, m.name]));
const modeOrder = [...new Set(items.map((i) => i.mode))];

const splitGist = (t) => { const m = String(t ?? '').match(/^([\s\S]*?)\n*\s*\[\[GIST\]\]\s*([\s\S]*)$/); return m ? { body: m[1].trim(), gist: m[2].trim() } : { body: String(t ?? '').trim(), gist: '' }; };
const quote = (t) => String(t).split('\n').map((l) => `> ${l}`).join('\n');
const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);

// ── write ───────────────────────────────────────────────────────────────────
const out = [];
out.push('# Answer-quality iterations — changes, scores, and every dev question with its response per iteration');
out.push('');
out.push(`Generated ${new Date().toISOString().slice(0, 16)}Z by \`tools/iterations-qa.mjs\` (re-run to refresh). Generator: deepseek-flash. Judge: gpt-6-astra (AgentRouter), charter \`6dd53845a51c\`.`);
out.push('');
out.push('**Scope.** Only the DEV set (360 questions, 9 modes) is listed per item. The holdout, final and supplementary sets are blind: they are reported in aggregate elsewhere (`docs/ITERATIONS-ASTRA.md`) and never item by item.');
out.push('');
out.push('**Reading a response.** The text shown is what the user ends up with. "edited after streaming" means the claim verifier (or another post-stream repair) replaced the streamed draft. A judge line appears only for runs that were judged (Baseline, fix2, fix6 in full; fix4 on 25 items per mode in six modes). Scores are the official 0–10 score; a hard flag caps the score.');
out.push('');
out.push('## 1. Runs');
out.push('');
out.push('| Run | App commit | Contains | Rows | Judged | Dev mean (judged) |');
out.push('|---|---|---|---:|---:|---:|');
for (const r of runs) {
  const s = Object.values(r.judged).map((j) => j.official.overall);
  out.push(`| ${r.label} (\`${r.id}\`) | \`${r.commit}\` | ${r.contains} | ${r.n} | ${s.length || '—'} | ${s.length >= 300 ? mean(s).toFixed(2) : s.length ? `${mean(s).toFixed(2)} (partial)` : '—'} |`);
}
out.push('');
out.push('## 2. Judged score per mode');
out.push('');
const judgedRuns = runs.filter((r) => Object.keys(r.judged).length >= 300);
out.push(`| Mode | ${judgedRuns.map((r) => `${r.label} mean (hard fails)`).join(' | ')} |`);
out.push(`|---|${judgedRuns.map(() => '---:').join('|')}|`);
for (const m of [...modeOrder, 'ALL']) {
  const cells = judgedRuns.map((r) => { const js = Object.values(r.judged).filter((j) => m === 'ALL' || j.mode === m); return js.length ? `${mean(js.map((j) => j.official.overall)).toFixed(2)} (${js.filter((j) => j.official.hard_fail).length}/${js.length})` : '—'; });
  out.push(`| ${m === 'ALL' ? '**All**' : (MODE_NAME[m] ?? m)} | ${cells.join(' | ')} |`);
}
out.push('');
out.push('fix8, fix9 and fix10 are not judged yet (the judge budget ran out at 03:30 UTC on 2026-10-01; next batch 11:00 UTC). The scores above are under judge charter v1; from the next batch the judge uses charter v2 (claim kinds), whose scores are not comparable with these.');
out.push('');
out.push('## 3. What changed in each iteration');
out.push('');
for (const [id, commit, firstRun, title, why, change, evidence, decision] of ITERATIONS) {
  out.push(`### ${id} — ${title}`);
  out.push('');
  out.push(`- **Commit:** \`${commit}\` · **first run containing it:** ${firstRun}`);
  out.push(`- **Why:** ${why}`);
  out.push(`- **Change:** ${change}`);
  out.push(`- **Evidence:** ${evidence}`);
  out.push(`- **Decision:** ${decision}`);
  out.push('');
}
out.push('### Tried and rejected (not built, or reverted)');
out.push('');
for (const [what, why] of REJECTED) out.push(`- **${what}:** ${why}.`);
out.push('');
out.push('### Harness-only changes that affect scores');
out.push('');
out.push('- The judge is told the generation date when a reply uses a relative day ("so that\'s tomorrow"); 3–5 answers per run.');
out.push('- Validator fixes: "2 million" parsed as a number; the stale-sheet oracle accepts "ran through December… confirm it\'s still the current one".');
out.push('');
out.push('## 4. Every dev question and its response in each run');
out.push('');
for (const mode of modeOrder) {
  out.push(`### ${MODE_NAME[mode] ?? mode}`);
  out.push('');
  for (const it of items.filter((i) => i.mode === mode)) {
    const any = runs.map((r) => r.rows[it.id]).find(Boolean);
    const surface = it.surface === 'typed' ? 'typed into the chat box' : 'heard (hotkey)';
    const chain = it.conversation_id ? ` · turn ${it.turn_index} of conversation ${it.conversation_id}` : '';
    out.push(`#### ${it.id} — ${it.category ?? ''}`);
    out.push('');
    out.push(`*${surface} · context: ${it.context_condition ?? any?.context_condition ?? 'none'}${it.context_ref ? ` (${dataset.contexts?.[it.context_ref]?.title ?? it.context_ref})` : ''}${it.pi_ref ? ` · profile ${it.pi_ref}` : ''}${chain}*`);
    out.push('');
    out.push('**Question**');
    out.push('');
    out.push(quote(it.question));
    out.push('');
    for (const r of runs) {
      const row = r.rows[it.id];
      if (!row) continue;
      const shown = row.rendered_answer ?? row.raw_answer ?? '';
      const { body, gist } = splitGist(shown);
      const edited = row.rendered_answer && splitGist(row.rendered_answer).body !== splitGist(row.raw_answer).body;
      const failed = row.success === false || FAILED_RE.test(body);
      out.push(`**${r.label}**${edited ? ' — edited after streaming' : ''}${failed ? ' — NO ANSWER (provider outage in this run)' : ''}`);
      out.push('');
      out.push(quote(body || '(empty)'));
      if (gist) out.push(`>\n> *Summary chip:* ${gist.replace(/\n/g, ' ')}`);
      const j = r.judged[it.id];
      if (j) out.push(`\n*Judge: ${j.official.overall.toFixed(1)}${j.official.flags?.length ? ` — ${j.official.flags.join(', ')}` : ''}. ${String(j.judgment.specific_issue ?? '').replace(/\s+/g, ' ').slice(0, 320)}*`);
      out.push('');
    }
    out.push('---');
    out.push('');
  }
}
fs.writeFileSync(OUT, out.join('\n'));
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${items.length} questions × ${runs.length} runs, ${kb} KB, ${out.length} lines`);
