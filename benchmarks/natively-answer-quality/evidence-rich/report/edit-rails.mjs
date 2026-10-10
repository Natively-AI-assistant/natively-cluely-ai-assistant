// What would simple acceptance rails on post-answer edits have done? Uses rows judged both as draft and as shown (cc):
// a rail that rejects an edit yields the draft's score, one that accepts yields the shown score. No new judging.
//   node evidence-rich/report/edit-rails.mjs er-dev-e12b er-dev-e13 [...]
import { loadRun, readJsonl, answerOf, splitGist } from '../objective.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The app's own rule (claimVerifier.numbersAddedByEdit, bundled from the E14 branch): results/.cv/cv-e14.mjs
const CV = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results', '.cv', 'cv-e14.mjs'));
const JUDGE = process.env.ER_JUDGE || 'cc';
const figs = (t) => new Set((String(t).match(/\d[\d,]*(?:\.\d+)?%?/g) || []).map((x) => x.replace(/,/g, '')).filter((x) => x.replace(/%/, '').length >= 2 || /%/.test(x)));
const DEFER = /\b(I'll|I will|let me|I'd need to|I would need to) (confirm|check|pull|look|get back|come back|find out|follow up|verify)|come back to you|get back to you/i;
const E = [];
for (const name of process.argv.slice(2)) {
  const run = loadRun(`evidence-rich/results/${name}`);
  const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j.official]));
  const D = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.draft.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j.official]));
  for (const r of run.rows) {
    if (!r.answer_differs_raw_vs_rendered || !S[r.benchmark_id] || !D[r.benchmark_id]) continue;
    const raw = splitGist(String(r.raw_answer)).body, fin = splitGist(String(answerOf(r))).body; const w = run.wire[r.benchmark_id];
    const prompt = (w?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n').replace(/,/g, '');
    const items = (prompt.match(/<evidence /g) ?? []).length; const rf = figs(raw), ff = figs(fin);
    const kinds = (w?.other_requests ?? []).map((o) => { const t = (o.messages ?? []).map((m) => m.text ?? '').join(''); return /DRAFT REPLY:/.test(t) ? 'claim' : /Output ONLY the corrected answer/.test(t) ? 'repair' : 'other'; });
    E.push({ run: name, id: r.benchmark_id, cond: run.ds.byId[r.benchmark_id].condition, d: D[r.benchmark_id], s: S[r.benchmark_id], items, repair: kinds.includes('repair'),
      appAdded: CV.numbersAddedByEdit(raw, fin), added: [...ff].filter((x) => !rf.has(x)), removed: [...rf].filter((x) => !ff.has(x)), removedInEvidence: [...rf].filter((x) => !ff.has(x) && prompt.includes(x)), newDeferral: DEFER.test(fin) && !DEFER.test(raw), shrink: fin.length / Math.max(1, raw.length) });
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const RAILS = {
  'accept every edit (today)': () => false,
  'reject every edit (drafts only)': () => true,
  'E14 (the app rule): numbersAddedByEdit(draft, edit) not empty': (e) => e.appAdded.length > 0,
  'A  edit adds a figure the draft did not have': (e) => e.added.length > 0,
  "A' edit adds more figures than it removes (a correction is allowed)": (e) => e.added.length > e.removed.length,
  'B  edit removes a figure that is in the evidence': (e) => e.removedInEvidence.length > 0,
  'C  edit introduces a deferral, evidence in the prompt': (e) => e.newDeferral && e.items > 0,
  'D  edit under 60 % of the draft, evidence in the prompt': (e) => e.shrink < 0.6 && e.items > 0,
  'A + B': (e) => e.added.length > 0 || e.removedInEvidence.length > 0,
  'A + B + C': (e) => e.added.length > 0 || e.removedInEvidence.length > 0 || (e.newDeferral && e.items > 0),
  'A + B + C + D': (e) => e.added.length > 0 || e.removedInEvidence.length > 0 || (e.newDeferral && e.items > 0) || (e.shrink < 0.6 && e.items > 0),
};
if (process.env.SHOW) for (const e of E.filter((e) => e.added.length > 0)) console.log(e.run, e.id.padEnd(15), e.cond.padEnd(16), 'draft', e.d.overall.toFixed(1), 'shown', e.s.overall.toFixed(1), 'added', e.added.join(' '), '| removed', e.removed.join(' '));
console.log(`edited rows judged both ways: ${E.length} (with the repair pass too: ${E.filter((e) => e.repair).length})`);
for (const [name, rej] of Object.entries(RAILS)) {
  const out = E.map((e) => (rej(e) ? e.d : e.s)); const n = E.filter(rej).length;
  const good = E.filter((e) => rej(e) && e.d.overall - e.s.overall > 0.5).length, bad = E.filter((e) => rej(e) && e.s.overall - e.d.overall > 0.5).length;
  console.log(`${name.padEnd(58)} rejects ${String(n).padStart(2)}  mean ${mean(out.map((o) => o.overall)).toFixed(3)}  hard ${out.filter((o) => o.hard_fail).length}  | rejections that save >0.5: ${good}, that lose >0.5: ${bad}`);
}
