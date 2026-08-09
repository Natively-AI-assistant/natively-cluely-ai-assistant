// Answer policy (§6) — "Use references when relevant" must never deny.
//
// Reported from a live run: with option 1 selected and nothing attached, six
// question shapes came back as refusals rather than answers, e.g.
//
//   "Should I negotiate my salary?"      → "You have not given me any context I
//                                           can ground that in… switch to a
//                                           profile-enabled mode"
//   "What do you think about remote work?" → "I can't answer that from your
//                                             actual background"
//
// Root cause, measured through the REAL surface (buildV3Prompt, which every
// live answer path funnels into): two absence branches in the prompt composer
// wrote their instruction from the SOURCE state alone and never consulted the
// grounding policy —
//
//   1. zero attachments + a private claim  → "do not answer from general
//      knowledge as though it were sourced"
//   2. shouldRetrieve === false (the mode does not authorize the claim's
//      source) → "cannot be answered from the available material — do not
//      answer it from general knowledge … switching to a profile-enabled mode"
//
// Both fired identically whether the stored policy was option 1, option 2, or
// absent, and both contradicted the grounding line the same prompt carried
// ("For parts it does not cover, answer from general knowledge"). The model
// obeyed the louder, more specific prohibition. 72 of 80 fresh-user turns
// across all 8 modes were denied.
//
// This suite runs at buildV3Prompt rather than composePrompt deliberately: the
// previous round of composer-level tests passed while the live app still
// denied, because they never exercised the path the app takes.
//
// The invariant is two-sided and both sides are asserted here:
//   - option 1 / mode default  ⇒ no refusal instruction, on any mode
//   - option 2                 ⇒ the strict refusal instruction is intact
// plus, on BOTH sides, the anti-fabrication clause survives — the relaxation
// licenses a general answer, never an invented fact about the user.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-answer-policy-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { setStoredAnswerPolicy } = await import(pathToFileURL(path.join(base, 'policies/answer-policy-store.js')).href);

const MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work',
  'technical-interview', 'lecture', 'seminar'];

// Verbatim from the live run.
const REPORTED = [
  'Should I negotiate my salary?',
  'When should I follow up after an interview?',
  'What should I do if I disagree with my manager?',
  'What do you think about remote work?',
  "Give me an example answer for 'Why do you want this role?'",
  'What should I say next?',
];

// Refusals the user reviewed and confirmed as CORRECT. They must stay
// source-honest under option 1 — the fix lifts the prohibition on answering,
// not the prohibition on inventing.
const MUST_STAY_HONEST = [
  'What is my CGPA?',
  'What salary does the job description list?',
  'Summarize the attached document.',
];

// Every phrase that instructs the model to withhold the answer itself.
const REFUSAL_INSTRUCTIONS = [
  /cannot be answered from the available material/i,
  /do not answer it from general knowledge/i,
  /do not answer from general knowledge as though it were sourced/i,
  /do not invent a template or example answer/i,
  /switching to a profile-enabled mode/i,
  /has NO reference material attached, so there was nothing to search/i,
  // The third branch's strict wording — reachable only with material attached.
  // Its non-strict counterpart is deliberately distinct ("Say plainly what the
  // material does not cover … and then answer the question itself") so these
  // two patterns discriminate the branches rather than merely the phrasing.
  /say plainly what is not covered/i,
  /never answer with a generic definition or typical value as a substitute/i,
];

// Clauses that keep an answered turn from fabricating. At least one must be
// present on any turn that renders an absence notice, under EITHER policy.
const ANTI_FABRICATION = [
  /Do not invent source-specific facts/i,
  /not established by any available source/i,
  /do not invent/i,
];

const ask = (question, modeId, opts = {}) => buildV3Prompt({
  surface: opts.surface ?? 'manual-chat', question, modeTemplateType: modeId, modeUniqueId: modeId,
  attachedSourceCount: opts.attachedSourceCount ?? 0,
  profileSourceCount: opts.profileSourceCount ?? 0,
  attachedFileNames: (opts.attachedSourceCount ?? 0) ? ['handbook.pdf'] : [],
  // An empty sweep over material that DOES exist — the "not covered by the
  // attached file" case, which is unreachable while nothing is attached.
  retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
  scope: { sessionId: `ap-${modeId}-${question.length}-${question.charCodeAt(0)}-${opts.surface ?? ''}${opts.attachedSourceCount ?? 0}${opts.profileSourceCount ?? 0}` },
});

const setAll = (policy) => { for (const m of MODES) setStoredAnswerPolicy(m, policy, USERDATA); };

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });

