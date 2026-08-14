// electron/services/__tests__/ModeTokenizerApostrophe.test.mjs
//
// Regression test for FINDING-002: the retriever's tokenizer used to convert
// every non-alphanumeric character to a space, splitting "Green's" into
// "green" + "s", then dropping "s" via the length>2 filter. Short academic
// queries about Green's function therefore lost ~30% of their tokens before
// scoring, frequently falling below the 0.18 relevance threshold.
//
// The fix strips English possessive `'s` as a unit on both query and chunk —
// "Green's" → "green" and "interviewer's" → "interviewer" — so possessive
// queries match plain nouns in the chunks and vice versa. Remaining
// apostrophes (contractions) are dropped so "don't" → "dont".
//
// This test exercises the contract via ModeContextRetriever (which delegates
// to the same wordsOf as ModeHybridRetriever — see comment in the latter).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';
import { loadReferenceFiles, SENTINELS } from '../../../tests/utils/referenceFileFactory.mjs';

describe('FIX-002: Tokenizer preserves apostrophe-bearing tokens', () => {
  test("Bare query 'Greens function definition LG delta' retrieves the lecture sentinel without needing a transcript", () => {
    const mode = makeMode('mode_lecture_token', 'lecture', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('lecture'));
    const result = runScenario({
      mode,
      files,
      // Note: NO transcript passed. Production usage often DOES pass a
      // transcript, but at the very start of a session the query is the
      // only signal. After the fix, "Greens" survives as "greens", matching
      // the fixture's "Green's" (also tokenized to "greens").
      query: "Greens function definition satisfies LG delta",
    });
    assert.ok(
      result.snippets.length > 0,
      'Tokenizer fix should make the bare apostrophe-stripped query retrieve at least one snippet'
    );
    // The chunk text is preserved verbatim (apostrophes intact in output);
    // assert against the XML-escaped form because formatted output passes
    // through escapeXmlText.
    const raw = SENTINELS.lecture.definition;
    const escaped = raw.replace(/'/g, '&apos;');
    assert.ok(
      result.formattedContext.includes(raw) ||
        result.formattedContext.includes(escaped),
      `Expected the Green's-function definition sentinel after the fix.\nHaystack:\n${result.formattedContext.slice(0, 1200)}`
    );
  });

  test("Sarah's possessive in the team-meet fixture is matched by a 'Sarah's' query", () => {
    const mode = makeMode('mode_team_token', 'team-meet', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('team-meet'));
    const result = runScenario({
      mode,
      files,
      // Both forms — "Sarah" (root) and "Sarah's" (possessive) — collapse to
      // "sarah" after the fix, so this query overlaps with the file's
      // "Sarah owns the launch checklist…" line on multiple tokens.
      query: "Sarah's launch checklist deadline Friday ownership",
    });
    assert.ok(
      result.snippets.length > 0,
      "Possessive \"Sarah's\" in the query must collapse to \"sarah\" and match the file."
    );
  });

  test("New: query with 'interviewer's complexity' matches a file that uses plain 'Interviewer prefers …'", () => {
    const mode = makeMode('mode_tech_possessive', 'technical-interview', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('technical-interview'));
    const result = runScenario({
      mode,
      files,
      // This is the regression that originally broke the technical-interview
      // scenario when we tried strip-only tokenizer behavior: the query has
      // a possessive, the file does NOT. After the possessive-strip fix,
      // both sides reduce to "interviewer" and the chunk scores above
      // threshold.
      query: "what is the interviewer's complexity preference",
    });
    assert.ok(
      result.snippets.length > 0,
      "Possessive in query (interviewer's) must collapse to the noun root and match a plain 'Interviewer' in the chunk."
    );
  });

  test("Contraction 'cant' in a query matches a chunk containing \"can't\"", () => {
    const mode = makeMode('mode_contraction', 'general', '');
    const files = asReferenceFiles(mode.id, [{
      fileName: 'note.md',
      content: "We can't ship until step seven is verified by the rollback drill on Thursday.",
    }]);
    const result = runScenario({
      mode,
      files,
      query: 'cant ship rollback drill Thursday verified',
    });
    // The match strength comes from "cant" matching "cant" (post-fix), plus
    // "ship", "rollback", "drill", "thursday", "verified".
    assert.ok(
      result.snippets.length > 0,
      "Tokenizer fix should let 'cant' match \"can't\" in the chunk"
    );
  });

  test("Negative: apostrophe fix does not change matching for plain words (regression guard)", () => {
    const mode = makeMode('mode_plain', 'sales', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('sales'));
    const result = runScenario({
      mode,
      files,
      query: 'Acme enterprise discount floor 17 percent pricing policy',
    });
    // Pre-fix this also worked. We assert it still works to make sure the
    // fix didn't accidentally drop or alter plain word matching.
    assert.ok(
      result.snippets.length > 0,
      'Plain-word queries should still match after the apostrophe fix'
    );
    assert.ok(
      result.formattedContext.includes('17 percent') ||
        result.formattedContext.includes('17 percent'),
      'Acme discount-floor sentinel must still retrieve after fix'
    );
  });
});
