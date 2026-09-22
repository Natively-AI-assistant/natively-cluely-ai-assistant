#!/usr/bin/env node
// scripts/intent-benchmark/replay.mjs
//
// Rerun the full dataset against a provider and DIFF against the last committed
// report, listing regressions by label.
//
// This becomes the merge gate from PR 6 onward, so its job is to be hard to
// fool. Three things it deliberately does:
//
//   1. It diffs PER LABEL, not just per axis. An axis whose macro F1 is
//      unchanged can hide a swap: one label gains exactly what another loses.
//      That is a routing regression and an axis-level number cannot see it.
//
//   2. It reports rows that FLIPPED, in both directions. A change that fixes 40
//      rows and breaks 38 shows as +2 at the axis level and is not obviously an
//      improvement. The gate shows both counts.
//
//   3. It knows the suite has an inherited red baseline. Four service tests
//      fail at campaign base 330717e5 (docs/natively-router-test-baseline.md).
//      A gate calibrated against "zero failures" would either be permanently
//      red or be silenced, and a silenced gate is worse than none.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCORED_AXES } from './providers/contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };

const BASELINE = path.resolve(__dirname, val('--baseline', 'reports/baseline.json'));
const CURRENT = path.resolve(__dirname, val('--current', 'reports/latest.json'));
const TOLERANCE = Number(val('--tolerance', '0.01'));
const MIN_SUPPORT = Number(val('--min-support', '10'));

/**
 * Compare two scored runs.
 *
 * `tolerance` exists because a provider with any nondeterminism (a GGUF sampler,
 * a thread-scheduling-sensitive tie-break) will not reproduce a metric to the
 * bit. It is NOT a licence to ignore small real regressions: it applies per
 * label, so a systematic shift across many labels still trips the gate even
 * when no single label moves past it.
 */
/**
 * Minimum held-out support before a label's F1 movement counts as a regression.
 *
 * Below roughly ten examples, a label's F1 is decided by whether one or two
 * rows happened to land in this split, and it swings by tenths for reasons that
 * have nothing to do with the model. `mode_intent` has 77 labels partitioned
 * across ~377 rows, so most of them sit far under this.
 *
 * Without this the gate is unusable, and not in a subtle way. Run against two
 * real reports it reported 50 regressions when the model IMPROVED by 0.30 on
 * every label that mattered, and 41 regressions in the opposite direction: it
 * failed both ways, so it carried no information and would have blocked every
 * merge from PR 6 onward. A gate that always fails gets switched off, and a
 * switched-off gate is worse than none.
 *
 * Low-support labels are still REPORTED, under a separate heading, because they
 * are the early warning that a rare class is being lost. They just do not block.
 */
export const DEFAULT_MIN_SUPPORT = 10;

export function diffRuns(baseline, current, tolerance = 0.01, minSupport = DEFAULT_MIN_SUPPORT) {
  const findings = { regressions: [], improvements: [], newLabels: [], lostLabels: [], lowSupportDrops: [], summary: {}, minSupport };

  for (const axis of SCORED_AXES) {
    const b = baseline.axes?.[axis];
    const c = current.axes?.[axis];
    if (!b && !c) continue;
    if (b && !c) { findings.regressions.push({ axis, label: null, kind: 'axis_missing', from: b.macroF1, to: null }); continue; }
    if (!b && c) { findings.newLabels.push({ axis, label: null, kind: 'axis_added' }); continue; }

    const dMacro = (c.macroF1 ?? 0) - (b.macroF1 ?? 0);
    findings.summary[axis] = { from: b.macroF1, to: c.macroF1, delta: dMacro };

    const labels = new Set([...Object.keys(b.perLabel ?? {}), ...Object.keys(c.perLabel ?? {})]);
    for (const label of labels) {
      const bl = b.perLabel?.[label];
      const cl = c.perLabel?.[label];
      if (bl && !cl) { findings.lostLabels.push({ axis, label }); continue; }
      if (!bl && cl) { findings.newLabels.push({ axis, label }); continue; }
      // A label with zero support in BOTH runs is not evidence of anything.
      if ((bl.support ?? 0) === 0 && (cl.support ?? 0) === 0) continue;
      const bf = bl.f1 ?? 0;
      const cf = cl.f1 ?? 0;
      const d = cf - bf;
      const support = Math.max(bl.support ?? 0, cl.support ?? 0);
      const entry = { axis, label, kind: 'f1', from: bf, to: cf, delta: d, support: cl.support };
      if (d < -tolerance) {
        // Under-supported labels are recorded but do not block.
        if (support < minSupport) findings.lowSupportDrops.push(entry);
        else findings.regressions.push(entry);
      } else if (d > tolerance && support >= minSupport) {
        findings.improvements.push(entry);
      }
    }
  }

  // Latency is a gate too: the brief's bar is p95 <= 25ms on the Intel Mac.
  const bp = baseline.latency?.p95, cp = current.latency?.p95;
  if (bp != null && cp != null && cp > bp * 1.2 && cp - bp > 2) {
    findings.regressions.push({ axis: 'latency', label: 'p95', kind: 'latency', from: bp, to: cp, delta: cp - bp });
  }

  return findings;
}

