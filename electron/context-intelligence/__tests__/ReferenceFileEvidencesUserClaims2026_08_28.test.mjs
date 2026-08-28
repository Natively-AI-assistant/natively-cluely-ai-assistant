// T1 — a user's own reference file may evidence claims about their own work.
//
// THE MASTER CAUSE (docs/retrieval-handoff/01-ROOT-CAUSES.md RC1).
// `PERSONAL_RE` turns any second-person question into a USER_* claim, and
// REFERENCE_FILE was authoritative for NO USER_* claim. In an interview every
// question is second person, so an uploaded file describing the user's own
// projects was unreachable for every one of them, in all nine modes. Proved with
// perfect retrieval: a chunk literally containing the answer, at score 0.99,
// discarded by 9/9 modes with evidence=0 and answerability=NONE. No amount of
// better chunking, embedding or ranking can rescue a turn that never receives
// evidence.
//
// Measured before: 0 of 6 realistic interviewer phrasings reached the file in
// any mode. After: 6 of 6 in all nine. The three neutral document-shaped
// controls reached it before and still do.
//
// ── WHAT THIS SUITE IS REALLY GUARDING ───────────────────────────────────────
//
// Widening source authority is the single riskiest change in this subsystem —
// four documented incidents came from getting these lists wrong in EITHER
// direction. So most of what follows asserts what did NOT change:
//
//   • every `prohibited` list is byte-identical. The JD-as-experience
//     protection (a job description states what the EMPLOYER wants and can
//     never evidence what the USER has) lives there.
//   • USER_MOTIVATION is untouched. A document about what someone BUILT cannot
//     evidence why they want a job.
//   • with NO documents attached, reachability is byte-identical to before —
//     which is what keeps the "what are my strengths?" anti-fabrication guards
//     firing in a profile-less mode.
//   • no mode gains a source its own policy does not authorize.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const policy = await import(pathToFileURL(path.join(base, 'policies/source-authority-policy.js')).href);
const { CLAIM_AUTHORITY, claimAuthority, authorityOf, isProhibitedFor } = policy;
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES, MODE_IDS } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { sourceTypeForFile } = await import(pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);

const ENV = 'NATIVELY_RETRIEVAL_REFERENCE_FILES_EVIDENCE_USER_CLAIMS';
const withFlag = (value, fn) => {
  const original = process.env[ENV];
  process.env[ENV] = value;
  try { return fn(); } finally {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  }
};

const NAME = 'projects.md';
const BODY = '# Projects\n\n## Project: Orbit Bridge\n\n### Retries\nThe policy is 6 attempts, multiplier 2.5.\n';

const classify = (q, modeId, hasAttachedDocuments = true) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, hasAttachedDocuments });

/** The end-to-end admission predicate, mirroring the real filter order. */
function reaches(modeId, q) {
  const p = MODE_POLICIES[modeId];
  const stamped = sourceTypeForFile(NAME, BODY, p.allowedSourceTypes);
  const r = classify(q, modeId);
  if (!r.shouldRetrieve) return false;
  if (!r.requiredSourceTypes.includes(stamped)) return false;
  return authorityOf(stamped).some((c) => r.claimTypes.includes(c));
}

// How an interviewer actually speaks. Every one of these produced
// USER_EMPLOYMENT (one also USER_SKILL) and reached nothing.
const SECOND_PERSON = [
  'What is your retry policy on the ingest path?',
  'How did you handle idempotency on Orbit Bridge?',
  'Do you have a dead letter queue configured?',
  'Have you worked with exactly-once delivery?',
  'Tell me about your role on Orbit Bridge.',
  'What did you monitor after launch?',
];

const NEUTRAL_DOC = [
  'What is the retry backoff on the Orbit Bridge project?',
  'What is the idempotency key format for Orbit Bridge?',
  'How does Orbit Bridge handle failures?',
];

describe('T1 — second-person questions reach the reference file', () => {
  for (const q of SECOND_PERSON) {
    test(`reachable in every mode: ${q}`, () => {
      for (const modeId of MODE_IDS) {
        assert.equal(reaches(modeId, q), true, `${modeId}: "${q}" still cannot reach the file`);
      }
    });
  }

  test('NON-REGRESSION: neutral document-shaped questions still reach it', () => {
    for (const q of NEUTRAL_DOC) {
      for (const modeId of MODE_IDS) {
        assert.equal(reaches(modeId, q), true, `${modeId}: "${q}" regressed`);
      }
    }
  });

  test('the kill switch reproduces the defect exactly', () => {
    withFlag('0', () => {
      for (const q of SECOND_PERSON) {
        for (const modeId of MODE_IDS) {
          assert.equal(reaches(modeId, q), false,
            `${modeId}: flag OFF must reproduce the pre-fix unreachability for "${q}"`);
        }
      }
      // ...and must not disturb the questions that always worked.
      for (const q of NEUTRAL_DOC) {
        assert.equal(reaches('general', q), true, `flag OFF changed a neutral row: "${q}"`);
      }
    });
  });
});

