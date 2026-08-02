// Context Intelligence V3 — the single user-facing grounding control (§6).
//
// The point of these tests is that the control CANNOT grow back into a Knowledge
// Source selector: it exposes two fallback options, it cannot authorize a
// source, and it cannot leak internal retrieval vocabulary.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const {
  resolveAnswerPolicy, groundingFor, shouldOfferAnswerPolicyControl,
  ANSWER_POLICY_LABELS, FORBIDDEN_UI_TERMS,
} = await import(pathToFileURL(path.join(base, 'policies/answer-policy.js')).href);
const { MODE_IDS, MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

describe('exactly two user-facing options', () => {
  test('the control offers two choices and no more', () => {
    assert.deepEqual(Object.keys(ANSWER_POLICY_LABELS).sort(),
      ['only_answer_from_references', 'use_references_when_relevant']);
  });

  test('neither label exposes internal architecture', () => {
    for (const label of Object.values(ANSWER_POLICY_LABELS)) {
      for (const term of FORBIDDEN_UI_TERMS) {
        assert.ok(!label.toLowerCase().includes(term),
          `label "${label}" leaks internal term "${term}"`);
      }
    }
  });

  test('internal grounding states are NOT reachable from the control', () => {
    // OPEN_KNOWLEDGE is a mode default; ASK_BEFORE_FALLBACK is unsuitable for a
    // live meeting. Surfacing either would put architecture back in the UI.
    const reachable = new Set(Object.keys(ANSWER_POLICY_LABELS).map(groundingFor));
    assert.deepEqual([...reachable].sort(), ['SOURCE_FIRST', 'STRICT_SOURCE_ONLY']);
  });
});

describe('precedence', () => {
  test('mode default applies when the user has not chosen', () => {
    const r = resolveAnswerPolicy({ modeId: 'technical-interview' });
    assert.equal(r.source, 'mode_default');
    assert.equal(r.groundingPolicy, MODE_POLICIES['technical-interview'].groundingPolicy);
  });

  test('an explicit user choice overrides the mode default', () => {
    const r = resolveAnswerPolicy({ modeId: 'technical-interview', userChoice: 'only_answer_from_references' });
    assert.equal(r.source, 'user_choice');
    assert.equal(r.groundingPolicy, 'STRICT_SOURCE_ONLY');
  });

  test('a diagnostic override beats both — and is passed per call, never persisted', () => {
    const r = resolveAnswerPolicy({
      modeId: 'technical-interview', userChoice: 'only_answer_from_references',
      diagnosticOverride: 'OPEN_KNOWLEDGE',
    });
    assert.equal(r.source, 'diagnostic_override');
    assert.equal(r.groundingPolicy, 'OPEN_KNOWLEDGE');
  });

  test('an unknown mode falls back rather than throwing in the UI path', () => {
    assert.doesNotThrow(() => resolveAnswerPolicy({ modeId: 'not-a-mode' }));
  });
});

describe('the control cannot widen authorization', () => {
  test('choosing a policy never changes which sources a mode allows', () => {
    for (const modeId of MODE_IDS) {
      const before = [...MODE_POLICIES[modeId].allowedSourceTypes].sort();
      resolveAnswerPolicy({ modeId, userChoice: 'only_answer_from_references' });
      resolveAnswerPolicy({ modeId, userChoice: 'use_references_when_relevant' });
      const after = [...MODE_POLICIES[modeId].allowedSourceTypes].sort();
      assert.deepEqual(after, before, `${modeId}: the control must not mutate mode authorization`);
    }
  });
});

describe('the control is only offered where it means something', () => {
  test('shown for modes that authorize reference files', () => {
    for (const modeId of ['seminar', 'lecture', 'sales', 'general']) {
      assert.equal(shouldOfferAnswerPolicyControl(modeId), true, modeId);
    }
  });

  test('hidden where the mode has no reference files to be strict about', () => {
    // "Only answer from references" in a mode with no reference files is a
    // control that can only make the answer worse. technical-interview
    // authorizes RESUME / JD / project files / coding samples / screen — but
    // not REFERENCE_FILE — so the control has nothing to bind to there.
    assert.equal(shouldOfferAnswerPolicyControl('technical-interview'), false);
  });

  test('the offered/hidden split matches the registry exactly', () => {
    // Guards against the control drifting out of sync with mode authorization,
    // which is how the old selector came to offer sources a mode never allowed.
    for (const modeId of MODE_IDS) {
      assert.equal(
        shouldOfferAnswerPolicyControl(modeId),
        MODE_POLICIES[modeId].allowedSourceTypes.includes('REFERENCE_FILE'),
        modeId,
      );
    }
  });
});

describe('every mode resolves to a sane default', () => {
  test('no mode resolves to an unreachable or undefined policy', () => {
    for (const modeId of MODE_IDS) {
      const r = resolveAnswerPolicy({ modeId });
      assert.ok(r.groundingPolicy, `${modeId} has no grounding policy`);
      assert.ok(ANSWER_POLICY_LABELS[r.answerPolicy], `${modeId} maps to an unlabelled option`);
    }
  });

  test('seminar presents as strict-by-default without being STRICT_SOURCE_ONLY', () => {
    // Seminar labels rather than refuses (§27.2 forbids over-refusal), so its
    // grounding is SOURCE_FIRST even though it is the strictest document mode.
    const r = resolveAnswerPolicy({ modeId: 'seminar' });
    assert.equal(r.groundingPolicy, 'SOURCE_FIRST');
    assert.equal(r.modeIsStrictByDefault, false);
  });
});
