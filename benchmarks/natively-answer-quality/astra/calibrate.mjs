#!/usr/bin/env node
// Judge calibration gate (spec §38): gpt-6-astra must prefer the obvious `good` answer in >= 18 of 20 pairs
// before it is used as an optimisation arbiter. Labels are randomised per pair; results in astra/out/calibration/.
//   node astra/calibrate.mjs [--repeat 1]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertProbeOk, limiter, readProbe } from './client.mjs';
import { buildEnvelope } from './envelope.mjs';
import { judgePair, pairText } from './ab.mjs';
import { CHARTER_VERSION } from './judge.mjs';
import { splitGist } from './envelope.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cal = JSON.parse(fs.readFileSync(path.join(HERE, 'calibration.json'), 'utf8'));
const profiles = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'dataset', 'pi', 'profiles.json'), 'utf8')).profiles;
const ds = { contexts: cal.contexts, pi_profiles: profiles, items: [] };
try { assertProbeOk(); } catch (e) { console.error(String(e.message)); process.exit(2); }
const outDir = path.join(HERE, 'out', 'calibration'); fs.mkdirSync(outDir, { recursive: true });
const lim = limiter(3);
const results = [];
await Promise.all(cal.pairs.map((p) => lim(async () => {
  const item = { id: p.id, category: p.class, difficulty: 'easy', surface: p.item.speaker === 'other' ? 'hotkey' : 'typed', tags: [], pi_ref: null, pi_eligible: false, context_ref: null, prior_transcript: null, conversation_id: null, turn_index: 1, ...p.item };
  const goodFirst = crypto.randomInt(2) === 0;
  const [A, B] = goodFirst ? [p.good, p.bad] : [p.bad, p.good];
  const env = buildEnvelope({ item, ds, answer: A });
  const a = splitGist(A), b = splitGist(B);
  const res = await judgePair(pairText(env, { body: a.body, gist: a.gist, validator: null }, { body: b.body, gist: b.gist, validator: null }));
  const want = goodFirst ? 'A' : 'B';
  const got = res.ok ? res.judgment.preferred : null;
  results.push({ id: p.id, class: p.class, want, got, correct: got === want, strength: res.judgment?.preference_strength ?? null, reason: res.judgment?.reason ?? res.error ?? null,
    flags_good: res.ok ? (goodFirst ? res.judgment.a : res.judgment.b).hard_flags : null, flags_bad: res.ok ? (goodFirst ? res.judgment.b : res.judgment.a).hard_flags : null,
    returned_model: res.calls?.[0]?.returned_model ?? null, ok: res.ok });
})));
results.sort((x, y) => x.id.localeCompare(y.id));
const correct = results.filter((r) => r.correct).length;
const summary = { at: new Date().toISOString(), charter_version: CHARTER_VERSION, probe: { returned_model: readProbe()?.returned_model ?? null }, correct, total: results.length, pass: correct >= 18, results };
fs.writeFileSync(path.join(outDir, `calibration-${Date.now()}.json`), JSON.stringify(summary, null, 1));
for (const r of results) console.log(`${r.correct ? 'OK  ' : 'MISS'} ${r.id} ${r.class.padEnd(28)} want ${r.want} got ${r.got} ${r.strength ?? ''} ${r.correct ? '' : '— ' + String(r.reason).slice(0, 140)}`);
console.log(`\ncalibration: ${correct}/${results.length} ${summary.pass ? 'PASS (>= 18)' : 'FAIL (< 18) — do not optimise against this judge'}`);
process.exit(summary.pass ? 0 : 1);
