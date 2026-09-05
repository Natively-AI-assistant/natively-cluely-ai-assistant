#!/usr/bin/env node
// scripts/intent-benchmark/summarize.mjs
//
// One table across every report in reports/, ranked by the axis the campaign
// actually turns on.
//
// needs_response is the ranking key on purpose. It is the axis with the
// clearest product consequence (6.1% of live generations are provably wasted
// confirming there was nothing to say), it has only three classes so it is well
// powered at this corpus size, and unlike mode_intent it is not partitioned by
// mode into single-digit support.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, 'reports');

const reports = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.includes('baseline'))
  .map((f) => ({ f, d: JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) }))
  .filter((r) => r.d.axes);

// A table that silently mixes corpora is worse than no table. reports/ persists
// across runs, so this names every dataset present and says plainly when there
// is more than one rather than ranking across them as if they were comparable.
{
  const datasets = [...new Set(reports.map((r) => r.d.meta?.dataset ?? 'UNSTAMPED (pre-dating the dataset stamp)'))];
  if (datasets.length > 1) {
    console.log('\nWARNING: these reports were scored on DIFFERENT corpora, so the ranking below is not a like-for-like comparison:');
    for (const d of datasets) {
      const which = reports.filter((r) => (r.d.meta?.dataset ?? 'UNSTAMPED (pre-dating the dataset stamp)') === d).map((r) => r.f.replace('.json', ''));
      console.log(`  ${d}: ${which.join(', ')}`);
    }
    console.log('');
  } else {
    console.log(`\nall reports scored on ${datasets[0]}`);
  }
}

const num = (v, d = 1) => (v == null ? '   -' : (v * 100).toFixed(d).padStart(5));
const ms = (v) => (v == null ? '    -' : `${v.toFixed(1)}`.padStart(6));

reports.sort((a, b) => (b.d.axes.needs_response?.macroF1 ?? -1) - (a.d.axes.needs_response?.macroF1 ?? -1));

console.log('\nRanked by needs_response macro F1 (bar: 85.0)   n = held-out rows\n');
console.log('provider                      n   needs_resp  dialogue  task   answer  ground  mode_int   p95ms  passes/row');
console.log('─'.repeat(112));
for (const { d } of reports) {
  const a = d.axes;
  const passes = d.meta?.forwardPassesPerRow ?? (d.meta?.forwardPassesTotal && d.n ? Math.round(d.meta.forwardPassesTotal / d.n) : null);
  console.log(
    `${d.providerId.padEnd(26)} ${String(d.n).padStart(4)}  ` +
    `${num(a.needs_response?.macroF1)}      ${num(a.dialogue_act?.macroF1)}   ${num(a.task?.macroF1)}  ` +
    `${num(a.answer_form?.macroF1)}   ${num(a.grounding?.macroF1)}   ${num(a.mode_intent?.macroF1)}   ` +
    `${ms(d.latency?.p95)}  ${String(passes ?? '-').padStart(6)}` +
    (attempts(d) ? '' : '   [legacy-only: does not attempt the frame axes]') +
    (d.meta?.latencyTrustworthy === false ? '   [latency measured on a BUSY machine]' : ''),
  );
}

/** Did this provider even try the frame axes, or is it a legacy-taxonomy run? */
function attempts(d) {
  const a = d.axes?.needs_response;
  return a ? a.coverage?.fired > 0 : false;
}
console.log('\nnotes');
console.log('  All figures are macro F1 percent on the English held-out split, which no');
console.log('  candidate trained on or built prototypes from.');
console.log('  A 0.0 on a row marked [legacy-only] means the provider did not ATTEMPT');
console.log('  that axis, not that it attempted and failed. Those runs reproduce');
console.log('  production exactly: eight hypotheses, one softmax, nothing else. The');
console.log('  distinction matters because abstention and error are different failures.');
console.log('  mode_intent is UNDERPOWERED at this corpus size: 78 labels partitioned by');
console.log('  mode over ~377 rows leaves single-digit support per label. Rank on it at');
console.log('  your peril; it is reported because the brief asks for it.');
console.log('  p95 is measured inside the worker on Apple Silicon. The bar is 25ms on the');
console.log('  INTEL Mac, which is a separate and slower hardware cell not yet run.\n');
