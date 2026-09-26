// Live repro 2026-08-06 (manual verification of the PR #429 Bug 001 fix):
// Team-Meet mode, ZERO reference files, question "What's a good icebreaker
// for a…" → answer began "No document's been added to this mode yet…".
//
// V3 debug line: intent [MEETING_FACT, DOCUMENT_FACT], path GROUNDED, planned
// [MEETING_TRANSCRIPT, REFERENCE_FILE], evidence 0, answerability NONE,
// fallback DOCUMENT_FACT_NOT_FOUND.
//
// ── REWRITTEN 2026-08-07 ─────────────────────────────────────────────────────
//
// The original fix for this was CLASSIFIER-level: gate the DOCUMENT_FACT
// companion rules on `input.hasAttachedDocuments === true` so a fresh no-files
// Team-Meet never plans REFERENCE_FILE. That implementation was reverted out of
// the working tree, leaving this suite asserting a design that no longer
// exists.
//
// It was fixed instead at the COMPOSER (prompt-composer.ts, three absence
// branches now gated on `d.generalKnowledgeAllowed`). That is the better
// altitude: the classifier's label is a routing fact, and routing a
// reference-file-capable mode toward REFERENCE_FILE is defensible. What was
// never defensible was turning an empty sweep into "no document has been added
// — do not answer from general knowledge".
//
// So this suite now asserts BOTH halves, which is what it always cared about:
//   1. the CURRENT classifier label, pinned honestly (DOCUMENT_FACT IS still
//      claimed with zero files — that did not change and is not a defect);
//   2. that the composed prompt does NOT deny — the user-visible property the
//      original live repro was actually about.
//
// The three assertions that were already TRUE against the current classifier
// are kept unchanged as real guards, not re-pinned.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-docfact-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);

const classify = (q, mode, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[mode], isFollowUp: false, ...over });

// Every instruction that tells the model to withhold the answer itself.
const REFUSALS = [
  /cannot be answered from the available material/i,
  /do not answer it from general knowledge/i,
  /do not answer from general knowledge as though it were sourced/i,
  /do not invent a template or example answer/i,
  /switching to a profile-enabled mode/i,
  /has NO reference material attached, so there was nothing to search/i,
  /say plainly what is not covered/i,
];

async function composed(q, mode, { attached = 0 } = {}) {
  const r = await buildV3Prompt({
    surface: 'manual-chat', question: q, modeTemplateType: mode, modeUniqueId: mode,
    attachedSourceCount: attached, attachedFileNames: attached ? ['ref.pdf'] : [],
    profileSourceCount: 0,
    retrieval: { async retrieve() { return { evidence: [], attempts: [] }; } },
    scope: { sessionId: `docfact-${mode}-${q.length}-${attached}` },
  });
  assert.ok(r, 'the live path must produce a V3 prompt');
  return r;
}
const assertNoRefusal = (r, ctx) => {
  for (const re of REFUSALS) assert.doesNotMatch(`${r.system}\n${r.user}`, re, `${ctx}: ${re}\n\n${r.user}`);
};

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });

describe('DOCUMENT_FACT companion claims on OPEN_KNOWLEDGE modes with zero files', () => {
  test('live repro: team-meet + no files + icebreaker question is routed to a document, but NOT denied', async () => {
    const r = classify('"What\'s a good icebreaker for a', 'team-meet', { hasAttachedDocuments: false });
    // Pinned, not endorsed: the companion rule still claims the document side
    // from the mode's allowlist alone. Harmless now — the composer no longer
    // converts an empty sweep into a refusal.
    assert.deepEqual(r.questionTypes, ['MEETING_FACT', 'DOCUMENT_FACT']);
    assert.deepEqual(r.requiredSourceTypes, ['MEETING_TRANSCRIPT', 'REFERENCE_FILE']);
    assertNoRefusal(await composed('"What\'s a good icebreaker for a', 'team-meet'), 'zero-file icebreaker');
  });

  test('Defect A canonical: team-meet + no files + facilitator question is routed to a document, but NOT denied', async () => {
    const q = 'What should the facilitator ask first?';
    const r = classify(q, 'team-meet', { hasAttachedDocuments: false });
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), `got: ${r.questionTypes.join(',')}`);
    assertNoRefusal(await composed(q, 'team-meet'), 'zero-file facilitator');
  });

  // ── unchanged guards: these were already true against the current classifier ──

  test('Defect A preserved: team-meet + FILES + facilitator question → DOCUMENT_FACT + REFERENCE_FILE', () => {
    const r = classify('What should the facilitator ask first?', 'team-meet', { hasAttachedDocuments: true });
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'),
      `Defect A must still claim the document side when files are attached, got: ${r.questionTypes.join(',')}`);
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), `got: ${r.requiredSourceTypes.join(',')}`);
  });

  test('meeting side unaffected: no-files turn still claims MEETING_FACT / plans the transcript', () => {
    const r = classify('What should the facilitator ask first?', 'team-meet', { hasAttachedDocuments: false });
    assert.ok(r.questionTypes.includes('MEETING_FACT'), `got: ${r.questionTypes.join(',')}`);
    assert.ok(r.requiredSourceTypes.includes('MEETING_TRANSCRIPT'), `got: ${r.requiredSourceTypes.join(',')}`);
  });

  test('document-FIRST mode untouched: technical-interview definite lookup keeps its docish routing', () => {
    // The fabrication boundary for SOURCE_FIRST modes — deliberate regardless
    // of files, and deliberately NOT relaxed by the 2026-08-07 composer fix.
    const r = classify('What is the default retention period?', 'technical-interview', { hasAttachedDocuments: false });
    assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), `got: ${r.questionTypes.join(',')}`);
  });
});
