// Two producers from a 1,000-turn live campaign with STT-style noise (2026-09-07).
//
// (1) Fillers inside a question defeated the value-lookup rules: "What is erm
//     the erm basically period for churn pct?" → GENERAL_TECHNICAL → FAST, while
//     the clean form retrieves. The classifier now strips unambiguous fillers
//     and stutters before any rule runs.
// (2) The referent resolver skipped its own-subject guards whenever the turn
//     carried a pronoun, so "What does it say about the Step 4?" was resolved
//     as "(referring to: milestones 2 title)" and answered from the roadmap
//     instead of the checklist; "Remind me, Detection, what was it?" got the
//     previous risk glued on. A document-deictic pronoun with its own subject is
//     self-contained.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { classifyTurn, normalizeSttQuestion } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { resolveReference, advance, pronounIsDocumentDeictic } = await load('question/conversation-state.js');

const FILES = ['general_meeting_agenda.md', 'general_metrics_sheet.csv', 'general_onboarding_checklist.txt', 'general_roadmap.json'];
const classify = (q) => classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES.general, isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: FILES });

describe('fillers and stutters do not change the route', () => {
  test('normalizeSttQuestion strips fillers and collapses stutters', () => {
    assert.equal(normalizeSttQuestion('What is erm the erm basically period for churn pct?'), 'what is the period for churn pct?');
    assert.equal(normalizeSttQuestion('remind me okay so step hmm 5 5 what was it'), 'remind me okay so step 5 what was it');
    assert.equal(normalizeSttQuestion('so the the migration thing, um, how long'), 'so the migration thing, how long');
  });
  test('wedged "right"/"okay so"/"like" between a function word and its object are fillers (2026-09-08)', () => {
    assert.equal(normalizeSttQuestion('what is right the the annual um discount you know pct'), 'what is the annual discount pct');
    assert.equal(normalizeSttQuestion('For okay so proposal, what is erm the acv um usd?'), 'for proposal, what is the acv usd?');
    const r = classify('what is right the annual discount pct'); assert.equal(r.shouldRetrieve, true, r.reason);
  });
  test('"like", "so" and "right" survive (they are real words)', () => {
    assert.equal(normalizeSttQuestion('What do you like about the role, right?'), 'what do you like about the role, right?');
  });
  test('a compound noun containing "to" is a value lookup, an infinitive is still a concept', () => {
    for (const q of ['What is the free to paid conversion?', 'What is the end to end latency?', 'What is the peer to peer sync interval?']) {
      const r = classify(q); assert.equal(r.shouldRetrieve, true, `${q}: ${r.reason}`);
    }
    for (const q of ['What is the best way to learn Rust?', 'What is the fastest way to scale a queue?']) {
      const r = classify(q); assert.equal(r.shouldRetrieve, false, `${q}: ${r.reason}`);
    }
  });
  for (const [noisy, clean] of [
    ['What is erm the erm basically period for churn pct?', 'What is the period for churn pct?'],
    ['um what what is the uh step 4', 'what is the step 4'],
    ['how many hmm retailers did did PriceX cover', 'how many retailers did PriceX cover'],
  ]) {
    test(`same route noisy vs clean: ${noisy}`, () => {
      const a = classify(noisy), b = classify(clean);
      assert.equal(a.path, b.path, `${a.path} vs ${b.path} (${a.reason})`);
      assert.equal(a.shouldRetrieve, b.shouldRetrieve);
      assert.equal(a.shouldRetrieve, true, a.reason);
    });
  }
});

const SCOPE = { userId: 'u1', sessionId: 's1' };
const chain = (turns) => turns.reduce((st, q) => advance(st, { scope: SCOPE, question: q, at: 0 }), null);

describe('a document-deictic pronoun with its own subject is self-contained', () => {
  const st = chain(['What does it say about the milestones 2 title?', 'What is the risks 3 title?']);
  for (const q of ['What does it say about the Step 4?', 'Remind me, Detection, what was it?', 'what does it say about churn pct', 'Okay, so, Timeline, what was it?']) {
    test(q, () => {
      assert.equal(pronounIsDocumentDeictic(q), true);
      const r = resolveReference(q, st);
      assert.equal(r.usedState, false, `stale topic glued on: ${r.resolved}`);
      assert.equal(r.resolved, q.trim());
    });
  }
  test('bare "what does it say?" and "what was it?" still anchor to the conversation', () => {
    for (const q of ['what does it say?', 'what was it?', 'What is its latency?', 'Has she used GCP?']) {
      assert.equal(pronounIsDocumentDeictic(q), false, q);
    }
    const r = resolveReference('what was it?', st);
    assert.equal(r.usedState, true, r.reason);
  });
  test('a pronoun that is genuinely the previous topic still resolves', () => {
    const r = resolveReference('What did Priya say about it?', chain(['Tell me about the Kafka migration.']));
    assert.equal(r.usedState, true, r.reason);
  });
});

