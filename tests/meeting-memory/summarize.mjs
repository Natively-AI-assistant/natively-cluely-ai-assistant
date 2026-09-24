// tests/meeting-memory/summarize.mjs
//
// Aggregates live-memory-harness result files into one comparable table.
//   node tests/meeting-memory/summarize.mjs <label>        (all files for a label)
//   node tests/meeting-memory/summarize.mjs <file.json>...

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const argv = process.argv.slice(2);
const files = argv.flatMap((a) => (a.endsWith('.json')
  ? [a]
  : fs.readdirSync(DIR).filter((f) => f.startsWith(`${a}-`) && f.endsWith('.json')).map((f) => path.join(DIR, f))));
const runs = files.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).runs);

// RE-SCORE every stored answer with the CURRENT scorer and fact regexes, so a
// tightened matcher applies to baseline and post-fix runs alike (the raw files
// keep whatever the harness scored at run time).
const { score, factRegexFor } = await import('./scenarios.mjs');
const evidenceOf = (u) => { const i = (u ?? '').indexOf('# Evidence'); return i >= 0 ? u.slice(i) : ''; };
for (const r of runs) {
  const recs = r.turns ? r.turns.filter((t) => t.kind === 'probe') : (r.results ?? []);
  for (const x of recs) {
    const re = factRegexFor(r.scenario, x.fact);
    if (!re) continue;
    x.result = score(x.answer, re);
    if (typeof x.promptUser === 'string') {
      x.factInEvidence = re.test(evidenceOf(x.promptUser));
      if (r.scenario === 'interview' || r.scenario === 'hour') x.factInPrompt = re.test(x.promptUser);
    }
  }
}

const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : 'n/a');
const out = [];

for (const sc of ['typed', 'typed-quiet', 'typed-wta', 'typed-long']) {
  const rs = runs.filter((r) => r.scenario === sc && r.turns);
  if (!rs.length) continue;
  out.push(`\n## ${sc} — ${rs.length} run(s)`);
  const probes = rs.flatMap((r) => r.turns.filter((t) => t.kind === 'probe'));
  const byFact = new Map();
  for (const p of probes) {
    const k = `${p.fact} (d=${p.distance})`;
    const e = byFact.get(k) ?? { n: 0, recalled: 0, denied: 0, wrong: 0, error: 0, inPrompt: 0, inConvo: 0 };
    e.n++; e[p.result] = (e[p.result] ?? 0) + 1;
    if (p.factInPrompt) e.inPrompt++;
    if (p.factInConversationBlock) e.inConvo++;
    byFact.set(k, e);
  }
  out.push('| fact (distance) | recalled | denied | wrong | fact in prompt | fact in history block |');
  out.push('|---|---|---|---|---|---|');
  for (const [k, e] of [...byFact].sort((a, b) => Number(a[0].match(/d=(\d+)/)[1]) - Number(b[0].match(/d=(\d+)/)[1]))) {
    out.push(`| ${k} | ${pct(e.recalled, e.n)} | ${pct(e.denied, e.n)} | ${pct(e.wrong + e.error, e.n)} | ${pct(e.inPrompt, e.n)} | ${pct(e.inConvo, e.n)} |`);
  }
  const recalled = probes.filter((p) => p.result === 'recalled').length;
  out.push(`\n**Recall overall: ${pct(recalled, probes.length)}**`);
  const plants = rs.flatMap((r) => r.turns.filter((t) => t.kind === 'plant'));
  out.push(`Pushback on the user's own fact when stated: ${pct(plants.filter((t) => t.pushback).length, plants.length)}`);
  // A ring RESET = the engine key's turn count going DOWN between consecutive typed turns.
  let resets = 0;
  for (const r of rs) {
    let prev = null;
    for (const t of r.turns) {
      const mine = (t.ring ?? []).find((x) => x.key === t.engineKey);
      if (!mine) continue;
      if (prev !== null && mine.turns < prev) resets++;
      prev = mine.turns;
    }
  }
  out.push(`History-ring resets mid-meeting: ${resets} across ${rs.length} run(s)`);
}

const wf = runs.filter((r) => r.scenario === 'wta-followup' && r.second);
const denies = (a) => /(don'?t|do not|can'?t|cannot)\s+(have|see|know|speak|tell)|not (in front of me|sure which)|no (record|detail)/i.test(a ?? '');
if (wf.length) {
  out.push(`\n## what-to-answer follow-up after a 110 s gap — ${wf.length} run(s)`);
  out.push(`Previous question in follow-up prompt: ${pct(wf.filter((r) => r.firstQuestionInSecondPrompt).length, wf.length)}`);
  out.push(`Previous answer in follow-up prompt: ${pct(wf.filter((r) => r.firstAnswerInSecondPrompt).length, wf.length)}`);
  out.push(`Follow-up says it does not know the earlier pick: ${pct(wf.filter((r) => r.secondDenies ?? denies(r.second.answer)).length, wf.length)}`);
  out.push(`Follow-up recalls the earlier pick: ${pct(wf.filter((r) => r.recalledChoice ?? (!denies(r.second.answer) && r.first.algos?.[0] && (r.second.answer ?? '').toLowerCase().includes(r.first.algos[0]))).length, wf.length)}`);
}

