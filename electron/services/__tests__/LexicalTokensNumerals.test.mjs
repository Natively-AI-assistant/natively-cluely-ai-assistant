// The shared FTS tokenizer, and the numeral equivalence it adds.
//
// A-03 regression. "How fast did Natively reach ten thousand users?" retrieved
// NOTHING from a résumé reading "scaled Natively to 10k users in the first 90
// days", because the lexical arm contributed exactly zero and the vector score
// alone could not clear the combined-score floor. Measured:
//
//   query "…ten thousand users?"  ->  résumé fts 0.000
//   query "…10k users?"           ->  résumé fts 0.152
//
// This file also guards the thing the two old copies could not: they carried a
// comment saying "keep in lock-step", had already drifted in wording, and a
// functional drift would have silently mis-fused FTS and vector scores.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const { wordsOf, numeralTokens } = await import(
  path.resolve(process.cwd(), 'dist-electron/electron/services/modes/lexicalTokens.js')
);

describe('numeral equivalence', () => {
  const has = (text, tok) => wordsOf(text).includes(tok);

  test('spelled-out and compact forms produce the SAME token', () => {
    assert.ok(has('ten thousand users', '10000'), 'ten thousand -> 10000');
    assert.ok(has('scaled Natively to 10k users', '10000'), '10k -> 10000');
  });

  test('the A-03 pair actually shares a lexical token', () => {
    const q = new Set(wordsOf('How fast did Natively reach ten thousand users?'));
    const chunk = wordsOf('Built PriceX; scaled Natively to 10k users in the first 90 days.');
    const shared = chunk.filter((w) => q.has(w));
    assert.ok(shared.includes('10000'),
      `the quantity must match across phrasings; shared = ${JSON.stringify(shared)}`);
  });

  test('comma grouping does not split one quantity into two tokens', () => {
    // The tokenizer turns punctuation into spaces, so "1,250,000" would otherwise
    // become "250" and "000" — two tokens that are not the number.
    assert.ok(has('1,250,000 transactions', '1250000'));
    assert.ok(has('5.1 million transactions per day', '5100000'));
  });

  test('scale words compose', () => {
    assert.deepEqual(numeralTokens('two hundred fifty').includes('250'), true);
    assert.deepEqual(numeralTokens('three million').includes('3000000'), true);
    assert.deepEqual(numeralTokens('nineteen').includes('19'), true);
  });

  test('expansion is ADDITIVE — original tokens survive', () => {
    const toks = wordsOf('scaled to 10k users');
    assert.ok(toks.includes('10k'), 'the original token must still be there');
    assert.ok(toks.includes('users'));
    assert.ok(toks.includes('10000'));
  });

  test('text with no quantity is unchanged, and pays nothing', () => {
    const toks = wordsOf('Built a WebRTC pipeline for developer tooling');
    assert.ok(!toks.some((t) => /^\d+$/.test(t)), `no numeric tokens expected, got ${JSON.stringify(toks)}`);
  });

  test('the base transformation chain is preserved', () => {
    // These are the properties the two replaced copies had, and hybrid score
    // fusion depends on query and chunk being tokenized identically.
    assert.deepEqual(wordsOf("Green's function"), ['green', 'function']);
    assert.deepEqual(wordsOf("don't"), ['dont']);
    assert.deepEqual(wordsOf('a an the of'), ['the'], 'tokens of 1-2 chars are dropped');
    assert.deepEqual(wordsOf('Mixed-Case Hyphen-Word'), ['mixed-case', 'hyphen-word']);
  });

  test('a bare year is not mangled', () => {
    // "Graduated 2017" must keep 2017 as a token — it is already canonical.
    assert.ok(wordsOf('Graduated 2017').includes('2017'));
  });
});