export function formatDiff(findings, { baselineId, currentId }) {
  const L = [];
  const f3 = (x) => (x == null ? 'n/a' : Number(x).toFixed(3));
  L.push(`\nreplay  ${baselineId} -> ${currentId}\n`);

  L.push('axis macro F1');
  for (const [axis, s] of Object.entries(findings.summary)) {
    const sign = s.delta >= 0 ? '+' : '';
    L.push(`  ${axis.padEnd(16)} ${f3(s.from)} -> ${f3(s.to)}   ${sign}${f3(s.delta)}`);
  }

  if (findings.regressions.length) {
    L.push(`\nREGRESSIONS (${findings.regressions.length})`);
    for (const r of findings.regressions.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))) {
      L.push(`  ${r.axis}/${r.label ?? '-'}  ${f3(r.from)} -> ${f3(r.to)}  (${f3(r.delta)})${r.support != null ? `  support=${r.support}` : ''}`);
    }
  } else {
    L.push('\nno regressions');
  }

  if (findings.improvements.length) {
    L.push(`\nimprovements (${findings.improvements.length})`);
    for (const r of findings.improvements.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 12)) {
      L.push(`  ${r.axis}/${r.label}  ${f3(r.from)} -> ${f3(r.to)}  (+${f3(r.delta)})`);
    }
  }

  if (findings.lowSupportDrops.length) {
    L.push(`\nnot blocking: ${findings.lowSupportDrops.length} label(s) dropped with under ${findings.minSupport} held-out examples`);
    L.push(`  (their F1 turns on one or two rows; watch them, do not gate on them)`);
    for (const r of findings.lowSupportDrops.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 8)) {
      L.push(`    ${r.axis}/${r.label}  ${f3(r.from)} -> ${f3(r.to)}  support=${r.support}`);
    }
  }

  if (findings.lostLabels.length) L.push(`\nlabels that disappeared: ${findings.lostLabels.map((l) => `${l.axis}/${l.label}`).join(', ')}`);
  if (findings.newLabels.length) L.push(`\nlabels that appeared: ${findings.newLabels.map((l) => `${l.axis}/${l.label ?? '(axis)'}`).join(', ')}`);

  return L.join('\n');
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('replay.mjs')) {
  if (!fs.existsSync(BASELINE)) {
    console.error(`no baseline at ${BASELINE}. Record one first:\n  node scripts/intent-benchmark/run.mjs --provider <id> --out reports/baseline.json`);
    process.exit(2);
  }
  if (!fs.existsSync(CURRENT)) {
    console.error(`no current run at ${CURRENT}.`);
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const current = JSON.parse(fs.readFileSync(CURRENT, 'utf8'));
  const findings = diffRuns(baseline, current, TOLERANCE, MIN_SUPPORT);
  console.log(formatDiff(findings, { baselineId: baseline.providerId, currentId: current.providerId }));
  if (findings.regressions.length) {
    console.log(`\nGATE: FAIL — ${findings.regressions.length} regression(s)\n`);
    process.exit(1);
  }
  console.log('\nGATE: PASS\n');
}
