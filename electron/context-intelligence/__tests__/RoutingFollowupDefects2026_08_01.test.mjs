// Context Intelligence V3 — regression tests for the 2026-08-01 defect set.
//
// Defect A: Team Meet routed reference-stated facts (objective, agenda, success
//           criteria) to MEETING_TRANSCRIPT and never planned the attached brief.
// Defect C: default Team Meet/Lecture classified as strict document-grounded
//           custom modes via the template-seeded source contract.
// Defect D: follow-up referents lost — detection and resolution used disjoint
//           gates, lowercase topics were never extracted, the CLARIFICATION
//           verdict never reached the prompt.
// Defect E: "What is the interview process?" took the FAST path and a six-stage
//           JD lost to a generic model answer with a clean trace.
// Defect F: USER_MOTIVATION was unreachable in Recruiting — the candidate
//           résumé was never queried and the answer claimed none existed.
//
// Every test here fails on the pre-fix classifier/resolver (mutation-verified
// per file — see the session report).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { advance, resolveReference, extractTopicPhrase, emptyState } =
  await import(pathToFileURL(path.join(base, 'question/conversation-state.js')).href);
const { composePrompt } = await import(pathToFileURL(path.join(base, 'generation/prompt-composer.js')).href);
const { CLAIM_AUTHORITY } = await import(pathToFileURL(path.join(base, 'policies/source-authority-policy.js')).href);
const svc = path.resolve(process.cwd(), 'dist-electron/electron/services');
const { strictDocumentGroundedFromContract, documentGroundedFromContract, defaultSourceContractForNewMode } =
  await import(pathToFileURL(path.join(svc, 'modeSourceContract.js')).href);

const classify = (q, modeId, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, ...over });

// ── Defect A — Team Meet: reference facts vs transcript events ──────────────

describe('Defect A: reference-stated meeting facts route to the reference file', () => {
  for (const q of [
    'What is the objective of this meeting?',
    'What are we planning to review?',
    'What are the current success criteria?',
  ]) {
    test(`team-meet: "${q}" plans REFERENCE_FILE, not the transcript`, () => {
      const r = classify(q, 'team-meet');
      assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'),
        `expected REFERENCE_FILE in ${JSON.stringify(r.requiredSourceTypes)} (${r.reason})`);
      assert.ok(!r.requiredSourceTypes.includes('MEETING_TRANSCRIPT'),
        `transcript must not be planned for a reference fact: ${JSON.stringify(r.requiredSourceTypes)}`);
      assert.equal(r.path, 'GROUNDED');
      assert.equal(r.shouldRetrieve, true);
    });
  }

  test('team-meet: "success criteria" must not silently take the FAST path', () => {
    // Pre-fix this question was WORSE than the report said: no meeting cue at
    // all, so it fabricated with answerability FULL and zero evidence.
    const r = classify('What are the current success criteria?', 'team-meet');
    assert.notEqual(r.path, 'FAST');
  });
});

describe('Defect A: transcript events stay transcript-only', () => {
  for (const q of [
    'What did we decide?',
    'What are the action items?',
    'Who owns the source-contract patch?',
    'Summarise the discussion so far.',
  ]) {
    test(`team-meet: "${q}" plans MEETING_TRANSCRIPT only`, () => {
      const r = classify(q, 'team-meet');
      assert.deepEqual(r.requiredSourceTypes, ['MEETING_TRANSCRIPT'],
        `${JSON.stringify(r.requiredSourceTypes)} (${r.reason})`);
    });
  }
});

describe('Defect A: mixed and assistance shapes', () => {
  test('team-meet: "Is it decided whether Lecture can use general knowledge?" claims BOTH sides', () => {
    const r = classify('Is it decided whether Lecture can use general knowledge?', 'team-meet');
    assert.ok(r.requiredSourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(r.requiredSourceTypes));
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
  });

  test('team-meet: facilitator advice reaches the brief, not the transcript alone', () => {
    const r = classify('What should the facilitator ask first?', 'team-meet');
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
    assert.equal(r.shouldRetrieve, true);
  });

  test('team-meet: unclassified factual questions plan the reference alongside the transcript', () => {
    const r = classify('What caused the checkout latency regression?', 'team-meet');
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
    assert.ok(r.requiredSourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(r.requiredSourceTypes));
  });

  test('lecture: "What does this handout say about quantum computing?" is a document claim', () => {
    const r = classify('What does this handout say about quantum computing?', 'lecture');
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
  });

  test('concept questions keep the fast path in OPEN_KNOWLEDGE modes', () => {
    for (const q of ['What is a mutex?', 'What is the goal of dependency injection?']) {
      const r = classify(q, 'team-meet');
      assert.equal(r.path, 'FAST', `"${q}" → ${r.path} (${r.reason})`);
    }
  });
});

// ── Defect C — explicit strictness only ─────────────────────────────────────

