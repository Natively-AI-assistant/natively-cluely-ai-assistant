// Unit tests for electron/audio/whisper/hallucinationFilter.ts —
// filterHallucination() drops Whisper's well-known silence hallucinations
// ("Thanks for watching", "[BLANK_AUDIO]", ...) and otherwise returns the
// trimmed transcript.
//
// Loads the compiled CommonJS output from dist-electron/ (build first).
// Run from the repo root:
//   node --test electron/audio/whisper/__tests__/HallucinationFilter.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const { filterHallucination } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'whisper', 'hallucinationFilter.js'),
);

describe('filterHallucination — real speech passes through', () => {
  test('ordinary text is returned unchanged', () => {
    assert.equal(filterHallucination('Hello world'), 'Hello world');
    assert.equal(
      filterHallucination('Tell me about a time you led a project.'),
      'Tell me about a time you led a project.',
    );
  });

  test('surrounding whitespace is trimmed, inner whitespace and case are preserved', () => {
    assert.equal(filterHallucination('  Hello   World \n'), 'Hello   World');
    assert.equal(filterHallucination('\t\nOK\r\n'), 'OK');
  });

  test('two-character text is the shortest that survives', () => {
    assert.equal(filterHallucination('ok'), 'ok');
    assert.equal(filterHallucination('Hi'), 'Hi');
    assert.equal(filterHallucination('..'), '..');
  });

  test('non-English text passes through', () => {
    assert.equal(filterHallucination('こんにちは'), 'こんにちは');
    assert.equal(filterHallucination(' ¿Cómo estás? '), '¿Cómo estás?');
  });
});

describe('filterHallucination — too short', () => {
  test('empty and whitespace-only input yield an empty string', () => {
    assert.equal(filterHallucination(''), '');
    assert.equal(filterHallucination('   '), '');
    assert.equal(filterHallucination('\n\t '), '');
  });

  test('a single character is dropped, including after trimming', () => {
    assert.equal(filterHallucination('a'), '');
    assert.equal(filterHallucination('.'), '');
    assert.equal(filterHallucination('  x  '), '');
  });
});

describe('filterHallucination — exact known hallucinations', () => {
  const blocked = [
    '[music]',
    '[applause]',
    '[inaudible]',
    '(music)',
    'thank you for watching',
    'thanks for watching',
    'you',
    'bye',
    '...',
  ];

  for (const phrase of blocked) {
    test(`drops ${JSON.stringify(phrase)}`, () => {
      assert.equal(filterHallucination(phrase), '');
    });
  }

  test('matching is case-insensitive', () => {
    assert.equal(filterHallucination('Thank You For Watching'), '');
    assert.equal(filterHallucination('THANKS FOR WATCHING'), '');
    assert.equal(filterHallucination('You'), '');
    assert.equal(filterHallucination('BYE'), '');
    assert.equal(filterHallucination('(Music)'), '');
  });

  test('matching ignores surrounding whitespace', () => {
    assert.equal(filterHallucination('  thanks for watching\n'), '');
    assert.equal(filterHallucination(' you '), '');
    assert.equal(filterHallucination('\t...\t'), '');
  });

  test('only whole-string matches are dropped — the phrase inside a sentence survives', () => {
    assert.equal(filterHallucination('you are right'), 'you are right');
    assert.equal(filterHallucination('Thank you'), 'Thank you');
    assert.equal(filterHallucination('bye for now'), 'bye for now');
    assert.equal(filterHallucination('Goodbye'), 'Goodbye');
    assert.equal(filterHallucination('I was listening to music'), 'I was listening to music');
  });

  test('a blocked phrase with extra punctuation is not an exact match', () => {
    assert.equal(filterHallucination('Thanks for watching!'), 'Thanks for watching!');
    assert.equal(filterHallucination('Bye.'), 'Bye.');
    assert.equal(filterHallucination('....'), '....');
  });
});

describe('filterHallucination — bracketed tags', () => {
  test('any single fully-bracketed tag is dropped', () => {
    assert.equal(filterHallucination('[BLANK_AUDIO]'), '');
    assert.equal(filterHallucination('[Noise]'), '');
    assert.equal(filterHallucination('[ Silence ]'), '');
    assert.equal(filterHallucination('  [laughter]  '), '');
    assert.equal(filterHallucination('[]'), '');
  });

  test('text that merely contains or starts with a tag is kept', () => {
    assert.equal(filterHallucination('[Music] and then he said hello'), '[Music] and then he said hello');
    assert.equal(filterHallucination('he laughed [laughter]. Anyway'), 'he laughed [laughter]. Anyway');
    assert.equal(filterHallucination('[unterminated'), '[unterminated');
    assert.equal(filterHallucination('unopened]'), 'unopened]');
  });

  test('only square brackets are treated as tags — other parenthesised text is kept', () => {
    assert.equal(filterHallucination('(laughs)'), '(laughs)');
    assert.equal(filterHallucination('(applause)'), '(applause)');
    assert.equal(filterHallucination('{noise}'), '{noise}');
  });
});
