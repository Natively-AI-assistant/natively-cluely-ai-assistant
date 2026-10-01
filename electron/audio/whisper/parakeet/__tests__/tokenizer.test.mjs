import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetTokenizer } from '../tokenizer.ts';

describe('ParakeetTokenizer', () => {
  const sampleVocab = `
<unk> 0
<|nospeech|> 1
<pad> 2
<|endoftext|> 3
<|startoftranscript|> 4
▁Hello 5
, 6
▁world 7
! 8
<blk> 9
`.trim();

  test('parses vocab lines and identifies blankId', () => {
    const tok = new ParakeetTokenizer(sampleVocab);
    assert.equal(tok.vocabSize, 10);
    assert.equal(tok.blankId, 9);
  });

  test('decodes tokens into clean text with spaces and punctuation', () => {
    const tok = new ParakeetTokenizer(sampleVocab);
    // [4 (<|startoftranscript|>), 5 ( Hello), 6 (,), 7 ( world), 8 (!), 9 (<blk>)]
    const decoded = tok.decode([4, 5, 6, 7, 8, 9]);
    assert.equal(decoded, 'Hello, world!');
  });

  test('ignores unknown or blank token IDs safely', () => {
    const tok = new ParakeetTokenizer(sampleVocab);
    const decoded = tok.decode([999, 9, 5]);
    assert.equal(decoded, 'Hello');
  });
});