describe('Defect C: default modes are never strict document-grounded', () => {
  for (const tpl of ['team-meet', 'lecture', 'sales', 'recruiting', 'seminar', 'general']) {
    test(`default ${tpl} seed is not strict — with or without attached files`, () => {
      const contract = defaultSourceContractForNewMode(tpl);
      assert.equal(strictDocumentGroundedFromContract(contract, false), false);
      // Attaching a file must not change the policy (spec hard requirement).
      assert.equal(strictDocumentGroundedFromContract(contract, true), false);
    });
  }

  test('explicit reference_files_only IS strict', () => {
    const contract = { ...defaultSourceContractForNewMode('general'), sourceAuthority: 'reference_files_only', origin: 'user_selected' };
    assert.equal(strictDocumentGroundedFromContract(contract, false), true);
    assert.equal(strictDocumentGroundedFromContract(contract, true), true);
  });

  test('user-selected reference-first is strict only WITH files', () => {
    const contract = { ...defaultSourceContractForNewMode('general'), sourceAuthority: 'reference_files_primary', origin: 'user_selected' };
    assert.equal(strictDocumentGroundedFromContract(contract, true), true);
    assert.equal(strictDocumentGroundedFromContract(contract, false), false);
  });

  test('prompt-migrated document mode with files is strict', () => {
    const contract = { ...defaultSourceContractForNewMode('general'), sourceAuthority: 'reference_files_plus_transcript', origin: 'migrated_from_prompt' };
    assert.equal(strictDocumentGroundedFromContract(contract, true), true);
  });

  test('the broad isolation flag is UNCHANGED (2026-07-15 fix preserved)', () => {
    const contract = defaultSourceContractForNewMode('team-meet');
    // Isolation semantics: default doc-authority mode with files still counts
    // as document-grounded for Hindsight/OKF/profile suppression.
    assert.equal(documentGroundedFromContract(contract, true), true);
    assert.equal(documentGroundedFromContract(contract, false), false);
  });

  test('knowledge policies stay template-declared: team-meet OPEN, lecture SOURCE_FIRST', () => {
    assert.equal(MODE_POLICIES['team-meet'].groundingPolicy, 'OPEN_KNOWLEDGE');
    assert.equal(MODE_POLICIES['lecture'].groundingPolicy, 'SOURCE_FIRST');
  });
});

// ── Defect D — follow-up referent resolution ────────────────────────────────

describe('Defect D: lowercase topics are extracted', () => {
  test('about-complement', () => {
    assert.equal(extractTopicPhrase('What does this lecture say about quantum computing?'), 'quantum computing');
  });
  test('definiendum', () => {
    assert.equal(extractTopicPhrase('What is a mutex?'), 'mutex');
  });
  test('no topic → undefined, never a guess', () => {
    assert.equal(extractTopicPhrase('Why not?'), undefined);
  });
});

describe('Defect D: the reported follow-ups resolve', () => {
  const scope = { userId: 'local', sessionId: 's1' };

  test('"What should I say?" inherits the user-count exchange', () => {
    const st = advance(null, { scope, question: 'How many users does Natively have?', answerSummary: '16,000+ users.' });
    const r = resolveReference('What should I say?', st);
    assert.equal(r.usedState, true);
    assert.ok(r.resolved.includes('How many users does Natively have?'), r.resolved);
  });

  test('"Can you explain it generally instead?" resolves it → quantum computing', () => {
    const st = advance(null, { scope, question: 'What does this lecture say about quantum computing?' });
    const r = resolveReference('Can you explain it generally instead?', st);
    assert.equal(r.usedState, true);
    assert.ok(r.resolved.toLowerCase().includes('quantum computing'), r.resolved);
  });

  test('"Why not?" anchors to the mutex question', () => {
    const st = advance(null, { scope, question: 'What is a mutex?' });
    const r = resolveReference('Why not?', st);
    assert.equal(r.usedState, true);
    assert.ok(r.resolved.toLowerCase().includes('mutex'), r.resolved);
  });

  test('no prior state → question passes through untouched', () => {
    const r = resolveReference('Why not?', null);
    assert.equal(r.usedState, false);
    assert.equal(r.resolved, 'Why not?');
    const empty = emptyState(scope);
    const r2 = resolveReference('Why not?', empty);
    assert.equal(r2.usedState, false);
  });

  test('scope change resets the referent (mode/meeting switch cannot inherit)', () => {
    const st = advance(null, { scope, question: 'What is a mutex?' });
    const other = advance(st, { scope: { userId: 'local', sessionId: 's2' }, question: 'Hello there' });
    assert.equal(other.activeTopic === 'mutex', false);
  });
});

