// Denial sweep 2026-08-06: fresh General / Team-Meet (OPEN_KNOWLEDGE, zero
// files/profile) turns made generic advice look like profile evidence requests:
//
//   "What do you think about remote work?"
//   "Should I negotiate my salary?"
//   "What should I do if I disagree with my manager?"
//
// PERSONAL_RE sees `you` / `I` / `my`, emits USER_EMPLOYMENT, and the source
// authority layer reports that RESUME/CANDIDATE_FILE/PROFILE_FACT are not
// authorized. The prompt composer then said "cannot be answered from available
// material" and prohibited general knowledge.
//
// ── REWRITTEN 2026-08-07 ─────────────────────────────────────────────────────
//
// The original fix was CLASSIFIER-level (relax PERSONAL_RE for opinion/advice
// shapes in OPEN_KNOWLEDGE modes with nothing attached). That implementation
// was reverted out of the working tree.
//
// The defect was fixed at the COMPOSER instead, and that is the better
// altitude. "Should I negotiate my salary?" IS a question about the user's
// employment — labelling it PERSONAL_EXPERIENCE is arguably correct, and a
// user WITH a hydrated profile should get a tailored answer. The bug was never
// the label. The bug was that an unauthorized-source verdict was used to
// withhold the whole answer instead of just the source-specific claims.
//
// So this suite now pins the label as unchanged and asserts the property that
// actually broke: the composed prompt must not refuse. That assertion holds no
// matter which altitude a future fix picks — if someone restores the classifier
// relaxation, these tests keep passing.
//
// Live-verified 2026-08-07 on deepseek-v4-flash and MiniMax-M3: 0 refusals
// across 6,535 real calls (scripts/answer-policy-live-sweep.mjs).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-advice-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);

const classify = (question, modeId, hasAttachedDocuments = false) => classifyTurn({
  resolvedQuestion: question, policy: MODE_POLICIES[modeId], isFollowUp: false,
  hasAttachedDocuments, attachedFileNames: [],
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

async function composed(question, modeId, attached = 0) {
  const r = await buildV3Prompt({
    surface: 'manual-chat', question, modeTemplateType: modeId, modeUniqueId: modeId,
    attachedSourceCount: attached, attachedFileNames: attached ? ['ref.pdf'] : [],
    profileSourceCount: 0,
    retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    scope: { sessionId: `advice-${modeId}-${question.length}-${attached}` },
  });
  assert.ok(r, 'the live path must produce a V3 prompt');
  return r;
}

const genericAdvice = [
  'What do you think about remote work?',
  'What is your opinion on remote work?',
  'Should I negotiate my salary?',
  'What should I do if I disagree with my manager?',
  'When should I follow up after an interview?',
];

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });

describe('generic first/second-person advice does not deny fresh OPEN_KNOWLEDGE users', () => {
  for (const modeId of ['general', 'team-meet']) {
    for (const question of genericAdvice) {
      test(`${modeId}: ${question}`, async () => {
        // The label is a routing fact and is deliberately NOT asserted here —
        // the original suite pinned it to GENERAL_TECHNICAL, which the reverted
        // classifier fix would have produced. Both routings are acceptable; the
        // refusal is not. Asserting only the refusal keeps this test valid under
        // either implementation.
        const r = await composed(question, modeId);
        for (const re of REFUSALS) {
          assert.doesNotMatch(`${r.system}\n${r.user}`, re,
            `${modeId} / ${question} — refusal instruction survived: ${re}\n\n${r.user}`);
        }
      });
    }
  }

  test('the current routing for these shapes is PERSONAL_EXPERIENCE (pinned, not endorsed)', () => {
    // One place records what the classifier actually does, so a future change
    // is visible rather than silent. It is deliberately ONE test, not fifteen:
    // the label is not the contract, the no-refusal property above is.
    for (const modeId of ['general', 'team-meet']) {
      const r = classify('Should I negotiate my salary?', modeId);
      assert.ok(r.questionTypes.includes('PERSONAL_EXPERIENCE'), `${modeId}: ${r.questionTypes.join(',')}`);
      assert.ok(r.unsupportedInMode.length > 0,
        'the source-authority verdict is unchanged — the mode still cannot evidence this');
    }
  });

  test('factual self-history question stays source-honest without a profile', async () => {
    // The anti-fabrication half. "What are my strengths?" must never be
    // answered as though a résumé had been read — the composer relaxation
    // licenses a general answer, never an invented fact about the user.
    const r = classify('What are my strengths?', 'general', false);
    assert.ok(r.questionTypes.includes('PERSONAL_EXPERIENCE'), `got: ${r.questionTypes.join(',')}`);
    assert.ok(r.unsupportedInMode.length > 0, 'no-profile self facts must not be invented');

    const p = await composed('What are my strengths?', 'general');
    assert.match(p.user, /Do not invent source-specific facts/);
    assert.match(p.user, /not established by any available source/);
  });

  test('generic advice with a hydrated profile remains eligible for tailored routing', () => {
    const r = classify('Should I negotiate my salary?', 'general', true);
    assert.ok(r.questionTypes.includes('PERSONAL_EXPERIENCE'),
      `profile-backed advice should preserve the personal route, got: ${r.questionTypes.join(',')}`);
  });
});
