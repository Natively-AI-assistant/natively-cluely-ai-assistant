// The heard path's document-grounded "corrected answer" repair (IntelligenceEngine.ts ~5730): how often it runs, what
// it misses of the generator's evidence, and whether its text became the shown answer. Judge-free.
//   node evidence-rich/report/repair-parity.mjs <run dir> …
import path from 'node:path';
import { loadRun, splitGist, answerOf } from '../objective.mjs';
const squash = (t) => String(t ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').replace(/\[Page \d+\]/g, ' ').replace(/\s+/g, '').toLowerCase();
const respText = (raw) => { let out = ''; for (const line of String(raw ?? '').split('\n')) { if (!line.startsWith('data:')) continue; try { const j = JSON.parse(line.slice(5)); out += j.delta?.text ?? j.choices?.[0]?.delta?.content ?? ''; } catch { /* */ } } return out; };
const body = (t) => squash(splitGist(t).body);
for (const dir of process.argv.slice(2)) {
  const run = loadRun(dir); const n = { rows: 0, heard: 0, typed: 0, rep: 0, repHeard: 0, repTyped: 0, cut: 0, factsGen: 0, factsLost: 0, lostRows: 0, shown: 0, shownLost: 0 }; const ids = [];
  for (const row of run.rows) {
    const w = run.wire[row.benchmark_id]; if (!w) continue; n.rows++; row.surface === 'typed' ? n.typed++ : n.heard++;
    const gen = (w.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
    const reps = (w.other_requests ?? []).filter((o) => /Output ONLY the corrected answer/.test((o.messages ?? []).map((m) => m.text ?? '').join('\n')));
    if (!reps.length) continue; n.rep++; row.surface === 'typed' ? n.repTyped++ : n.repHeard++;
    const r = reps.at(-1); const t = (r.messages ?? []).map((m) => m.text ?? '').join('\n'); if (/answer context truncated/.test(t)) n.cut++;
    const item = run.ds.byId[row.benchmark_id]; const needles = (item?.oracle?.required_facts ?? []).flatMap((f) => f.doc_needles ?? f.answer_needles ?? []).filter((x) => String(x).length >= 4);
    const had = needles.filter((x) => squash(gen).includes(squash(x))); const lost = had.filter((x) => !squash(t).includes(squash(x)));
    n.factsGen += had.length; n.factsLost += lost.length; if (lost.length) n.lostRows++;
    const out = respText(r.response); const shown = out.trim().length >= 5 && body(answerOf(row)).includes(body(out).slice(0, 120));
    if (shown) { n.shown++; if (lost.length) { n.shownLost++; ids.push(row.benchmark_id); } }
  }
  console.log(`${path.basename(dir)}: rows ${n.rows} (heard ${n.heard}, typed ${n.typed}); repair ran ${n.rep} (heard ${n.repHeard}, typed ${n.repTyped}); cut at 24,000 ${n.cut}; needed facts the generator had ${n.factsGen}, missing from the repair ${n.factsLost} (on ${n.lostRows} turns); repair text became the shown answer ${n.shown}, of which with a lost fact ${n.shownLost}${ids.length ? ` (${ids.slice(0, 8).join(', ')})` : ''}`);
}