describe('Defect D: the fallback verdict reaches the prompt', () => {
  const decision = (over = {}) => ({
    requestId: 'r1', requestSequence: 1,
    rawQuestion: 'Why not?', resolvedQuestion: 'Why not?',
    modeId: 'lecture', modePolicyVersion: '1.0.0',
    scope: { userId: 'local', sessionId: 's1' },
    questionTypes: ['FOLLOW_UP'], claimRequirements: [],
    requiredSourceTypes: [], unsupportedInMode: [],
    groundingPolicy: 'SOURCE_FIRST',
    personalClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    documentClaimsRequireEvidence: true, meetingClaimsRequireEvidence: true,
    generalKnowledgeAllowed: true, isFollowUp: true,
    retrievalPlan: { path: 'GROUNDED', shouldRetrieve: true, sourceTypes: ['REFERENCE_FILE'], queries: ['Why not?'], maximumAttempts: 1, maximumAcceptedEvidence: 6 },
    ...over,
  });

  test('CLARIFICATION renders an explicit follow-up instruction', () => {
    const composed = composePrompt({
      decision: decision(), policy: MODE_POLICIES['lecture'], evidence: [],
      fallbackUsed: 'CLARIFICATION',
    });
    assert.ok(composed.system.includes('# Follow-up'), composed.system);
    assert.ok(/clarifying question/i.test(composed.system));
  });

  test('a strict-mode follow-up gets the policy explanation, not a second bare refusal', () => {
    const composed = composePrompt({
      decision: decision({ groundingPolicy: 'STRICT_SOURCE_ONLY' }),
      policy: { ...MODE_POLICIES['lecture'], groundingPolicy: 'STRICT_SOURCE_ONLY' },
      evidence: [],
      conversationSummary: 'Previous question: What is a mutex?\nPrevious answer (referent only, NOT evidence): Not covered.',
      fallbackUsed: 'STRICT_NOT_FOUND',
    });
    assert.ok(composed.system.includes('# Follow-up'), composed.system);
    assert.ok(/answers only from the attached reference material/.test(composed.system));
  });

  test('a plain grounded turn renders no follow-up section', () => {
    const composed = composePrompt({
      decision: decision({ isFollowUp: false, questionTypes: ['DOCUMENT_FACT'] }),
      policy: MODE_POLICIES['lecture'], evidence: [], fallbackUsed: 'NONE',
    });
    assert.ok(!composed.system.includes('# Follow-up'), composed.system);
  });
});

// ── Defect E — direct document facts beat generic answers ───────────────────

describe('Defect E: process/stage lookups do not FAST-path past a document', () => {
  test('recruiting: "What is the interview process?" plans the JD', () => {
    const r = classify('What is the interview process?', 'recruiting');
    assert.ok(r.requiredSourceTypes.includes('JOB_DESCRIPTION'),
      `${JSON.stringify(r.requiredSourceTypes)} (${r.reason})`);
    assert.equal(r.path, 'GROUNDED');
    assert.equal(r.shouldRetrieve, true);
  });

  test('lecture: "What is the deployment process?" is a document lookup', () => {
    const r = classify('What is the deployment process?', 'lecture');
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'),
      `${JSON.stringify(r.requiredSourceTypes)} (${r.reason})`);
    assert.notEqual(r.path, 'FAST');
  });

  test('general mode keeps the fast path for the same grammar', () => {
    const r = classify('What is the deployment process?', 'general');
    assert.equal(r.path, 'FAST', r.reason);
  });

  test('true concept questions are untouched everywhere', () => {
    for (const modeId of ['lecture', 'recruiting', 'technical-interview']) {
      const r = classify('What is a bloom filter?', modeId);
      assert.equal(r.shouldRetrieve && r.requiredSourceTypes.length > 0, false,
        `"What is a bloom filter?" must not demand a private source in ${modeId}`);
    }
  });
});

// ── Defect F — candidate motivation is reachable in Recruiting ──────────────

describe('Defect F: USER_MOTIVATION reaches the candidate file', () => {
  for (const q of [
    'Why did the candidate leave her last role?',
    'What led the candidate to switch to backend work?',
  ]) {
    test(`recruiting: "${q}" retrieves the candidate file`, () => {
      const r = classify(q, 'recruiting');
      assert.ok(r.claimTypes.includes('USER_MOTIVATION'), JSON.stringify(r.claimTypes));
      assert.ok(r.requiredSourceTypes.includes('CANDIDATE_FILE'),
        `${JSON.stringify(r.requiredSourceTypes)} (${r.reason})`);
      assert.equal(r.shouldRetrieve, true,
        'pre-fix this was GROUNDED/shouldRetrieve=false — the résumé was never queried');
    });
  }

  test('claim authority matches the planner (two-map consistency)', () => {
    assert.ok(CLAIM_AUTHORITY.USER_MOTIVATION.authoritative.includes('CANDIDATE_FILE'));
    // The operator's own résumé stays prohibited: facts are not motives.
    assert.ok(CLAIM_AUTHORITY.USER_MOTIVATION.prohibited.includes('RESUME'));
    assert.ok(CLAIM_AUTHORITY.USER_MOTIVATION.prohibited.includes('JOB_DESCRIPTION'));
  });

  test('looking-for-work motivation routing is unchanged (no CANDIDATE_FILE there)', () => {
    const r = classify('Why did I build the PriceX project?', 'looking-for-work');
    assert.ok(!r.requiredSourceTypes.includes('CANDIDATE_FILE'), JSON.stringify(r.requiredSourceTypes));
  });
});
