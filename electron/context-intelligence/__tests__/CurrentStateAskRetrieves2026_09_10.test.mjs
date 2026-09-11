// A question about OUR current state, with documents attached, retrieves
// (2026-09-10). Measured in two live simulations on the real stack:
//   negotiation, MSA attached — "…on the service credits, we want to cap them
//   at fifteen percent instead of, what is it now" → FAST, no retrieval, the
//   model invented "10%" over a contract that says 30%.
//   investor, board update attached — "what are you raising and at what
//   valuation" → FAST, "we're not raising" over a $60–75M Series C ask.
// Neither carried a document pointer or a private claim. In a document mode
// the subject of "we / you / our / it now" is the material.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { classifyTurn, normalizeSttQuestion, fragmentCoreWordCount } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { screenEnrichedQuery, decide } = await load('orchestration/orchestrator.js');
const { screenReferentNotice } = await load('generation/prompt-composer.js');
const { buildV3Prompt } = await load('orchestration/engine-bridge.js');

const inDocMode = (q, files = ['msa_acme_orbital.txt', 'q3_board_update.html']) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES.general, isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: files });
const noDocs = (q) => classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES.general, isFollowUp: false, hasAttachedDocuments: false });

describe('current-state asks retrieve when documents are attached', () => {
  for (const q of [
    'okay. and on the service credits, we want to cap them at fifteen percent instead of, what is it now',
    'what are you raising and at what valuation',
    'what are we actually scoring on and what weights',
    'how much do we charge per user per month',
    "what's the current uplift on the renewal",
    'what is it currently set to',
  ]) {
    test(`retrieves: ${q}`, () => {
      const r = inDocMode(q);
      assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), `expected DOCUMENT_FACT, got ${r.questionTypes.join('+')} (${r.reason})`);
      assert.equal(r.shouldRetrieve, true);
      assert.notEqual(r.path, 'FAST');
    });
  }

  test('the same grammar with NO documents keeps its general route', () => {
    const r = noDocs('what are you raising and at what valuation');
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'));
  });

  test('a concept question in a document mode is untouched', () => {
    const r = inDocMode('what is a bloom filter');
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
  });

  test('a coding task with "you" in it stays a coding task', () => {
    const r = inDocMode('how would you implement a rate limiter');
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
  });
});

describe('STT fragment lookups are judged on their core, not their hedges', () => {
  const FILES = ['general_meeting_agenda.md', 'general_metrics_sheet.csv', 'general_onboarding_checklist.txt'];
  const cls = (q) => classifyTurn({ resolvedQuestion: normalizeSttQuestion(q), policy: MODE_POLICIES.general, isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: FILES });
  test('lead-ins and hedges do not count', () => {
    assert.equal(fragmentCoreWordCount('yeah and period for gross margin percent i think'), 5);
    assert.equal(fragmentCoreWordCount('so the mrr growth percent what is it if you know'), 7);
    assert.equal(fragmentCoreWordCount('okay so and note for arr run rate usd same doc'), 6);
    assert.equal(fragmentCoreWordCount('right so the step 5 what is it'), 6);
  });
  for (const q of [
    'yeah and period for gross gross margin percent I think',
    'okay so and note for arr run rate usd same doc',
    'so the mrr growth percent what is it if you know',
    'right right so uh so the I mean step 5 what is it',
  ]) {
    test(`retrieves: ${q}`, () => {
      const r = cls(q);
      assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), `got ${r.questionTypes.join('+')} (${r.reason})`);
      assert.equal(r.shouldRetrieve, true);
    });
  }
  test('a genuinely long conversational line still keeps its route', () => {
    const r = cls('so anyway I was thinking we could maybe grab lunch after this if you are around later today');
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
  });
});

describe('residual corpus misses (2026-09-11)', () => {
  const cls = (q, mode, files) => classifyTurn({ resolvedQuestion: normalizeSttQuestion(q), policy: MODE_POLICIES[mode], isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: files });
  test('a subject that looks like a concept complement, followed by "what is it", is still a lookup', () => {
    const r = cls('so the engineering headcount as of july 2026 what is it', 'technical-interview', ['northstar_ops_handbook.md']);
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), `${r.questionTypes.join('+')} (${r.reason})`);
    assert.equal(r.shouldRetrieve, true);
  });
  test('"what are all the <X>s in the sheet" is an exhaustive document request', () => {
    const r = cls('okay so what are all the benchmarks in the sheet', 'seminar', ['seminar_evaluation_results.csv']);
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
    assert.equal(r.exhaustive, true);
  });
  test("an identifier's possessive loses its apostrophe so the row token matches", () => {
    assert.equal(normalizeSttQuestion("what's p3's notes"), "what's p3 notes");
    assert.equal(normalizeSttQuestion("INC-2601's owner"), 'inc-2601 owner');
    assert.equal(normalizeSttQuestion("the candidate's résumé and what's next"), "the candidate's résumé and what's next", 'ordinary nouns and contractions keep their apostrophes');
  });
});

