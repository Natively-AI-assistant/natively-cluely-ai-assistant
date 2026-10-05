#!/usr/bin/env node
// Headroom per mode and per failure class, from existing judgments — no new calls.
//   node astra/headroom.mjs astra/out/abs-dev-c2/<run>.jsonl [more files…]
// Every judged answer is put in ONE class by its flags (first match wins):
//   generator  — the model's own error: reasoning, arithmetic, a wrong fact, wrong code
//   no-source  — a company / policy / product / research claim nothing supports, or a commitment it cannot back
//   no-answer  — about the user themselves: an invented personal claim or story, or the question left unanswered
//   evidence   — the material had it and the answer missed or contradicted it
//   clean      — none of the above
// "If fixed" = the mode's mean if that class's answers scored like the mode's clean answers. The clean mean is the
// ceiling local or architectural fixes of these classes can reach; what is below 9.5 after that is polish.
import fs from 'node:fs';
const CLASSES = [
  ['generator', /^(major_reasoning_error|arithmetic_error|major_factual_error|code_incorrect|complexity_incorrect)$/],
  ['no-source', /^(unsupported_company_claim|unsupported_policy_claim|unsupported_research_claim|unsafe_commitment|fabricated_meeting_history)$/],
  ['no-answer', /^(unsupported_personal_claim|fabricated_behavioral_story|important_question_unanswered|coaching_instead_of_answer)$/],
  ['evidence', /^(missed_available_evidence|reference_conflict_ignored)$/],
];
const NAME = { general: 'General', sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', 'looking-for-work': 'Looking for work', lecture: 'Lecture', 'technical-interview': 'Technical interview', seminar: 'Seminar', 'call-center': 'Call Center' };
const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const f = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
for (const file of process.argv.slice(2)) {
  const J = {}; for (const l of fs.readFileSync(file, 'utf8').split('\n')) { if (!l) continue; const j = JSON.parse(l); if (j.ok && (j.repeat ?? 0) === 0) J[j.benchmark_id] = j; }
  const rows = Object.values(J).map((j) => { const flags = [...new Set([...(j.official.flags ?? []), ...(j.judgment.flags ?? [])])]; const c = CLASSES.find(([, re]) => flags.some((x) => re.test(x)))?.[0] ?? 'clean'; return { mode: j.mode, s: j.official.overall, c }; });
  console.log(`\n${file.split('/').slice(-2).join('/')} — ${rows.length} judged answers`);
  console.log('| Mode | mean | clean answers: n, mean | generator: n, mean → if fixed | no-source: n, mean → if fixed | no-answer: n, mean → if fixed | evidence: n, mean → if fixed | clean ≥ 9.5 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const m of [...Object.keys(NAME), 'ALL']) {
    const v = rows.filter((r) => m === 'ALL' || r.mode === m); if (!v.length) continue;
    const clean = v.filter((r) => r.c === 'clean'); const cm = mean(clean.map((r) => r.s));
    const cell = (c) => { const x = v.filter((r) => r.c === c); if (!x.length) return '0'; const lifted = mean(v.map((r) => (r.c === c ? cm : r.s))); return `${x.length}, ${f(mean(x.map((r) => r.s)))} → ${f(lifted)}`; };
    console.log(`| ${m === 'ALL' ? '**All**' : NAME[m]} | ${f(mean(v.map((r) => r.s)))} | ${clean.length}, ${f(cm)} | ${cell('generator')} | ${cell('no-source')} | ${cell('no-answer')} | ${cell('evidence')} | ${clean.filter((r) => r.s >= 9.5).length}/${clean.length} |`);
  }
}
