// electron/services/__tests__/WhatToAnswerSnapshotWiring.test.mjs
//
// Structural regression guards for audit findings #6 + #3 + #9 in the live
// what-to-answer path. The wiring lives inside IntelligenceEngine.runWhatShouldISay
// / WhatToAnswerLLM.generateStream / main.ts — classes that can't be cheaply
// instantiated in a unit test — so we assert the load-bearing shape so a refactor
// can't silently revert it. Behavioral coverage of the pure pieces lives in:
//   - electron/llm/__tests__/WhatToAnswerRequestSnapshot.test.mjs  (snapshot + batch reducer)
//   - electron/services/__tests__/ChatStreamGuard.test.mjs         (renderer reducer)
//   - electron/services/__tests__/ModePinnedResolution.test.mjs    (mode pin)
//   - electron/services/__tests__/IntelligenceTraceCorrelation.test.mjs (#9 setCorrelation)
//
// Pure source-assertion — runs under plain `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('#6 — runWhatShouldISay captures ONE mode snapshot at t0 and threads it', () => {
  const src = read('../../IntelligenceEngine.ts');
  // Isolate the method body so assertions can't accidentally match another method.
  const start = src.indexOf('async runWhatShouldISay(');
  const end = src.indexOf('async runFollowUp', start) >= 0
    ? src.indexOf('async runFollowUp', start)
    : src.indexOf('private getActiveModeId', start);
  assert.ok(start >= 0 && end > start, 'runWhatShouldISay must be isolatable');
  const body = src.slice(start, end);

  test('the mode is captured exactly ONCE into snapshot locals near t0', () => {
    assert.match(body, /const snapshotModeInfo = this\.getActiveModeInfo\(\)/, 'must snapshot mode info at t0');
    assert.match(body, /const snapshotModeId = this\.getActiveModeId\(\)/, 'must snapshot mode template id at t0');
  });

  test('the per-request planAnswer calls read the SNAPSHOT, not a fresh live query', () => {
    // The two planAnswer calls inside runWhatShouldISay (follow-up memory mode +
    // main answer plan) must use snapshotModeInfo. A fresh this.getActiveModeInfo()
    // inside a planAnswer({...}) call here would re-introduce the race.
    assert.match(body, /activeMode: snapshotModeInfo/, 'planAnswer must read the snapshot mode');
    // There must be NO remaining inline getActiveModeInfo() feeding a planAnswer in
    // this method (the snapshot replaced both).
    assert.doesNotMatch(body, /activeMode: this\.getActiveModeInfo\(\)/,
      'no planAnswer in runWhatShouldISay may re-read the live mode');
  });

  test('session-memory routing reads the snapshot template id, not a fresh live read', () => {
    assert.match(body, /const modeId = snapshotModeId/, 'session-memory modeId must come from the snapshot');
    assert.doesNotMatch(body, /const modeId = this\.getActiveModeId\(\)/,
      'session-memory routing must not re-read the live mode mid-request');
  });

  test('an immutable request snapshot is built and passed into generateStream', () => {
    assert.match(body, /const requestSnapshot: WhatToAnswerRequestSnapshot = Object\.freeze\(/,
      'a frozen request snapshot must be assembled');
    assert.match(body, /generateStream\([^;]*,\s*modeContextPromise,\s*requestSnapshot,\s*whatToAnswerCancellationToken\.signal\)/,
      'the snapshot and request cancellation signal must be threaded into WhatToAnswerLLM.generateStream');
  });

  test('a newer WTA request aborts the previous provider request at t0', () => {
    assert.match(body, /this\.whatToAnswerCancellationToken\.abort\('superseded'\)/,
      'a new WTA request must abort the prior request before beginning its own work');
    assert.match(body, /const whatToAnswerCancellationToken = new AbortController\(\)/,
      'each WTA request must own a new AbortController');
    assert.match(body, /const generationId = \+\+this\.currentGenerationId/,
      'generation id must be minted before the first await to preserve newest-wins ordering');
    assert.match(body, /const isWtaSuperseded = \(\) => \(/,
      'late-path checks must retain a request ownership guard independent of local cleanup');
  });

  test('only the owning WTA request clears the shared cancellation slot', () => {
    assert.match(body, /if \(this\.whatToAnswerCancellationToken === whatToAnswerCancellationToken\) \{\s*this\.whatToAnswerCancellationToken = null;/s,
      'an older request must not clear a newer request\'s cancellation controller');
  });

  test('the parallel mode-context prefetch is pinned to the t0 mode id', () => {
    assert.match(body, /buildRetrievedActiveModeContextBlockHybrid\(\s*preparedTranscript, preparedTranscript, 1800, undefined, true, snapshotModeInfo\?\.id,/,
      'the prefetched retrieval must pin the snapshot mode id');
  });

  test('the canonical-turn observe seam uses only t0 source availability', () => {
    assert.match(body, /const snapshotSourceAvailability = Object\.freeze\(/,
      'source availability must be frozen with the t0 request snapshot');
    assert.match(body, /const canonicalTurn = resolveCanonicalTurn\(/,
      'WTA must resolve one canonical turn before dispatch');
    assert.match(body, /sourceContract: snapshotSourceContract/,
      'canonical turn must read the t0 persisted source contract');
    assert.match(body, /availability: snapshotSourceAvailability/,
      'canonical turn must read frozen t0 availability rather than re-querying live stores');
    assert.match(body, /const answerPlan = canonicalTurn\.answerPlan/,
      'the main WTA provider path must consume the canonical answer plan');
  });

  // ── Candidate-profile gate contract (survives any future authority dedup) ──
  // These pin the two invariants a legacy-block removal MUST preserve, so the
  // duplicate-authority cleanup can't silently re-open profile evidence on a
  // JD-only / reference-files-only / transcript-only turn.
  test('the candidate-profile orchestrator fetch is gated on the canonical never-retrieve decision', () => {
    assert.match(body, /isKnowledgeMode\?\.\(\) && !documentGroundedCustomModeActive\s*\n?\s*&& wtaDecisionAllowsCandidateProfile/s,
      'the résumé orchestrator fetch must AND the canonical candidate-profile gate');
  });

  test('the JIT profile-evidence fetch is gated on both the never-retrieve decision and the profile-allowed contract', () => {
    assert.match(body, /if \(!candidateProfile && wtaDecisionAllowsCandidateProfile\s*\n?\s*&& \(wtaProfileAllowed \|\| _jdShapeAllowed\)\)/s,
      'the JIT profile-evidence fetch must AND the canonical + contract gates');
  });

  test('wtaDecisionAllowsCandidateProfile is derived from the canonical turnSourceDecision', () => {
    assert.match(body, /wtaDecisionAllowsCandidateProfile =\s*\n?\s*_?\w*_wtaTurnSourceDecision\.outcome === 'default'\s*\n?\s*\|\| _?\w*_wtaTurnSourceDecision\.outcome === 'explicit_granted'/s,
      'the gate must be derived from the canonical decision outcome');
    assert.match(body, /allowedEvidenceKinds\.includes\('profile_resume'\)/,
      'the gate must consult the canonical allowed evidence kinds');
  });

  test('multi-family WTA evidence reuses the canonical decision and t0 profile/JD snapshots', () => {
    assert.match(body, /const WTA_COORDINATOR_KINDS = new Set\(\['reference_files', 'profile_resume', 'projects', 'profile_jd'\]\)/,
      'WTA coordinator must keep transcript and meeting-RAG families out of this first slice');
    assert.match(body, /decision: canonicalTurn\.turnSourceDecision/,
      'coordinator must consume the canonical source decision');
    assert.match(body, /profile: snapshotProfileFacts/,
      'profile evidence must use the t0 profile snapshot');
    assert.match(body, /jobDescription: snapshotJobDescriptionFacts/,
      'JD evidence must use the t0 JD snapshot');
    assert.match(body, /evidencePack: coordinatorResult\.pack/,
      'the resolved packet must be passed intact to provider generation');
    assert.match(body, /candidateProfile = ''/,
      'governed packet must suppress competing raw profile injection');
  });

  test('mixed reference/profile turns retrieve typed reference evidence from the t0 mode snapshot', () => {
    assert.match(body, /const retrieveReferenceEvidence = canonicalTurn\.requiredEvidenceKinds\.includes\('reference_files'\)/,
      'a required reference family must supply a typed resolver');
    assert.match(body, /const snapshotMode = snapshotModesManager && snapshotModeInfo\?\.id\s*\? snapshotModesManager\.getModeSnapshot\(snapshotModeInfo\.id\)/s,
      'the full mode must be captured from the t0 mode id');
    assert.match(body, /getModeSnapshot: \(\) => \(\{ \.\.\.snapshotMode \}\)/,
      'EvidenceResolver must not re-read the live active mode');
    assert.match(body, /getReferenceFiles: \(modeId: string\) => \(\s*modeId === snapshotMode\.id \? snapshotReferenceFiles\.map\(\(file\) => \(\{ \.\.\.file \}\)\) : \[\]/s,
      'reference files must remain scoped to the captured mode');
    assert.match(body, /retrieveReferenceEvidence,\s*retrieveProfileEvidence:/s,
      'TurnEvidenceCoordinator must merge the independent typed family packets');
    assert.match(body, /if \(!snapshotMode \|\| snapshotReferenceFiles\.length === 0\)/,
      'a missing/deleted pinned mode must fail closed rather than borrow the new active mode');
    assert.match(body, /modesManager\.retrieveHybridRaw\(mode, files, options\)/,
      'the typed resolver must reuse the shared indexed hybrid retriever');
  });

  test('a pre-resolved multi-family packet is reused by WhatToAnswerLLM without re-retrieval', () => {
    const llmSrc = read('../../llm/WhatToAnswerLLM.ts');
    assert.match(llmSrc, /let governedEvidencePack: import\('\.\.\/intelligence\/context-os'\)\.EvidencePack \| null =\s*initialContextOsGeneration\?\.evidencePack \?\? null/s,
      'WTA generation must begin with the coordinator-owned EvidencePack');
    assert.match(llmSrc, /if \(!activeSkill && !governedEvidencePack\) \{/,
      'a resolved packet must skip the legacy document retrieval branch');
    assert.match(llmSrc, /const pack = governedEvidencePack \?\? _cog\.evidencePack/,
      'the rendered factual block must use that same packet identity');
  });

  test('the final wtaTurnContract carries the canonical decision and switch allowlist', () => {
    assert.match(body, /turnSourceDecision: _wtaTurnSourceDecision/,
      'wtaTurnContract must receive the persisted canonical decision');
    assert.match(body, /allowedExplicitSwitches: snapshotSourceContract\?\.allowedExplicitSwitches \?\? null/,
      'wtaTurnContract must also carry the persisted switch allowlist');
  });

  test('the multi-family coordinator result carries turnSourceDecision onto wtaContextOsGeneration', () => {
    assert.match(body, /turnSourceDecision: canonicalTurn\.turnSourceDecision,\s*\n\s*govern: true/s,
      'the coordinator-built context must surface the decision for validateFinalPromptEvidence');
  });

  test('a mid-resolution WTA supersession drops the coordinator packet and bails out', () => {
    assert.match(body, /if \(isWtaSuperseded\(\)\)/,
      'an in-flight coordinator must discard its result on supersession');
    assert.match(body, /wtaContextOsGeneration = undefined/,
      'the discarded coordinator result must clear the provider context');
    assert.match(body, /recordWtaCancellation\(\)/,
      'a superseded coordinator turn must record terminal cancellation');
  });

  test('the coordinator budget widens for doc-grounded turns without bypassing the cancellation path', () => {
    assert.match(body, /const WTA_COORDINATOR_BUDGET_MS = documentGroundedCustomModeActive \? 2000 : 1000/,
      'doc-grounded WTA coordinator calls inherit the larger budget');
  });

  test('the canonical WTA governance reuses the resolved pack to thread contextOsGeneration', () => {
    const llmSrc = read('../../llm/WhatToAnswerLLM.ts');
    assert.match(llmSrc, /const resolvedGovernedPack: import\('\.\.\/intelligence\/context-os'\)\.EvidencePack \| null =/s,
      'wtaRouteOptions must derive from the RESOLVED pack, not the local variable');
    assert.match(llmSrc, /wtaRouteOptions = resolvedGovernedPack && governedWtaContextOs/,
      'route options must thread contextOsGeneration when the resolved pack governs');
  });

  test('LLMHelper stream pins document-grounded retrieval to the t0 mode id via route options', () => {
    const llmHelperSrc = read('../../LLMHelper.ts');
    const policySrc = read('../../llm/streamContextPolicy.ts');
    assert.match(policySrc, /pinnedModeId\?: string \| null/,
      'StreamRouteOptions must carry the t0 mode pin');
    assert.match(llmHelperSrc, /mm\.getActiveModeDocumentGroundingInfo\?\.?\(pin \?\? undefined\)/,
      'document-grounded detection must consult the route pin');
    assert.match(llmHelperSrc, /modesMgrForInjection\.getActiveModeDocumentGroundingInfo\?\.?\(_pinnedModeId\)/,
      'active-mode injection must read the pinned grounding info');
    assert.match(llmHelperSrc, /routeOptions\?\.pinnedModeId \?\? undefined/,
      'all mode-injection reads must thread the route pin');
    assert.match(llmHelperSrc, /modesMgr\.getModeSnapshot\?\.?\(_pinnedModeIdEvidenceResolver\)/,
      'the EvidenceResolver block must resolve the pinned mode row');
  });

  test('a deadline replaces an unseen sub-threshold provider fragment with the safe fallback', () => {
    // `raceStreamWithDeadline` considers a response useful only at the same
    // safe-prefix threshold. A short provider fragment that then times out must
    // not bypass the fallback merely because fullAnswer is non-empty.
    assert.match(body, /if \(fullAnswer\.trim\(\)\.length < STREAMING_SAFE_PREFIX_CHARS\) \{\s*const safe =/s,
      'the timeout fallback must replace an unseen short provider fragment');
  });

  test('a post-deadline exception is not mistaken for supersession', () => {
    // Deadline cleanup deliberately aborts the owning provider controller. The
    // outer catch must check request ownership only; testing `.signal.aborted`
    // here would silently discard a real post-deadline failure as superseded.
    const catchStart = body.lastIndexOf('} catch (error) {');
    assert.ok(catchStart >= 0, 'WTA outer catch must be present');
    const catchBody = body.slice(catchStart, catchStart + 1200);
    assert.match(catchBody, /if \(isWtaSuperseded\(\)\) \{/,
      'only a replaced/reset request may take the cancellation branch');
    assert.doesNotMatch(catchBody, /whatToAnswerCancellationToken\.signal\.aborted/,
      'the request-owned deadline abort must not be treated as supersession');
  });
});

describe('WTA repairs inherit the owning request cancellation', () => {
  const src = read('../../IntelligenceEngine.ts');

  function repairWindow(marker) {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, `expected repair marker: ${marker}`);
    return src.slice(start, start + 6000);
  }

  function assertForegroundRepairUsesRequestSignal(marker) {
    const window = repairWindow(marker);
    assert.match(window, /stream: this\.llmHelper\.streamChat\([\s\S]*?whatToAnswerCancellationToken\.signal/s,
      `${marker} repair must thread its request AbortSignal into streamChat`);
    assert.match(window, /shouldAbort: \(\) =>[\s\S]*?whatToAnswerCancellationToken\.signal\.aborted[\s\S]*?isWtaSuperseded\(\)/s,
      `${marker} repair must stop local stream consumption when superseded`);
  }

  test('every foreground repair cancels its provider request on WTA supersession', () => {
    assertForegroundRepairUsesRequestSignal("trace.mark('repair_used', { reason: 'scaffold_contamination_detected'");
    assertForegroundRepairUsesRequestSignal('The previous answer failed document-grounded validation:');
    assertForegroundRepairUsesRequestSignal('const repairInstruction = pv.repairInstruction');
    assertForegroundRepairUsesRequestSignal('Your previous response did not address the question below at all.');
  });

  test('background coding correction inherits its child cancellation signal', () => {
    const start = src.indexOf('private async maybeVerifyCoding(');
    const end = src.indexOf('async runFollowUp(', start);
    assert.ok(start >= 0 && end > start, 'maybeVerifyCoding must be isolatable');
    const body = src.slice(start, end);

    assert.match(body, /stream: this\.llmHelper\.streamChat\([\s\S]*?abortSignal/s,
      'the background correction must thread its child AbortSignal into streamChat');
    assert.match(body, /shouldAbort: \(\) => fixed\.length > 1200 \|\| superseded\(\)/,
      'the background correction must stop consuming when its generation is superseded');
  });
});

describe('answer pipeline lifecycle telemetry', () => {
  const engineSrc = read('../../IntelligenceEngine.ts');
  const ipcSrc = read('../../ipcHandlers.ts');

  test('WTA records every canonical lifecycle stage and commits cancellation', () => {
    for (const stage of ['created', 'planned', 'evidence_selected', 'prompt_built', 'provider_dispatched', 'streaming', 'validating', 'repairing', 'completed', 'cancelled', 'failed']) {
      assert.match(engineSrc, new RegExp(`\\.lifecycle\\('${stage}'`), `WTA must record ${stage}`);
    }
    assert.match(engineSrc, /const recordWtaCancellation = \(\) => \s*\{[\s\S]*?\.lifecycle\('cancelled'[\s\S]*?commitTrace\(wtaTrace\)/,
      'WTA cancellation must be committed, not silently dropped');
    assert.match(engineSrc, /if \(streamAborted\) \{\s*recordWtaCancellation\(\)/,
      'the streaming cancellation path must record the terminal lifecycle event');
  });

  test('manual chat records the same lifecycle and commits supersession', () => {
    for (const stage of ['created', 'planned', 'evidence_selected', 'prompt_built', 'provider_dispatched', 'streaming', 'validating', 'repairing', 'completed', 'cancelled', 'failed']) {
      assert.match(ipcSrc, new RegExp(`\\.lifecycle\\('${stage}'`), `manual chat must record ${stage}`);
    }
    assert.match(ipcSrc, /if \(manualSuperseded\) \{\s*iTrace\.setCorrelation\(\{ aborted: true, errorCategory: 'superseded' \}\)\s*\.lifecycle\('cancelled'[\s\S]*?commitTrace\(iTrace\)/,
      'a superseded manual turn must be committed as cancelled, not silently dropped');
  });
});

describe('#9 — the live IntelligenceTrace is correlated with the latency trace', () => {
  const src = read('../../IntelligenceEngine.ts');
  const start = src.indexOf('async runWhatShouldISay(');
  const end = src.indexOf('async runFollowUp', start);
  const body = src.slice(start, end > start ? end : start + 30000);

  test('wtaTrace.setCorrelation is called with the shared requestId + ids only', () => {
    assert.match(body, /wtaTrace\.setCorrelation\(\{/, 'the engine trace must be correlated');
    assert.match(body, /requestId: trace\.requestId/, 'must share the PiLatencyTrace requestId');
    assert.match(body, /surface: 'what_to_answer'/, 'must mark the surface');
    assert.match(body, /modeId: snapshotModeId/, 'must carry the mode marker');
    assert.match(body, /meetingId: meetingMarker/, 'must carry the meeting marker');
  });
});

describe('#3 — live tokens carry the generationId end-to-end', () => {
  test('engine stamps generationId on the live suggested_answer_token emits', () => {
    const src = read('../../IntelligenceEngine.ts');
    const start = src.indexOf('async runWhatShouldISay(');
    const end = src.indexOf('async runFollowUp', start);
    const body = src.slice(start, end > start ? end : start + 30000);
    // The streaming emitChunk + the finalization flush emits must pass generationId.
    const emits = body.match(/this\.emit\('suggested_answer_token', [^)]*confidence, generationId\)/g) || [];
    assert.ok(emits.length >= 3, `at least the stream + 2 flush emits must carry generationId (found ${emits.length})`);
  });

  test('main forwards generationId per item on the token batch', () => {
    const src = read('../../main.ts');
    assert.match(src, /on\('suggested_answer_token', \(token: string, question: string, confidence: number, generationId\?: number\)/,
      'the main listener must accept generationId');
    assert.match(src, /queueBatch\('suggested_answer', \{ token, question, confidence, generationId \}\)/,
      'the batch item must carry generationId');
  });

  test('renderer drops superseded live batches via resolveLiveAnswerBatch', () => {
    const src = read('../../../src/components/NativelyInterface.tsx');
    assert.match(src, /resolveLiveAnswerBatch/, 'renderer must use the live-answer batch guard');
    assert.match(src, /liveAnswerGenIdRef/, 'renderer must track an active live-answer generation id');
    assert.match(src, /\(it as any\)\.generationId/, 'the guard must read the per-item generationId');
  });
});
