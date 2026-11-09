// A fixed seed, except when the same prompt is sent again (2026-11-09).
// Live on Gemini Flash, one Lecture prompt timed out 8 times out of 8 with
// seed 7 at temperature 0.2: every retry sent the identical request. Pure
// bookkeeping, no platform branches: holds on macOS and Windows alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.join(process.cwd(), 'dist-electron/electron/llm/interactiveSeed.js');
const m = await import(pathToFileURL(dist).href);

test('first send keeps the base seed; each repeat of the same prompt gets the next one', () => {
  m.resetInteractiveSeeds();
  const parts = ['gemini-flash', 'SYS', 'What grade did you get?'];
  assert.equal(m.interactiveSeedFor('gemini', parts, 1_000), 7);
  assert.equal(m.interactiveSeedFor('gemini', parts, 2_000), 8);
  assert.equal(m.interactiveSeedFor('gemini', parts, 3_000), 9);
});

test('a different prompt, model or provider is a first send of its own', () => {
  m.resetInteractiveSeeds();
  assert.equal(m.interactiveSeedFor('gemini', ['flash', 'SYS', 'Q1'], 0), 7);
  assert.equal(m.interactiveSeedFor('gemini', ['flash', 'SYS', 'Q2'], 0), 7);
  assert.equal(m.interactiveSeedFor('gemini', ['pro', 'SYS', 'Q1'], 0), 7);
  assert.equal(m.interactiveSeedFor('groq', ['flash', 'SYS', 'Q1'], 0), 7);
});

test('a repeat long after the last send starts over at the base seed', () => {
  m.resetInteractiveSeeds();
  const parts = ['m', 'S', 'U'];
  m.interactiveSeedFor('gemini', parts, 0);
  assert.equal(m.interactiveSeedFor('gemini', parts, m.REPEAT_WINDOW_MS + 1), 7);
});

test('the four LLMHelper seed sites use it, and no fixed seed constant is left', () => {
  const s = fs.readFileSync(path.join(process.cwd(), 'electron/LLMHelper.ts'), 'utf8');
  assert.doesNotMatch(s, /seed: INTERACTIVE_SEED/);
  for (const p of ["interactiveSeedFor('gemini'", "interactiveSeedFor('groq'", "interactiveSeedFor('deepseek'", "interactiveSeedFor('agentrouter'"]) {
    assert.ok(s.includes(p), p);
  }
  // Gemini: once per request, not per buildConfig call (a cache-miss rebuild is not a repeat).
  assert.match(s, /const requestSeed = interactiveSeedFor\('gemini'[\s\S]{0,400}seed: requestSeed/);
});
