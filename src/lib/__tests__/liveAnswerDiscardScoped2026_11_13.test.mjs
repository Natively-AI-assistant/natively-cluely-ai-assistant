// A "discard the open answer row" message from an OLDER answer run must not
// clear the newer run's row (pipeline forensics 2026-11-13, F-CTX-09).
// Main used to forward only { reason }, and the overlay cleared the current
// What-to-Answer row by intent, so a late discard from a replaced run wiped
// whatever was streaming now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldApplyLiveAnswerDiscard } from '../chatStreamGuard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('a discard from an older generation is ignored', () => {
  assert.equal(shouldApplyLiveAnswerDiscard(7, 6), false);
});

test('a discard for the live generation, a newer one, or one without an id applies', () => {
  assert.equal(shouldApplyLiveAnswerDiscard(7, 7), true);
  assert.equal(shouldApplyLiveAnswerDiscard(7, 8), true);
  assert.equal(shouldApplyLiveAnswerDiscard(7, undefined), true);
  assert.equal(shouldApplyLiveAnswerDiscard(null, 3), true);
});

test('main forwards the generation id with the discard, and the overlay checks it', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(main, /on\('suggested_answer_discard', \(reason: string, generationId\?: number\)/);
  assert.match(main, /'intelligence-suggested-answer-discard', \{ reason, \.\.\.\(typeof generationId === 'number' \? \{ generationId \} : \{\}\) \}/);
  const ui = fs.readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');
  assert.match(ui, /shouldApplyLiveAnswerDiscard\(liveAnswerGenIdRef\.current, data\?\.generationId\)/);
});
