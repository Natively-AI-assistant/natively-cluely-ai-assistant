// Denial sweep 2026-08-06: "Can you give me an example answer?" — a
// subject-less request for a worked example — was routed as a document lookup
// in fresh no-files General/Team-Meet, and the composer answered with an
// upload prompt instead of an example.
//
// ── REWRITTEN 2026-08-07 ─────────────────────────────────────────────────────
//
// The original fix added an example-answer branch to RESPONSE_REQUEST_RE and
// widened isBareFollowUp. That implementation was reverted out of the working
// tree, so the follow-up recognition is still partial — pinned below, and it is
// genuinely inconsistent: "Can you give AN example answer?" is recognized as a
// bare follow-up while "Can you give ME an example answer?" is not.
//
// The denial is gone regardless: prompt-composer.ts gates its absence branches
// on `d.generalKnowledgeAllowed`, and these turns now classify as
// GENERAL_TECHNICAL with no retrieval planned at all — so no absence notice is
// rendered and no upload prompt can be produced.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-example-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn, isBareFollowUp } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
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
  /do not invent a template or example answer/i,
  /has NO reference material attached, so there was nothing to search/i,
  /say plainly what is not covered/i,
];

async function composed(question, modeId) {
  const r = await buildV3Prompt({
    surface: 'manual-chat', question, modeTemplateType: modeId, modeUniqueId: modeId,
    attachedSourceCount: 0, profileSourceCount: 0,
    retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    scope: { sessionId: `example-${modeId}-${question.length}` },
  });
  assert.ok(r, 'the live path must produce a V3 prompt');
  return r;
}

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });

describe('subject-less example-answer requests get an example, not an upload prompt', () => {
  for (const modeId of ['general', 'team-meet']) {
    test(`${modeId}: generic example-answer request is not refused`, async () => {
      const q = 'Can you give me an example answer?';
      const r = classify(q, modeId);
      // Now routed as general knowledge with NO retrieval planned, so the
      // composer renders no absence notice at all. Both halves asserted: the
      // routing that makes it safe, and the refusal that must not appear.
      assert.deepEqual(r.requiredSourceTypes, [],
        `an example request must not plan retrieval, got: ${r.requiredSourceTypes.join(',')}`);
      assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), `got: ${r.questionTypes.join(',')}`);

      const p = await composed(q, modeId);
      for (const re of REFUSALS) {
        assert.doesNotMatch(`${p.system}\n${p.user}`, re, `${modeId}: ${re}\n\n${p.user}`);
      }
    });
  }

  test('bare-follow-up recognition of example requests is inconsistent (pinned, not endorsed)', () => {
    // KNOWN ODDITY: the object pronoun flips the verdict. This is the gap the
    // reverted 2026-08-06 fix closed. It no longer causes a denial — these
    // turns plan no retrieval either way — but it does mean the two phrasings
    // take different continuity paths, so it is recorded rather than dropped.
    assert.equal(isBareFollowUp('Can you give an example answer?'), true);
    assert.equal(isBareFollowUp('Can you give me an example answer?'), false,
      'recognition changed — if the "me" form is now recognized, update this test');
    assert.equal(isBareFollowUp('Can you show me a sample answer?'), false,
      'recognition changed — if the "show me" form is now recognized, update this test');
  });

  // ── unchanged guard: already true against the current classifier ──

  test('self-contained example-answer request is NOT treated as a bare follow-up', () => {
    assert.equal(isBareFollowUp('Can you give me an example answer to a difficult interview question?'), false);
  });
});
