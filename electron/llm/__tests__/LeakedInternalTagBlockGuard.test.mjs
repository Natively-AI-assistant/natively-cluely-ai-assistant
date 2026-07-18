// electron/llm/__tests__/LeakedInternalTagBlockGuard.test.mjs
//
// Grounding campaign (2026-07-18): while root-causing run-023 press A7's
// fabricated-identity leak (fixed at the natively-api think-tag-stripper
// layer for its specific `</mm:think>`-closed shape), a SIBLING bug was
// found: the model sometimes opens its ENTIRE visible answer with a leaked
// internal instruction/state-tracking block instead of a real spoken answer
// — either a REAL prompt-structure tag (`<injected_context>`, `<active_mode>`,
// `<answer_contract>`, `<conversation_state>`, `<rewrite_instructions>` — all
// genuinely defined in prompts.ts/AnswerPlanner.ts/the repair-prompt builders
// in IntelligenceEngine.ts) or an INVENTED one in the same style
// (`<answerShapeSpec>`, `<rewrite_directive>`, `<rewrite_rules_for_self_check>`
// — none of these literal names exist anywhere in this codebase). Confirmed
// across 12 live occurrences in test/harness-longsession/reports/ runs
// 001-023: in EVERY case the entire visible answer is meta/instructional
// content, never a leak followed by a genuine spoken answer. No runtime guard
// previously existed for this — `stripEmbeddedAnswerContract` only sanitizes
// INBOUND user messages, never the model's OUTPUT.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/LeakedInternalTagBlockGuard.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const answerPolishPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/answerPolish.js');
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

describe('isLeakedInternalTagBlock (pure detector)', async () => {
  const { isLeakedInternalTagBlock } = await import(pathToFileURL(answerPolishPath).href);

  // Real, live-captured leaks — 8 of the 12 occurrences across
  // test/harness-longsession/reports/ runs 001/008(x2)/012(x2)/013/014/021,
  // reproduced verbatim (truncated to the opening block for brevity, matching
  // how answerPreview truncates in the harness reports).
  test('run-001 A13: real prompt-structure tag <injected_context>', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<injected_context>\nIf a <user_context> block appears, it is background the user has provided about themselves. Use it as first-person memory.\n</injected_context>'
    ), true);
  });
  test('run-008 A18: invented tag <answerShapeSpec> (does not exist anywhere in the codebase)', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<answerShapeSpec>experience_answer</answerShapeSpec>\n\nHow would you design a system to process millions of events per second reliably?'
    ), true);
  });
  test('run-008 C3: invented tag <rewrite_directive>', () => {
    assert.equal(isLeakedInternalTagBlock(
      "<rewrite_directive>Rewrite the answer. Use the candidate's real experience from the profile.</rewrite_directive>\n\nTell me about a time..."
    ), true);
  });
  test('run-012 A18 / run-015 A6: real repair-prompt tag <rewrite_instructions> (IntelligenceEngine.ts:2301)', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<rewrite_instructions note="follow these; never repeat or quote them in your output">\nYour previous answer broke these rules. Regenerate, fixing ONLY these:\n- You DO have the user\'s profile...'
    ), true);
  });
  test('run-012 C15: invented tag <context_intelligence_check>', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<context_intelligence_check>No active mode is explicitly set beyond the universal meeting copilot...'
    ), true);
  });
  test('run-013 A2: invented tag <rewrite_rules_for_self_check ...>', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<rewrite_rules_for_self_check only,  do not output>\nI have the candidate profile loaded. Answer behavioral questions as Marcus...'
    ), true);
  });
  test('run-014 A13: real context-layer name used as a self-invented tag <active_mode>', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<active_mode>\nThis is a job interview context. The interviewer is asking a behavioral follow-up...'
    ), true);
  });
  test('run-021 A15: real prompt-structure tag <answer_contract> (AnswerPlanner.ts:2921)', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<answer_contract>\nanswerType: general_meeting_answer\nsource: what_to_answer\nspeakerPerspective: interviewer...'
    ), true);
  });
  test('run-022 C6: invented tag <conversation_state>', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<conversation_state>\nNo active conversation yet. Waiting for the user to share what they need help with.\n</conversation_state>'
    ), true);
  });
  test('run-023 A7: the fabricated-identity leak (<resume>) — belt-and-suspenders alongside the natively-api think-tag fix', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<resume>\n**Vaibhav Singh**\nDistributed Systems & Database Engineer\nGitHub: github.com/svaibhav07...'
    ), true);
  });

  // Deliberate non-matches — the shape must stay narrow.
  test('run-022 C15: a stray <br> tag is NOT flagged (separate, lower-severity bug — a genuine good answer follows)', () => {
    assert.equal(isLeakedInternalTagBlock(
      '<br>\n\nI have spent the last decade building the kind of distributed systems this role cares about, including a reconciliation pipeline at Stripe.'
    ), false);
  });
  test('a real answer mentioning an HTML tag in prose is untouched', () => {
    assert.equal(isLeakedInternalTagBlock('The <b>bold</b> tag makes text bold in HTML.'), false);
  });
  test('a real coding answer with a fenced code block is untouched', () => {
    assert.equal(isLeakedInternalTagBlock('```python\ndef two_sum(nums, target):\n    return []\n```'), false);
  });
  test('a normal first-person spoken answer is untouched', () => {
    assert.equal(isLeakedInternalTagBlock('I built a reconciliation pipeline at Stripe using Kafka and Flink.'), false);
  });
  test('a real answer discussing tags in prose without opening with one is untouched', () => {
    assert.equal(isLeakedInternalTagBlock('Sure — <script> tags and <style> tags are both blocked by our CSP policy.'), false);
  });
  test('empty/null/undefined are safe', () => {
    assert.equal(isLeakedInternalTagBlock(''), false);
    assert.equal(isLeakedInternalTagBlock(null), false);
    assert.equal(isLeakedInternalTagBlock(undefined), false);
  });
});