describe('a screen-deictic question lends the screen text to retrieval (2026-09-11)', () => {
  const screen = 'Ravi 10:47 what is our instant refund limit again and who owns reconciliation escalations? You 10:48 checking';
  test('a pointer question gains the on-screen ask', () => {
    const q = screenEnrichedQuery('answer what he is asking from our spec', screen);
    assert.match(q, /^answer what he is asking from our spec /);
    assert.match(q, /instant refund limit/);
  });
  test('an empty question becomes the on-screen ask', () => {
    assert.match(screenEnrichedQuery('', screen), /instant refund limit/);
  });
  test('a long self-contained question is untouched', () => {
    const q = 'what does the northstar handbook say the target time to mitigate a sev two incident is';
    assert.equal(screenEnrichedQuery(q, screen), q);
  });
  test('no screen text leaves the query alone', () => {
    assert.equal(screenEnrichedQuery('what is it', undefined), 'what is it');
  });
  test('decide() plans the enriched query', () => {
    const d = decide({ requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId: 'technical-interview', scope: { userId: 'local' }, sessionId: 's',
      transcriptQuestion: 'answer what he is asking from our spec', hasScreenContext: true, hasAttachedDocuments: true, attachedFileNames: ['payments_spec_v2.json'], screenText: screen });
    assert.match(d.retrievalPlan.queries[0], /instant refund limit/);
    assert.equal(d.resolvedQuestion.includes('instant refund'), false, 'the question itself is unchanged');
  });
});

describe('a screenshot in a document-holding mode claims the document side too (2026-09-11)', () => {
  test('lecture + notes + exam on screen plans the reference files', () => {
    const r = classifyTurn({ resolvedQuestion: 'part b, what are the numbers', policy: MODE_POLICIES.lecture, isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: ['thermo_lecture_notes.txt'], hasScreenContext: true });
    assert.ok(r.questionTypes.includes('SCREEN_SPECIFIC'));
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), r.requiredSourceTypes.join('+'));
    assert.ok(r.requiredSourceTypes.includes('SCREEN_CONTEXT'), r.requiredSourceTypes.join('+'));
  });
  test('a screenshot with NO documents attached does not claim a document', () => {
    const r = classifyTurn({ resolvedQuestion: 'part b, what are the numbers', policy: MODE_POLICIES.lecture, isFollowUp: false, hasAttachedDocuments: false, hasScreenContext: true });
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
  });
});

describe('the current screen is the referent of a pointer question (2026-09-11)', () => {
  test('the notice appears only when a screen item is in the evidence', () => {
    assert.equal(screenReferentNotice('<evidence source_type="JOB_DESCRIPTION">x</evidence>'), '');
    const n = screenReferentNotice('<evidence source_type="SCREEN_CONTEXT">x</evidence>');
    assert.match(n, /RIGHT NOW/);
    assert.match(n, /screen item win/);
    assert.match(n, /from ALL the evidence/, "the screen names the subject; attached material still answers it");
  });
});

describe('job vocabulary in a document-holding mode claims the attached documents too (2026-09-11)', () => {
  const cls = (q, mode, files) => classifyTurn({ resolvedQuestion: normalizeSttQuestion(q), policy: MODE_POLICIES[mode], isFollowUp: false, hasAttachedDocuments: files.length > 0, attachedFileNames: files });
  test('"so the interview loop what is it" over an ops handbook plans the handbook as well as the JD', () => {
    const r = cls('so the interview loop what is it', 'technical-interview', ['northstar_ops_handbook.md']);
    assert.ok(r.questionTypes.includes('JOB_REQUIREMENT'), r.questionTypes.join('+'));
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), r.requiredSourceTypes.join('+'));
  });
  test('"remind me what was the salary talk" over attached prep notes plans the notes', () => {
    const r = cls('okay and then remind me what was the salary talk', 'looking-for-work', ['interview_prep_notes.txt']);
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), r.requiredSourceTypes.join('+'));
    assert.ok(r.requiredSourceTypes.includes('JOB_DESCRIPTION'), r.requiredSourceTypes.join('+'));
  });
  test('with nothing attached the JD claim stands alone', () => {
    const r = cls('so the interview loop what is it', 'technical-interview', []);
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), r.questionTypes.join('+'));
  });
});

