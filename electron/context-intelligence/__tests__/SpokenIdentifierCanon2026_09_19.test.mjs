// Spoken identifiers, three defects (2026-09-19). Found on the LIVE natively
// stack: "Why did the forty-four seventy-one outage happen?" was the one miss in
// 20 paraphrased questions — the incident log says INC-4471 and the turn
// searched for number words it never contains. Probing the canonicalizer then
// showed two outright corruptions of plain input.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { canonicalizeSttSpellings: c } = await import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence/question/turn-classifier.js')).href);

describe('the noun that makes it an identifier may come AFTER the number', () => {
  test('"the <number> outage|incident|ticket|release" converts', () => {
    assert.equal(c('Why did the forty-four seventy-one outage happen?'), 'Why did the 4471 outage happen?');
    assert.equal(c('what happened in the twenty six oh one incident'), 'what happened in the 2601 incident');
    assert.equal(c('the twenty twenty five release'), 'the 2025 release');
  });
  test('quantities after "the" are untouched', () => {
    for (const q of ['the two options we discussed', 'the twenty percent discount', 'in the last twenty four hours', 'the three incidents last week', 'the forty four open tickets'])
      assert.equal(c(q), q);
  });
});

describe('a number word is never the head of an identifier', () => {
  test('a spelled-out prefix no longer corrupts the number ("i n c forty 471")', () => {
    assert.equal(c('i n c forty four seventy one what caused it'), 'i n c 4471 what caused it');
  });
  test('with a number word as the head, two words are a quantity and stay words', () => {
    // (An ORDINARY head followed by two number words — "we need forty four
    // more" → "44 more" — is older behaviour, meaning-preserving, and not
    // what this rule is about.)
    assert.equal(c('forty four people joined'), 'forty four people joined');
  });
});

describe('"X and <number> Y" is a conjunction, not an identifier after X', () => {
  test('the "and" is not eaten', () => {
    const q = 'we had forty four people and seventy one tickets';
    assert.equal(c(q), q);
  });
});

describe('unchanged behaviour', () => {
  test('head-noun identifiers still convert', () => {
    assert.equal(c('What caused incident forty-four seventy-one?'), 'What caused incident 4471?');
    assert.equal(c('what was ticket twenty six oh one about'), 'what was ticket 2601 about');
  });
});
