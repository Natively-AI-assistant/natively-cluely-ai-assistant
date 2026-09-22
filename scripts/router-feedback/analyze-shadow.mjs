#!/usr/bin/env node
// scripts/router-feedback/analyze-shadow.mjs
//
// PR 10. Read the shadow run's telemetry, find where the router and the shipped
// classifier disagreed, and propose dataset rows from the disagreements.
//
// WHY DISAGREEMENTS AND NOT MARKED ROWS.
//
// The brief asks for rows marked on regenerate, edit and dismiss. Those user
// actions do not exist on the answer surface: the only discard signals are
// engine-internal, `superseded` and `no_answer`, which are the engine giving up
// rather than the user rejecting an answer. Treating them as negative signal
// would poison the dataset they feed. So this clusters disagreements instead,
// which needs no UI change and is the higher-value set anyway: a turn where two
// classifiers disagree is a turn whose label is genuinely uncertain, which is
// exactly what a human should spend their labelling time on.
//
// IT PROPOSES. IT NEVER WRITES TO THE CORPUS.
//
// Output is a review file. A job that appended straight to the training set
// would close a loop with no human in it, and the failure mode of that is a
// model that drifts toward its own mistakes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };

const IN = path.resolve(val('--in', path.join(__dirname, 'shadow-events.jsonl')));
const OUT = path.resolve(val('--out', path.join(__dirname, 'review')));
const MIN_CELL = Number(val('--min-cell', '5'));

if (!fs.existsSync(IN)) {
  console.error(`no shadow events at ${IN}`);
  console.error('Collect them first: run with NATIVELY_ROUTER_SHADOW=1 and export the piTelemetry ring.');
  process.exit(2);
}

const events = fs.readFileSync(IN, 'utf8').trim().split('\n')
  .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((e) => e && (e.event === 'router_shadow_turn' || e?.data?.cell))
  .map((e) => e.data ?? e);

const compared = events.filter((e) => e.outcome === 'compared');
const noOpinion = events.filter((e) => e.outcome === 'no_opinion');

// ── the four cells ─────────────────────────────────────────────────────────
const cells = { agree_silent: 0, agree_answer: 0, router_would_silence: 0, router_would_speak: 0 };
for (const e of compared) if (e.cell in cells) cells[e.cell]++;
const n = compared.length;
const pct = (v) => (n ? ((v / n) * 100).toFixed(1) + '%' : 'n/a');

console.log(`\nshadow turns: ${events.length}  (compared ${n}, no opinion ${noOpinion.length})\n`);
console.log('cell                    n      share   meaning');
console.log('-'.repeat(78));
console.log(`agree_answer         ${String(cells.agree_answer).padStart(5)}   ${pct(cells.agree_answer).padStart(6)}   both spoke`);
console.log(`agree_silent         ${String(cells.agree_silent).padStart(5)}   ${pct(cells.agree_silent).padStart(6)}   both stayed quiet: the generations the router SAVES`);
console.log(`router_would_silence ${String(cells.router_would_silence).padStart(5)}   ${pct(cells.router_would_silence).padStart(6)}   the router would have stayed quiet where we spoke`);
console.log(`router_would_speak   ${String(cells.router_would_speak).padStart(5)}   ${pct(cells.router_would_speak).padStart(6)}   the router would have spoken where we stayed quiet`);

console.log('\nread it this way');
console.log('  agree_silent is the saving. Those turns cost a full generation today and');
console.log('  would cost one forward pass instead.');
console.log('  router_would_silence is the RISK, and it is the number that decides whether');
console.log('  the flag can flip. Each one is a turn the user got an answer for today and');
console.log('  would not get. It is not symmetric with router_would_speak, which only adds');
console.log('  an answer where there was none.');

// ── per mode, because a mode-wide regression hides in an aggregate ──────────
const byMode = new Map();
for (const e of compared) {
  const m = e.mode ?? 'unknown';
  if (!byMode.has(m)) byMode.set(m, { n: 0, silence: 0, speak: 0 });
  const b = byMode.get(m);
  b.n++;
  if (e.cell === 'router_would_silence') b.silence++;
  if (e.cell === 'router_would_speak') b.speak++;
}
console.log('\nper mode (a mode-wide regression does not show in the aggregate)');
console.log('mode                    n   would_silence   would_speak');
console.log('-'.repeat(62));
for (const [m, b] of [...byMode].sort((a, b2) => b2[1].n - a[1].n)) {
  const flag = b.n >= MIN_CELL && b.silence / b.n > 0.05 ? '  <- above 5%, look here first' : '';
  console.log(`${m.padEnd(22)} ${String(b.n).padStart(4)}   ${((b.silence / b.n) * 100).toFixed(1).padStart(11)}%   ${((b.speak / b.n) * 100).toFixed(1).padStart(9)}%${flag}`);
}

// ── the shim, for the Answer Shape table's removal ──────────────────────────
const withShim = compared.filter((e) => e.shim_intent);
const agreed = withShim.filter((e) => e.legacy_agrees).length;
const guessed = withShim.filter((e) => e.shim_ambiguous).length;
console.log(`\nlegacy shim: agreed with the shipped label on ${withShim.length ? ((agreed / withShim.length) * 100).toFixed(1) : 'n/a'}% of ${withShim.length} turns`);
console.log(`             had to guess on ${withShim.length ? ((guessed / withShim.length) * 100).toFixed(1) : 'n/a'}%`);
console.log('             a high guess rate is an argument for removing the table, not for tuning the shim');

// ── proposals, for review, never written to the corpus ─────────────────────
fs.mkdirSync(OUT, { recursive: true });
const proposals = compared
  .filter((e) => e.cell === 'router_would_silence' || e.cell === 'router_would_speak')
  .map((e) => ({
    cell: e.cell,
    mode: e.mode,
    surface: e.surface,
    router_needs_response: e.router_needs_response,
    router_dialogue_act: e.router_dialogue_act,
    router_confidence: e.router_confidence,
    live_was_silent: e.live_was_silent,
    // The turn text is NOT here and cannot be: the privacy allowlist never let
    // it into telemetry. A reviewer correlates by mode, cell and confidence and
    // supplies the text from their own session, which is the only place it
    // legitimately lives.
    needs: 'turn text, supplied by the reviewer from their own session',
  }));
const outFile = path.join(OUT, `disagreements-${new Date().toISOString().slice(0, 10)}.jsonl`);
fs.writeFileSync(outFile, proposals.map((p) => JSON.stringify(p)).join('\n') + '\n');
console.log(`\n${proposals.length} disagreements written for review -> ${path.relative(process.cwd(), outFile)}`);
console.log('Nothing was written to the corpus. This file is a proposal for a human to act on.');

// High-confidence disagreements are the ones worth reading first: the router
// was sure and was overruled, or sure and would have overruled.
const confident = proposals.filter((p) => (p.router_confidence ?? 0) >= 0.9);
console.log(`${confident.length} of them are above 0.90 router confidence, which is where the model is wrong in a way it does not know about`);
