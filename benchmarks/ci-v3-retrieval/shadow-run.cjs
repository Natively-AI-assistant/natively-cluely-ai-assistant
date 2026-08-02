/**
 * Shadow run — diff the legacy decision layers against each other and against V3.
 *
 * WHAT THIS MEASURES
 * Not answer text. DECISIONS. Phase 1 (F2) found nine answer surfaces running
 * five independent source-decision sites, but there was never a way to observe
 * whether those sites AGREE on the same question. This drives the real legacy
 * decision functions directly — no LLM, no provider spend, fully deterministic —
 * and diffs their output.
 *
 * Three comparisons:
 *   A vs B    do the two legacy layers that HAVE a source decision agree?
 *   B vs C    what does the ungrounded surface decide? (nothing — that's F2)
 *   legacy vs V3   would the rebuild have decided the same thing?
 *
 * Usage:
 *   NATIVELY_TEST_USERDATA=<dir> NATIVELY_CI_V3_TRACE=1 ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron benchmarks/ci-v3-retrieval/shadow-run.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { installElectronStub, REPO_ROOT, DIST } = require('./bootstrap.cjs');

installElectronStub();
const d = (rel) => require(path.join(DIST, rel));

const { resolveTurnSourceDecision } = d('electron/llm/turnSourceDecision.js');
const { defaultSourceContractForNewMode } = d('electron/services/modeSourceContract.js');
const { decide } = d('electron/context-intelligence/orchestration/orchestrator.js');
const { MODE_POLICIES } = d('electron/context-intelligence/policies/mode-policy-registry.js');
const { MemoryTraceSink, setTraceSink, recordLegacyTurn } = d('electron/context-intelligence/observability/legacy-trace.js');
const { compareDecisions } = d('electron/context-intelligence/observability/answer-trace.js');

const BANK = path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json');
const questions = JSON.parse(fs.readFileSync(BANK, 'utf8')).questions;

// Everything available — the interesting divergences are about POLICY, not about
// which files happen to be uploaded.
const availability = {
  hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true,
  hasLiveTranscript: true, hasMeetingRag: true,
};

const MODES = ['technical-interview', 'looking-for-work', 'seminar', 'team-meet'];

const sink = new MemoryTraceSink(10000);
setTraceSink(sink);
process.env.NATIVELY_CI_V3_TRACE = '1';

const rows = [];

for (const modeId of MODES) {
  const contract = defaultSourceContractForNewMode(modeId);

  for (const q of questions) {
    const question = q.question;

    // ── Layer B: the manual-chat decision (ipcHandlers builds exactly this) ──
    let legacyB = null;
    try {
      legacyB = resolveTurnSourceDecision({
        sourceContract: contract,
        persistedSourceAuthority: contract.sourceAuthority,
        availability,
      });
    } catch (e) { legacyB = { error: e.message }; }

    const traceB = recordLegacyTurn({
      requestId: `B-${modeId}-${q.id}`, surface: 'manual-chat', scope: { userId: 'local' },
      originalQuestion: question, resolvedQuestion: question, modeId,
      groundingPolicy: legacyB?.sourceAuthority,
      retrievalPath: 'GROUNDED', legacyPath: 'layerB',
    });

    // ── Layer C: runManualAnswer — constructs NO source authority at all ──
    const traceC = recordLegacyTurn({
      requestId: `C-${modeId}-${q.id}`, surface: 'manual-chat', scope: { userId: 'local' },
      originalQuestion: question, resolvedQuestion: question, modeId,
      authorizedSources: [], retrievalPath: 'GROUNDED', legacyPath: 'layerC',
    });

    // ── V3 ──
    let v3 = null;
    try {
      v3 = decide({
        requestId: `V3-${modeId}-${q.id}`, requestSequence: 1, surface: 'manual-chat',
        modeId, scope: { userId: 'local' }, sessionId: 's', manualQuestion: question,
      });
    } catch (e) { v3 = { error: e.message }; }

    rows.push({
      modeId, id: q.id, category: q.category, question,
      expectedPath: q.expectedPath,
      legacyBAuthority: legacyB?.sourceAuthority ?? null,
      legacyBOwner: legacyB?.owner ?? null,
      legacyBRequired: legacyB?.requiredEvidenceKinds ?? [],
      legacyCAuthority: traceC?.groundingPolicy ?? null,
      v3Path: v3?.retrievalPlan?.path ?? null,
      v3Retrieve: v3?.retrievalPlan?.shouldRetrieve ?? null,
      v3Required: v3?.requiredSourceTypes ?? [],
      v3Grounding: v3?.groundingPolicy ?? null,
      bcDivergences: traceB && traceC ? compareDecisions(traceB, traceC).map((x) => x.field) : [],
    });
  }
}

// ── aggregate ───────────────────────────────────────────────────────────────
const n = rows.length;
const bcDiverged = rows.filter((r) => r.bcDivergences.length > 0).length;
const layerCNoPolicy = rows.filter((r) => r.legacyCAuthority === 'legacy_none').length;

// Does the legacy decision vary with the QUESTION at all? This is the key probe:
// a source decision that ignores the question cannot be doing claim-level work.
const byMode = {};
for (const r of rows) {
  byMode[r.modeId] ??= new Set();
  byMode[r.modeId].add(JSON.stringify({ a: r.legacyBAuthority, o: r.legacyBOwner, req: r.legacyBRequired }));
}

const v3PathCounts = {};
for (const r of rows) v3PathCounts[r.v3Path] = (v3PathCounts[r.v3Path] ?? 0) + 1;

// V3 path vs the corpus's labelled expectation (deterministic questions only).
const labelled = rows.filter((r) => r.expectedPath);
const pathAgree = labelled.filter((r) => r.v3Path === r.expectedPath).length;

const out = {
  runAt: new Date().toISOString(),
  questions: questions.length, modes: MODES.length, comparisons: n,
  layerB_vs_layerC: { diverged: bcDiverged, rate: bcDiverged / n },
  layerC_no_policy: { count: layerCNoPolicy, rate: layerCNoPolicy / n },
  legacyB_distinct_decisions_per_mode: Object.fromEntries(
    Object.entries(byMode).map(([m, s]) => [m, s.size]),
  ),
  v3_path_distribution: v3PathCounts,
  v3_path_vs_labelled_expectation: { agreed: pathAgree, of: labelled.length, rate: pathAgree / labelled.length },
  rows,
};

const outDir = path.join(REPO_ROOT, 'benchmarks/ci-v3-retrieval/results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'shadow-latest.json'), JSON.stringify(out, null, 2));

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log('\n=== SHADOW RUN ===');
console.log(`comparisons                        ${n}  (${questions.length} questions x ${MODES.length} modes)`);
console.log(`Layer B vs Layer C diverged        ${bcDiverged}/${n}  ${pct(bcDiverged / n)}`);
console.log(`Layer C had NO policy              ${layerCNoPolicy}/${n}  ${pct(layerCNoPolicy / n)}`);
console.log('\nlegacy Layer B — distinct decisions across all questions, per mode:');
for (const [m, c] of Object.entries(out.legacyB_distinct_decisions_per_mode)) {
  console.log(`  ${m.padEnd(22)} ${c}`);
}
console.log('\nV3 retrieval-path distribution:', JSON.stringify(v3PathCounts));
console.log(`V3 path vs labelled expectation:   ${pathAgree}/${labelled.length}  ${pct(pathAgree / labelled.length)}`);
console.log(`\nwrote ${path.join(outDir, 'shadow-latest.json')}`);
process.exit(0);
