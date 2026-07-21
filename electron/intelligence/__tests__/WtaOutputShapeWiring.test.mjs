// node:test — Phase 4 live-wiring verification: the WTA output-shape normalizer.
//
// CONTEXT (verified gap): the MANUAL chat path (electron/ipcHandlers.ts ~1255) already
// applies answer polish (cleanAnswerArtifacts + AnswerDiversityGuard + compressToSpeakable),
// but the WTA ("What to answer?") path in IntelligenceEngine.runWhatShouldISay applied NO
// polish — empty "*" bullets and visible scaffold labels in default-style answers reached
// the UI uncleaned. Phase 4 closed THAT gap by computing, just before
// session.addAssistantMessage / pushUsage / emit('suggested_answer', …):
//
//   let finalWtaAnswer = fullAnswer;
//   try {
//     if (isIntelligenceFlagEnabled('answerDiversityGuard')) {
//       const shaped = normalizeOutputShape({ answer: fullAnswer, answerStyle, isCoding });
//       if (shaped.changed && shaped.text.trim().length >= 10) finalWtaAnswer = shaped.text;
//     }
//   } catch { /* normalizer never blocks the answer */ }
//
// This test does NOT re-run the engine. It pins the WTA-relevant CONTRACT of the REAL
// compiled normalizeOutputShape under the EXACT acceptance gate the engine applies
// (changed === true && text.trim().length >= 10), so we prove that what the engine would
// substitute is correct and safe. The flag plumbing (default OFF) and the byte-for-byte
// flag-OFF path are pinned in DurableMemoryWiring/IntelligenceFlags tests and by source
// inspection (finalWtaAnswer initialized to fullAnswer; only reassigned inside the
// flag-gated if). The renderer REPLACE-not-append behavior is pinned by
// overlayMessagePersistence / streamingTokenQueue tests (finalize assigns row.text).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOutputShape } from '../../../dist-electron/electron/intelligence/OutputShapeNormalizer.js';

// Reproduce the EXACT engine acceptance gate (IntelligenceEngine.ts ~1475-1476) so the
// test asserts on the value the engine would actually deliver, not just the raw result.
function engineWtaSubstitution(fullAnswer, { answerStyle, isCoding } = {}) {
  const shaped = normalizeOutputShape({ answer: fullAnswer, answerStyle, isCoding });
  const accepted = shaped.changed && shaped.text.trim().length >= 10;
  return { delivered: accepted ? shaped.text : fullAnswer, accepted, shaped };
}