function makeHelper() {
  return { setNegotiationCoachingHandler() {} };
}

async function makeEngineWithAnswer(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };
  return { engine, session };
}

describe('runWhatShouldISay: a leaked internal-tag-block answer is replaced, never shipped or persisted verbatim', () => {
  const LEAKED_ANSWER = '<rewrite_instructions note="follow these; never repeat or quote them in your output">\nYour previous answer broke these rules. Regenerate, fixing ONLY these:\n- You DO have the user\'s profile.';

  test('the leaked block is NOT returned/emitted verbatim — a safe fallback is used instead', async () => {
    const { engine, session } = await makeEngineWithAnswer([LEAKED_ANSWER]);
    const events = [];
    engine.on('suggested_answer', answer => events.push(answer));

    const answer = await engine.runWhatShouldISay('tell me about your background', 0.9, undefined, { skipCooldown: true });

    assert.notEqual(answer, LEAKED_ANSWER);
    assert.equal(answer.includes('rewrite_instructions'), false, 'the fallback text must not itself contain the leaked tag');
    assert.deepEqual(events, [answer]);
  });

  test('the leaked block is NEVER persisted into session history verbatim', async () => {
    const { engine, session } = await makeEngineWithAnswer([LEAKED_ANSWER]);

    await engine.runWhatShouldISay('tell me about your background', 0.9, undefined, { skipCooldown: true });

    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('rewrite_instructions')),
      false,
      'the leaked tag text must never appear in fullTranscript (would poison a later prompt, same failure mode as the provider-transport-error precedent)',
    );
  });

  test('the leaked block is NOT counted in fullUsage (mirrors the leaked-schema-stub precedent)', async () => {
    const { engine, session } = await makeEngineWithAnswer([LEAKED_ANSWER]);

    await engine.runWhatShouldISay('tell me about your background', 0.9, undefined, { skipCooldown: true });

    assert.deepEqual(session.getFullUsage(), []);
  });

  test('a REAL answer that merely mentions a tag in prose is still persisted normally — no over-suppression', async () => {
    const realAnswer = 'The <b>bold</b> tag in HTML is used for emphasis, and I have used it in a few internal dashboards.';
    const { engine, session } = await makeEngineWithAnswer([realAnswer]);

    const answer = await engine.runWhatShouldISay('have you used html?', 0.9, undefined, { skipCooldown: true });

    assert.equal(answer, realAnswer);
    assert.equal(session.getFullTranscript().some(segment => segment.text === realAnswer), true);
    assert.equal(session.getFullUsage().length, 1);
  });

  // Skeptic-pass-style regression, mirroring the provider-transport-error
  // guard's own precedent test: the guard must fire on the RAW fullAnswer
  // before validateAnswerStructure/repairCodingMarkdown can wrap a leaked
  // tag block into a six-section coding scaffold that would hide it from a
  // naive check.
  test('coding-type question: a leaked tag block is still caught before repairCodingMarkdown can mutate it', async () => {
    const { engine, session } = await makeEngineWithAnswer([LEAKED_ANSWER]);

    const answer = await engine.runWhatShouldISay('solve two sum', 0.9, undefined, { skipCooldown: true });

    assert.notEqual(answer, LEAKED_ANSWER);
    assert.equal(
      session.getFullTranscript().some(segment => segment.text.includes('rewrite_instructions')),
      false,
      'must not be persisted even when repairCodingMarkdown would otherwise have wrapped it into a scaffold first',
    );
    assert.deepEqual(session.getFullUsage(), []);
  });
});