describe('T1 — technical-interview is covered by the PROJECT_FILE half', () => {
  // TI authorizes no REFERENCE_FILE, so `sourceTypeForFile` falls through to
  // PROJECT_FILE. Widening only REFERENCE_FILE would have left the mode the
  // report was actually about unfixed — which is why PROJECT_FILE and
  // CODING_SAMPLE are widened alongside it.
  test('a .md in technical-interview is stamped PROJECT_FILE and is admissible', () => {
    const p = MODE_POLICIES['technical-interview'];
    assert.equal(sourceTypeForFile(NAME, BODY, p.allowedSourceTypes), 'PROJECT_FILE');
    assert.equal(reaches('technical-interview', SECOND_PERSON[0]), true);
  });
});

describe('T1 — what did NOT change', () => {
  test('every prohibited list is byte-identical, flag on or off', () => {
    for (const claim of Object.keys(CLAIM_AUTHORITY)) {
      const on = withFlag('1', () => claimAuthority(claim).prohibited);
      const off = withFlag('0', () => claimAuthority(claim).prohibited);
      assert.deepEqual(on, CLAIM_AUTHORITY[claim].prohibited, `${claim}: prohibited widened`);
      assert.deepEqual(on, off, `${claim}: prohibited differs by flag`);
    }
  });

  test('a job description still cannot evidence any USER_* claim', () => {
    // The JD-as-experience protection. This is the hole the fix plan names as
    // non-negotiable.
    for (const claim of ['USER_EMPLOYMENT', 'USER_SKILL', 'USER_EDUCATION', 'USER_PROJECT']) {
      assert.equal(isProhibitedFor('JOB_DESCRIPTION', claim), true, `${claim}`);
      assert.equal(claimAuthority(claim).authoritative.includes('JOB_DESCRIPTION'), false, `${claim}`);
    }
  });

  test('USER_MOTIVATION is untouched', () => {
    // A document about what someone BUILT cannot evidence why they want a job.
    assert.deepEqual(claimAuthority('USER_MOTIVATION'), CLAIM_AUTHORITY.USER_MOTIVATION);
    for (const s of ['REFERENCE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE']) {
      assert.equal(claimAuthority('USER_MOTIVATION').authoritative.includes(s), false, s);
    }
    // The résumé prohibition on motivation also stands.
    assert.equal(isProhibitedFor('RESUME', 'USER_MOTIVATION'), true);
  });

  test('USER_PROJECT is deliberately NOT widened', () => {
    // It already admits PROJECT_FILE and CODING_SAMPLE, and no measured
    // interview phrasing routes to it — widening it would add reach with no
    // defect to show for it. Pinned so a future change is visible, not silent.
    assert.deepEqual(claimAuthority('USER_PROJECT'), CLAIM_AUTHORITY.USER_PROJECT);
  });

  test('only the three named claims are widened at all', () => {
    const widened = Object.keys(CLAIM_AUTHORITY).filter((c) =>
      claimAuthority(c).authoritative.length > CLAIM_AUTHORITY[c].authoritative.length);
    assert.deepEqual(widened.sort(), ['USER_EDUCATION', 'USER_EMPLOYMENT', 'USER_SKILL']);
  });

  test('no mode gains a source its own policy does not authorize', () => {
    // Authority is necessary, never sufficient — the mode allowlist still gates.
    for (const modeId of MODE_IDS) {
      const allowed = new Set(MODE_POLICIES[modeId].allowedSourceTypes);
      for (const q of SECOND_PERSON) {
        for (const s of classify(q, modeId).requiredSourceTypes) {
          assert.ok(allowed.has(s), `${modeId}: planned ${s}, which the mode does not authorize`);
        }
      }
    }
  });
});

describe('T1 — anti-fabrication: no documents means no widening', () => {
  // The guard that "what are my strengths?" in a profile-less mode still
  // discloses rather than invents. Reachability is what licenses the composer's
  // "not established by any available source" instruction, so with nothing
  // attached the classifier must behave exactly as it did before T1.
  const SELF_FACTS = ['What are my strengths?', 'Tell me about your role on Orbit Bridge.'];

  for (const q of SELF_FACTS) {
    test(`unchanged with no attached documents: ${q}`, () => {
      for (const modeId of MODE_IDS) {
        const on = classify(q, modeId, false);
        const off = withFlag('0', () => classify(q, modeId, false));
        assert.deepEqual(on.requiredSourceTypes, off.requiredSourceTypes, `${modeId}: plan changed`);
        assert.deepEqual(on.unsupportedInMode, off.unsupportedInMode, `${modeId}: reachability changed`);
        assert.equal(on.shouldRetrieve, off.shouldRetrieve, `${modeId}: retrieval decision changed`);
      }
    });
  }

  test('a profile-less general-mode self-fact question still reports the gap', () => {
    const r = classify('What are my strengths?', 'general', false);
    assert.ok(r.unsupportedInMode.length > 0,
      'no-profile self facts must stay unsupported so they are disclosed, not invented');
  });
});
