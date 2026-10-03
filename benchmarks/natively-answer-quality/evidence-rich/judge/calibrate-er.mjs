#!/usr/bin/env node
// Calibration gate for the evidence-rich charter: the judge must prefer the obviously better answer in at least 27
// of 30 pairs before any batch is judged with it. Scenarios are written for calibration only (they are not
// benchmark items) on top of the frozen corpus; labels are assigned by a hash, so they are reproducible and
// unpredictable to the judge.
//   [AQ_JUDGE=opus] node evidence-rich/judge/calibrate-er.mjs [--evidence focused|full]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertProbeOk, limiter, VIA_CLI } from '../../astra/client.mjs';
import { loadDataset } from '../objective.mjs';
import { buildPairEnvelope } from './envelope-er.mjs';
import { CHARTER, CHARTER_VERSION, JUDGE_META, JUDGE_TAG, judgeOnce, checkJudgment } from './judge-er.mjs';
import { DIMENSIONS } from './score-er.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const evidence = opt('evidence', 'focused');
const cal = JSON.parse(fs.readFileSync(path.join(HERE, 'calibration-er.json'), 'utf8'));
const ds = loadDataset('dev'); // configs only; calibration scenarios are not dataset items
try { assertProbeOk(); } catch (e) { console.error(String(e.message)); process.exit(2); }

export const PAIR_INSTRUCTIONS = `\n\n# PAIRWISE MODE\nYou will see ONE case and TWO candidate answers, labelled A and B in random order. Judge each answer independently with the full procedure, then say which you would rather the user receive at this moment.\nReturn ONLY one JSON object:\n{"expected_behavior": "...", "a": {"scores": {${DIMENSIONS.map((d) => `"${d}": 0`).join(', ')}}, "hard_flags": [], "verdict": "excellent|good|mixed|poor|hard_fail", "specific_issue": "..."}, "b": {same shape}, "preferred": "A|B|tie", "preference_strength": "slight|clear|decisive", "reason": "..."}\nThe labels carry no meaning; neither answer is newer or preferred by anyone.`;
function checkPair(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, problems: ['not an object'] };
  const p = [];
  for (const k of ['a', 'b']) { const c = checkJudgment({ expected_behavior: 'x', ...(obj[k] ?? {}) }); if (!c.ok) p.push(...c.problems.map((x) => `${k}.${x}`)); }
  if (!['A', 'B', 'tie'].includes(obj.preferred)) p.push('preferred invalid');
  return { ok: p.length === 0, problems: p };
}

const lim = limiter(VIA_CLI ? 4 : 3);
const results = [];
await Promise.all(cal.pairs.map((p) => lim(async () => {
  const item = { id: p.id, prior_transcript: null, conversation_id: null, turn_index: 1, pi_state: 'none', condition: p.class, ...p.item };
  const goodFirst = (crypto.createHash('sha256').update(`er-cal|${p.id}`).digest()[0] & 1) === 0;
  const [A, B] = goodFirst ? [p.good, p.bad] : [p.bad, p.good];
  const env = buildPairEnvelope({ item, ds, answerA: A, answerB: B, evidence });
  const res = await judgeOnce(CHARTER + PAIR_INSTRUCTIONS, env.text, { maxTokens: 6000, check: checkPair, schema: 'the pairwise object described in the instructions' });
  const want = goodFirst ? 'A' : 'B';
  const got = res.ok ? res.judgment.preferred : null;
  const side = (k) => (res.ok ? (goodFirst === (k === 'good') ? res.judgment.a : res.judgment.b) : null);
  results.push({ id: p.id, class: p.class, want, got, correct: got === want, strength: res.judgment?.preference_strength ?? null, reason: res.judgment?.reason ?? res.error ?? null,
    flags_good: side('good')?.hard_flags ?? null, flags_bad: side('bad')?.hard_flags ?? null, returned_model: res.calls?.[0]?.returned_model ?? null, ok: res.ok });
})));
results.sort((x, y) => x.id.localeCompare(y.id));
const correct = results.filter((r) => r.correct).length;
const need = Math.ceil(results.length * 0.9);
const summary = { at: new Date().toISOString(), ...JUDGE_META, charter_version: CHARTER_VERSION, envelope_evidence: evidence, correct, total: results.length, need, pass: correct >= need, results };
const outDir = path.join(HERE, 'out', 'calibration'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `calibration-${JUDGE_TAG}-${Date.now()}.json`), JSON.stringify(summary, null, 1));
for (const r of results) console.log(`${r.correct ? 'OK  ' : 'MISS'} ${r.id.padEnd(12)} ${String(r.class).padEnd(34)} want ${r.want} got ${r.got} ${r.strength ?? ''} ${r.correct ? '' : '— ' + String(r.reason).slice(0, 160)}`);
console.log(`\ncalibration (${JUDGE_META.judge_family}, charter ${CHARTER_VERSION}): ${correct}/${results.length} ${summary.pass ? `PASS (>= ${need})` : `FAIL (< ${need}) — do not judge with this charter`}`);
process.exit(summary.pass ? 0 : 1);
