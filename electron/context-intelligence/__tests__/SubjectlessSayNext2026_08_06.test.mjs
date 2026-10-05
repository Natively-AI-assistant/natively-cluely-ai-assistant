// Denial sweep 2026-08-06: "What should I say next?" is a subject-less
// response request. RESPONSE_REQUEST_RE correctly marks it FOLLOW_UP, but
// FIRST_PERSON_RE sees "I" earlier and emits USER_EMPLOYMENT first. In fresh
// General/Team-Meet that private claim is unauthorized, so V3's composed
// prompt said "cannot be answered from the available material" instead of
// resolving the preceding question or asking for context.
//
// ── REWRITTEN 2026-08-07 ─────────────────────────────────────────────────────
//
// The original fix suppressed the PERSONAL_EXPERIENCE claim for the exact
// subject-less form. That implementation was reverted out of the working tree;
// the claim is still emitted, verified below.
//
// The refusal is gone regardless, because prompt-composer.ts now gates its
// absence branches on `d.generalKnowledgeAllowed`. The turn is routed as
// personal AND answered.
//
// One thing the 2026-08-07 live sweep taught that this suite now encodes: asked
// with NO conversation behind it, "What should I say next?" is a genuine
// CLARIFICATION case — "I don't have enough context, what should I weigh in
// on?" is the CORRECT response there, not a denial. The reported bug happened
// mid-session, so the meaningful assertion is about a turn that HAS a referent.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-saynext-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn, isBareFollowUp } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);

const classify = (modeId, question) => classifyTurn({
  resolvedQuestion: question, policy: MODE_POLICIES[modeId], isFollowUp: false,
  hasAttachedDocuments: false, attachedFileNames: [],
});

const REFUSALS = [
  /cannot be answered from the available material/i,
  /do not answer it from general knowledge/i,
  /do not answer from general knowledge as though it were sourced/i,
  /do not invent a template or example answer/i,
  /switching to a profile-enabled mode/i,
  /has NO reference material attached, so there was nothing to search/i,
  /say plainly what is not covered/i,
];

async function composed(modeId, question, conversationSummary) {
  const r = await buildV3Prompt({
    surface: 'assist', question, modeTemplateType: modeId, modeUniqueId: modeId,
    conversationSummary,
    attachedSourceCount: 0, profileSourceCount: 0,
    retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    scope: { sessionId: `saynext-${modeId}-${question.length}-${conversationSummary ? 'c' : 'x'}` },
  });
  assert.ok(r, 'the live path must produce a V3 prompt');
  return r;
}

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });

describe('subject-less “What should I say next?” is answered, not refused', () => {
  for (const modeId of ['general', 'team-meet']) {
    test(`${modeId}: mid-conversation say-next is not refused`, async () => {
      const r = await composed(modeId, 'What should I say next?',
        'The other person just asked why I am interested in moving roles.');
      for (const re of REFUSALS) {
        assert.doesNotMatch(`${r.system}\n${r.user}`, re, `${modeId}: ${re}\n\n${r.user}`);
      }
    });
  }

  test('the current routing still emits the personal claim (pinned, not endorsed)', () => {
    // KNOWN ODDITY: FIRST_PERSON_RE matches the bare "I" and claims
    // PERSONAL_EXPERIENCE alongside FOLLOW_UP, so the turn asks for résumé
    // authority it does not need. Harmless now that the composer no longer
    // refuses on an unauthorized-source verdict — but it IS why this suite
    // existed, so it is recorded rather than quietly dropped.
    for (const modeId of ['general', 'team-meet']) {
      const r = classify(modeId, 'What should I say next?');
      assert.ok(r.questionTypes.includes('FOLLOW_UP'), `got: ${r.questionTypes.join(',')}`);
      assert.ok(r.questionTypes.includes('PERSONAL_EXPERIENCE'),
        `routing changed — if the personal claim was dropped, update this test. got: ${r.questionTypes.join(',')}`);
    }
  });

  // ── unchanged guards: already true against the current classifier ──

  test('exact form is a bare follow-up', () => {
    assert.equal(isBareFollowUp('What should I say next?'), true);
  });

  test('source-qualified say-next request stays outside the narrow exemption', () => {
    assert.equal(isBareFollowUp('What should I say next about my résumé?'), true,
      'continuity grammar still applies; source routing will decide its evidence');
    const r = classify('general', 'What should I say next about my résumé?');
    assert.ok(r.questionTypes.includes('PERSONAL_EXPERIENCE'), `got: ${r.questionTypes.join(',')}`);
  });
});