const { decide } = await load('orchestration/orchestrator.js');
const { composePrompt } = await load('generation/prompt-composer.js');
describe('the orchestrator strips fillers before classification, retrieval and the prompt (2026-09-07)', () => {
  const dec = (q) => decide({ requestId: 'r', requestSequence: 1, surface: 'what_to_answer', modeId: 'general', scope: { userId: 'u' }, sessionId: 's', transcriptQuestion: q, hasAttachedDocuments: true, attachedFileNames: FILES });
  test('"what is arh the discount pct?" reaches the model as "what is the discount pct?"', () => {
    const d = dec('What is arh the enterprise floor discount um pct?');
    assert.equal(d.resolvedQuestion, 'What is the enterprise floor discount pct?');
    assert.equal(d.rawQuestion, 'What is arh the enterprise floor discount um pct?', 'the raw question is kept for the trace');
    assert.equal(d.retrievalPlan.shouldRetrieve, true);
    assert.ok(!/\barh\b|\bum\b/.test(d.retrievalPlan.queries[0]));
  });
  test('the permanent rules forbid inventing a figure about the user\'s own material', () => {
    const c = composePrompt({ decision: dec('For proposal, what is the ACV?'), policy: MODE_POLICIES.general, evidence: [] });
    assert.match(c.system, /Never state a specific figure/);
  });
});

describe('a reminder is a document lookup even when it contains a tech word (2026-09-08)', () => {
  const cr = (q) => classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES['technical-interview'], isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: ['debug_test_results.json', 'debug_error_log.txt'] });
  for (const q of ['Remind me, failures 1 error, what was it?', 'so remind me the exception message', 'What was the failing test again?']) {
    test(q, () => { const r = cr(q); assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(r.questionTypes)); assert.equal(r.shouldRetrieve, true, r.reason); });
  }
  test('without documents a reminder is unchanged', () => {
    const r = classifyTurn({ resolvedQuestion: 'Remind me, failures 1 error, what was it?', policy: MODE_POLICIES.general, isFollowUp: false, hasAttachedDocuments: false });
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(r.questionTypes));
  });
});

const { canonicalizeSttSpellings, stripSttFillers } = await load('question/turn-classifier.js');
describe('transcriber spellings are canonicalised (2026-09-08)', () => {
  test('queue two → Q2, p ninety five → p95, n d c g → nDCG, bat na → BATNA', () => {
    assert.equal(canonicalizeSttSpellings('the projected ARR for queue two 2026'), 'the projected ARR for Q2 2026');
    assert.equal(stripSttFillers('what um was the p ninety five after the regression'), 'what was the p95 after the regression');
    assert.equal(canonicalizeSttSpellings('the n d c g and the m r r for reranker A'), 'the nDCG and the MRR for reranker A');
    assert.equal(canonicalizeSttSpellings('what is my bat na'), 'what is my BATNA');
  });
  test('ordinary words are untouched', () => {
    assert.equal(canonicalizeSttSpellings('the queue depth alert and the p value'), 'the queue depth alert and the p value');
  });

  // 2026-09-10, live interview simulation: "DEBUG two oh six" never matched
  // DEBUG-206 in the attached pack and the answer opened with "There's no
  // DEBUG 206 record in what I have here".
  test('spoken identifier digits are written as digits; ordinary counts are not', () => {
    assert.equal(canonicalizeSttSpellings('from the debugging set, DEBUG two oh six. what would your first step be'), 'from the debugging set, DEBUG 206. what would your first step be');
    assert.equal(canonicalizeSttSpellings('ARCH one oh four, do you remember'), 'ARCH 104, do you remember');
    assert.equal(canonicalizeSttSpellings('the redis pool one, INC twenty six oh one, we raised the pool'), 'the redis pool one, INC 2601, we raised the pool');
    assert.equal(canonicalizeSttSpellings('incident twenty six oh nine was the cert one'), 'incident 2609 was the cert one');
    assert.equal(canonicalizeSttSpellings('ticket one hundred four is open'), 'ticket 104 is open');
    assert.equal(canonicalizeSttSpellings('question three on the sheet'), 'question 3 on the sheet');
    assert.equal(canonicalizeSttSpellings('I have two kids and the two of us went'), 'I have two kids and the two of us went');
    assert.equal(canonicalizeSttSpellings('take one more look at mode two'), 'take one more look at mode two');
    assert.equal(canonicalizeSttSpellings('we hired five engineers last year'), 'we hired five engineers last year');
  });
});
