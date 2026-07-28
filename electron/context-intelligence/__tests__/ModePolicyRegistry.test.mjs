// Context Intelligence V3 — mode policy registry.
//
// These encode the defects the registry exists to make impossible:
//   F6  `seminar` missing from six independent mode lists
//   F8  unvalidated templateType producing a mode with no system prompt
//   §4  mode policy failing open to "mode-blind" behaviour

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const {
  MODE_POLICIES, MODE_IDS, resolveModePolicy, isModeId,
  modeAllowsSource, generalKnowledgeAllowed, UnknownModeError,
} = await import(pathToFileURL(path.resolve(
  process.cwd(), 'dist-electron/electron/context-intelligence/policies/mode-policy-registry.js')).href);

describe('registry completeness', () => {
  test('contains exactly the EIGHT built-in modes — including seminar', () => {
    assert.equal(MODE_IDS.length, 8);
    assert.ok(MODE_IDS.includes('seminar'), 'seminar is the 8th built-in and was missing from six legacy lists');
    assert.ok(MODE_IDS.includes('general'), 'general is the auto-seeded mode omitted from every hand-written list of six');
  });

  test('every mode id has a policy — no mode can exist without one', () => {
    for (const id of MODE_IDS) {
      const p = MODE_POLICIES[id];
      assert.ok(p, `${id} has no policy`);
      assert.equal(p.id, id, `${id} policy has mismatched id`);
      assert.ok(p.version, `${id} missing version (needed for trace attribution)`);
      assert.ok(p.allowedSourceTypes.length > 0, `${id} authorizes no sources`);
      assert.ok(p.capabilityPolicy, `${id} missing capability policy`);
      assert.equal(p.retrievalPolicy.maximumAttempts, 2, `${id} must cap retrieval attempts at 2`);
    }
  });

  test('modes the brief names but which do not exist are NOT invented', () => {
    for (const absent of ['thesis', 'coding-interview', 'meeting', 'presentation', 'interview']) {
      assert.equal(isModeId(absent), false, `${absent} is not a mode in this codebase`);
    }
  });
});

describe('fail-closed resolution (F8)', () => {
  test('an unknown mode id THROWS rather than yielding an empty policy', () => {
    assert.throws(() => resolveModePolicy('not-a-mode'), UnknownModeError);
    assert.throws(() => resolveModePolicy(''), UnknownModeError);
    assert.throws(() => resolveModePolicy('GENERAL'), UnknownModeError, 'case-sensitive');
  });

  test('a known mode resolves to its policy', () => {
    assert.equal(resolveModePolicy('seminar').name, 'Seminar');
    assert.equal(resolveModePolicy('technical-interview').groundingPolicy, 'SOURCE_FIRST');
  });
});

describe('source authorization per mode', () => {
  test('looking-for-work ranks RESUME above JOB_DESCRIPTION', () => {
    const p = MODE_POLICIES['looking-for-work'];
    assert.ok(p.sourcePriorities.RESUME < p.sourcePriorities.JOB_DESCRIPTION,
      'the JD may shape emphasis, never outrank the resume as a source of user fact');
  });

  test('recruiting uses CANDIDATE_FILE, never the user\'s own RESUME', () => {
    const p = MODE_POLICIES.recruiting;
    assert.ok(modeAllowsSource(p, 'CANDIDATE_FILE'));
    assert.equal(modeAllowsSource(p, 'RESUME'), false,
      'the Natively user\'s resume must not be confused with a candidate\'s');
  });

  test('technical-interview authorizes coding samples and screen context', () => {
    const p = MODE_POLICIES['technical-interview'];
    assert.ok(modeAllowsSource(p, 'CODING_SAMPLE'));
    assert.ok(modeAllowsSource(p, 'SCREEN_CONTEXT'));
  });

  test('no mode authorizes a source it has no priority story for', () => {
    for (const id of MODE_IDS) {
      const p = MODE_POLICIES[id];
      for (const s of Object.keys(p.sourcePriorities)) {
        assert.ok(p.allowedSourceTypes.includes(s), `${id} prioritises ${s} without authorizing it`);
      }
    }
  });
});

describe('seminar — strict but never refusing', () => {
  const seminar = MODE_POLICIES.seminar;

  test('permits derivation from the document (explain, summarize, pseudocode, code)', () => {
    const c = seminar.capabilityPolicy;
    assert.ok(c.explainSourceContent && c.summarize && c.generatePseudocode && c.generateCode,
      'strict grounding must not block valid transformations');
  });

  test('blocks unrelated recommendation and speculation', () => {
    const c = seminar.capabilityPolicy;
    assert.equal(c.makeRecommendations, false);
    assert.equal(c.brainstorm, false);
    assert.equal(c.hypotheticalExamples, false);
  });

  test('always discloses external suggestions and shows citations', () => {
    assert.equal(seminar.capabilityPolicy.externalSuggestionDisclosure, 'ALWAYS');
    assert.equal(seminar.citations, 'VISIBLE');
  });

  test('still permits general knowledge — labels rather than refuses', () => {
    assert.equal(generalKnowledgeAllowed(seminar), true,
      'over-refusal is explicitly forbidden; the contract is to answer general-labeled');
  });
});

describe('claim evidence requirements', () => {
  test('EVERY mode requires evidence for personal, document, meeting and job claims', () => {
    for (const id of MODE_IDS) {
      const p = MODE_POLICIES[id];
      assert.equal(p.personalClaimsRequireEvidence, true, `${id}`);
      assert.equal(p.documentClaimsRequireEvidence, true, `${id}`);
      assert.equal(p.meetingClaimsRequireEvidence, true, `${id}`);
      assert.equal(p.jobClaimsRequireJdEvidence, true, `${id}`);
    }
  });

  test('open-knowledge modes still require evidence for factual claims', () => {
    const p = MODE_POLICIES['team-meet'];
    assert.equal(p.groundingPolicy, 'OPEN_KNOWLEDGE');
    assert.equal(p.meetingClaimsRequireEvidence, true,
      'open knowledge governs FALLBACK, not whether meeting facts need evidence');
  });
});
