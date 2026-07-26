// Regression for campaign2 iteration 55 (run-053): the answer-relevance
// guard's live-fire path now accepts/rejects its regeneration via
// `isLeakedAnswerArtifact`. When the repair call itself hits a transient
// provider failure (expired key, 429 rate-limit, billing), the
// `WhatToAnswerLLM.generateStream` catch yields the EXACT fixed literal
// "I couldn't reach the AI provider — this looks like an API key or
// rate-limit issue. Check your API keys / plan in Settings and try
// again." (see `isProviderTransportError` in answerPolish.ts). That
// literal is, by construction, NOT an answer to the user's question —
// if it overwrites the original real answer (which the guard just
// classified as low-confidence), the user sees the literal instead and
// the press flips from a real, partial-credit answer to a 0/0 score.
//
// Adding `isProviderTransportError(text)` to `isLeakedAnswerArtifact`
// means EVERY repair site that uses that function as its accept/reject
// gate (answer-relevance, profile-repair, doc-grounded-repair, scaffold-
// contamination-recheck) automatically rejects a provider-error repair
// and falls back to the original answer, matching the established
// "never silently ship a worse second guess" pattern for the other
// leakage shapes already in that function.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/answerPolish.js');
const { isLeakedAnswerArtifact, isProviderTransportError } = await import(pathToFileURL(modPath).href);

const PROVIDER_LITERAL = "I couldn't reach the AI provider — this looks like an API key or rate-limit issue. Check your API keys / plan in Settings and try again.";

describe('isLeakedAnswerArtifact — provider-transport-error rejection (campaign2 iteration 55)', () => {
  // Verbatim `isProviderTransportError` doc commitment: "exact (the string
  // is a fixed literal, not model-generated prose), so this can never
  // false-positive on a real answer that happens to discuss API keys or
  // rate limits." The fixture must be in scope across all three tests.
  const discussingAnswer = "I hit a rate limit during the Stripe webhook integration around t=18, so I added exponential backoff with jitter to the retry queue. The 429 responses tapered off after that.";

  test('the exact provider-transport-error literal IS flagged as a leaked artifact', () => {
    assert.equal(isLeakedAnswerArtifact(PROVIDER_LITERAL), true);
  });

  test('an answer that merely discusses API keys or rate limits (no literal match) is NOT flagged', () => {
    assert.equal(isLeakedAnswerArtifact(discussingAnswer), false);
  });

  test('the provider-transport-error literal is also caught by isProviderTransportError itself', () => {
    assert.equal(isProviderTransportError(PROVIDER_LITERAL), true);
    assert.equal(isProviderTransportError(""), false);
    assert.equal(isProviderTransportError(discussingAnswer), false);
  });
});
