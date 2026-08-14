// electron/llm/__tests__/LeakedJsonEnvelopeGuard_2026_07_18.test.mjs
//
// Campaign 2 longsession runs 022/025/026/027 (2026-07-18): a SIBLING
// failure to the JSON-schema stub (isLeakedSchemaStub) and the leaked-tag
// block (isLeakedInternalTagBlock) — MiniMax-M3 also occasionally leaks a
// plausible-looking, syntactically valid JSON "API response" envelope
// instead of prose. 6 live instances observed, no two using the same keys
// (`{"key_facts": []}`, `{"name": "noop", "arguments": {}}`,
// `{"answer": "...", "chat_id": 0}`). Grepped the entire source tree for
// every distinctive key seen — zero matches anywhere in app code, ruling
// out a real internal-schema/prompt leak; this is model hallucination of a
// generic JSON shape. isLeakedSchemaStub's key-name allowlist
// (type/$schema/properties/etc.) is the wrong tool since there's no fixed
// key set — isLeakedJsonEnvelope detects the SHAPE instead (a whole-answer
// JSON value with no genuine prose anywhere in it). Two of the six
// instances (run-026 C2, run-027 A18) wrapped REAL, substantive content
// under an "answer" key rather than emitting no content at all —
// extractAnswerFromJsonEnvelope recovers that real content, matching this
// campaign's established preference for extraction over discarding
// whenever a confident, narrow extraction exists (see the coding-scaffold-
// misfire extraction fix for the same principle).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isLeakedSchemaStub, isLeakedJsonEnvelope, extractAnswerFromJsonEnvelope } from '../../../dist-electron/electron/llm/index.js';

describe('isLeakedJsonEnvelope — live repros', () => {
  test('C15 (run-025): {"key_facts": []} is detected as a leaked envelope', () => {
    assert.equal(isLeakedJsonEnvelope('{"key_facts": []}'), true);
  });

  test('A11 (run-026): a raw tool-call-shaped stub is detected', () => {
    assert.equal(isLeakedJsonEnvelope('{"name": "noop", "arguments": {}}'), true);
  });

  // isLeakedSchemaStub itself does NOT catch these — it is deliberately kept
  // independent of isLeakedJsonEnvelope (an earlier draft had it fall
  // through internally, which silently bypassed the call site's own
  // exclusion scoping for isLeakedJsonEnvelope — see IntelligenceEngine.ts's
  // jsonAnswerLikelyAnswerTypes gate and its accompanying code comment).
  // The call site combines both checks with its own OR, applying the
  // exclusion only to the isLeakedJsonEnvelope branch.
  test('isLeakedSchemaStub alone does NOT catch these — it stays independently narrow (key-vocabulary-scoped)', () => {
    assert.equal(isLeakedSchemaStub('{"key_facts": []}'), false);
    assert.equal(isLeakedSchemaStub('{"name": "noop", "arguments": {}}'), false);
  });
});

