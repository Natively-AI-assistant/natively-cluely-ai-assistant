#!/usr/bin/env node
// scripts/intent-benchmark/validate.mjs
//
// Check a corpus against the row contract and against the campaign brief's
// composition requirements, and report what it actually contains.
//
// Run this before any benchmark run. A corpus that silently drifted from the
// brief (too few no-response rows, a mode missing, a split that leaked) would
// produce numbers that look fine and mean nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl, validateCorpus, splitFor } from './lib/schema.mjs';
import { analyzeBatch, formatBatchReport } from './lib/sttRealism.mjs';
import { isPromptExample } from './lib/prompts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const IN = path.resolve(__dirname, val('--in', 'dataset/v1.jsonl'));
const STRICT = args.includes('--strict');

/** Brief requirements that are checkable from the corpus alone. */
const REQUIREMENTS = {
  minNoResponseShare: 0.40,   // "at least 40% of all rows must be live events needing no response"
  minRowsPerBuiltinMode: 150,
  minCustomRows: 150,
  builtinModes: ['general', 'technical-interview', 'looking-for-work', 'sales',
    'recruiting', 'team-meet', 'lecture', 'seminar', 'call-center'],
};

const { rows, bad } = parseJsonl(fs.readFileSync(IN, 'utf8'));
console.log(`\ncorpus  ${path.relative(process.cwd(), IN)}`);
console.log(`rows    ${rows.length}${bad.length ? `  (${bad.length} torn lines skipped)` : ''}`);

// ── contract ───────────────────────────────────────────────────────────────
const v = validateCorpus(rows);
if (!v.ok) {
  console.log(`\nSCHEMA PROBLEMS`);
  console.log(`  invalid rows: ${v.errors.length}`);
  for (const e of v.errors.slice(0, 15)) console.log(`    ${e.id}: ${e.problems.join('; ')}`);
  if (v.errors.length > 15) console.log(`    ... and ${v.errors.length - 15} more`);
  if (v.dupes.length) console.log(`  duplicate ids: ${v.dupes.length} (first: ${v.dupes[0]?.id})`);
} else {
  console.log(`schema  all rows valid, no duplicate ids`);
}

