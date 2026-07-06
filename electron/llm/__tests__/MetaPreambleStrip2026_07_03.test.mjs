/**
 * Regression for the meta-commentary preamble leak (E2E MiniMax campaign,
 * autopilot pass). The live model sometimes narrated the task before the real
 * answer ("No identity question was actually asked. If I'm asking for a self-
 * introduction, here it is: I'm a critical care nurse…"). stripMetaPreamble
 * removes a SINGLE leading meta sentence ONLY when a substantive answer follows,
 * and never touches a clean answer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/answerPolish.js');
const { stripMetaPreamble } = await import(pathToFileURL(modPath).href);

describe('stripMetaPreamble', () => {
  test('strips "No identity question was asked… here it is:" and keeps the real intro', () => {
    const input = "No identity question was actually asked. If I'm asking for a self-introduction, here it is: I'm a critical care nurse with a BSN from the University of Cincinnati and an active Ohio RN license.";
    const out = stripMetaPreamble(input);
    assert.ok(out.startsWith("I'm a critical care nurse"), 'preamble removed, answer kept');
    assert.doesNotMatch(out, /no identity question/i);
  });

  test('does NOT strip a whole-meta answer with no real content after (leaves it for empty-retry)', () => {
    const input = 'The interviewer is asking about your interest in the role, so you should respond as the candidate explaining why you want this job.';
    // No substantive first-person answer follows → left intact (not silently emptied).
    assert.equal(stripMetaPreamble(input), input);
  });

  for (const clean of [
    "I'm Marcus, a senior backend engineer with 10 years building distributed systems.",
    'My biggest achievement was leading the settlement reconciliation pipeline at Stripe.',
    'The question of scale is central to my work — I architected systems at billions of requests.',
  ]) {
    test(`clean answer untouched: "${clean.slice(0, 40)}…"`, () => {
      assert.equal(stripMetaPreamble(clean), clean);
    });
  }
});
