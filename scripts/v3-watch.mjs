// scripts/v3-watch.mjs
//
// Live one-line-per-turn view of the Context Intelligence V3 decision, for
// MANUAL testing. The referent fixes (2026-08-09) are only observable in the
// `resolvedQuestion` field, and reading raw [V3] JSON while clicking through
// the app is impractical.
//
//   npm start 2>&1 | node scripts/v3-watch.mjs
//   npm start 2>&1 | node scripts/v3-watch.mjs --raw     # also dump full JSON
//
// Tolerates concurrently's "[1] " prefix. Everything that is not a [V3] line is
// dropped, so this is a focused view, not a log replacement — keep the original
// terminal if you need the rest.
//
// FLAGS shown per turn:
//   REWRITTEN  the resolver changed the question. Expected ONLY for genuine
//              follow-ups. On a question that names its own subject this is the
//              contamination class fixed on 2026-08-09 — read the arrow.
//   DENY-RISK  fallback label that used to withhold the answer. Not a failure
//              by itself: under "Use references when relevant" the turn should
//              still be answered. Compare against the answer in the app.

import readline from 'node:readline';

const RAW = process.argv.includes('--raw');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', yel: '\x1b[33m', grn: '\x1b[32m', cyn: '\x1b[36m', b: '\x1b[1m', r: '\x1b[0m' }
  : { dim: '', red: '', yel: '', grn: '', cyn: '', b: '', r: '' };

let n = 0;
rl.on('line', (line) => {
  const i = line.indexOf('[V3] ');
  if (i < 0) return;
  let j;
  try { j = JSON.parse(line.slice(i + 5)); } catch { return; }

  const orig = j.originalQuestion ?? '';
  const resolved = j.resolvedQuestion ?? '';
  const rewritten = resolved && orig && resolved !== orig;
  const denyRisk = ['STRICT_NOT_FOUND', 'DOCUMENT_FACT_NOT_FOUND'].includes(j.fallback);

  n += 1;
  console.log(`\n${C.b}#${n}${C.r} ${C.dim}${j.mode}${j.modeName && j.modeName !== j.mode ? ` (${j.modeName})` : ''}`
    + ` · files=${j.modeAttachedFiles ?? 0} · profile=${j.profileSources ?? 0} · ${j.surface}${C.r}`);
  console.log(`  Q  ${orig}`);
  if (rewritten) console.log(`  ${C.yel}→  ${resolved}${C.r}   ${C.yel}${C.b}[REWRITTEN]${C.r}`);
  console.log(`  ${C.cyn}intent${C.r} ${(j.intent ?? []).join(',') || '-'}`
    + `   ${C.cyn}policy${C.r} ${j.knowledgePolicy}`
    + `   ${C.cyn}planned${C.r} ${(j.planned ?? []).join(',') || '-'}`
    + `   ${C.cyn}evidence${C.r} ${j.evidence ?? 0}`);
  console.log(`  ${C.cyn}fallback${C.r} ${denyRisk ? C.yel : C.grn}${j.fallback}${C.r}`
    + `${denyRisk ? `  ${C.dim}(must still be ANSWERED under option 1)${C.r}` : ''}`);
  if (RAW) console.log(`  ${C.dim}${JSON.stringify(j)}${C.r}`);
});

rl.on('close', () => console.log(`\n${C.dim}— ${n} V3 turn(s) observed —${C.r}`));
