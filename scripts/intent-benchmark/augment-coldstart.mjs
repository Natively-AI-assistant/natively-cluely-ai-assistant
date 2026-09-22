#!/usr/bin/env node
// scripts/intent-benchmark/augment-coldstart.mjs
//
// Teach the router that history can be empty.
//
// Every row in the corpus carries history, so the model never saw an empty
// history field and its behaviour there was never measured. Production hands it
// exactly that at the start of every session. Measured on the retrained MiniLM
// head, needs_response macro F1 falls from 78.5 to 68.3 when history is
// stripped from the held out split.
//
// THE LABEL DOES NOT CHANGE. Whether the assistant should speak is a fact about
// the turn and the situation, not about how much transcript the router was
// handed. Removing an input feature removes information the model can use; it
// does not change the right answer. So an augmented row carries its source's
// labels unaltered, and what the model learns is to lean on the cues that
// remain: the mode, the channel, and the words themselves.
//
// Two shapes, because a session ramps rather than jumping straight to full
// context. `cs0` has no history at all, which is turn one. `cs1` keeps a single
// prior turn, which is turn two.
//
// `source` stays exactly as it was, because it is a four value enum and this is
// not a new provenance. The `-cs0` and `-cs1` id suffix and an explicit
// `augmented` field carry the marking instead.
//
// The augmented row keeps its source's split. It shares the source's input, so
// assignGroupedSplits would group them anyway, and the source id sorts first so
// the group anchor and therefore the split is unchanged. Separating them would
// put the same input on both sides of the boundary, which is the leak the
// grouped split exists to prevent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl } from './lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };

const IN = path.resolve(__dirname, val('--in', 'dataset/v3.jsonl'));
const OUT = path.resolve(__dirname, val('--out', val('--in', 'dataset/v3.jsonl')));
const FRAC_EMPTY = Number(val('--frac-empty', '0.25'));
const FRAC_ONE = Number(val('--frac-one', '0.10'));
const SEED = Number(val('--seed', '17'));

// Deterministic sampling, so a rerun produces the same corpus.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

const { rows } = parseJsonl(fs.readFileSync(IN, 'utf8'));
const already = rows.filter((r) => /-cs[01]$/.test(String(r.id))).length;
if (already > 0) {
  console.error(`refusing: ${already} augmented rows already present in ${path.basename(IN)}. Augmenting twice would double-count them.`);
  process.exit(2);
}

const out = [...rows];
let made0 = 0, made1 = 0, skipped = 0;
for (const r of rows) {
  const h = r.history ?? [];
  if (h.length === 0) { skipped++; continue; }
  const u = hash(`${SEED}:${r.id}`);
  if (u < FRAC_EMPTY) {
    out.push({ ...r, id: `${r.id}-cs0`, history: [], augmented: 'coldstart' });
    made0++;
  } else if (u < FRAC_EMPTY + FRAC_ONE && h.length > 1) {
    out.push({ ...r, id: `${r.id}-cs1`, history: h.slice(-1), augmented: 'coldstart' });
    made1++;
  }
}

fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');

const bySplit = (s) => out.filter((r) => r.split === s).length;
console.log(`read     ${rows.length} rows from ${path.basename(IN)}`);
console.log(`added    ${made0} with NO history (turn one), ${made1} with ONE prior turn (turn two)`);
if (skipped) console.log(`skipped  ${skipped} rows that already had no history`);
console.log(`wrote    ${out.length} rows -> ${path.relative(process.cwd(), OUT)}`);
console.log(`split    train ${bySplit('train')}, holdout ${bySplit('holdout')}`);
const emptyNow = out.filter((r) => !(r.history ?? []).length).length;
console.log(`corpus now has ${emptyNow} rows with empty history (${((emptyNow / out.length) * 100).toFixed(1)}%), was 0`);
