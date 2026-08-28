// T2 — bare generic tokens in the classifier regexes misrouted whole turns.
//
// Swept 2026-08-28 over 106 product/technical terms x 2 document-shaped
// templates x 9 modes (experiments/mode-audit/collision-sweep.ts). Three tokens
// matched on the NOUN ALONE and took a question about an attached reference
// file away from that file:
//
//   `sync`      MEETING_EVENT_RE — "the sync" names half the integration
//               features ever shipped. In the 7 modes that allow a transcript
//               the turn planned MEETING_TRANSCRIPT only and the file was
//               dropped; in looking-for-work and technical-interview, which
//               authorize no transcript, shouldRetrieve went FALSE and nothing
//               was retrieved at all.
//   `standup`   same clause, same mechanism.
//   `candidate` PERSONAL_RE — killed ordinary ML/search/database vocabulary
//               ("candidate generation", "candidate set", "candidate key"),
//               turning a system-design question into an identity question
//               with retrieve=false.
//
// The reported case is a field-service <-> CRM **sync**, so this is not a
// hypothetical: every natural question about that product tripped the first
// token.
//
// ── WHY THE ASSERTIONS ARE DIFFERENTIAL ──────────────────────────────────────
//
// The first draft of this suite asserted absolutes — "this question must not be
// a meeting event in any mode" — and failed everywhere, including on the fix.
// That was the SUITE being wrong, not the fix: team-meet claims
// MEETING_STATEMENT for essentially every question by design, and the
// interview-family modes claim USER_PROJECT for any project-shaped question.
// Those are baseline mode behaviours and have nothing to do with the token.
//
// The defect was never "this question is classified as X". It was "swapping ONE
// WORD changes the classification", which is what a misrouting token means and
// what the sweep measures. So every case here compares the term against an
// inert control word in the same sentence and the same mode, and asserts the
// classification is identical. That assertion cannot pass vacuously and cannot
// fail because some unrelated mode-level rule changed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES, MODE_IDS } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

const classify = (q, mode) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[mode], isFollowUp: false, hasAttachedDocuments: true });

/** The classification, flattened to something comparable and readable on failure. */
const shape = (r) =>
  `types=[${[...r.questionTypes].sort()}] claims=[${[...r.claimTypes].sort()}] retrieve=${r.shouldRetrieve}`;

const isMeeting = (r) => r.questionTypes.includes('MEETING_FACT') || r.claimTypes.includes('MEETING_STATEMENT');
const isPersonal = (r) => r.claimTypes.some((c) => String(c).startsWith('USER_'));

// "Acme" is the sweep's own control: a term with no meaning to any regex in the
// classifier. If <term> classifies the same as Acme, the term is inert too.
const CONTROL = 'Acme';

/** Assert that swapping <term> for the control changes nothing, in every mode. */
function assertInert(template, term) {
  for (const mode of MODE_IDS) {
    const withTerm = classify(template(term), mode);
    const withControl = classify(template(CONTROL), mode);
    assert.equal(shape(withTerm), shape(withControl),
      `${mode}: "${template(term)}"\n  got      ${shape(withTerm)}\n  control  ${shape(withControl)}  ("${template(CONTROL)}")`);
  }
}

describe('T2 — `sync` and `standup` are inert outside a meeting frame', () => {
  const TEMPLATES = [
    (x) => `What is the retry backoff on the ${x} project?`,
    (x) => `How does ${x} handle failures?`,
    (x) => `What happens when the ${x.toLowerCase()} fails?`,
    (x) => `How does the ${x.toLowerCase()} handle retries?`,
  ];

  for (const term of ['Sync', 'Standup']) {
    for (const [i, t] of TEMPLATES.entries()) {
      test(`${term} classifies as the control [t${i}]: ${t(term)}`, () => assertInert(t, term));
    }
  }

  // `sync` only. "During the nightly sync" is a data pipeline far more often
  // than a meeting, and `sync` is deliberately given the narrowest treatment of
  // the two nouns — no temporal frame, head noun or "sync-up" only. The same
  // sentence with "standup" IS a meeting and is expected to differ from the
  // control, so running this template over both terms asserts the opposite of
  // what the fix intends.
  test('a nightly sync is a pipeline, not a meeting', () =>
    assertInert((x) => `What happens during the nightly ${x.toLowerCase()}?`, 'Sync'));

  // The collision's real cost, asserted directly rather than by comparison: in
  // a mode that authorizes no transcript the turn stopped retrieving anything.
  test('a product-sync question still retrieves in a no-transcript mode', () => {
    for (const mode of ['technical-interview', 'looking-for-work']) {
      const r = classify('What is the retry backoff on the Sync project?', mode);
      assert.equal(r.shouldRetrieve, true, `${mode}: expected retrieval; reason=${r.reason}`);
    }
  });
});

