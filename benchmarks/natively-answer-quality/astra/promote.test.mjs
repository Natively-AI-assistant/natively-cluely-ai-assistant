// astra/promote.mjs over a made-up harness tree: the written promotion rules give the written verdicts.
//   node --test astra/promote.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = { 'looking-for-work': ['lfw-base', 'lfw-bridge-v2', 'fix14'], 'call-center': ['ccfin-base', 'ccfin-nopolicy-v1h', 'fix16'], sales: ['salesfin-base', 'salesfin-shape-v1h', 'fix16'] };
const N = 12;
const ids = (mode, split) => Array.from({ length: N }, (_, i) => `${split}-${mode}-${i}`);
const jrow = (id, mode, s, { hf = false, flags = [] } = {}) => JSON.stringify({ ok: true, benchmark_id: id, mode, repeat: 0, official: { overall: s, hard_fail: hf, flags } });
// A spread around the mean so an interval exists: the base alternates 7.8 / 8.2, the other side adds `gain` (± jitter).
const base = (i) => (i % 2 ? 8.2 : 7.8);
const moved = (i, gain) => base(i) + gain + (i % 3 === 0 ? 0.1 : -0.05);

/** spec: per mode { replay: gain, app: { dev: gain, holdout: gain }, flagsUp?, hfUp?, skipApp? }; reasoning: { dev, holdout, hfUp? } */
function tree(spec, reasoning = { dev: 0.4, holdout: 0.4 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-promote-'));
  const w = (f, lines) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, lines.join('\n') + '\n'); };
  for (const split of ['dev', 'holdout']) {
    // fix15: 6 typed + 6 heard technical-interview rows
    const tids = ids('technical-interview', split);
    w(`results/aq2-${split}-fix15/natively_benchmark_full.jsonl`, tids.map((id, i) => JSON.stringify({ benchmark_id: id, mode: 'technical-interview', surface_path: i < 6 ? 'typed' : 'manual' })));
    w(`astra/out/abs-${split}-c2/aq2-${split}-fix13c.jsonl`, tids.map((id, i) => jrow(id, 'technical-interview', base(i))));
    w(`astra/out/abs-${split}-c2/aq2-${split}-fix15.jsonl`, tids.map((id, i) => jrow(id, 'technical-interview', i < 6 ? moved(i, reasoning[split]) : base(i), { hf: !!reasoning.hfUp && split === 'holdout' && i === 0 })));
    for (const [mode, [, , app]] of Object.entries(MODES)) {
      const m = spec[mode]; const mids = ids(mode, split);
      w(`results/aq2-${split}-${app}/natively_benchmark_full.jsonl`, mids.map((id) => JSON.stringify({ benchmark_id: id, mode, surface_path: 'manual' })));
      w(`astra/out/abs-${split}-c2/aq2-${split}-fix13c.jsonl`, mids.map((id, i) => jrow(id, mode, base(i))));
      if (m.skipApp) continue;
      w(`astra/out/abs-${split}-c2/aq2-${split}-${app}.jsonl`, mids.map((id, i) => jrow(id, mode, moved(i, m.app[split]), { hf: !!m.hfUp && split === 'holdout' && i < 2, flags: m.flagsUp && i < 3 ? ['important_question_unanswered'] : [] })));
    }
  }
  for (const [mode, [b, v]] of Object.entries(MODES)) {
    const rids = ids(mode, 'replay');
    w(`results/replay/${b}.jsonl`, rids.map((id) => JSON.stringify({ id, k: 0 })));
    if (spec[mode].replay == null) continue;
    w(`results/replay/${b}.judged.jsonl`, rids.map((id, i) => jrow(id, mode, base(i))));
    w(`results/replay/${v}.judged.jsonl`, rids.map((id, i) => jrow(id, mode, moved(i, spec[mode].replay))));
  }
  return root;
}
function run(spec, reasoning) {
  const root = tree(spec, reasoning);
  try {
    const r = spawnSync(process.execPath, [path.join(HERE, 'promote.mjs'), '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const [reasoningPart, partsPart] = r.stdout.split('## The three');
    return { out: r.stdout, reasoningPart, partsPart };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const good = { replay: 0.5, app: { dev: 0.4, holdout: 0.4 } };
const flat = { replay: 0.0, app: { dev: 0.4, holdout: 0.4 } };

test('reasoning: positive typed rows on both splits meet condition (4); heard rows do not enter it', () => {
  const { reasoningPart } = run({ 'looking-for-work': good, 'call-center': good, sales: good });
  assert.match(reasoningPart, /Verdict: condition \(4\) MET/);
  assert.match(reasoningPart, /\| dev \| typed \(reason\) \| 6 \|/);
  assert.match(reasoningPart, /\| dev \| heard \(unchanged code, a new sample\) \| 6 \| 8\.00 \| 8\.00 \| \+0\.00/);
});
test('reasoning: typed rows down on dev, or a new holdout hard fail, do not meet it', () => {
  assert.match(run({ 'looking-for-work': good, 'call-center': good, sales: good }, { dev: -0.3, holdout: 0.4 }).reasoningPart, /NOT MET \(dev typed rows not positive\)/);
  assert.match(run({ 'looking-for-work': good, 'call-center': good, sales: good }, { dev: 0.4, holdout: 0.4, hfUp: true }).reasoningPart, /NOT MET \(holdout hard fails up\)/);
});
test('parts: only modes whose replay pair says BUILD are pooled', () => {
  const { partsPart } = run({ 'looking-for-work': good, 'call-center': flat, sales: flat });
  assert.match(partsPart, /Built modes: looking-for-work\./);
  assert.match(partsPart, /\| holdout \| 12 \|/);
  assert.match(partsPart, /rules 1–4 and 6 MET/);
});
test('parts: no BUILD verdict means nothing is promoted, whatever the app rows say', () => {
  const { partsPart } = run({ 'looking-for-work': flat, 'call-center': flat, sales: flat });
  assert.match(partsPart, /No part has a BUILD verdict/);
  assert.doesNotMatch(partsPart, /MET/);
});
test('parts: a holdout gain whose interval includes 0 is not promoted', () => {
  const { partsPart } = run({ 'looking-for-work': { replay: 0.5, app: { dev: 0.4, holdout: 0.01 } }, 'call-center': flat, sales: flat });
  assert.match(partsPart, /NOT PROMOTED \(rule 1:/);
});
test('parts: one built mode clearly down on holdout is removed and the rest is tested once', () => {
  const { partsPart } = run({ 'looking-for-work': good, 'call-center': { replay: 0.5, app: { dev: 0.4, holdout: -0.8 } }, sales: good });
  assert.match(partsPart, /Note — rule 3: Call Center .* removed/);
  assert.match(partsPart, /Built modes: looking-for-work, sales\./);
  assert.match(partsPart, /rules 1–4 and 6 MET/);
});
test('parts: hard fails up, the unanswered flag up, or dev disagreeing each block promotion', () => {
  assert.match(run({ 'looking-for-work': { ...good, hfUp: true }, 'call-center': flat, sales: flat }).partsPart, /NOT PROMOTED \(rule 2: holdout hard fails up/);
  assert.match(run({ 'looking-for-work': { ...good, flagsUp: true }, 'call-center': flat, sales: flat }).partsPart, /rule 6: "question left unanswered" is up/);
  assert.match(run({ 'looking-for-work': { replay: 0.5, app: { dev: -0.4, holdout: 0.4 } }, 'call-center': flat, sales: flat }).partsPart, /rule 4: dev does not agree in sign/);
});
test('parts: unjudged replay pair or unjudged app rows give no verdict', () => {
  assert.match(run({ 'looking-for-work': { replay: null, app: good.app }, 'call-center': { replay: null, app: good.app }, sales: { replay: null, app: good.app } }).partsPart, /INCOMPLETE — no part has a verdict/);
  assert.match(run({ 'looking-for-work': { ...good, skipApp: true }, 'call-center': flat, sales: flat }).partsPart, /INCOMPLETE — no verdict \(app rows not fully judged\)/);
});
test('holdout stays aggregate: no item id is printed', () => {
  const { out } = run({ 'looking-for-work': good, 'call-center': good, sales: good });
  assert.doesNotMatch(out, /holdout-(looking-for-work|call-center|sales|technical-interview)-\d/);
  assert.doesNotMatch(out, /dev-(looking-for-work|call-center|sales|technical-interview)-\d/);
});
