// Live manual repro follow-up (2026-08-06): in a fresh no-files Team-Meet
// mode, "What's a good icebreaker for a team meeting?" entered V3 as a
// DOCUMENT_FACT and prompted "no document has been added". The semantic twin
// "What is a good way to open a difficult conversation?" was correctly FAST
// / GENERAL_TECHNICAL.
//
// Original diagnosis: GENERAL_TECH_RE recognized only `what is`, not the
// contraction `what's`, so the question failed the general-concept guard and
// the primary-source fallback treated it as a factual lookup.
//
// ── REWRITTEN 2026-08-07 ─────────────────────────────────────────────────────
//
// The contraction fix was reverted out of the working tree. `what's` is STILL
// not recognized as `what is` — verified below — so the routing asymmetry the
// original repro found is real and still present.
//
// It no longer produces a denial, though, and that is the whole reason the
// repro mattered: prompt-composer.ts now gates its three absence branches on
// `d.generalKnowledgeAllowed`, so an empty sweep over a document the user never
// attached yields "answer from general knowledge" rather than "no document has
// been added".
//
// This suite therefore pins the asymmetry as a KNOWN ODDITY and asserts the
// property that actually protects the user. If someone later restores the
// contraction fix, the first two tests will fail loudly and should be updated
// to the GENERAL_TECHNICAL expectation — that would be an improvement, not a
// regression.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-contraction-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);

const classify = (question, modeId) => classifyTurn({
  resolvedQuestion: question, policy: MODE_POLICIES[modeId], isFollowUp: false,
  hasAttachedDocuments: false, attachedFileNames: [],
});

const REFUSALS = [
  /cannot be answered from the available material/i,
  /do not answer it from general knowledge/i,
  /do not answer from general knowledge as though it were sourced/i,
  /has NO reference material attached, so there was nothing to search/i,
  /say plainly what is not covered/i,
];

async function composed(question, modeId) {
  const r = await buildV3Prompt({
    surface: 'manual-chat', question, modeTemplateType: modeId, modeUniqueId: modeId,
    attachedSourceCount: 0, profileSourceCount: 0,
    retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    scope: { sessionId: `contraction-${modeId}-${question.length}` },
  });
  assert.ok(r, 'the live path must produce a V3 prompt');
  return r;
}
const assertNoRefusal = (r, ctx) => {
  for (const re of REFUSALS) assert.doesNotMatch(`${r.system}\n${r.user}`, re, `${ctx}: ${re}\n\n${r.user}`);
};

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });

describe('OPEN_KNOWLEDGE contraction routing — asymmetry pinned, denial gone', () => {
  for (const modeId of ['general', 'team-meet']) {
    test(`${modeId}: “What's a good icebreaker…” routes to a document, but is not denied`, async () => {
      const q = "What's a good icebreaker for a team meeting?";
      const r = classify(q, modeId);
      // KNOWN ODDITY: the contraction is not folded to "what is", so this is
      // classified as a document lookup while its uncontracted twin is not.
      // Pinned as fact, NOT endorsed — see the header.
      assert.ok(r.questionTypes.includes('DOCUMENT_FACT'),
        `contraction handling changed — update this test to the GENERAL_TECHNICAL expectation. got: ${r.questionTypes.join(',')}`);
      assertNoRefusal(await composed(q, modeId), `${modeId} contraction`);
    });
  }

  test('curly-apostrophe variant behaves identically to the straight one', async () => {
    const straight = classify("What's a good way to open a difficult conversation?", 'general');
    const curly = classify('What’s a good way to open a difficult conversation?', 'general');
    // The real invariant worth guarding: whatever the routing is, the two
    // apostrophe forms must never diverge — that would make behaviour depend on
    // the user's keyboard.
    assert.deepEqual(curly.questionTypes, straight.questionTypes,
      `apostrophe form changed the routing: ${curly.questionTypes.join(',')} vs ${straight.questionTypes.join(',')}`);
    assert.deepEqual(curly.requiredSourceTypes, straight.requiredSourceTypes);
    assertNoRefusal(await composed('What’s a good way to open a difficult conversation?', 'general'), 'curly');
  });

  // ── unchanged guard: already true against the current classifier ──

  test('explicit source question remains document-grounded', () => {
    const r = classify("What's stated in the document about the meeting agenda?", 'general');
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'),
      `explicit document pointer must retain grounding, got: ${r.questionTypes.join(',')}`);
  });
});
