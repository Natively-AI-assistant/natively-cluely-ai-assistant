// The claim verifier runs only on turns whose material carries documents
// (owner's decision 2026-11-13 after the pipeline forensics, F-LAT-04: it was
// 43 of 103 answer-sized calls on spoken General and held the finished state
// ~0.9 s). Drives the real IntelligenceEngine.verifyAnswerClaims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { IntelligenceEngine } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js')).href);
const { SessionTracker } = require(path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js'));

function engineWithCountingProvider() {
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, new SessionTracker());
  let calls = 0;
  engine.llmHelper = {
    replayAnswerCall: () => null,
    replayedAnswerHasImages: () => false,
    async *streamChat() { calls++; yield 'I ship on Fridays.'; },
  };
  return { engine, calls: () => calls };
}
const trace = { mark() {} };
const run = (engine, material) => engine.verifyAnswerClaims({
  answer: 'I ship on Fridays.', modeId: 'general', question: 'When do you ship?', material,
  turnKey: {}, signal: new AbortController().signal, isSuperseded: () => false, trace,
});

test('spoken General with no documents: no verifier call, the answer is returned as is', async () => {
  const h = engineWithCountingProvider();
  assert.equal(await run(h.engine, '# Conversation so far\n[INTERVIEWER] When do you ship?'), 'I ship on Fridays.');
  assert.equal(h.calls(), 0);
});

test('with documents attached the verifier still runs', async () => {
  const h = engineWithCountingProvider();
  await run(h.engine, '<evidence source="notes.md">We ship on Fridays.</evidence>\n[INTERVIEWER] When do you ship?');
  assert.ok(h.calls() >= 1);
});

test('NATIVELY_CLAIM_VERIFIER_NO_DOCS=1 restores the no-document pass for a comparison', async () => {
  process.env.NATIVELY_CLAIM_VERIFIER_NO_DOCS = '1';
  try {
    const h = engineWithCountingProvider();
    await run(h.engine, '[INTERVIEWER] When do you ship?');
    assert.ok(h.calls() >= 1);
  } finally { delete process.env.NATIVELY_CLAIM_VERIFIER_NO_DOCS; }
});