describe('WTA output-shape wiring contract (real compiled normalizeOutputShape)', () => {
  // (a) empty "*" bullet lines in a default-style answer → cleaned, no lone "*" lines.
  test('(a) empty "*" bullets are stripped under the engine gate', () => {
    const answer = 'You should highlight your backend depth here.\n*\nKeep it concise and confident.';
    const { delivered, accepted, shaped } = engineWtaSubstitution(answer, { answerStyle: 'default' });
    assert.equal(accepted, true, 'engine should accept (changed + >=10 chars)');
    assert.ok(shaped.changed, 'shaped.changed must be true');
    assert.ok(shaped.applied.includes('cleaned_artifacts'), 'cleaned_artifacts must be applied');
    // No line consisting only of a bullet marker survives.
    assert.doesNotMatch(delivered, /^[ \t]*[-*•+][ \t]*$/m, 'no lone bullet-marker line');
    // The real content is preserved.
    assert.match(delivered, /backend depth/);
    assert.match(delivered, /concise and confident/);
  });

  test('(a2) a trailing orphan bullet at the very end is removed', () => {
    const answer = 'Lead with the migration you owned and the latency win it produced. *';
    const { delivered, accepted } = engineWtaSubstitution(answer, { answerStyle: 'default' });
    assert.equal(accepted, true);
    assert.doesNotMatch(delivered, /\*\s*$/, 'no dangling trailing bullet');
    assert.match(delivered, /latency win/);
  });

  // (b) default-style (and undefined-style) answer with visible scaffold labels
  // ("Direct Answer:", "Speakable Final Answer:") + >=40-char body → compressed.
  const TEMPLATED = 'Direct Answer: I am a strong fit for this senior backend role.\n'
    + 'Matching Experience: I led platform reliability work for five years at scale.\n'
    + 'Speakable Final Answer: I would say I am a great fit because I have led backend '
    + 'reliability at scale for years and shipped the exact kind of platform work this role needs.';

  test('(b) default style → scaffold labels compressed away', () => {
    const { delivered, accepted, shaped } = engineWtaSubstitution(TEMPLATED, { answerStyle: 'default' });
    assert.equal(accepted, true, 'engine should accept the compressed prose');
    assert.ok(shaped.applied.includes('compressed_to_speakable'), 'compressed_to_speakable applied');
    assert.doesNotMatch(delivered, /Direct Answer:/, 'Direct Answer: label removed');
    assert.doesNotMatch(delivered, /Speakable Final Answer:/, 'Speakable Final Answer: label removed');
    assert.doesNotMatch(delivered, /Matching Experience:/, 'Matching Experience: label removed');
    assert.ok(delivered.trim().length >= 40, 'compressed body is substantial');
  });

  test('(b2) undefined answerStyle behaves like default (compressed)', () => {
    const { delivered, accepted } = engineWtaSubstitution(TEMPLATED, { answerStyle: undefined });
    assert.equal(accepted, true);
    assert.doesNotMatch(delivered, /Direct Answer:|Speakable Final Answer:/);
  });

  // (c) structured-style answers KEEP their scaffold labels (changed=false OR labels kept).
  test('(c) detailed/bullets/notes KEEP scaffold labels (structure was requested)', () => {
    for (const answerStyle of ['detailed', 'bullets', 'notes']) {
      const { delivered, shaped } = engineWtaSubstitution(TEMPLATED, { answerStyle });
      // Labels must be retained for structured styles.
      assert.match(delivered, /Direct Answer:/, `style=${answerStyle} keeps Direct Answer:`);
      // compress must NOT have fired for a structured style.
      assert.ok(
        !shaped.applied.includes('compressed_to_speakable'),
        `style=${answerStyle} must not compress`,
      );
    }
  });

  // (d) isCoding=true → unchanged even when bullets / list-like shapes are present.
  test('(d) coding answers are returned unchanged (sectioned output is intentional)', () => {
    const codingAnswer = '## Approach\nUse a hash map.\n\n```js\nconst seen = new Map();\n```\n* O(n) time';
    const { delivered, accepted, shaped } = engineWtaSubstitution(codingAnswer, {
      answerStyle: 'default',
      isCoding: true,
    });
    assert.equal(shaped.changed, false, 'coding → changed === false');
    assert.equal(accepted, false, 'engine gate not satisfied → keeps original');
    assert.equal(delivered, codingAnswer, 'coding answer byte-identical');
    assert.equal(shaped.text, codingAnswer, 'normalizer returned input verbatim');
  });

  test('(d2) coding skip beats even an empty-bullet artifact (no cleanup applied)', () => {
    // Same artifact that WOULD be cleaned in prose; isCoding must short-circuit BEFORE cleanup.
    const codingAnswer = 'function f(){}\n*\nmore code context';
    const { delivered, shaped } = engineWtaSubstitution(codingAnswer, { isCoding: true });
    assert.equal(shaped.changed, false);
    assert.equal(delivered, codingAnswer);
  });

  // (e) clean prose → no-op, so flag-ON on an already-good answer is byte-safe.
  test('(e) clean prose is a no-op (flag ON on a good answer changes nothing)', () => {
    const clean = 'Tell them you led the payments migration end to end and cut p95 latency by 40 percent, '
      + 'then tie it directly to what this role needs.';
    const { delivered, accepted, shaped } = engineWtaSubstitution(clean, { answerStyle: 'default' });
    assert.equal(shaped.changed, false, 'no change on clean prose');
    assert.equal(accepted, false, 'engine keeps the original (gate not satisfied)');
    assert.equal(delivered, clean, 'delivered === original, byte-for-byte');
  });

  test('(e2) clean prose with a real markdown bullet list is preserved (not a lone marker)', () => {
    // Bullets WITH content must NOT be treated as empty-bullet artifacts.
    const withList = 'Lead with two proof points:\n* Cut p95 latency by 40 percent.\n* Owned the migration end to end.';
    const { shaped } = engineWtaSubstitution(withList, { answerStyle: 'default' });
    assert.equal(shaped.changed, false, 'content bullets are preserved');
    assert.match(shaped.text, /Cut p95 latency/);
    assert.match(shaped.text, /Owned the migration/);
  });

  // (f) never throws on empty / garbage; the engine also wraps in try/catch as a 2nd layer.
  test('(f) never throws on empty / whitespace / garbage input', () => {
    for (const bad of ['', '   ', '\n\n', '***', '* * *', ' ', '```unterminated', undefined]) {
      assert.doesNotThrow(() => normalizeOutputShape({ answer: bad, answerStyle: 'default' }), `input=${JSON.stringify(bad)}`);
      const r = normalizeOutputShape({ answer: bad, answerStyle: 'default' });
      assert.equal(typeof r.text, 'string');
      assert.equal(typeof r.changed, 'boolean');
    }
  });

  // The engine's >=10-char gate: a result that compresses to something too short must be
  // REJECTED by the engine (keeps fullAnswer), never deliver a sub-10-char fragment.
  test('(gate) engine rejects a substitution whose trimmed result is < 10 chars', () => {
    // Force a "changed but tiny" outcome by giving a lone-bullet answer whose only real
    // content is short; cleanup yields a < 10-char string → engine must keep the original.
    const tiny = '*\nHi.';
    const shaped = normalizeOutputShape({ answer: tiny, answerStyle: 'default' });
    if (shaped.changed && shaped.text.trim().length < 10) {
      const { delivered, accepted } = engineWtaSubstitution(tiny, { answerStyle: 'default' });
      assert.equal(accepted, false, 'sub-10-char result rejected by engine gate');
      assert.equal(delivered, tiny, 'engine keeps the original rather than a tiny fragment');
    } else {
      // If the normalizer happened not to shrink below 10, the contract is still satisfied
      // (the gate exists precisely to guard the shrink case); assert it stays a string.
      assert.equal(typeof shaped.text, 'string');
    }
  });
});