describe('isLeakedJsonEnvelope — false-positive guards', () => {
  test('a real answer that legitimately contains prose in a JSON-shaped object is not flagged', () => {
    const real = '{"answer": "Skipping this turn, bro.", "chat_id": 0}';
    // "Skipping this turn, bro." is short but real prose (has a space,
    // >= PROSE_MIN_CHARS) — the envelope-emptiness check must not fire.
    assert.equal(isLeakedJsonEnvelope(real), false);
  });

  test('a normal prose answer with no JSON shape at all is never touched', () => {
    assert.equal(isLeakedJsonEnvelope("I owned the payments orchestration platform at Stripe."), false);
    assert.equal(isLeakedSchemaStub("I owned the payments orchestration platform at Stripe."), false);
  });

  test('a real answer over the 240-char length cap is never touched even if JSON-shaped', () => {
    const long = `{"note": "${'a real detailed technical explanation '.repeat(10)}"}`;
    assert.equal(isLeakedJsonEnvelope(long), false);
  });

  test('a real answer that legitimately quotes/discusses a JSON code example is not flagged (has genuine prose)', () => {
    const real = '{"description": "This endpoint returns the current user profile including their display name and avatar URL."}';
    assert.equal(isLeakedJsonEnvelope(real), false);
  });

  test('empty/whitespace input never crashes and returns false', () => {
    assert.equal(isLeakedJsonEnvelope(''), false);
    assert.equal(isLeakedJsonEnvelope('   '), false);
  });

  // ── Code-review 2026-07-18 HIGH finding: isLeakedJsonEnvelope's shape-only
  //    heuristic cannot distinguish a hallucinated envelope from a real,
  //    correct, terse JSON-shaped answer (e.g. to "what does a typical API
  //    response look like"). In ISOLATION this function still flags these —
  //    that is documented, expected behavior; the actual fix scopes the call
  //    at IntelligenceEngine.ts away from technical/coding answerTypes where
  //    a short JSON answer is legitimate (mirroring the exact precedent used
  //    for detectAndExtractScaffoldMisfire's own answerType exclusion set —
  //    see IntelligenceEngineJsonEnvelopeRecovery.test.mjs for the
  //    production-accurate, call-site-scoped coverage of this exclusion).
  //    These tests pin the pure function's documented (broad) behavior so a
  //    future edit can't silently narrow detection without updating both. ──
  test('a real terse JSON-shaped answer (status/code) is still flagged by the pure function in isolation', () => {
    assert.equal(isLeakedJsonEnvelope('{"status":"ok","code":200}'), true);
  });

  test('a real terse JSON-shaped answer (error/code) is still flagged by the pure function in isolation', () => {
    assert.equal(isLeakedJsonEnvelope('{"error":"User not found","code":404}'), true);
  });

  test('malformed/non-JSON text starting with a brace is never flagged (requires a clean parse)', () => {
    assert.equal(isLeakedJsonEnvelope('{ this is not valid json at all'), false);
  });
});

describe('extractAnswerFromJsonEnvelope — recovers real content, never guesses', () => {
  test('C2-shaped (run-026): recovers real, substantive answer content from an "answer" key', () => {
    const raw = '{"answer": "Sure, here\'s a classic shape: I was the incident commander when our payments API started failing.", "chat_id": 0}';
    const extracted = extractAnswerFromJsonEnvelope(raw);
    assert.ok(extracted, 'should extract real content, not null');
    assert.match(extracted, /incident commander/);
    assert.doesNotMatch(extracted, /"answer":/);
    assert.doesNotMatch(extracted, /chat_id/);
  });

  test('a genuinely empty/no-prose envelope (key_facts) is never "recovered" — returns null', () => {
    assert.equal(extractAnswerFromJsonEnvelope('{"key_facts": []}'), null);
  });

  test('a tool-call-shaped envelope with no "answer" key returns null', () => {
    assert.equal(extractAnswerFromJsonEnvelope('{"name": "noop", "arguments": {}}'), null);
  });

  test('a short/trivial "answer" value is not extracted (avoids recovering a non-answer like "ok")', () => {
    assert.equal(extractAnswerFromJsonEnvelope('{"answer": "ok", "chat_id": 0}'), null);
  });

  // ── Code-review 2026-07-18 HIGH fix: the first draft used a length-only
  //    check (>= PROSE_MIN_CHARS) instead of looksLikeProse (length AND
  //    whitespace), so a long-enough but non-prose token (a repeated
  //    character run, a snake_case sentinel) would have been extracted and
  //    shipped as if it were the real answer — the model already produces
  //    exactly this kind of token elsewhere in the same envelope shape
  //    (observed: "name":"noop", "chat_id":0). ─────────────────────────────
  test('a long but non-prose (no whitespace) "answer" value is NOT extracted — must look like real multi-word text', () => {
    assert.equal(extractAnswerFromJsonEnvelope('{"answer":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","chat_id":0}'), null);
    assert.equal(extractAnswerFromJsonEnvelope('{"answer":"no_answer_available_right_now","chat_id":0}'), null);
  });

  test('non-JSON prose is never touched', () => {
    assert.equal(extractAnswerFromJsonEnvelope('I owned the payments orchestration platform at Stripe.'), null);
  });

  test('empty/whitespace input never crashes and returns null', () => {
    assert.equal(extractAnswerFromJsonEnvelope(''), null);
    assert.equal(extractAnswerFromJsonEnvelope('   '), null);
  });

  test('a JSON array (not an object) is never touched', () => {
    assert.equal(extractAnswerFromJsonEnvelope('["answer", "some text here that is long enough"]'), null);
  });
});
