// electron/llm/__tests__/WhatToAnswerProfileGrounding.test.mjs
//
// Production-path test: drives the REAL compiled WhatToAnswerLLM + PromptAssembler
// and asserts that the candidateProfile facts reach the prompt the provider sees.
// Only the LLMHelper transport is stubbed (it echoes the userMessage back as the
// single streamed token), so this proves the assembly wiring end-to-end without
// a network/model call.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/WhatToAnswerProfileGrounding.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js');
const { WhatToAnswerLLM } = await import(pathToFileURL(modPath).href);

// Stub LLMHelper: echo the assembled userMessage so we can assert its contents.
function makeStubHelper() {
  return {
    getPromptTier: () => 'tiny',
    getCapabilities: () => ({ outputBudgetTokens: 1000 }),
    fitContextForCurrentModel: (t) => t,
    canUseLocalFallback: async () => false,
    async *streamChat(userMessage) {
      yield userMessage; // single token = the whole prompt the provider would see
    },
  };
}
// Stub ModesManager (no active mode) so retrieval is a no-op.
const stubModes = {
  getActiveModeSystemPromptSuffix: () => '',
  buildActiveModeContextBlock: () => '',
  buildRetrievedActiveModeContextBlock: () => '',
};

async function collect(gen) {
  let out = '';
  for await (const t of gen) out += t;
  return out;
}

describe('WhatToAnswerLLM candidate-profile grounding', () => {
  test('candidateProfile facts are injected into the prompt the provider sees', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(), stubModes);
    const candidateProfile = '<candidate_projects>\n1. [Project: LedgerFlow] Event-sourced ledger\n</candidate_projects>';
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: Tell me about your projects.',
      undefined, { intent: 'general', answerShape: 'x' }, undefined, undefined, undefined, undefined,
      candidateProfile,
    ));
    assert.match(out, /LedgerFlow/, 'the loaded project must appear in the assembled prompt');
    assert.match(out, /candidate_projects/, 'candidate profile block must be present');
  });

  test('no candidateProfile → prompt has no candidate block (non-profile turns unaffected)', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: What is the time complexity of quicksort?',
      undefined, { intent: 'technical', answerShape: 'x' },
    ));
    assert.doesNotMatch(out, /candidate_projects|candidate_identity_fact/);
    assert.match(out, /quicksort/i, 'transcript still flows through');
  });

  test('identity fact block is preserved in the prompt', async () => {
    const llm = new WhatToAnswerLLM(makeStubHelper(), stubModes);
    const out = await collect(llm.generateStream(
      '[INTERVIEWER]: What is your name?',
      undefined, { intent: 'general', answerShape: 'x' }, undefined, undefined, undefined, undefined,
      '<candidate_identity_fact>\nYou are Jordan Rivera.\n</candidate_identity_fact>',
    ));
    assert.match(out, /Jordan Rivera/);
  });
});
