#!/usr/bin/env node
// scripts/intent-benchmark/coldstart-eval.mjs
//
// Did the augmentation fix the cold start without costing the warm case?
//
// Two models and two conditions, so the answer cannot be read off one number.
// The pre-augmentation model is preserved on disk rather than remembered, and
// both are scored on the SAME held out rows, taken from the pre-augmentation
// corpus so that neither model is evaluated on rows the other never saw.
//
// The held out rows come from v3.pre-coldstart.jsonl. The augmented corpus adds
// copies of some of those rows, and those copies inherit their source's split,
// so scoring on the augmented holdout would score the new model on rows built
// from its own training distribution while the old model never had them. Using
// the original holdout keeps the comparison honest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MultiHeadProvider } from './providers/multihead.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const corpus = path.join(__dirname, 'dataset', 'v3.pre-coldstart.jsonl');
const rows = fs.readFileSync(corpus, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((r) => r.split === 'holdout' && (r.language ?? 'en') === 'en');

const macro = (pairs) => {
  const labels = [...new Set(pairs.flatMap((x) => [x.a, x.p]))];
  const f1s = labels.map((L) => {
    const tp = pairs.filter((x) => x.a === L && x.p === L).length;
    const fp = pairs.filter((x) => x.a !== L && x.p === L).length;
    const fn = pairs.filter((x) => x.a === L && x.p !== L).length;
    const pr = tp + fp ? tp / (tp + fp) : 0;
    const rc = tp + fn ? tp / (tp + fn) : 0;
    return pr + rc ? (2 * pr * rc) / (pr + rc) : 0;
  });
  return (f1s.reduce((a, b) => a + b, 0) / f1s.length) * 100;
};

const pre = fs.readdirSync(path.join(repoRoot, 'resources/models/natively'))
  .filter((d) => d.startsWith('router-minilm-multihead.pre-coldstart-')).sort().pop();

const models = [
  ['before augmentation', pre ? `resources/models/natively/${pre}` : null],
  ['after augmentation ', 'resources/models/natively/router-minilm-multihead'],
];

const out = [];
for (const [label, dir] of models) {
  if (!dir) { out.push([label, null, null]); continue; }
  const p = new MultiHeadProvider({ id: label.trim(), dir });
  await p.load();
  const scores = [];
  for (const strip of [false, true]) {
    const pairs = [];
    for (const r of rows) {
      const f = await p.classify({ ...r, history: strip ? [] : r.history });
      pairs.push({ a: r.labels.needs_response, p: f.needs_response ?? '<none>' });
    }
    scores.push(macro(pairs));
  }
  out.push([label, scores[0], scores[1]]);
}

console.log(`\nneeds_response macro F1, ${rows.length} held-out English rows from the pre-augmentation corpus\n`);
console.log('model                  with history   cold start   gap');
console.log('-'.repeat(58));
for (const [label, warm, cold] of out) {
  if (warm == null) { console.log(`${label}  (model not found)`); continue; }
  console.log(`${label}       ${warm.toFixed(1).padStart(5)}        ${cold.toFixed(1).padStart(5)}    ${(warm - cold).toFixed(1).padStart(5)}`);
}
const [, warmA, coldA] = out[0] ?? [];
const [, warmB, coldB] = out[1] ?? [];
if (warmA != null && warmB != null) {
  console.log('');
  console.log(`cold start moved ${(coldB - coldA >= 0 ? '+' : '')}${(coldB - coldA).toFixed(1)} points`);
  console.log(`warm case moved  ${(warmB - warmA >= 0 ? '+' : '')}${(warmB - warmA).toFixed(1)} points`);
  console.log(coldB > coldA && warmB >= warmA - 1
    ? 'VERDICT: cold start improved without meaningfully costing the warm case'
    : 'VERDICT: read both columns, the trade is not free');
}
process.exit(0);