describe('option 1 — "Use references when relevant" never refuses, in any mode', () => {
  for (const modeId of MODES) {
    for (const question of REPORTED) {
      test(`${modeId}: ${question}`, async () => {
        setAll('use_references_when_relevant');
        const r = await ask(question, modeId);
        assert.ok(r, 'the live path must produce a V3 prompt, not fall through to legacy');
        const text = `${r.system}\n${r.user}`;
        for (const re of REFUSAL_INSTRUCTIONS) {
          assert.doesNotMatch(text, re, `refusal instruction survived: ${re}\n\n${r.user}`);
        }
      });
    }
  }

  test('the mode default behaves the same when the user has never chosen', async () => {
    // general/team-meet default to OPEN_KNOWLEDGE and may never have a stored
    // choice — neither absence branch consulted the policy, so they denied too.
    setAll(null);
    for (const modeId of ['general', 'team-meet']) {
      for (const question of REPORTED) {
        const r = await ask(question, modeId);
        for (const re of REFUSAL_INSTRUCTIONS) {
          assert.doesNotMatch(`${r.system}\n${r.user}`, re, `${modeId} / ${question} / ${re}`);
        }
      }
    }
  });

  test('a general answer is positively instructed, not merely un-prohibited', async () => {
    setAll('use_references_when_relevant');
    const r = await ask('What do you think about remote work?', 'technical-interview');
    assert.match(r.user, /Answer the question itself helpfully from general knowledge/);
  });

  // The scenario the control is actually NAMED after, and the one the first
  // round of this fix missed entirely: material IS attached, the question is
  // simply not covered by it. A separate composer branch governs this — the
  // zero-attachment branch shadows it whenever nothing is attached, so a
  // matrix built only on fresh users never reaches it. It denied 27 of 48
  // turns under option 1 until 2026-08-07.
  for (const [label, opts] of [
    ['a file is attached but does not cover the question', { attachedSourceCount: 1 }],
    ['Profile Intelligence is hydrated but does not cover it', { profileSourceCount: 2 }],
    ['on the assist surface', { attachedSourceCount: 1, surface: 'assist' }],
  ]) {
    test(`no refusal when ${label}`, async () => {
      setAll('use_references_when_relevant');
      for (const modeId of MODES) {
        for (const question of REPORTED) {
          const r = await ask(question, modeId, opts);
          for (const re of REFUSAL_INSTRUCTIONS) {
            assert.doesNotMatch(`${r.system}\n${r.user}`, re,
              `${modeId} / ${question} / ${re}\n\n${r.user}`);
          }
        }
      }
    });
  }

  test('an uncovered attached file still forbids substituting a generic value (deep-test D5)', async () => {
    setAll('use_references_when_relevant');
    const r = await ask('What is the discount floor in the contract?', 'sales', { attachedSourceCount: 1 });
    assert.match(r.user, /the exact value could not be retrieved/);
    assert.match(r.user, /never present a general figure, definition or typical value as though it came from the material/);
  });
});

describe('option 1 does not license fabrication', () => {
  for (const question of MUST_STAY_HONEST) {
    test(`still source-honest: ${question}`, async () => {
      setAll('use_references_when_relevant');
      const r = await ask(question, 'looking-for-work');
      const text = `${r.system}\n${r.user}`;
      assert.ok(ANTI_FABRICATION.some((re) => re.test(text)),
        `no anti-fabrication clause on an absence turn:\n${r.user}`);
    });
  }

  test('every answered absence notice carries an anti-fabrication clause', async () => {
    // Scoped to the answering policies. Under option 2 the refusal IS the
    // protection — that branch never produces an answer to contaminate — so the
    // clause is only load-bearing where a general answer is now licensed.
    for (const policy of ['use_references_when_relevant', null]) {
      setAll(policy);
      for (const modeId of MODES) {
        for (const question of [...REPORTED, ...MUST_STAY_HONEST]) {
          const r = await ask(question, modeId);
          if (!/# Evidence\n/.test(r.user)) continue;
          assert.ok(ANTI_FABRICATION.some((re) => re.test(r.user)),
            `${policy ?? 'mode default'} / ${modeId} / ${question}:\n${r.user}`);
        }
      }
    }
  });
});

describe('option 2 — "Only answer from references" keeps every refusal', () => {
  // The half that proves the strict path was scoped, not deleted.
  test('every reported question is still refused under option 2', async () => {
    setAll('only_answer_from_references');
    for (const opts of [{}, { attachedSourceCount: 1 }, { profileSourceCount: 2 }]) {
      let refused = 0; let total = 0;
      for (const modeId of MODES) {
        for (const question of REPORTED) {
          total += 1;
          const r = await ask(question, modeId, opts);
          if (REFUSAL_INSTRUCTIONS.some((re) => re.test(`${r.system}\n${r.user}`))) refused += 1;
        }
      }
      assert.equal(refused, total,
        `option 2 must refuse all ${total} with ${JSON.stringify(opts)}, refused ${refused}`);
    }
  });

  test('the exact strict wording is unchanged', async () => {
    setAll('only_answer_from_references');
    const r = await ask('What is my CGPA?', 'looking-for-work');
    assert.match(r.user, /has NO reference material attached, so there was nothing to search/);
    assert.match(r.user, /do not answer from general knowledge as though it were sourced/);
    assert.match(r.user, /Profile Intelligence/);
  });
});
