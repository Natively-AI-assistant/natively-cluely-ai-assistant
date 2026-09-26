// Phase 7 — the Answer policy control, END TO END through the decision layer.
//
// The two-option control existed with 13 tests and NO consumer: nothing read a
// user choice, so persisting one would have been the unwired-architecture
// disease (F1) in miniature. These tests pin the whole chain instead — store →
// decide() → answerability/fallback — so the UI cannot drift into a control
// that saves state nothing honours.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { decide, orchestrate } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { getStoredAnswerPolicy, setStoredAnswerPolicy, _resetAnswerPolicyStoreForTest } =
  await import(pathToFileURL(path.join(base, 'policies/answer-policy-store.js')).href);

const req = (over = {}) => ({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat',
  modeId: 'technical-interview', scope: { userId: 'u1' }, sessionId: 's1', ...over,
});

describe('the store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-store-'));

  test('roundtrips, clears, and survives a fresh read', () => {
    _resetAnswerPolicyStoreForTest();
    assert.equal(getStoredAnswerPolicy('mode_x', dir), null, 'no choice yet');
    setStoredAnswerPolicy('mode_x', 'only_answer_from_references', dir);
    assert.equal(getStoredAnswerPolicy('mode_x', dir), 'only_answer_from_references');
    _resetAnswerPolicyStoreForTest();   // force re-read from disk
    assert.equal(getStoredAnswerPolicy('mode_x', dir), 'only_answer_from_references');
    setStoredAnswerPolicy('mode_x', null, dir);
    assert.equal(getStoredAnswerPolicy('mode_x', dir), null);
  });

  test('an illegal value in the file is dropped on read, never surfaced', () => {
    // Hand-edited file / older schema: a third state flowing into groundingFor()
    // would be a grounding policy no one chose.
    fs.writeFileSync(path.join(dir, 'context-intelligence-answer-policy.json'),
      JSON.stringify({ mode_bad: 'ALLOW_EVERYTHING', mode_ok: 'only_answer_from_references' }));
    _resetAnswerPolicyStoreForTest();
    assert.equal(getStoredAnswerPolicy('mode_bad', dir), null);
    assert.equal(getStoredAnswerPolicy('mode_ok', dir), 'only_answer_from_references');
  });
});

describe('decide() honours the choice', () => {
  test('strict blocks the general-knowledge fallback', async () => {
    // technical-interview defaults SOURCE_FIRST: an unsupported personal claim
    // falls back to general knowledge. The user's strict choice must close that.
    const dflt = await orchestrate(req({ manualQuestion: 'Tell me about your Rust experience.' }));
    assert.equal(dflt.decision.generalKnowledgeAllowed, true, 'mode default is SOURCE_FIRST');
    // DOCUMENT_FACT_NOT_FOUND since deep-run 2 (issue 14): a document-specific
    // miss carries its own label; GENERAL_KNOWLEDGE is reserved for turns that
    // never required private evidence.
    assert.equal(dflt.trace.fallbackUsed, 'DOCUMENT_FACT_NOT_FOUND');

    const strict = await orchestrate(req({
      manualQuestion: 'Tell me about your Rust experience.',
      userAnswerPolicy: 'only_answer_from_references',
    }));
    assert.equal(strict.decision.groundingPolicy, 'STRICT_SOURCE_ONLY');
    assert.equal(strict.decision.generalKnowledgeAllowed, false);
    assert.equal(strict.trace.fallbackUsed, 'STRICT_NOT_FOUND',
      'strict means disclose the gap, never quietly answer from model knowledge');
  });

  test('the choice cannot widen: relaxing a strict-by-default mode is the ONLY loosening, and it stays inside the two options', () => {
    const relaxed = decide(req({
      modeId: 'seminar', manualQuestion: 'What does the document say about attention?',
      userAnswerPolicy: 'use_references_when_relevant',
    }));
    assert.equal(relaxed.groundingPolicy, 'SOURCE_FIRST');
    assert.notEqual(relaxed.groundingPolicy, 'OPEN_KNOWLEDGE',
      'OPEN_KNOWLEDGE is unreachable from the control — internal state, not a user option');
  });

  test('the choice never touches source authorization', () => {
    const a = decide(req({ manualQuestion: 'Do you have Postgres experience?' }));
    const b = decide(req({ manualQuestion: 'Do you have Postgres experience?', userAnswerPolicy: 'only_answer_from_references' }));
    assert.deepEqual(
      [...b.retrievalPlan.sourceTypes].sort(),
      [...a.retrievalPlan.sourceTypes].sort(),
      'grounding is fallback behaviour; which sources a mode may read is not user-steerable',
    );
  });

  test('absent choice means the mode default, bit for bit', () => {
    const a = decide(req({ manualQuestion: 'Tell me about your WebRTC project.' }));
    const b = decide(req({ manualQuestion: 'Tell me about your WebRTC project.', userAnswerPolicy: null }));
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  });
});
