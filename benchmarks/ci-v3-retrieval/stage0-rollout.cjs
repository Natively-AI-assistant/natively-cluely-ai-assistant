// Phase 10 Stage 0 — the developer-harness rollout gate, with the flag ON.
//
// §3's Stage 0 exit criterion is "AnswerTrace parity green on the harness", and
// the flag had never been on for anything. This drives the real decision layer
// over the labelled corpus through the PRODUCTION retrieval port and reads the
// §4 signals and §5 abort conditions out of the live counters.
//
// READ THE TWO STRUCTURAL ZEROS BEFORE TRUSTING THEM. This uses
// createModeRetrievalPort — the shape the wired surfaces actually use — whose
// registry is degenerate by design: every file is REFERENCE_FILE at one
// synthetic version under one user scope. So staleVersionRejected and
// outOfScopeRejected are 0% because nothing CAN be rejected here, not because
// the filter is proven. golden-live exercises those (7 and 14 turns) with a real
// versioned/scoped registry. Likewise groundedWithNoEvidence is high because the
// production port covers reference files only, so RESUME/JD/MEETING questions
// correctly find nothing rather than fabricating.
// Drives the real decision layer over the labelled corpus and reads the §4
// signals + §5 abort conditions out of the live counters.
'use strict';
const path = require('path');
const fs = require('fs');
const R = path.resolve(__dirname, '..', '..');
const { boot, DIST } = require(path.join(R, 'benchmarks/ci-v3-retrieval/bootstrap.cjs'));
const { ingestCorpus } = require(path.join(R, 'benchmarks/ci-v3-retrieval/ingest.cjs'));
const C = require(path.join(R, 'benchmarks/ci-v3-retrieval/corpus.cjs'));
process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = '1';
process.env.NATIVELY_CI_V3_TRACE = '1';
process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL = process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL ?? '0';
const d = (rel) => require(path.join(DIST, rel));
(async () => {
  const b = await boot({ verbose: false });
  const { orchestrate } = d('electron/context-intelligence/orchestration/orchestrator.js');
  const { createModeRetrievalPort } = d('electron/context-intelligence/retrieval/mode-retrieval-port.js');
  const { resolveModePolicy, isModeId } = d('electron/context-intelligence/policies/mode-policy-registry.js');
  const { isContextIntelligenceV3Enabled } = d('electron/context-intelligence/contracts/flag.js');
  const { getRolloutMetrics, evaluateAbortConditions, resetRolloutMetrics } =
    d('electron/context-intelligence/observability/rollout-metrics.js');
  const { ModesManager } = d('electron/services/ModesManager.js');
  const mm = ModesManager.getInstance();

  if (!isContextIntelligenceV3Enabled()) throw new Error('Stage 0 requires the flag ON — it is not');
  console.log('[stage0] flag ON, confirmed via the production resolver');
  resetRolloutMetrics();

  const groups = {};
  for (const g of ['base', 'versioned']) {
    const { mode, ingested } = await ingestCorpus(b, C.docsForGroup(g), { modeName: `Stage0 ${g}`, verbose: false });
    const indexed = ingested.filter((i) => i.file);
    const files = mm.getReferenceFiles(mode.id);
    const policy = resolveModePolicy('seminar');
    groups[g] = { registry: C.buildRegistry(indexed), files, mode, policy };
  }
  const bank = JSON.parse(fs.readFileSync(path.join(R, 'test-fixtures/ci-v3-corpus/questions.json'), 'utf8')).questions;

  for (const q of bank) {
    const g = groups[C.groupForQuestion(q.id)];
    const raw = C.MODE_FOR_SOURCE[(q.requiredSources || [])[0]] || 'general';
    const modeId = isModeId(raw) ? raw : 'general';
    const policy = resolveModePolicy(modeId);
    const port = createModeRetrievalPort({
      modesManager: mm, modeInfo: g.mode, files: g.files,
      tokenBudget: policy.contextBudget.evidenceTokens, userId: 'local',
    });
    await orchestrate({
      requestId: `stage0-${q.id}`, requestSequence: 1, surface: 'manual-chat',
      modeId, scope: C.scopeForQuestion(q), sessionId: 's', manualQuestion: q.question,
    }, port);
  }

  const m = getRolloutMetrics();
  const abort = evaluateAbortConditions({ minTurns: 40, baselineP95Ms: null });
  console.log('\n=== STAGE 0 — §4 SIGNALS, FLAG ON ===');
  console.log(`turns                        ${m.counters.turns}  (v3 ${m.counters.engine.v3} / legacy ${m.counters.engine.legacy})`);
  console.log(`path split                   ${JSON.stringify(m.counters.path)}`);
  console.log(`answerability                ${JSON.stringify(m.counters.answerability)}`);
  console.log(`fallback                     ${JSON.stringify(m.counters.fallback)}`);
  const pc = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  for (const k of ['contamination','staleVersionRejected','outOfScopeRejected','groundedWithNoEvidence','retrievalDependencyFailure','strictRefusal','generalFallback','fastPath','superseded']) {
    console.log(`${k.padEnd(28)} ${pc(m.rates[k])}`);
  }
  console.log(`\n=== §5 ABORT CONDITIONS ===`);
  console.log(`insufficientData             ${abort.insufficientData}`);
  console.log(`triggered                    ${abort.triggered.length ? abort.triggered.join(', ') : 'NONE'}`);
  const blob = JSON.stringify(m);
  console.log(`\ntelemetry leak check         ${/PriceX|Kubernetes|Postgres|Meera|Helio/.test(blob) ? '*** CONTENT FOUND ***' : 'clean (no corpus content in counters)'}`);
  fs.writeFileSync(path.join(R, 'benchmarks/ci-v3-retrieval/results/stage0-rollout-metrics.json'), JSON.stringify({ metrics: m, abort }, null, 2));
  process.exit(abort.triggered.length ? 1 : 0);
})().catch((e) => { console.error('STAGE 0 FAILED:', e.stack || e.message); process.exit(1); });
