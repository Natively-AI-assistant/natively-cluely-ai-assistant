#!/usr/bin/env node
// scripts/intent-benchmark/clean.mjs
//
// Strip rows a corpus should not contain, preserving ids.
//
// Removes, in order:
//   1. rows whose input is a verbatim copy of a generation-prompt example
//   2. within-mode duplicate inputs (keeps the first occurrence)
//   3. schema-invalid rows
//
// IDS ARE NEVER RENUMBERED. The held-out split is a hash of the id, so
// renumbering would move surviving rows across the split boundary. A corpus
// with gaps in its sequence is correct; a resequenced one is quietly wrong.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl, validateRow } from './lib/schema.mjs';
import { isPromptExample } from './lib/prompts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const IN = path.resolve(__dirname, val('--in', 'dataset/v1.jsonl'));
const OUT = path.resolve(__dirname, val('--out', val('--in', 'dataset/v1.jsonl')));

const { rows, bad } = parseJsonl(fs.readFileSync(IN, 'utf8'));
const stats = { in: rows.length, torn: bad.length, parroted: 0, duplicate: 0, invalid: 0, kept: 0 };

const seen = new Set();
const kept = [];
for (const r of rows) {
  if (isPromptExample(r.input)) { stats.parroted++; continue; }
  const key = `${r.mode}::${String(r.input).toLowerCase().replace(/\s+/g, ' ').trim()}`;
  if (seen.has(key)) { stats.duplicate++; continue; }
  if (validateRow(r).length) { stats.invalid++; continue; }
  seen.add(key);
  kept.push(r);
}
stats.kept = kept.length;

fs.writeFileSync(OUT, kept.map((r) => JSON.stringify(r)).join('\n') + '\n');

console.log(`\nclean  ${path.relative(process.cwd(), IN)} -> ${path.relative(process.cwd(), OUT)}`);
console.log(`  in           ${stats.in}${stats.torn ? ` (+${stats.torn} torn lines)` : ''}`);
console.log(`  parroted     ${stats.parroted}   copies of a generation-prompt example`);
console.log(`  duplicate    ${stats.duplicate}   same input twice within one mode`);
console.log(`  invalid      ${stats.invalid}   failed the row contract`);
console.log(`  kept         ${stats.kept}`);
console.log(`  ids preserved; sequence gaps are expected and correct\n`);