// ── split integrity ────────────────────────────────────────────────────────
// The split is recomputed from the id and compared to what is stored. A
// mismatch means someone hand-edited the file, and a hand-edited split is how
// held-out rows leak into training without anyone noticing.
// SPLIT INTEGRITY, against the GROUPED rule rather than the bare id hash.
//
// This check used to require every row's split to equal splitFor(its own id).
// That predates assignGroupedSplits, which deliberately overrides the per-id
// hash: rows sharing a normalised input are one group and the whole group takes
// the split of its lowest id, so that an adversarial pair or a repeated
// backchannel cannot straddle the train/holdout boundary and leak the answer.
//
// So the old check called the corpus broken for being correct. Measured on
// v3.jsonl it reported 132 failures, and all 132 were group members following
// their anchor. The invariant below is the one that actually holds, and it is
// stronger: it still catches a split that was hand-edited or corrupted, because
// such a row would match neither its own hash nor its group's.
const groupsByInput = new Map();
for (const r of rows) {
  const k = String(r.input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!groupsByInput.has(k)) groupsByInput.set(k, []);
  groupsByInput.get(k).push(r);
}
const groupSplit = (r) => {
  const k = String(r.input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const g = groupsByInput.get(k) ?? [r];
  return splitFor(g.map((x) => x.id).sort()[0]);
};
const splitMismatch = rows.filter((r) => r.split && r.split !== groupSplit(r));
const holdout = rows.filter((r) => groupSplit(r) === 'holdout');
console.log(`split   holdout ${holdout.length}/${rows.length} = ${((holdout.length / (rows.length || 1)) * 100).toFixed(1)}%` +
  (splitMismatch.length ? `   ${splitMismatch.length} STORED SPLITS DISAGREE WITH THE ID HASH` : ''));

// ── split leakage ──────────────────────────────────────────────────────────
// A held-out row whose exact input also appears in train is memorisable, and
// its contribution to a score does not generalise. Reported rather than fixed
// in place, because re-splitting invalidates every measurement already taken.
const trainInputs = new Set(
  rows.filter((r) => r.split === 'train').map((r) => String(r.input).toLowerCase().replace(/\s+/g, ' ').trim()),
);
const holdoutRows = rows.filter((r) => r.split === 'holdout');
const leaked = holdoutRows.filter((r) => trainInputs.has(String(r.input).toLowerCase().replace(/\s+/g, ' ').trim()));
console.log(`leak    ${leaked.length}/${holdoutRows.length} held-out rows share an exact input with train` +
  (holdoutRows.length ? ` = ${((leaked.length / holdoutRows.length) * 100).toFixed(1)}%` : ''));

// ── composition ────────────────────────────────────────────────────────────
const count = (fn) => rows.filter(fn).length;
const byMode = {};
for (const r of rows) {
  const k = r.custom_mode_key ? 'custom' : r.mode;
  byMode[k] = (byMode[k] ?? 0) + 1;
}

const noResponse = count((r) => r.labels?.needs_response === 'no');
const noResponseShare = rows.length ? noResponse / rows.length : 0;

console.log(`\ncomposition`);
console.log(`  needs_response=no   ${noResponse}  ${(noResponseShare * 100).toFixed(1)}%  (brief floor ${REQUIREMENTS.minNoResponseShare * 100}%)`);
for (const axis of ['needs_response', 'dialogue_act', 'voice', 'grounding']) {
  const t = {};
  for (const r of rows) { const v2 = r.labels?.[axis]; t[v2] = (t[v2] ?? 0) + 1; }
  console.log(`  ${axis.padEnd(16)} ${Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  ')}`);
}

console.log(`\nper mode`);
for (const m of [...REQUIREMENTS.builtinModes, 'custom']) {
  const n = byMode[m] ?? 0;
  const floor = m === 'custom' ? REQUIREMENTS.minCustomRows : REQUIREMENTS.minRowsPerBuiltinMode;
  console.log(`  ${m.padEnd(22)} ${String(n).padStart(4)}  ${n >= floor ? 'ok' : `SHORT by ${floor - n}`}`);
}

// ── grounding legality ─────────────────────────────────────────────────────
// mode_files may only be emitted when files are attached. Enforced in
// validateRow, re-reported here because it is the one cross-field rule the
// benchmark exists to measure candidates against.
const illegalGrounding = count((r) => r.labels?.grounding === 'mode_files' && r.mode_has_reference_files !== true);
console.log(`\ngrounding=mode_files with no files attached: ${illegalGrounding} (must be 0)`);

// ── realism ────────────────────────────────────────────────────────────────
console.log(`\nSTT realism, whole corpus`);
// Duplicates are measured WITHIN MODE, matching the generator's dedup key.
// Across modes, repetition is deliberate and useful: "mhm" occurring in
// team-meet and in lecture is the same string with the same correct
// needs_response label, and a mode-aware router should get both right. Those
// rows are signal. Two copies of the same string inside ONE mode are not.
const withinModeDupes = (() => {
  const byMode = new Map();
  for (const r of rows) {
    const k = r.custom_mode_key ?? r.mode;
    if (!byMode.has(k)) byMode.set(k, new Map());
    const m = byMode.get(k);
    const t = String(r.input).toLowerCase().replace(/\s+/g, ' ').trim();
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  let d = 0;
  for (const m of byMode.values()) for (const c of m.values()) if (c > 1) d += c - 1;
  return d;
})();
const realism = analyzeBatch(rows.map((r) => r.input), { maxDuplicateRate: 1 });
realism.withinModeDuplicateRate = rows.length ? withinModeDupes / rows.length : 0;
console.log(formatBatchReport(realism));
console.log(`  within-mode duplicates ${(realism.withinModeDuplicateRate * 100).toFixed(1)}%  (cross-mode repeats are intentional)`);

// Leakage: rows that copied an example straight out of the generation prompt.
// They measure the instruction rather than the language, and become outright
// contamination if any of those strings later appears in a prompted candidate.
const parroted = rows.filter((r) => isPromptExample(r.input));
console.log(`  prompt-example copies  ${parroted.length} (${((parroted.length / (rows.length || 1)) * 100).toFixed(1)}%)`);

// ── verdict ────────────────────────────────────────────────────────────────
const failures = [];
if (!v.ok) failures.push(`${v.errors.length} schema-invalid rows, ${v.dupes.length} duplicate ids`);
if (splitMismatch.length) failures.push(`${splitMismatch.length} stored splits disagree with their GROUP's split (grouped by normalised input)`);
if (noResponseShare < REQUIREMENTS.minNoResponseShare) failures.push(`needs_response=no is ${(noResponseShare * 100).toFixed(1)}%, below the ${REQUIREMENTS.minNoResponseShare * 100}% floor`);
if (illegalGrounding > 0) failures.push(`${illegalGrounding} rows emit mode_files with no files attached`);
if (realism.problems.length) failures.push(`realism: ${realism.problems.join('; ')}`);
if (realism.withinModeDuplicateRate > 0.02) failures.push(`${(realism.withinModeDuplicateRate * 100).toFixed(1)}% within-mode duplicate inputs`);
if (parroted.length / (rows.length || 1) > 0.005) failures.push(`${parroted.length} rows copy a generation-prompt example verbatim`);

const shortModes = [...REQUIREMENTS.builtinModes, 'custom']
  .filter((m) => (byMode[m] ?? 0) < (m === 'custom' ? REQUIREMENTS.minCustomRows : REQUIREMENTS.minRowsPerBuiltinMode));
if (shortModes.length) failures.push(`below the per-mode floor: ${shortModes.join(', ')}`);

console.log('');
if (failures.length === 0) {
  console.log('VERDICT  corpus meets the brief\n');
} else {
  console.log('VERDICT  corpus does NOT yet meet the brief:');
  for (const f of failures) console.log(`  - ${f}`);
  console.log('');
  if (STRICT) process.exit(1);
}
