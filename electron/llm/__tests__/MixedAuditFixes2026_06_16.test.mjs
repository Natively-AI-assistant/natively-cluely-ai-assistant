/**
 * MixedAuditFixes2026_06_16.test.mjs — regression tests for the confirmed fixes from
 * the mixed-7000 audit. Property-based (no hardcoded answers, no Evin-specific strings).
 *
 * H6: simple factual profile questions render as speakable prose, not a STAR scaffold.
 * H2: compressToSpeakable strips model-invented markdown headers/tables/bold-labels
 *     from spoken answers while leaving fenced code untouched.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DIST = path.resolve(__dirname, '..', '..', '..', 'dist-electron', 'electron');
const planner = require(path.join(DIST, 'llm', 'AnswerPlanner.js'));
const polish = require(path.join(DIST, 'llm', 'answerPolish.js'));

const { planAnswer, formatAnswerPlanForPrompt, isSpeakableOnlyPlan } = planner;
const { compressToSpeakable } = polish;
// NOTE: the compressTechnicalConcept tests were removed 2026-06-16 — that function is
// owned/being-rewritten by a parallel speakability sprint (it now handles header-stripping
// itself via splitProseSentences + full markdown flattening). H2 header-strip coverage here
// is via compressToSpeakable (answerPolish), which this audit owns; tech-concept brevity is
// covered by GenericTechBrevity2026_06_15.test.mjs in that other sprint.

const SPEAKABLE_MARKER = /RENDERING \(overrides the section labels/;
const plan = (q, source = 'manual_input') => planAnswer({ question: q, source, speakerPerspective: source === 'what_to_answer' ? 'interviewer' : 'user' });

describe('H6: factual profile questions render speakable, not scaffolded', () => {
  // these are FACTUAL questions — they must NOT ship a STAR / Direct-Answer scaffold
  const factual = [
    'What companies have you worked at?',
    'How many years of experience do you have?',
    'What is your current role?',
    'Introduce yourself.',
    'Tell me about yourself.',
  ];
  for (const q of factual) {
    test(`"${q}" gets the speakable rendering directive on the manual surface`, () => {
      const p = plan(q);
      assert.ok(isSpeakableOnlyPlan(p), `${q} → ${p.answerType} should be speakable-only`);
      const ctx = formatAnswerPlanForPrompt(p, false);
      assert.match(ctx, SPEAKABLE_MARKER, `${q} (${p.answerType}) must carry the speakable directive`);
    });
  }

  test('explicit structure request ("in bullet points") still keeps structure', () => {
    const p = plan('List in bullet points the companies I worked at');
    // when the user explicitly asks for bullets, the speakable directive must NOT fire
    assert.equal(p.answerStyle, 'bullets');
    assert.ok(!isSpeakableOnlyPlan(p), 'explicit bullets request should keep structure');
  });

  test('WTA (spoken-aloud) profile answers remain speakable', () => {
    const p = plan('What companies have you worked at?', 'what_to_answer');
    assert.ok(isSpeakableOnlyPlan(p), 'WTA profile answers are always speakable');
  });
});

describe('H2: compressToSpeakable strips invented markdown from spoken answers', () => {
  const hasHeader = (s) => /^[ \t]{0,3}#{1,6}[ \t]/m.test(s);
  const hasTableRow = (s) => /^[ \t]*\|.*\|[ \t]*$/m.test(s);
  const hasBoldLabel = (s) => /^\s*\*\*[^*\n]{1,40}:\*\*/m.test(s);

  test('ATX headers are removed, body text preserved', () => {
    const out = compressToSpeakable('## What is Redis\nRedis is an in-memory data store.');
    assert.ok(!hasHeader(out));
    assert.match(out, /in-memory data store/);
  });

  test('markdown tables are flattened to prose, content preserved', () => {
    const out = compressToSpeakable('| Feature | Value |\n|---|---|\n| Speed | High |\nThat is the gist.');
    assert.ok(!hasTableRow(out));
    assert.match(out, /Speed/);
    assert.match(out, /High/);
    assert.match(out, /gist/);
  });

  test('bold pseudo-headers ("**Use cases:**") are removed, list content preserved', () => {
    const out = compressToSpeakable('Redis is fast.\n\n**Use cases:** caching and sessions.');
    assert.ok(!hasBoldLabel(out));
    assert.match(out, /caching and sessions/);
  });

  test('fenced code is left COMPLETELY untouched (fence-safety must not regress)', () => {
    const input = 'Here is the code:\n```js\nfunction f(){ return 1; }\n```\nThat solves it.';
    assert.equal(compressToSpeakable(input), input);
  });

  test('a mermaid/diagram block is left untouched', () => {
    const input = '```mermaid\ngraph TD; A-->B;\n```';
    assert.equal(compressToSpeakable(input), input);
  });

  test('idempotent: compressing twice equals compressing once', () => {
    const input = '## Title\n| a | b |\n|---|---|\n| 1 | 2 |\nProse tail.';
    const once = compressToSpeakable(input);
    assert.equal(compressToSpeakable(once), once);
  });

  test('a clean spoken answer is unchanged in substance', () => {
    const input = 'I led the Redis migration and cut latency by forty percent.';
    const out = compressToSpeakable(input);
    assert.match(out, /Redis migration/);
    assert.match(out, /forty percent/);
  });
});
