// Context Intelligence V3 — a file-grounded mode with NOTHING attached must not
// narrate a file.
//
// Seen in the running app, 2026-09-21. Seminar mode, zero files attached, the
// question "Can you explain what gradient descent is?" — a FAST turn (general
// technical knowledge, no retrieval). The overlay answered:
//
//   "This is general knowledge, not something from your slides ... The material
//    you uploaded doesn't define gradient descent, so if your deck covers it, the
//    rest of that file wasn't retrieved for this turn and I can't cite a slide."
//
// No slides, deck or upload existed. The prompt said the mode is "Strict
// file-grounded Q&A", told the model to label anything unsupported as "general
// knowledge, not document content", carried the permanent rule "say the rest of
// that file was not retrieved for this turn" — and never said that NO file is
// attached, because the truthful "no document is attached here" notice is
// (rightly) a retrieval-miss notice and FAST turns never retrieve. So the model
// assumed the file and apologised for it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { composePrompt } = await import(pathToFileURL(path.join(base, 'generation/prompt-composer.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

const Q = 'Can you explain what gradient descent is?';
const decision = (modeId, q = Q) => decide({ requestId: 'r1', requestSequence: 1, surface: 'what-to-answer', modeId, scope: { userId: 'u1' }, sessionId: 's1', manualQuestion: q });
const compose = (modeId, extra, q) => composePrompt({ decision: decision(modeId, q), policy: MODE_POLICIES[modeId], evidence: [], ...extra });

describe('a FAST turn in a disclosure-strict mode with zero attached sources', () => {
  test('precondition: this is the FAST path and the mode demands source disclosure', () => {
    assert.equal(decision('seminar').retrievalPlan.path, 'FAST');
    assert.equal(MODE_POLICIES.seminar.capabilityPolicy.externalSuggestionDisclosure, 'ALWAYS');
  });

  test('is told that nothing is attached, and not to narrate a file', () => {
    const c = compose('seminar', { attachedSourceCount: 0, profileSourceCount: 0 });
    assert.ok(c.sections.includes('no_attached_material'));
    assert.match(c.system, /No (?:file|document)[^.]*attached/i);
    assert.match(c.system, /slides|deck/i);
    assert.match(c.system, /do not (?:mention|refer)/i);
  });

  test('it replaces the "label it as not document content" guidance, which presupposes a document', () => {
    const c = compose('seminar', { attachedSourceCount: 0, profileSourceCount: 0 });
    assert.doesNotMatch(c.system, /not as document content/);
  });
});

describe('it says nothing when it would be false or redundant', () => {
  test('files ARE attached', () => {
    const c = compose('seminar', { attachedSourceCount: 2, profileSourceCount: 0 });
    assert.ok(!c.sections.includes('no_attached_material'));
    assert.match(c.system, /not as document content/);
  });
  test('a profile source exists', () => assert.ok(!compose('seminar', { attachedSourceCount: 0, profileSourceCount: 1 }).sections.includes('no_attached_material')));
  test('the count is UNKNOWN (a caller that does not supply it) — composition unchanged', () => {
    const c = compose('seminar', {});
    assert.ok(!c.sections.includes('no_attached_material'));
    assert.match(c.system, /not as document content/);
  });
  test('a mode that does not demand disclosure (General)', () => assert.ok(!compose('general', { attachedSourceCount: 0, profileSourceCount: 0 }).sections.includes('no_attached_material')));
  test('a NON-fast turn keeps its own tailored no-evidence notice and gets no second one', () => {
    const c = compose('seminar', { attachedSourceCount: 0, profileSourceCount: 0 }, 'What does my paper say about the learning rate schedule?');
    assert.notEqual(decision('seminar', 'What does my paper say about the learning rate schedule?').retrievalPlan.path, 'FAST');
    assert.ok(!c.sections.includes('no_attached_material'));
  });
});
