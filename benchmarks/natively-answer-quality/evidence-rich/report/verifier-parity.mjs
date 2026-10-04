// verifier_evidence_parity: for every turn on which the claim pass ran, did it receive the evidence the generator
// had?  node evidence-rich/report/verifier-parity.mjs <run dir> [<run dir> …]
// Per turn: the generator's user message vs the material in the pass's own request; the evidence items (by source
// name) in each; whether each needed fact (the oracle's recorded strings) reached the generator and the pass; and,
// where the pass changed the answer, whether that is a `verifier_context_loss` (a needed fact the generator had,
// missing from what the pass saw). Judge-free. Run from benchmarks/natively-answer-quality.
import path from 'node:path';
import { loadRun, funnel, splitGist, answerOf } from '../objective.mjs';
const squash = (t) => String(t ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').replace(/\[Page \d+\]/g, ' ').replace(/\s+/g, '').toLowerCase();
const names = (t) => [...String(t).matchAll(/<evidence ([^>]*)>/g)].map((m) => (m[1].match(/source_name="([^"]*)"/) ?? [])[1] ?? (m[1].match(/source_type="([^"]*)"/) ?? [])[1]);
for (const dir of process.argv.slice(2)) {
  const run = loadRun(dir); const n = { passes: 0, fullMaterial: 0, fewerItems: 0, cutMarker: 0, edits: 0, factsGen: 0, factsLostToPass: 0, contextLossEdits: 0 }; const lossIds = [];
  for (const row of run.rows) {
    const w = run.wire[row.benchmark_id]; if (!w) continue;
    const gen = (w.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
    const passReq = (w.other_requests ?? []).find((o) => /DRAFT REPLY:/.test((o.messages ?? []).map((m) => m.text ?? '').join('\n'))); if (!passReq) continue;
    const pr = (passReq.messages ?? []).map((m) => m.text ?? '').join('\n'); const material = pr.slice(0, pr.lastIndexOf('DRAFT REPLY:'));
    n.passes++; if (squash(material).includes(squash(gen))) n.fullMaterial++; if (/truncated for the repair pass/.test(material)) n.cutMarker++;
    const gNames = names(gen), vNames = names(material); if (vNames.length < gNames.length) n.fewerItems++;
    const item = run.ds.byId[row.benchmark_id]; const needles = (item?.oracle?.required_facts ?? []).flatMap((f) => (f.doc_needles ?? f.answer_needles ?? [])).filter((x) => String(x).length >= 4);
    const lost = needles.filter((x) => squash(gen).includes(squash(x)) && !squash(material).includes(squash(x)));
    n.factsGen += needles.filter((x) => squash(gen).includes(squash(x))).length; n.factsLostToPass += lost.length;
    const edited = !!row.answer_differs_raw_vs_rendered; if (edited) n.edits++;
    if (edited && lost.length) { n.contextLossEdits++; lossIds.push(row.benchmark_id); }
  }
  console.log(`${path.basename(dir)}: claim passes ${n.passes}; material holds the generator's whole user message on ${n.fullMaterial}; marked cut ${n.cutMarker}; fewer evidence items than the generator on ${n.fewerItems}; needed-fact strings the generator had ${n.factsGen}, of which missing from the pass ${n.factsLostToPass}; edited answers ${n.edits}, of which verifier_context_loss ${n.contextLossEdits}${lossIds.length ? ` (${lossIds.slice(0, 8).join(', ')}${lossIds.length > 8 ? ', …' : ''})` : ''}`);
}
