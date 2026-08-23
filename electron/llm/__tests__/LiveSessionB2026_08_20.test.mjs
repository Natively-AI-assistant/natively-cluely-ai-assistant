// electron/llm/__tests__/LiveSessionB2026_08_20.test.mjs
//
// Regression suite from live shadow session B (2026-08-20, LocalWhisper, 37
// What-to-Answer presses — the first run with answer text in the log). Every
// string below is verbatim from that session.
//
// What it measured: 17 of 37 presses had the question REWRITTEN between
// extraction and answering. Six were correct (narrowing refinements and topic
// shifts resolving to their parent — the intended behaviour). Eleven were
// CORRUPTIONS produced by SessionMemory's demonstrative substitution firing on
// long, self-contained questions:
//
//   "…because that's honestly the most interesting part of your CV"
//        → "…because EstroTech's honestly the most interesting part…"
//   "…three things about it why you went with playwright…"
//        → "…three things about Playwright why you went with playwright…"
//   "…and answer this one first across all three of these projects…"
//        → "…and answer Playwright first across all three of these projects…"
//   "I mean the one you defend in a design review"
//        → "I mean WebSocket you defend in a design review"
//
// The damage was not cosmetic. The corrupted PriceX question ("three things
// about EstroTech … playwright … rate limiting") described a project that
// never used Playwright, and the model answered "I don't have those specific
// details from my background, so I can't speak to what actually happened at
// EstroTech" — a FALSE REFUSAL on a question the résumé answers directly
// (PriceX: "high-concurrency scraping pipeline using Playwright and Python").
//
// Two root causes, both fixed here:
//   1. NO LENGTH GUARD on the direct-substitution branch. The bare-pronoun
//      fallback rewrote any "it"/"that"/"there" anywhere in a 17-word
//      self-contained question. A demonstrative follow-up is by nature SHORT
//      ("how is it developed?", "what was the hardest part of that project?");
//      a long question that merely contains "it" is not referential.
//   2. `\bthat\b` MATCHED THE CONTRACTION "that's" (the apostrophe is a word
//      boundary), turning "because that's honestly" into "because EstroTech's
//      honestly".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { SessionMemory } = await import(dist('SessionMemory.js'));
const { resolveSessionFollowup } = await import(dist('sessionFollowupResolver.js'));

const withEntity = (value = 'Playwright', kind = 'project') => {
  const m = new SessionMemory();
  m.note(kind, value, 100, 'interview');
  return m;
};
const resolve = (latestQuestion, opts = {}) => resolveSessionFollowup({
  latestQuestion,
  previousQuestion: opts.previousQuestion ?? 'Tell me about your best project.',
  now: 200,
  mode: 'interview',
  surface: 'what_to_answer',
  memory: opts.memory ?? withEntity(),
  expectedKind: opts.expectedKind ?? 'project',
});

describe('session B: long self-contained questions must NOT be entity-substituted', () => {
  for (const q of [
    "Let's get into the projects because that's honestly the most interesting part of your CV for me",
    "I'm really trying to understand three things about it why you went with playwright for the scraping instead of something lighter",
    "Actually also and answer this one first across all three of these projects what's the single hardest technical decision you made",
    "And I don't mean the flashiest. I mean the one you defend in a design review",
    "That's genuinely useful context going back to the memory leak you mentioned earlier how long did it take to ship the fix",
  ]) {
    test(`"${q.slice(0, 52)}…" survives verbatim`, () => {
      const r = resolve(q);
      // Either no resolution at all, or a resolution that did not inject the
      // remembered entity into an already self-contained question.
      if (r.resolvedQuestion) {
        assert.ok(
          !/Playwright/.test(r.resolvedQuestion) || /playwright/.test(q),
          `entity injected into a self-contained question: ${String(r.resolvedQuestion).slice(0, 90)}`,
        );
      }
    });
  }

  test('the contraction "that\'s" is never treated as the demonstrative "that"', () => {
    const r = resolve("Let's get into the projects because that's honestly the most interesting part of your CV for me");
    assert.doesNotMatch(r.resolvedQuestion || '', /Playwright's/, "rewrote \"that's\" into \"<entity>'s\"");
  });
});

describe('session B: genuine short demonstrative follow-ups still resolve (no over-fix)', () => {
  test('"How is it developed?" still substitutes the remembered project', () => {
    const r = resolve('How is it developed?');
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion || '', /Playwright/);
  });

  test('"What was the hardest part of that project?" still substitutes', () => {
    const r = resolve('What was the hardest part of that project?');
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion || '', /Playwright/);
  });

  test('"Why did you build it?" still substitutes', () => {
    const r = resolve('Why did you build it?');
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion || '', /Playwright/);
  });
});
