// astra/decide-enlarged.mjs over a made-up tree: the I29 rules give the written verdicts.
//   node --test astra/decide-enlarged.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 20 rows: 10 untouched (carried), 10 touched with `gain(i, s)` added to the variant's score in sample s. */
function tree({ gain, half = 'D', hfBase = () => false, hfVar = () => false, drop = null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-enlarged-'));
  const dir = path.join(root, 'results', 'replay'); fs.mkdirSync(dir, { recursive: true });
  const w = (f, rows) => fs.writeFileSync(path.join(dir, f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const all = Array.from({ length: 20 }, (_, i) => `X-${String(i).padStart(2, '0')}`); const touched = all.slice(10);
  const jr = (id, s, hf) => ({ ok: true, benchmark_id: id, k: 0, official: { overall: s, hard_fail: hf, flags: [] } });
  for (let s = 1; s <= 3; s++) {
    const ids = s === 1 ? all : touched;
    w(`tE${s}-base.${half}.jsonl`, ids.map((id) => ({ id, k: 0, answer: `base ${id} ${s}` })));
    w(`tE${s}-var.${half}.jsonl`, ids.map((id) => (touched.includes(id) ? { id, k: 0, answer: `var ${id} ${s}` } : { id, k: 0, answer: `base ${id} ${s}`, carried: true })));
    w(`tE${s}-base.${half}.judged.jsonl`, ids.map((id) => jr(id, 7, hfBase(all.indexOf(id), s))));
    w(`tE${s}-var.${half}.judged.jsonl`, ids.filter((id) => touched.includes(id) && !(drop && drop(all.indexOf(id), s))).map((id) => jr(id, 7 + gain(all.indexOf(id), s), hfVar(all.indexOf(id), s))));
  }
  return root;
}
const run = (root, half = 'D') => { const r = spawnSync(process.execPath, [path.join(HERE, 'decide-enlarged.mjs'), '--prefix', 'tE', '--half', half, '--samples', '3', '--root', root], { encoding: 'utf8' }); fs.rmSync(root, { recursive: true, force: true }); return r; };

test('a steady gain on the touched rows passes the decision rule; untouched rows count as 0', () => {
  const r = run(tree({ gain: (i) => 0.8 + (i % 3) * 0.2 })); // touched mean +1.0 → +0.5 over all rows
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /\| 20 \| 10 \| 3 \| 7\.00 \| 7\.50 \| \+0\.50 \(±0\.2\d\) \| 0 → 0 \|/);
  assert.match(r.stdout, /Verdict \(decision rule\): PASS/);
});

test('a gain under +0.3 fails the decision rule and passes the confirmation rule', () => {
  const gain = (i) => 0.3 + (i % 3) * 0.1; // touched mean +0.4 → +0.2 over all rows
  const d = run(tree({ gain }));
  assert.equal(d.status, 1);
  assert.match(d.stdout, /FAIL — gain under \+0\.3/);
  const c = run(tree({ gain, half: 'C' }), 'C');
  assert.equal(c.status, 0, c.stdout);
  assert.match(c.stdout, /Verdict \(confirmation rule\): PASS/);
});

test('a gain carried by two rows does not clear its interval', () => {
  const r = run(tree({ gain: (i) => (i >= 18 ? 4 : -0.1) }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /interval includes 0/);
});

test('samples are averaged per item: one lucky sample is a third of that item', () => {
  const r = run(tree({ gain: (i, s) => (s === 1 ? 3 : 0) })); // each touched item +1.0 → +0.5 over all rows
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /\+0\.50 \(±0\.2\d\)/);
});

test('more hard fails in the variant fail the rule whatever the gain', () => {
  const r = run(tree({ gain: () => 1, hfVar: (i, s) => i === 12 && s === 2 }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /0 → 1/);
  assert.match(r.stdout, /hard fails up/);
});

test('an answer not judged yet gives no verdict', () => {
  const r = run(tree({ gain: () => 1, drop: (i, s) => i === 15 && s === 3 }));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /INCOMPLETE — 20 rows, 1 answers or judgments missing/);
  assert.doesNotMatch(r.stdout, /X-\d\d/, 'no item id is printed');
});