describe('a short personal fragment in a profile mode is grounded, never improvised (2026-09-11)', () => {
  const ti = (q) => classifyTurn({ resolvedQuestion: normalizeSttQuestion(q), policy: MODE_POLICIES['technical-interview'], isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: [] });
  test('foreign-language discourse clauses do not count toward the fragment core', () => {
    assert.ok(fragmentCoreWordCount('arre bhai, ek min, the team size, kitne log the') <= 8);
    assert.equal(fragmentCoreWordCount('the team size, kitne log the'), 6);
  });
  test('"the team size, kitne log the" claims the résumé side and leaves the fast path', () => {
    const r = ti('arre bhai, ek min, um the team size, kitne log the');
    assert.notEqual(r.path, 'FAST', r.reason);
    assert.ok(r.claimTypes.includes('USER_EMPLOYMENT'), r.claimTypes.join('+'));
    assert.ok(r.requiredSourceTypes.includes('RESUME'), r.requiredSourceTypes.join('+'));
  });
  test('a concept question in the same mode keeps its general route', () => {
    const r = ti('what is a bloom filter');
    assert.ok(!r.claimTypes.includes('USER_EMPLOYMENT'), r.claimTypes.join('+'));
  });
});

describe('an absent fact about the user is disclosed, never improvised (2026-09-11)', () => {
  test('the no-evidence notice carries the personal-fact guard for a USER_* claim', async () => {
    const r = await buildV3Prompt({
      surface: 'what-to-answer', question: 'the team size, how many people were there',
      modeTemplateType: 'technical-interview', modeUniqueId: 'technical-interview',
      attachedSourceCount: 0, profileSourceCount: 1,
      retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    });
    assert.notEqual(r.decision?.retrievalPlan?.path, 'FAST');
    assert.match(r.user, /fact about the USER themselves/);
    assert.match(r.user, /not in any language/);
  });
  test('a document lookup with no personal claim does not carry it', async () => {
    const r = await buildV3Prompt({
      surface: 'what-to-answer', question: 'what does the handbook say the canary steps are',
      modeTemplateType: 'general', modeUniqueId: 'general',
      attachedSourceCount: 1, attachedFileNames: ['northstar_ops_handbook.md'],
      retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    });
    assert.doesNotMatch(r.user, /fact about the USER themselves/);
  });
});

describe('romanised Hindi personal cues are personal (2026-09-11)', () => {
  const ti = (q) => classifyTurn({ resolvedQuestion: normalizeSttQuestion(q), policy: MODE_POLICIES['technical-interview'], isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: [] });
  test('"toh aap ka current role kya hai" claims the user side and leaves the fast path', () => {
    const r = ti('toh aap ka current role kya hai, like abhi kya kar rahe ho');
    assert.notEqual(r.path, 'FAST', r.reason);
    assert.ok(r.claimTypes.some((c) => /^USER_/.test(c)), r.claimTypes.join('+'));
  });
  test('"main branch" is not a personal cue', () => {
    const r = ti('how do I rebase onto the main branch');
    assert.ok(!r.claimTypes.some((c) => /^USER_/.test(c)), r.claimTypes.join('+'));
  });
});

describe('a self-introduction request is personal (2026-09-11)', () => {
  const lfw = (q) => classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES['looking-for-work'], isFollowUp: false, hasAttachedDocuments: true, attachedFileNames: [] });
  test('"could you give us a quick self-introduction?" claims the user side and leaves the fast path', () => {
    const r = lfw('Great to meet you. To start, could you give us a quick self-introduction?');
    assert.notEqual(r.path, 'FAST', r.reason);
    assert.ok(r.claimTypes.some((c) => /^USER_/.test(c)), r.claimTypes.join('+'));
    assert.ok(r.requiredSourceTypes.includes('RESUME'), r.requiredSourceTypes.join('+'));
  });
});
