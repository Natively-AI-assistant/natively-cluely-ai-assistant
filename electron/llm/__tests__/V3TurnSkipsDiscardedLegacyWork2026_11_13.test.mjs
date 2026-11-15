// F-LAT-05 / F-BND-02 (live-pipeline forensics, 2026-11-13).
//
// When V3 composes a WTA turn, its prompt REPLACES the legacy packet. The
// legacy work that only feeds that packet was still awaited first and then
// thrown away: the premium grounding call (≤2 s), the Context-OS coordinator
// (≤1-2 s) and the legacy mode retrieval (prefetch race ≤1.5 s, inline hybrid
// ≤1.5 s / 6 s doc-grounded). On a V3 turn none of it may be waited for; on a
// non-V3 turn it all runs as before.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const { WhatToAnswerLLM } = await import(pathToFileURL(path.join(distRoot, 'llm/WhatToAnswerLLM.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distRoot, 'llm/AnswerPlanner.js')).href);
const engineSrc = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

function helperStub() {
  const seen = { userMessage: '' };
  return {
    seen,
    getPromptTier: () => 'full',
    getCapabilities: () => ({ outputBudgetTokens: 2000 }),
    fitContextForCurrentModel: (t) => t,
    canUseLocalFallback: async () => false,
    thinkingBudgetForAnswerType: () => 0,
    streamChat: async function* (userMessage) { seen.userMessage = userMessage; yield 'ok'; },
  };
}
function modesStub() {
  const calls = { hybrid: 0 };
  return {
    calls,
    getActiveModeSystemPromptSuffix: () => '',
    getActiveModePinnedInstructions: () => '',
    buildActiveModeContextBlock: () => '',
    buildRetrievedActiveModeContextBlock: () => '',
    // A cold embedder: never settles.
    buildRetrievedActiveModeContextBlockHybrid: () => { calls.hybrid += 1; return new Promise(() => {}); },
  };
}
const drain = async (gen) => { let out = ''; for await (const t of gen) out += t; return out; };
const plan = () => planAnswer({ question: 'why is your product better than competitors?', source: 'what_to_answer', speakerPerspective: 'interviewer' });
const V3 = { v3Prompt: { user: 'V3-COMPOSED-USER', system: 'V3-SYSTEM', sections: null } };

describe('WhatToAnswerLLM does not wait for legacy retrieval on a V3 turn', () => {
  test('a hung prefetch is not raced when V3 composed the prompt', async () => {
    const helper = helperStub();
    const wta = new WhatToAnswerLLM(helper, modesStub());
    const t0 = performance.now();
    const out = await drain(wta.generateStream(
      'interviewer: why is your product better than competitors?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      plan(), new Promise(() => {}), V3,
    ));
    const elapsed = performance.now() - t0;
    assert.equal(out, 'ok');
    assert.equal(helper.seen.userMessage, 'V3-COMPOSED-USER');
    assert.ok(elapsed < 800, `V3 turn waited ${elapsed.toFixed(0)} ms for a legacy prefetch it discards`);
  });

  test('inline hybrid retrieval is not started when V3 composed the prompt', async () => {
    const helper = helperStub();
    const mm = modesStub();
    const wta = new WhatToAnswerLLM(helper, mm);
    const t0 = performance.now();
    await drain(wta.generateStream(
      'interviewer: why is your product better than competitors?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      plan(), undefined, V3,
    ));
    assert.equal(mm.calls.hybrid, 0, 'legacy hybrid retrieval ran on a V3 turn');
    assert.ok(performance.now() - t0 < 800);
  });

  test('non-V3 turn: the legacy retrieval still runs (prefetch raced under its budget)', async () => {
    const helper = helperStub();
    const mm = modesStub();
    const wta = new WhatToAnswerLLM(helper, mm);
    await drain(wta.generateStream(
      'interviewer: why is your product better than competitors?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      plan(), undefined, {},
    ));
    assert.equal(mm.calls.hybrid, 1, 'legacy turn lost its retrieval');
  });
});

describe('IntelligenceEngine does not start legacy-only work on a V3 turn (source pins)', () => {
  test('one predicate, computed before the prefetch, from the same question V3 receives', () => {
    const decl = engineSrc.indexOf('const wtaV3ExpectedToCompose');
    const prefetch = engineSrc.indexOf('const modeContextPromise: Promise<string>');
    assert.ok(decl > 0 && decl < prefetch, 'predicate must exist before the prefetch kick');
    assert.match(engineSrc, /isContextIntelligenceV3Enabled\(\) === true\s*&& String\(question \|\| extractedQuestion\.latestQuestion \|\| lastInterviewerTurn \|\| ''\)\.trim\(\)\.length > 0/);
  });
  test('the prefetch, the premium grounding call and the coordinator are skipped on it', () => {
    assert.match(engineSrc, /const modeContextPromise: Promise<string> = options\?\.activeSkill \|\| docGroundedEnforcementActive \|\| !wtaPrefetchDecision\.allowed \|\| wtaV3ExpectedToCompose/);
    assert.match(engineSrc, /&& wtaDecisionAllowsCandidateProfile && snapshotProfileIntelligenceAllowed\s*&& !wtaV3ExpectedToCompose\) \{/);
    assert.match(engineSrc, /&& snapshotProfileIntelligenceAllowed\s*&& !wtaV3ExpectedToCompose\s*&& isIntelligenceFlagEnabled\('contextOsEvidencePackEnabled'\)\s*&& isIntelligenceFlagEnabled\('contextOsMultiFamilyEvidenceEnabled'\)/);
  });
});
