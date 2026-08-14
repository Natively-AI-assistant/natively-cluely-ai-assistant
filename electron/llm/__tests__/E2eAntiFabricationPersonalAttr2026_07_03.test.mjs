/**
 * Regression for two defects found by the real-backend MiniMax E2E campaign
 * (2026-07-03). Deterministic — asserts the prompt rule + the routing fix that
 * address them. The live behavior is exercised by the E2E harness.
 *
 * Requires: npm run build:electron.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

describe('E2E F-FACT: unstated personal attribute must not be fabricated', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/llm/prompts.ts'), 'utf8');
  test('prompt has an admission template for unstated personal attributes/credentials', () => {
    // The gap the campaign found: driver\'s license / visa / relocation were not
    // covered by the existing "specific number/experience" anti-fabrication rules,
    // so the model answered "Yes, I have a valid driver\'s license" ungrounded.
    assert.match(src, /UNSTATED PERSONAL ATTRIBUTE \/ CREDENTIAL \/ STATUS/, 'template 5 present');
    assert.match(src, /driver'?s license/i, 'names the driver\'s-license example');
    assert.match(src, /MUST NOT invent a yes\/no or a specific value/i, 'forbids inventing a yes/no');
    assert.match(src, /FIVE admission templates/, 'count updated to FIVE');
  });
});

describe('E2E F-VOICE: intro phrasings route to identity (not general_meeting/experience)', () => {
  let planAnswer;
  test('load planAnswer', async () => {
    ({ planAnswer } = await import(pathToFileURL(path.resolve(repoRoot, 'dist-electron/electron/llm/AnswerPlanner.js')).href));
  });
  const introPhrasings = [
    'Could you give us a quick introduction?',
    'Give the team a brief intro.',
    'Tell us a little about yourself.',
    'So, to kick things off, could you tell me a little about yourself and your background?',
    // "self-introduction" / "self intro" variants (E2E round-13, p01 Q1).
    'Great to meet you. To start, could you give us a quick self-introduction?',
    'Please give a self intro.',
    'self-intro please',
  ];
  for (const q of introPhrasings) {
    test(`"${q.slice(0, 45)}…" → identity_answer, required, first person`, () => {
      const p = planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.equal(p.answerType, 'identity_answer');
      assert.equal(p.profileContextPolicy, 'required');
      assert.equal(p.voicePerspective, 'first_person_candidate');
    });
  }
});