const hr = runs.filter((r) => r.scenario === 'hour' && r.results);
if (hr.length) {
  out.push(`\n## one-hour meeting — ${hr.length} run(s)`);
  out.push('| fact | surface | recalled | denied | wrong | fact in prompt | in evidence | in history |');
  out.push('|---|---|---|---|---|---|---|---|');
  const cells = new Map();
  for (const r of hr) for (const x of r.results) {
    const k = `${x.fact} (min ${x.minute})|${x.surface}`;
    const e = cells.get(k) ?? { n: 0, recalled: 0, denied: 0, wrong: 0, error: 0, inPrompt: 0, inEv: 0, inHist: 0, located: 0 };
    e.n++; e[x.result] = (e[x.result] ?? 0) + 1; if (x.factInPrompt) e.inPrompt++;
    if (x.factInEvidence !== undefined) { e.located++; if (x.factInEvidence) e.inEv++; if (x.factInHistory) e.inHist++; }
    cells.set(k, e);
  }
  for (const [k, e] of cells) {
    const [f, s] = k.split('|');
    out.push(`| ${f} | ${s} | ${pct(e.recalled, e.n)} | ${pct(e.denied, e.n)} | ${pct(e.wrong + e.error, e.n)} | ${pct(e.inPrompt, e.n)} | ${pct(e.inEv, e.located)} | ${pct(e.inHist, e.located)} |`);
  }
}

const iv = runs.filter((r) => r.scenario === 'interview' && r.results);
if (iv.length) {
  out.push(`\n## live interview, details said aloud 13-29 min earlier — ${iv.length} run(s)`);
  out.push('| detail (who said it) | recalled | denied | wrong | in prompt | in evidence | in history |');
  out.push('|---|---|---|---|---|---|---|');
  const cells = new Map();
  for (const r of iv) for (const x of r.results) {
    const e = cells.get(x.fact) ?? { n: 0, recalled: 0, denied: 0, wrong: 0, error: 0, inPrompt: 0, inEv: 0, inHist: 0 };
    e.n++; e[x.result] = (e[x.result] ?? 0) + 1;
    if (x.factInPrompt) e.inPrompt++; if (x.factInEvidence) e.inEv++; if (x.factInHistory) e.inHist++;
    cells.set(x.fact, e);
  }
  for (const [k, e] of cells) out.push(`| ${k} | ${pct(e.recalled, e.n)} | ${pct(e.denied, e.n)} | ${pct(e.wrong + e.error, e.n)} | ${pct(e.inPrompt, e.n)} | ${pct(e.inEv, e.n)} | ${pct(e.inHist, e.n)} |`);
  const all = iv.flatMap((r) => r.results);
  out.push(`\n**Interview detail recall: ${pct(all.filter((x) => x.result === 'recalled').length, all.length)}**`);
}

const cm = runs.filter((r) => r.scenario === 'cross-meeting' && r.leakInPrompt !== undefined);
if (cm.length) {
  out.push(`\n## a new meeting must not know the previous meeting's conversation — ${cm.length} run(s)`);
  out.push(`Previous meeting's secret in the new meeting's prompt: ${pct(cm.filter((r) => r.leakInPrompt).length, cm.length)}`);
  out.push(`New meeting's answer repeats it: ${pct(cm.filter((r) => r.answerLeaks).length, cm.length)}`);
}

// Cost of memory: wall time per answered probe/turn (send → stream done) and
// the size of the composed user prompt for probes. Medians, since one slow
// provider response should not move the comparison.
const median = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const costRows = [];
for (const sc of ['typed', 'typed-long', 'interview', 'hour', 'wta-followup']) {
  const rs = runs.filter((r) => r.scenario === sc);
  const recs = rs.flatMap((r) => (r.turns ? r.turns.filter((t) => t.kind === 'probe') : (r.results ?? [])));
  const ms = recs.map((x) => x.ms);
  const chars = recs.map((x) => (typeof x.promptUser === 'string' ? x.promptUser.length : NaN));
  if (recs.length) costRows.push(`| ${sc} | ${recs.length} | ${Math.round(median(ms))} | ${Math.round(median(chars))} |`);
}
if (costRows.length) {
  out.push('\n## cost — median per probe');
  out.push('| scenario | probes | answer time (ms) | composed user prompt (chars) |');
  out.push('|---|---|---|---|');
  out.push(...costRows);
}

const failed = runs.filter((r) => r.error);
if (failed.length) out.push(`\n${failed.length} run(s) FAILED: ${failed.map((r) => `${r.scenario}#${r.rep}`).join(', ')}`);
console.log(out.join('\n'));
