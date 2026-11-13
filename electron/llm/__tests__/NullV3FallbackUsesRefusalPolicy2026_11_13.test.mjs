// F-ACC-13 (live-pipeline forensics, 2026-11-13): seminar / doc-grounded false
// refusals were fixed on the V3 default path, but when V3 returns null (flag
// off, empty question, a defect) the WTA engine still hands WhatToAnswerLLM a
// `govern: true` context (IntelligenceEngine site 2, set without
// packGovernsGeneration), and a `refuse_insufficient_evidence` pack then ended
// the turn with the canned "not directly mentioned" line and NO model call.
// LLMHelper's manual-chat twin had the same short-circuit.
//
// The refusal policy (refusalPolicy.packGovernsGeneration: ALWAYS ANSWER since
// 2026-09-07) must decide on that path too: a refusal pack does not govern, the
// turn falls through to generation like the visual-context yield does.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const distRoot = path.join(root, 'dist-electron/electron');
const { WhatToAnswerLLM } = await import(pathToFileURL(path.join(distRoot, 'llm/WhatToAnswerLLM.js')).href);
const { planAnswer } = await import(pathToFileURL(path.join(distRoot, 'llm/AnswerPlanner.js')).href);

function helperStub() {
  const seen = { calls: 0 };
  return {
    seen,
    getPromptTier: () => 'full',
    getCapabilities: () => ({ outputBudgetTokens: 2000 }),
    fitContextForCurrentModel: (t) => t,
    canUseLocalFallback: async () => false,
    thinkingBudgetForAnswerType: () => 0,
    streamChat: async function* () { seen.calls += 1; yield 'MODEL-ANSWER'; },
  };
}
const modesStub = {
  getActiveModeSystemPromptSuffix: () => '',
  getActiveModePinnedInstructions: () => '',
  buildActiveModeContextBlock: () => '',
  buildRetrievedActiveModeContextBlock: () => '',
};
const drain = async (gen) => { let out = ''; for await (const t of gen) out += t; return out; };

function governedRefusalSnapshot(answerPolicy) {
  const contract = { turnId: 't-1', sourceOwner: 'reference_files', requestedProperty: 'unknown', reason: 'diag' };
  return {
    // No v3Prompt: this is the null-V3 fallback.
    contextOsGeneration: {
      contract,
      turnQuestion: 'what does the paper say about the sampling method?',
      evidencePack: { packId: 'p-1', turnId: 't-1', answerPolicy, requestedProperty: 'unknown', sourceOwner: 'reference_files', items: [] },
      modeSnapshot: { modeId: 'm-1', modeName: 'Seminar', sourceAuthority: 'reference_files_primary' },
      turnSourceDecision: null,
      govern: true,
    },
  };
}

describe('null-V3 WTA fallback uses the shared refusal policy (F-ACC-13)', () => {
  test('a refusal pack does not end the turn with a canned line: the model answers', async () => {
    const helper = helperStub();
    const wta = new WhatToAnswerLLM(helper, modesStub);
    const plan = planAnswer({ question: 'what does the paper say about the sampling method?', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    const out = await drain(wta.generateStream(
      'interviewer: what does the paper say about the sampling method?',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      plan, undefined, governedRefusalSnapshot('refuse_insufficient_evidence'),
    ));
    assert.doesNotMatch(out, /not directly mentioned/i, 'canned refusal on the null-V3 fallback');
    assert.equal(helper.seen.calls, 1, 'the model was never called');
    assert.equal(out, 'MODEL-ANSWER');
  });
});

describe('both decline sites consult packGovernsGeneration (source pins)', () => {
  const wtaSrc = fs.readFileSync(path.join(root, 'electron/llm/WhatToAnswerLLM.ts'), 'utf8');
  const llmSrc = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
  test('WhatToAnswerLLM', () => {
    assert.match(wtaSrc, /const _refusalYields = pack\.answerPolicy === 'refuse_insufficient_evidence'\s*&& !packGovernsGeneration\(/);
  });
  test('LLMHelper', () => {
    assert.match(llmSrc, /const _refusalYieldsLLM = pack\.answerPolicy === 'refuse_insufficient_evidence'\s*&& !packGovernsGeneration\(/);
  });
});