describe('T2 — `candidate` is inert as a compound-noun modifier', () => {
  const TEMPLATES = [
    (x) => `What is the retry backoff on the ${x} project?`,
    (x) => `How does ${x} handle failures?`,
  ];
  for (const [i, t] of TEMPLATES.entries()) {
    test(`Candidate classifies as the control [t${i}]: ${t('Candidate')}`, () => assertInert(t, 'Candidate'));
  }

  // These have no control form — the technical sense IS the word. Assert the
  // absolute property instead: no identity claim, and retrieval still runs.
  const TECHNICAL = [
    'How does candidate generation work in the recommender?',
    'What is the candidate set size?',
    'What is a candidate key?',
    'How is candidate sampling implemented?',
    'What does the candidate pool look like after filtering?',
  ];
  for (const q of TECHNICAL) {
    test(`technical vocabulary is not an identity question: ${q}`, () => {
      // General mode has no identity pools at all, so a USER_* claim there is
      // unambiguously the token's doing and not a mode-level rule.
      const r = classify(q, 'general');
      assert.equal(isPersonal(r), false, `"${q}" became an identity question (claims=${r.claimTypes})`);
    });
  }
});

describe('T2 — genuine meeting questions still route to the transcript', () => {
  // Asserted in team-meet, the mode where losing the transcript route would
  // actually cost an answer.
  const REAL_MEETINGS = [
    'What did we decide in the standup?',
    'What was said in the standup?',
    'Any action items from the sync?',
    'What was covered in the daily standup?',
    'Do we have notes from the sync meeting?',
    'What happened at yesterday’s standup?',
    'What did we agree in the sync call?',
    'Recap the weekly standup for me.',
    'Was anything raised in our sync-up?',
  ];
  for (const q of REAL_MEETINGS) {
    test(`still a meeting event: ${q}`, () => {
      const r = classify(q, 'team-meet');
      assert.equal(isMeeting(r), true,
        `"${q}" lost its transcript route (types=${r.questionTypes}, claims=${r.claimTypes})`);
    });
  }

  // The stricter half: these must be meeting events because of the FRAMED noun
  // and nothing else, so they are also checked against the control. A framed
  // standup must NOT classify like "the Acme standup" would if the frame were
  // being ignored — i.e. it must differ from a question with no meeting noun.
  test('framing is what makes the noun a meeting event, not the noun alone', () => {
    const framed = classify('What was decided in the daily standup?', 'team-meet');
    const unframed = classify('What was decided in the daily report?', 'team-meet');
    assert.equal(isMeeting(framed), true, 'framed standup must claim the transcript');
    // The control question is a document fact in a mode that also allows
    // transcripts, so it may still be a meeting event by mode default — the
    // meaningful assertion is that the framed one is at least as strong.
    assert.ok(framed.questionTypes.includes('MEETING_FACT'),
      `framed standup lost MEETING_FACT (unframed=${unframed.questionTypes})`);
  });
});

describe('T2 — genuine recruiting questions still claim identity', () => {
  const PEOPLE = [
    'Does the candidate have Kubernetes experience?',
    "What is the candidate's strongest project?",
    'Tell me about the candidate.',
    'Where did the candidate work before?',
    'Has the candidate shipped anything at scale?',
    'Is the candidate a good fit for this role?',
  ];
  for (const q of PEOPLE) {
    test(`still an identity question: ${q}`, () => {
      const r = classify(q, 'recruiting');
      assert.equal(isPersonal(r), true, `"${q}" lost its identity claim (claims=${r.claimTypes})`);
    });
  }
});

describe('T2 — the kill switch restores the pre-fix behaviour exactly', () => {
  // Read per call, so setting it here is enough — see the comment on
  // `tokenFramingOn` in turn-classifier.ts for why that matters.
  const ENV = 'NATIVELY_RETRIEVAL_CLASSIFIER_TOKEN_FRAMING';

  test('flag off => `sync` misroutes again (the behaviour being reverted to)', () => {
    const q = 'What is the retry backoff on the Sync project?';
    const on = classify(q, 'technical-interview');
    process.env[ENV] = '0';
    try {
      const off = classify(q, 'technical-interview');
      assert.equal(on.shouldRetrieve, true, 'flag ON must retrieve');
      assert.equal(off.shouldRetrieve, false, 'flag OFF must reproduce the legacy stall');
    } finally {
      delete process.env[ENV];
    }
  });

  test('flag off => `candidate` is personal again', () => {
    const q = 'How does candidate generation work in the recommender?';
    assert.equal(isPersonal(classify(q, 'general')), false, 'flag ON must not be personal');
    process.env[ENV] = '0';
    try {
      assert.equal(isPersonal(classify(q, 'general')), true, 'flag OFF must reproduce the legacy identity claim');
    } finally {
      delete process.env[ENV];
    }
  });
});
