/**
 * Regression for the LIVE intro-grounding root cause found by the real-backend
 * MiniMax E2E campaign (round 13/14/15). The intro path has a FOUR-gate chain:
 *   AnswerPlanner.IDENTITY_PATTERNS  (answer routing)
 *   transcriptQuestionExtractor.classifyType → 'identity'  (live grounding gate)
 *   IntentClassifier.INTRO_PATTERNS → IntentType.INTRO  (MASTER gate)
 *   ContextAssembler.INTRO_PATTERNS → introResponse  (response build)
 * The MASTER gate (IntentClassifier) was missing the hyphenated/short-form intro
 * phrasings ("self-introduction", "brief intro", "introducing yourself"), so
 * intent !== INTRO and the ENTIRE intro-grounding path was bypassed — the live
 * answer degraded to "I don't have a resume loaded" / "could you run that again".
 *
 * This asserts (a) both INTRO_PATTERNS lists cover the real phrasings, and
 * (b) they stay IN SYNC (the drift between them WAS the bug).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const readPatterns = (rel) => {
  const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const m = src.match(/INTRO_PATTERNS\s*=\s*\[([\s\S]*?)\]/);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

const intentPatterns = readPatterns('premium/electron/knowledge/IntentClassifier.ts');
const assemblerPatterns = readPatterns('premium/electron/knowledge/ContextAssembler.ts');
const isIntro = (pats) => (q) => pats.some((p) => q.toLowerCase().includes(p));

const LIVE_INTROS = [
  'Great to meet you. To start, could you give us a quick self-introduction?',
  'Could you start by giving a brief introduction of yourself?',
  'Can you start by introducing yourself?',
  'Could you start by giving me a brief self-intro?',
  'Could you start us off with a brief self-introduction?',
];
const NON_INTROS = [
  'Give me a brief summary of your most impactful project.',
  'Can you give a quick overview of the system architecture?',
  'What are your salary expectations?',
  'How many years have you worked with Go?',
];

describe('IntentClassifier INTRO_PATTERNS (master gate) covers live intros', () => {
  const f = isIntro(intentPatterns);
  for (const q of LIVE_INTROS) test(`INTRO: "${q.slice(0, 40)}…"`, () => assert.ok(f(q)));
  for (const q of NON_INTROS) test(`NOT: "${q.slice(0, 40)}…"`, () => assert.ok(!f(q)));
});

describe('ContextAssembler INTRO_PATTERNS covers live intros', () => {
  const f = isIntro(assemblerPatterns);
  for (const q of LIVE_INTROS) test(`INTRO: "${q.slice(0, 40)}…"`, () => assert.ok(f(q)));
  for (const q of NON_INTROS) test(`NOT: "${q.slice(0, 40)}…"`, () => assert.ok(!f(q)));
});

describe('the two INTRO_PATTERNS lists stay in sync (drift WAS the bug)', () => {
  test('every live intro phrasing is matched by BOTH lists', () => {
    const a = isIntro(intentPatterns), b = isIntro(assemblerPatterns);
    for (const q of LIVE_INTROS) {
      assert.equal(a(q), b(q), `divergent classification for "${q}"`);
    }
  });
});
