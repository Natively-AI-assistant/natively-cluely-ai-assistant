// Ordering of the "nothing was retrieved" branches in prompt-composer.
//
// The multiTurnHistory work added a `hasConversationHistory` early return as the
// FIRST branch of the no-evidence notice. That put it in front of two guards
// that exist to stop this function narrating an absence:
//
//   1. the private-claim guard, whose own comment records it as a live defect
//      fix "hoisted to cover EVERY branch of this function";
//   2. the generalKnowledgeAllowed split, which is how "Only answer from
//      references" (STRICT_SOURCE_ONLY) keeps its refusal copy.
//
// Both are invisible in the feature's own tests, because every scenario there
// carries a private claim and runs in a mode that allows general knowledge.
// These two cases are the ones the ordering broke.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-absence-'));

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const store = await import(
  pathToFileURL(path.join(base, 'question/conversation-state-store.js')).href);
const { buildV3Prompt } = await import(
  pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(
  pathToFileURL(path.join(base, 'contracts/flag.js')).href);

process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';

const turn = (sessionId, question, n, extra = {}) => buildV3Prompt({
  surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
  requestId: `abs-${n}`, requestSequence: n,
  scope: { userId: 'local', sessionId }, ...extra,
});

describe('no-evidence notice — branch ordering', () => {
  test('a general-knowledge follow-up gets NO absence narrative, history or not', async () => {
    // The exact case the private-claim guard names: "give me an example" after
    // "what is a REST API" retrieves conservatively, comes back empty, and has
    // no claim a private source could ever have evidenced. Narrating an absence
    // here talks about documents over a question that never needed one.
    const sid = 'abs-general';
    store.clearConversationState(sid);
    await turn(sid, 'What is a REST API?', 1);
    store.recordAnswerSummary(sid, 'An architectural style for networked APIs over HTTP.');
    const t2 = await turn(sid, 'Give me an example.', 2);

    assert.ok(!/No NEW material was retrieved/.test(t2.user),
      'a turn with no private claim must not be told material is missing');
    assert.ok(!/No supporting evidence was retrieved/.test(t2.user));
    assert.ok(!/no document has been added/i.test(t2.user));
  });

  test('the history branch still fires for a private-claim turn that allows general knowledge', async () => {
    // The feature itself must survive the reorder: this is the screenshot case
    // it was built for, and it still reaches the branch.
    const sid = 'abs-private';
    store.clearConversationState(sid);
    await turn(sid, 'What is wrong with this code?', 1, { hasScreenContext: true });
    store.recordAnswerSummary(sid, 'Line 14 fails because visited is a list.',
      'VS Code on graph.py; sidebar shows project orbit-router with 12 files.');
    const t2 = await turn(sid, 'What was the project name in that screenshot?', 2);

    // A SCREEN OBSERVATION supersedes: the tailored copy would blame an
    // uploaded document that was never the subject of this turn.
    assert.ok(!/the uploaded material does not cover this/.test(t2.user),
      'no document was the subject; do not blame one');
    assert.match(t2.user, /may answer from directly/i,
      'the observation is a genuine alternative source');
  });

  test('a zero-attachment turn keeps its OWN copy, with history only appended', async () => {
    // Review finding 3. The history branch used to `return` its own block,
    // which threw away the tailored wording that makes the absence true for
    // THIS user: with nothing attached and no profile, the honest sentence is
    // "no reference material is attached, so nothing was searched" — and the
    // guard it carries is what stops the model saying "your resume does not
    // mention that" to someone who never uploaded one (the 2026-07-31 defect).
    const sid = 'abs-zero';
    store.clearConversationState(sid);
    await turn(sid, 'What are you able to help with?', 1);
    store.recordAnswerSummary(sid, 'Plenty — ask me anything about your work.');
    const t2 = await turn(sid, 'What is my strongest skill?', 2);

    // The branch this input actually reaches is the source-availability one.
    // What matters is that its GUARD survives — the sentence that stops the
    // model attributing an answer to a resume/job/meeting the user never
    // supplied. Asserting on the guard, not on which branch produced it.
    assert.match(t2.user, /not established by any available source/i,
      'the tailored anti-fabrication guard must survive the presence of history');
    assert.ok(!/No NEW material was retrieved/.test(t2.user),
      'the history block must not REPLACE the tailored notice');
    // And the caveat is still there — both facts, not one overriding the other.
    assert.match(t2.user, /check the conversation above/i,
      'plain history is appended as a caveat, never a replacement');
    // Scoped to the EVIDENCE BLOCK. The conversation header carries its own
    // "you may answer from it directly" for the screen exception, so a
    // whole-prompt match here would assert against unrelated instruction copy —
    // the same shape that already produced one false failure in this session.
    const evidenceBlock = /# Evidence[\s\S]*?(?=\n# |$)/.exec(t2.user)?.[0] ?? '';
    assert.ok(evidenceBlock.length > 0, 'expected an evidence block to assert against');
    assert.ok(!/may answer from directly/.test(evidenceBlock),
      'plain chat history is NOT an observation and the NOTICE must not present it as one');
  });

  test('a first turn with no history keeps the plain retrieval-miss copy', async () => {
    const sid = 'abs-first';
    store.clearConversationState(sid);
    const t1 = await turn(sid, 'What did the Q3 revenue report say?', 1);
    assert.match(t1.user, /No supporting evidence was retrieved/,
      'with nothing to read, "nothing was retrieved" is the honest answer');
  });
});
