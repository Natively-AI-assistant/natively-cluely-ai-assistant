/**
 * Regression for the WTA profile-grounding-skip bug found by the real-backend
 * MiniMax E2E campaign (2026-07-03). The live auto-trigger
 * (handleSuggestionTrigger) calls runWhatShouldISay(trigger.lastQuestion, …),
 * passing the interviewer question as the `question` arg. The grounding block was
 * gated `if (groundable && !question)` — so the LIVE path skipped profile
 * grounding entirely and answered "I don't have your resume loaded" and omitted
 * employer names.
 *
 * This is a source-level assertion (the full grounded generation needs the live
 * app + backend; the E2E harness exercises that). It locks the gate so the fix
 * can't silently regress back to `!question`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

test('WTA grounding is NOT gated on bare !question (that skipped the live trigger)', () => {
  // The naive gate must be gone.
  assert.doesNotMatch(src, /if \(groundable && !question\) \{/,
    'the old `if (groundable && !question)` gate must be replaced');
});

test('WTA grounding runs for the live trigger (question === transcript question)', () => {
  // The fix: ground when no question OR the supplied question IS the transcript
  // question (the live auto-trigger case).
  assert.match(src, /questionIsTranscriptQuestion/, 'introduces the live-trigger discriminator');
  assert.match(src, /groundable && \(!question \|\| questionIsTranscriptQuestion\)/,
    'grounds on no-question OR the live-trigger transcript question');
});

test('grounding-eligible types include jd_alignment and general (candidate-directed)', () => {
  // Both were excluded before, so "why this role" / "most recent role" / "how many
  // years on distributed systems" got no profile grounding.
  const gateBlock = src.slice(src.indexOf('const groundable ='), src.indexOf('const groundable =') + 600);
  assert.match(gateBlock, /questionType === 'jd_alignment'/, 'jd_alignment groundable');
  assert.match(gateBlock, /questionType === 'general'/, 'general groundable');
});

test('negotiation-leak protection preserved (factualRecall + !liveNegotiationResponse gate intact)', () => {
  assert.match(src, /knowledge\.factualRecall === true && !knowledge\.liveNegotiationResponse/,
    'the salary/coaching leak gate must remain — widening groundable types must not bypass it');
});
