// T4 — the post-stream doc-grounded validator must check the answer against the
// evidence THAT WAS SENT.
//
// THE DEFECT (docs/retrieval-handoff/01-ROOT-CAUSES.md RC7b). After the answer
// had already streamed, `IntelligenceEngine` re-ran a SEPARATE legacy retrieval
// (`buildRetrievedActiveModeContextBlock*`, with its own relaxed/topK params)
// and validated the streamed answer against that. Under V3 the answer was
// grounded in V3's evidence — a different set entirely. When the two disagreed,
// a correct, grounded answer was OVERWRITTEN with "I could not find that in the
// retrieved sections of the document."
//
// This is one of three independent refusal mechanisms and the only one that
// destroys an answer the user already saw being written.
//
// TWO THINGS THIS FIX IS NOT:
//
//   1. NOT a blanket V3 exemption. That is the obvious reading of the finding
//      and it is wrong: V3 is the default path, so exempting it would retire the
//      zero-fabrication guard for essentially every live turn.
//      `computeEvidenceCoverage` still has the final word — the fix points it at
//      the right evidence and adds one retry in FRONT of it, never inside it.
//
//   2. NOT a weakening of the refusal. The refusal string is unchanged, in all
//      three places that depend on it byte-for-byte (SYSTEM_REFUSAL_RE and the
//      two overwrite sites). A genuinely absent fact still refuses.
//
// WHAT IS TESTED HERE. The engine's post-stream block needs a live stream to
// exercise, so this suite covers the two pieces the fix rests on, both pure:
//   • `buildV3Prompt` now REPORTS the evidence it composed from — without that
//     carrier, no validator could have been honest, and the defect was
//     structurally unfixable.
//   • `rewriteQueryForRetry` produces a genuinely DIFFERENT query, or none. The
//     pre-existing retry re-ran the same query text that had just failed, which
//     is not a second attempt at all.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-sent-evidence-'));
process.env.NATIVELY_TEST_USERDATA = USERDATA;

const repoRoot = process.cwd();
const base = path.resolve(repoRoot, 'dist-electron/electron/context-intelligence');
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { rewriteQueryForRetry, extractIdentifiers, positionalDirection } =
  await import(pathToFileURL(path.join(base, 'retrieval/query-rewrite.js')).href);
