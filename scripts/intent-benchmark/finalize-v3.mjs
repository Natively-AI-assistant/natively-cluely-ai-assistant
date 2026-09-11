#!/usr/bin/env node
// scripts/intent-benchmark/finalize-v3.mjs
//
// Turn the expansion output into the v3 corpus: merge, retag, dedupe, re-split,
// validate.
//
// Order matters here and is not arbitrary.
//
//   Retag before dedupe, because a row mislabelled `hinglish` that is really
//   English must be compared against English rows when looking for duplicates.
//
//   Dedupe before the split, because the split is applied to groups of
//   identical input and a duplicate would otherwise pin a group's assignment
//   before the duplicate was removed.
//
//   Split LAST, and grouped. The v1 corpus had 7.9% of held-out rows sharing an
//   exact input with a training row, because dedup is keyed on (mode, input) —
//   deliberately, so the same backchannel in two modes survives — while the
//   split hashes the row id, and two rows with the same text have different
//   ids. assignGroupedSplits gives every row sharing a normalised input the
//   split of its lexicographically first id.
//
// IDs are never renumbered. A regenerated corpus that renumbered would move
// surviving rows across the split boundary, silently.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl, validateRow, assignGroupedSplits, splitFor, dedupeKey } from './lib/schema.mjs';
import { retagMonolingual } from './lib/codeSwitch.mjs';
import { isPromptExample } from './lib/prompts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const OUT = path.resolve(__dirname, val('--out', 'dataset/v3.jsonl'));
const inputs = (val('--in', 'dataset/v2.jsonl,dataset/v3.expand-en.jsonl,dataset/v3.expand-hard.jsonl,dataset/v3.expand-hi.jsonl,dataset/v3.expand-ml.jsonl'))
  .split(',').map((f) => path.resolve(__dirname, f.trim()));

const all = [];
for (const f of inputs) {
  if (!fs.existsSync(f)) { console.log(`  (skipped, absent) ${path.basename(f)}`); continue; }
  const { rows } = parseJsonl(fs.readFileSync(f, 'utf8'));
  console.log(`  ${String(rows.length).padStart(5)}  ${path.basename(f)}`);
  all.push(...rows);
}
console.log(`\nmerged ${all.length} rows`);

const retagged = retagMonolingual(all);
console.log(`retagged to en (claimed a language but did not switch): ${retagged}`);

const seen = new Set();
const kept = [];
const dropped = { dupeId: 0, dupeInput: 0, parroted: 0, invalid: 0 };
const ids = new Set();
for (const r of all) {
  if (ids.has(r.id)) { dropped.dupeId++; continue; }
  if (isPromptExample(r.input)) { dropped.parroted++; continue; }
  const key = dedupeKey(r);
  if (seen.has(key)) { dropped.dupeInput++; continue; }
  const problems = validateRow(r);
  if (problems.length) { dropped.invalid++; continue; }
  ids.add(r.id); seen.add(key); kept.push(r);
}
console.log(`dropped  ${dropped.dupeId} duplicate ids, ${dropped.dupeInput} duplicate inputs, ${dropped.parroted} prompt-example copies, ${dropped.invalid} schema-invalid`);

const before = kept.filter((r) => r.split === 'holdout').length;
assignGroupedSplits(kept);
const after = kept.filter((r) => r.split === 'holdout').length;

// The leak this re-split exists to close.
const trainInputs = new Set(kept.filter((r) => r.split === 'train')
  .map((r) => String(r.input).toLowerCase().replace(/\s+/g, ' ').trim()));
const leaked = kept.filter((r) => r.split === 'holdout'
  && trainInputs.has(String(r.input).toLowerCase().replace(/\s+/g, ' ').trim()));

fs.writeFileSync(OUT, kept.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\nkept ${kept.length} rows -> ${path.relative(process.cwd(), OUT)}`);
console.log(`holdout ${after} (${((after / kept.length) * 100).toFixed(1)}%), was ${before} before the grouped re-split`);
console.log(`held-out rows sharing an exact input with train: ${leaked.length}  (was 7.9% of holdout in v1)`);
