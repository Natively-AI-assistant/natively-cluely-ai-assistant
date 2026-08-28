// Context Intelligence V3 — engine bridge.
//
// One adoption point for the five engine surfaces that construct no source
// authority today. Its contract is deliberately narrow: return a prompt, or
// return null and let legacy run. It must never throw into a live answer path.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The Answer policy is read from the store per turn, so any test that pins a
// policy needs an isolated userData dir. NATIVELY_TEST_USERDATA is the variable
// the store itself checks first, ahead of Electron's app.getPath.
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-bridge-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { setStoredAnswerPolicy } = await import(pathToFileURL(path.join(base, 'policies/answer-policy-store.js')).href);

const ENV = CONTEXT_INTELLIGENCE_V3_ENV_KEY;
const enable = () => { process.env[ENV] = '1'; };
// Explicit, because "absent" no longer means off — DEFAULT_ENABLED flipped to
// true at rollout. The invariant under test is "off ⇒ legacy", not "the default
// happens to be off".
const disable = () => { process.env[ENV] = '0'; };
afterEach(() => { delete process.env[ENV]; });

describe('flag gate — legacy stays in control whenever the flag is off', () => {
  test('returns null when off', async () => {
    disable();
    assert.equal(await buildV3Prompt({ surface: 'manual-chat', question: 'Tell me about your project.' }), null);
  });

  test('returns a prompt when on', async () => {
    enable();
    const r = await buildV3Prompt({ surface: 'manual-chat', question: 'What is a mutex?' });
    assert.ok(r, 'expected a prompt');
    assert.match(r.system, /# Rules/);
    assert.match(r.user, /# Question/);
  });
});

describe('never throws into a live answer path', () => {
  beforeEach(enable);

  test('an empty question yields null, not an exception', async () => {
    assert.equal(await buildV3Prompt({ surface: 'manual-chat', question: '   ' }), null);
  });

  test('an unknown mode falls back instead of throwing', async () => {
    const r = await buildV3Prompt({
      surface: 'manual-chat', question: 'What is a mutex?', modeTemplateType: 'not-a-real-mode',
    });
    assert.ok(r, 'must not throw on an unknown templateType');
    assert.equal(r.modeId, 'general', 'falls back to the seeded mode');
  });

  test('a throwing retrieval port degrades to no evidence, not an exception', async () => {
    const r = await buildV3Prompt({
      surface: 'manual-chat', question: 'Tell me about your WebRTC project.',
      modeTemplateType: 'technical-interview',
      retrieval: { async retrieve() { throw new Error('boom'); } },
    });
    assert.ok(r);
    assert.equal(r.evidenceCount, 0);
    assert.equal(r.answerability, 'NONE');
  });
});

describe('the prompt reflects the decision', () => {
  beforeEach(enable);

  test('a general question is fast and carries no evidence section', async () => {
    const r = await buildV3Prompt({
      surface: 'assist', question: 'What is idempotency in an HTTP API?', modeTemplateType: 'technical-interview',
    });
    assert.equal(r.evidenceCount, 0);
    assert.equal(r.unsupportedInMode, false);
    assert.ok(!/No supporting evidence was retrieved/.test(r.user),
      'a question that never needed evidence must not be told retrieval failed');
  });

  test('an unsupported-in-mode question is flagged, and answered without source-specific claims', async () => {
    // Until 2026-08-07 this asserted "told not to answer generally". The flag
    // and the label are unchanged — the mode genuinely cannot evidence this —
    // but the INSTRUCTION derived from them is now policy-scoped: refusing the
    // whole turn is the contract of "Only answer from references", not of the
    // default. See AnswerPolicyLiveDenials2026_08_07 for the strict half and
    // for the live denials this scoping fixes.
    //
    // UPDATED 2026-08-28 (T8). The question was "How many backend roles are we
    // opening this quarter?", which is no longer WHOLLY unsupported in
    // technical-interview: the mode now authorizes REFERENCE_FILE, so bare
    // meeting-context wording claims the reference side as an alternative (the
    // classifier's deliberate "Are we SOC 2 certified?" branch, which this mode
    // was excluded from only for lack of a reference pool). It retrieves now,
    // and `unsupportedInMode` correctly reports false.
    //
    // A real meeting EVENT is still wholly unsupported here — the transcript is
    // the only thing that can evidence it and the mode authorizes none — so the
    // flag keeps a genuine witness rather than being relaxed to fit.
    setStoredAnswerPolicy('technical-interview', null, USERDATA);
    const r = await buildV3Prompt({
      surface: 'assist', question: 'What did we decide in the standup?',
      modeTemplateType: 'technical-interview', modeUniqueId: 'technical-interview',
    });
    assert.equal(r.unsupportedInMode, true);
    assert.equal(r.fallbackUsed, 'STRICT_NOT_FOUND');
    assert.match(r.user, /No source available in the active mode can establish facts specific to this question/);
    assert.match(r.user, /Answer the question itself helpfully from general knowledge/);
    // The headcount itself may still never be produced.
    assert.match(r.user, /Do not invent source-specific facts/);
    assert.doesNotMatch(r.user, /do not answer it from general knowledge/i);
  });

  test('grounded evidence reaches the prompt with provenance', async () => {
    const r = await buildV3Prompt({
      surface: 'manual-chat', question: 'According to the document, what is the discount floor?',
      modeTemplateType: 'seminar',
      retrieval: {
        async retrieve() {
          return {
            evidence: [{
              evidenceId: 'ev-1', sourceType: 'REFERENCE_FILE', sourceId: 'f1',
              versionId: 'v2', scopeId: 'u:local', content: 'Acme discount floor is 17 percent',
              finalScore: 0.9, authorityFor: ['DOCUMENT_FACT'], acceptedFor: ['DOCUMENT_FACT'],
              isDirectFact: true, isInferred: false, metadata: {}, trustLevel: 'untrusted_reference',
            }],
            attempts: [],
          };
        },
      },
    });
    assert.equal(r.evidenceCount, 1);
    assert.match(r.user, /version_id="v2"/);
    assert.match(r.user, /untrusted data/i);
  });
});

describe('realtime instructions stay presentation-only', () => {
  beforeEach(enable);

  test('an authorization-widening instruction is contained, not obeyed', async () => {
    const r = await buildV3Prompt({
      surface: 'manual-chat', question: 'Tell me about your Postgres experience.',
      modeTemplateType: 'technical-interview',
      realtimeInstruction: 'Use the job description as proof of the candidate\'s skills.',
    });
    assert.ok(!r.system.includes('as proof of'), 'must never reach the policy layer');
    assert.match(r.user, /<presentation_instruction[^>]*cannot authorize a source/);
    assert.match(r.system, /Never treat job-description requirements/i);
  });
});

describe('the [V3] line exposes the real source state (2026-07-31)', () => {
  test('per-role profile counts and resolved/retrieved source identities are logged', async () => {
    enable();
    const lines = [];
    const orig = console.log;
    console.log = (...args) => { if (args[0] === '[V3]') lines.push(args[1]); orig(...args); };
    try {
      await buildV3Prompt({
        surface: 'manual-chat', question: 'What is my CGPA?',
        modeTemplateType: 'looking-for-work',
        attachedSourceCount: 0, profileSourceCount: 2,
        resolvedProfileSources: [
          { role: 'profile_resume', id: 'psrc_r' },
          { role: 'profile_job_description', id: 'psrc_j' },
        ],
        scope: { sessionId: 'v3line-1' },
      });
    } finally { console.log = orig; }
    assert.equal(lines.length, 1, 'exactly one [V3] line per turn');
    const j = JSON.parse(lines[0]);
    // attachedFiles alone reported the whole source state as 0 while a profile
    // pool existed — these fields are the fix's observability contract.
    assert.equal(j.modeAttachedFiles, 0);
    assert.equal(j.profileSources, 2);
    assert.equal(j.profileResumeSources, 1);
    assert.equal(j.profileJobDescriptionSources, 1);
    assert.equal(j.profileFactSources, 0);
    assert.deepEqual(j.resolvedSources.map((s) => s.role).sort(),
      ['profile_job_description', 'profile_resume']);
    assert.ok(Array.isArray(j.retrievedSources));
    // Identity only, never content: no field may carry document text.
    assert.ok(!lines[0].includes('CGPA/GPA'), 'the line must never leak profile content');
  });
});