const { isIntelligenceFlagEnabled } = createRequire(import.meta.url)(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'));

before(() => { process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1'; });
after(() => { delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY]; });

const FACT = 'Acme discount floor is 17 percent';
const evidencePort = (items) => ({
  async retrieve() {
    return {
      evidence: items.map((content, i) => ({
        evidenceId: `ev-${i}`, sourceType: 'REFERENCE_FILE', sourceId: 'f1',
        versionId: 'v2', scopeId: 'u:local', content,
        finalScore: 0.9, authorityFor: ['DOCUMENT_FACT'], acceptedFor: ['DOCUMENT_FACT'],
        isDirectFact: true, isInferred: false, metadata: {}, trustLevel: 'untrusted_reference',
      })),
      attempts: [],
    };
  },
});

describe('T4 — the composed prompt reports the evidence it was built from', () => {
  test('evidenceBlock carries the packed evidence, and the prompt contains it', async () => {
    const r = await buildV3Prompt({
      surface: 'manual-chat',
      question: 'According to the document, what is the discount floor?',
      modeTemplateType: 'seminar',
      retrieval: evidencePort([FACT]),
    });
    assert.equal(r.evidenceCount, 1);
    assert.ok(r.evidenceBlock.includes(FACT),
      `evidenceBlock must contain the fact the model was given:\n${r.evidenceBlock}`);
    // The block must be a SUBSET of what was dispatched. If it were not, the
    // validator would once again be judging against something unsent — the
    // exact defect, one layer down.
    assert.ok(r.user.includes(r.evidenceBlock.trim()),
      'evidenceBlock must be part of the user prompt that was actually sent');
  });

  test('a turn with no evidence reports an EMPTY block, not a missing one', async () => {
    // This distinction carries weight: the engine skips doc-validation entirely
    // when a V3 turn carried no evidence, because there is nothing it could have
    // been grounded in and "I could not find that in the retrieved sections"
    // would claim sections were searched when none were.
    const r = await buildV3Prompt({
      surface: 'manual-chat',
      question: 'According to the document, what is the discount floor?',
      modeTemplateType: 'seminar',
      retrieval: evidencePort([]),
    });
    assert.equal(r.evidenceCount, 0);
    assert.equal(typeof r.evidenceBlock, 'string');
    assert.equal(r.evidenceBlock.trim(), '');
  });

  test('the block tracks the evidence, so a validator cannot be fooled by volume', async () => {
    const many = await buildV3Prompt({
      surface: 'manual-chat', question: 'What is the discount floor?', modeTemplateType: 'seminar',
      retrieval: evidencePort([FACT, 'Acme renewal window is 30 days', 'Acme escalation path is tier two']),
    });
    assert.ok(many.evidenceBlock.includes('renewal window'));
    assert.ok(many.evidenceBlock.length > 0);
    assert.equal(many.evidenceCount, 3);
  });
});

describe('T4 — the retry query is genuinely different, or there is none', () => {
  test('no structural handle => null, so no retrieval is spent asking the same thing twice', () => {
    for (const q of [
      'What is the retry backoff?',
      'How does the ingest path handle failures?',
      'Tell me about your role.',
    ]) {
      assert.equal(rewriteQueryForRetry(q, 'some retrieved text'), null, q);
    }
  });

  test('a missing exact identifier distils to that identifier', () => {
    const q = 'What is TECH-PDF-START-481 associated with?';
    assert.deepEqual(extractIdentifiers(q), ['TECH-PDF-START-481']);
    const r = rewriteQueryForRetry(q, 'unrelated retrieved chunk about pricing');
    assert.ok(r);
    assert.equal(r.reason, 'targeted_exact_lookup');
    assert.equal(r.query, 'TECH-PDF-START-481');
  });

  test('an identifier the first pass ALREADY returned does not trigger a retry', () => {
    // The bounded-ness that matters: a retry fires only when the admitted
    // evidence visibly lacks what was asked for.
    const q = 'What is TECH-PDF-START-481 associated with?';
    assert.equal(rewriteQueryForRetry(q, 'chunk mentioning tech-pdf-start-481 in context'), null);
  });

  test('a positional compound is stripped so the head term can be found anywhere', () => {
    const q = 'What is the last-page canary?';
    assert.equal(positionalDirection(q), 'last');
    const r = rewriteQueryForRetry(q, 'pages three through thirteen');
    assert.ok(r);
    assert.equal(r.reason, 'targeted_positional');
    assert.ok(!/last-page/i.test(r.query), `positional compound survived: ${r.query}`);
    assert.match(r.query, /canary/);
  });

  test('a bare positional word is NOT a document-position query', () => {
    // "last quarter revenue" must not trigger document-position targeting.
    assert.equal(positionalDirection('What was last quarter revenue?'), undefined);
    assert.equal(rewriteQueryForRetry('What was last quarter revenue?', ''), null);
  });

  test('hyphenated prose is not an identifier', () => {
    assert.deepEqual(extractIdentifiers('Describe the end-to-end state-of-the-art pipeline'), []);
  });

  test('the rewritten query is never equal to the original', () => {
    // The whole point. A retry that asks the same question is the first attempt.
    for (const q of ['What is TECH-PDF-START-481 associated with?', 'What is the last-page canary?']) {
      const r = rewriteQueryForRetry(q, '');
      assert.ok(r && r.query.trim() !== q.trim(), q);
    }
  });
});

describe('T4 — the flag default is environment-invariant', () => {
  test('NODE_ENV does not change docGroundedValidatorUsesSentEvidence', () => {
    const original = process.env.NODE_ENV;
    const seen = new Set();
    try {
      for (const env of ['production', 'development', 'test', undefined]) {
        if (env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = env;
        seen.add(isIntelligenceFlagEnabled('docGroundedValidatorUsesSentEvidence'));
      }
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
    assert.equal(seen.size, 1, `flag resolved differently across environments: ${[...seen]}`);
  });
});
