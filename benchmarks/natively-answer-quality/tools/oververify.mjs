#!/usr/bin/env node
// Objective signs of OVER-verification in a run (or a verifier replay): what the pass took away that was not a claim.
//   node tools/oververify.mjs results/<run> [...]            (in-app run: raw_answer → rendered_answer)
//   node tools/oververify.mjs --replay results/replay/<name>.jsonl [...]   (replay: original → answer)
// Per mode: edits; replies that END in a question when the draft did not; a current decision or ownership the
// draft made and the edit lost; edits cut to under half the draft.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const replay = args[0] === '--replay';
const files = (replay ? args.slice(1) : args).filter((a) => !a.startsWith('--'));
const strip = (s) => String(s ?? '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '').trim();
const endsQ = (s) => /\?\s*["”']?\s*$/.test(strip(s));
export const DECISION_RE = /\b(?:I can take|I'?ll take|happy to take|I can own|I'?ll own|I can do|I'?ll do|I'?ll handle|I can handle|let'?s (?:do|go with|start|keep|ship|hold|cut|move|plan|pick)|I'?d go with|I'?d pick|I'?d choose|I'?d start with|I'?d rather|I'?d keep|I'?d ship|I'?d hold|I'?d cut|I'?d prioriti[sz]e|we should|my vote is|I vote)\b/i;
const W = (s) => strip(s).split(/\s+/).filter(Boolean).length;
for (const f of files) {
  const rows = fs.readFileSync(replay ? f : path.join(f, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .map((r) => (replay ? { id: r.id, mode: r.mode, surface: r.surface, draft: r.original, final: r.answer } : { id: r.benchmark_id, mode: r.mode, surface: r.surface_path, draft: r.raw_answer, final: r.rendered_answer ?? r.raw_answer }));
  const by = {};
  for (const r of rows) {
    for (const k of [r.mode, 'ALL']) {
      const m = (by[k] ??= { n: 0, edited: 0, toQ: [], lostDecision: [], halved: [] });
      m.n++;
      if (strip(r.draft) === strip(r.final)) continue;
      m.edited++;
      if (endsQ(r.final) && !endsQ(r.draft)) m.toQ.push(r.id);
      if (DECISION_RE.test(strip(r.draft)) && !DECISION_RE.test(strip(r.final))) m.lostDecision.push(r.id);
      if (W(r.final) < W(r.draft) * 0.5) m.halved.push(r.id);
    }
  }
  console.log(`\n${path.basename(f)}`);
  console.log('| mode | n | edited | → ends in a question | decision lost | cut to < half |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const [k, m] of Object.entries(by).sort((a, b) => (a[0] === 'ALL') - (b[0] === 'ALL'))) console.log(`| ${k} | ${m.n} | ${m.edited} | ${m.toQ.length} | ${m.lostDecision.length} | ${m.halved.length} |`);
  if (args.includes('--ids')) for (const [k, m] of Object.entries(by)) if (k !== 'ALL' && m.lostDecision.length) console.log(`  ${k} decision lost: ${m.lostDecision.join(', ')}`);
}
