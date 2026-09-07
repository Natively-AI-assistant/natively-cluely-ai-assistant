// Two engine-side producers of "can you repeat the question?" (2026-09-07).
//
// (1) buildGracefulRetry fired whenever a stream came back empty or a
//     non-provider error was swallowed, and its wording asked the user to
//     repeat. The engine now regenerates once first; the wording is honest.
// (2) The model itself sometimes answers a garbled fragment with ONLY
//     "Sorry, could you rephrase that? The audio cut out and I didn't catch the
//     question." — now a misfire on every answer type, which regenerates.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = process.cwd();
const { detectAssistantVoiceMisfire } = require(path.join(root, 'dist-electron/electron/llm/ProfileOutputValidator.js'));
const { isClarificationStall } = require(path.join(root, 'dist-electron/electron/llm/providerErrorClassifier.js'));
const { buildGracefulRetry } = require(path.join(root, 'dist-electron/electron/llm/manualProfileIntelligence.js'));

describe('a whole-answer request to repeat is a misfire', () => {
  for (const a of [
    "Sorry, could you rephrase that? The audio cut out and I didn't catch the question.",
    'Could you repeat that?',
    "I didn't catch that. Could you say that again?",
    'Can you please repeat the question?',
  ]) test(a, () => { const r = detectAssistantVoiceMisfire(a); assert.equal(r.isMisfire, true); assert.equal(r.reason, 'repeat_request'); });
  test('a real answer that ends with a clarifying question is NOT a misfire', () => {
    const a = 'The floor is 17 percent and VP sign-off is needed below it. Do you want the multi-year uplift too?';
    assert.equal(detectAssistantVoiceMisfire(a).isMisfire, false);
  });
  test('a closing "any questions for us" answer is NOT a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire("I don't have a specific question right now, but I'd love to hear how success is measured.").isMisfire, false);
  });
});

describe('the last-resort line is honest and the stall classifier still recognises it', () => {
  test('never asks to repeat, always says press again', () => {
    for (const q of ['', 'What is the p95?', 'tell me about the database design', 'arh um what is the okay so ran at']) {
      const out = buildGracefulRetry(q);
      assert.doesNotMatch(out, /repeat|rephrase|once more|say that again/i, out);
      assert.match(out, /press again/i, out);
      assert.equal(isClarificationStall(out), true, `stall classifier must still see the fallback as a non-answer: ${out}`);
    }
  });
});

describe('engine wiring (source assertions)', () => {
  const ie = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  test('an empty stream regenerates once before buildGracefulRetry', () => {
    const i = ie.indexOf("reason: 'empty_stream'"); const j = ie.indexOf('fullAnswer = regenerated ?? buildGracefulRetry(');
    assert.ok(i > 0 && j > i, 'regeneration must precede the fallback');
  });
  test('a repeat_request misfire regenerates on every answer type', () => {
    assert.match(ie, /detectAssistantVoiceMisfire\(fullAnswer\)\.reason === 'repeat_request'/);
  });
});

describe('more measured shapes (2026-09-08)', () => {
  test('"Could you finish what you\'re asking? I want to make sure I answer the right part…" is a misfire', () => {
    const r = detectAssistantVoiceMisfire("Could you finish what you're asking? I want to make sure I answer the right part of the material for you.");
    assert.equal(r.isMisfire, true); assert.equal(r.reason, 'repeat_request');
  });
});

describe('clarify-only answers on absurd or cut-off questions (2026-09-08)', () => {
  for (const a of [
    'I\'m not sure what "seat number" refers to here. Could you clarify what you\'re asking about? Are you asking about something specific in the interview setup, or is there a particular context I should be aware of?',
    'It sounds like the question got cut off. Could you clarify what you\'re asking, perhaps about my understanding of a specific problem or concept?',
    'I\'m not sure which "Evaluation" you mean. Could you clarify, are you asking about a middle name field, a specific person\'s middle name, or is there an evaluation record with a name I should be using?',
  ]) test(a.slice(0, 50), () => { const r = detectAssistantVoiceMisfire(a); assert.equal(r.isMisfire, true, JSON.stringify(r)); });
  test('an answer that names the gap AND answers is not a misfire', () => {
    const r = detectAssistantVoiceMisfire('There is no seat number in the material. The Result line says duplicate shipments fell by 98% and carrier timeouts stopped paging the on-call.');
    assert.equal(r.isMisfire, false);
  });
});

describe('"go ahead and finish the question" is a misfire (2026-09-08)', () => {
  test('measured shape', () => {
    const r = detectAssistantVoiceMisfire("What is? I think you were about to ask me something specific, so go ahead and finish the question. I'm ready to answer whatever's on your mind.");
    assert.equal(r.isMisfire, true, JSON.stringify(r));
  });
});
