// electron/llm/__tests__/TranscriptQuestionExtractor.test.mjs
//
// Production-path tests for the deterministic transcript question extractor.
// Loads the REAL compiled module from dist-electron. No LLM, no fixtures baked
// into production logic — every assertion is derived from the transcript input.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/TranscriptQuestionExtractor.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/transcriptQuestionExtractor.js');
const { extractLatestQuestion, toCandidateFraming } = await import(pathToFileURL(modPath).href);

// Helper: build turns with increasing timestamps.
let _t = 1_000_000;
const turn = (role, text) => ({ role, text, timestamp: (_t += 1000) });

describe('transcript question extractor', () => {
  test('interviewer name question → identity, interviewer speaker', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Hi, can you hear me?'),
      turn('user', 'Yes, I can hear you fine.'),
      turn('interviewer', 'Great. What is your name?'),
    ]);
    assert.equal(r.detectedSpeaker, 'interviewer');
    assert.equal(r.questionType, 'identity');
    assert.match(r.latestQuestion, /your name/i);
    assert.ok(r.confidence >= 0.8);
  });

  test('"Tell me about your projects." → profile_detail (imperative, no question mark)', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Tell me about your projects.'),
    ]);
    assert.equal(r.detectedSpeaker, 'interviewer');
    assert.equal(r.questionType, 'profile_detail');
    assert.equal(r.isFollowUp, false);
    assert.ok(r.confidence >= 0.7);
  });

  test('experience question → profile_detail', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Walk me through your work experience.'),
    ]);
    assert.equal(r.questionType, 'profile_detail');
  });

  test('skills question → profile_detail', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What skills do you bring to this role?'),
    ]);
    assert.equal(r.questionType, 'profile_detail');
  });

  test('"why are you a good fit?" → jd_alignment', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'So why are you a good fit for this role?'),
    ]);
    assert.equal(r.questionType, 'jd_alignment');
  });

  test('salary question → negotiation', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What salary are you expecting?'),
    ]);
    assert.equal(r.questionType, 'negotiation');
  });

  test('behavioral question → behavioral', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Tell me about a time you handled a conflict on your team.'),
    ]);
    assert.equal(r.questionType, 'behavioral');
  });

  test('follow-up "can you explain that in more detail?" → follow_up + target resolved', () => {
    const r = extractLatestQuestion([
      turn('user', 'I built LedgerFlow, an event-sourced ledger.'),
      turn('interviewer', 'Can you explain that in more detail?'),
    ]);
    assert.equal(r.questionType, 'follow_up');
    assert.equal(r.isFollowUp, true);
    assert.equal(r.followUpTarget, 'LedgerFlow', 'should resolve the recently-mentioned project noun');
  });

  test('picks the LATEST interviewer question, not an earlier one', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What is your name?'),
      turn('user', 'Jordan.'),
      turn('interviewer', 'And what are your main projects?'),
    ]);
    assert.match(r.latestQuestion, /projects/i);
    assert.doesNotMatch(r.latestQuestion, /name/i);
  });

  test('noise/greetings before the real question are ignored', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'uh um okay'),
      turn('interviewer', 'yeah yeah right'),
      turn('interviewer', 'So, tell me about your experience.'),
    ]);
    assert.equal(r.questionType, 'profile_detail');
    assert.match(r.latestQuestion, /experience/i);
    assert.ok(r.ignoredTranscriptNoise.length >= 1, 'filler turns should be recorded as ignored noise');
  });

  test('greeting-only interviewer turn is skipped in favor of the real question', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Tell me about your background.'),
      turn('user', '...'),
      turn('interviewer', 'Nice to meet you'),
    ]);
    // "Nice to meet you" is greeting-only → skip back to the background question.
    assert.match(r.latestQuestion, /background/i);
  });

  test('no interviewer turn → unknown speaker, empty question, zero confidence', () => {
    const r = extractLatestQuestion([
      turn('user', 'I think I did well.'),
      turn('assistant', 'You answered clearly.'),
    ]);
    assert.equal(r.detectedSpeaker, 'unknown');
    assert.equal(r.latestQuestion, '');
    assert.equal(r.confidence, 0);
  });

  test('empty input → safe empty result', () => {
    const r = extractLatestQuestion([]);
    assert.equal(r.detectedSpeaker, 'unknown');
    assert.equal(r.confidence, 0);
  });

  test('technical question → technical', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'How does a hash map work internally?'),
    ]);
    assert.equal(r.questionType, 'technical');
  });

  test('relevantTranscriptWindow includes recent turns, labeled', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'What are your projects?'),
      turn('user', 'I built three things.'),
    ]);
    assert.match(r.relevantTranscriptWindow, /INTERVIEWER/);
    assert.match(r.relevantTranscriptWindow, /ME/);
  });
});

describe('toCandidateFraming (interviewer 2nd-person → candidate 1st-person)', () => {
  test('"What are your projects?" → "What are my projects?"', () => {
    const out = toCandidateFraming('What are your projects?');
    assert.match(out, /my projects/i);
    assert.doesNotMatch(out, /\byour\b/i);
  });

  test('possessive yours → mine, reflexive yourself → myself (non-idiom)', () => {
    assert.match(toCandidateFraming('Is that work yours?'), /\bmine\b/i);
    // "describe yourself in detail" is not an intro idiom → rewrites reflexive.
    assert.match(toCandidateFraming('Can you walk through what yourself did there?'), /\bmyself\b/i);
  });

  test('intro idioms are PRESERVED (not rewritten) so the orchestrator still routes them to a self-intro', () => {
    // "introduce yourself" / "tell me about yourself" are matched verbatim by the
    // orchestrator's INTRO_PATTERNS; rewriting "yourself"→"myself" would break
    // intro detection and the name would never ground.
    assert.match(toCandidateFraming('Please introduce yourself'), /introduce yourself/i);
    assert.match(toCandidateFraming('Tell me about yourself'), /about yourself/i);
  });

  test('a generic technical question with no pronouns is unchanged', () => {
    const q = 'How does a hash map work internally?';
    assert.equal(toCandidateFraming(q), q);
  });

  test('does not corrupt words that merely contain the letters of pronouns', () => {
    // "your" must match on word boundaries — "yourself" handled separately,
    // but words like "yours truly" or "neighbour" must not be mangled.
    const out = toCandidateFraming('Describe your favourite project');
    assert.match(out, /favourite/); // untouched
    assert.match(out, /my favourite project/i);
  });

  test('follow-up target false-positive guard: sentence-initial fillers are not picked', () => {
    // "So" / "Right" lead the sentences; the real noun is the CamelCase project.
    const r = extractLatestQuestion([
      turn('user', 'So we shipped it. Right, I built RedisMart last year.'),
      turn('interviewer', 'Can you explain that in more detail?'),
    ]);
    assert.equal(r.isFollowUp, true);
    assert.equal(r.followUpTarget, 'RedisMart', 'must skip "So"/"Right" and pick the CamelCase project');
  });
});
