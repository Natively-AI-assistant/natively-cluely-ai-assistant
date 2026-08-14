// Context Intelligence V3 — BM25.
//
// These assert the PROPERTIES that make BM25 beat the shipped scorer, not just
// that it runs. The shipped scorer is matches/sqrt(|Q|*|unique|) over
// DE-DUPLICATED matches, so it is blind to term frequency and to how rare a
// term is. Each test below targets one of those blind spots.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { Bm25Index, tokenize, DEFAULT_BM25 } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence/retrieval/bm25.js')).href
);

describe('tokenizer parity with the legacy retriever', () => {
  test('matches ModeHybridRetriever.wordsOf behaviour', () => {
    // possessive stripped, punctuation dropped, <=2 chars filtered, hyphen kept
    assert.deepEqual(tokenize("Green's function is a 12-mark topic"),
      ['green', 'function', '12-mark', 'topic']);
    // The legacy filter is `length > 2`, so "the" (3 chars) SURVIVES while
    // "a"/"an"/"of" do not. This is not stop-word removal — matching that exact
    // behaviour matters, because divergence would silently change every score.
    assert.deepEqual(tokenize('a an the of'), ['the']);
    assert.deepEqual(tokenize('MeetingPersistence.ts:212'), ['meetingpersistence', '212']);
  });
});

describe('BM25 scoring properties', () => {
  test('rewards rare terms over common ones (IDF) — the shipped scorer cannot', () => {
    const idx = new Bm25Index([
      { id: 'a', text: 'the system uses postgres for the ledger' },
      { id: 'b', text: 'the system uses redis for the cache' },
      { id: 'c', text: 'the system uses kafka for the stream' },
    ]);
    const ranked = idx.score('postgres system');
    assert.equal(ranked[0].id, 'a', '"postgres" is rare, "system" is in every doc');

    // A term present in EVERY document cannot discriminate between them. With the
    // +0.5-smoothed IDF its weight is small but non-zero (the unsmoothed variant
    // would go negative), so the correct assertion is that it separates nothing —
    // not that it scores exactly zero.
    const ubiquitous = idx.score('system');
    const spread = Math.max(...ubiquitous.map((r) => r.score)) - Math.min(...ubiquitous.map((r) => r.score));
    assert.ok(spread < 1e-9, 'a term in every document must not separate documents');

    // And it must be worth dramatically less than a term unique to one document.
    const rareTop = idx.score('postgres')[0].score;
    assert.ok(rareTop > ubiquitous[0].score * 5, 'a rare term must dominate a ubiquitous one');
  });

  test('accounts for term frequency — repeated matches rank higher', () => {
    const idx = new Bm25Index([
      { id: 'once', text: 'kafka appears here with lots of other filler words about systems' },
      { id: 'many', text: 'kafka kafka kafka appears here with other filler words about systems' },
    ]);
    const ranked = idx.score('kafka');
    assert.equal(ranked[0].id, 'many');
    assert.ok(ranked[0].score > ranked[1].score);
  });

  test('normalises for document length — a short exact hit beats a long diluted one', () => {
    const long = 'kafka ' + 'unrelated filler content '.repeat(40);
    const idx = new Bm25Index([
      { id: 'short', text: 'kafka streaming setup' },
      { id: 'long', text: long },
    ]);
    assert.equal(idx.score('kafka streaming')[0].id, 'short');
  });

  test('a query term absent from every document yields all-zero scores', () => {
    const idx = new Bm25Index([{ id: 'a', text: 'nothing relevant here' }]);
    assert.ok(idx.score('cassandra').every((r) => r.score === 0));
  });

  test('scoreNormalized bounds output to [0,1] so it can fuse with cosine', () => {
    const idx = new Bm25Index([
      { id: 'a', text: 'cassandra migration for the events table' },
      { id: 'b', text: 'postgres ledger stays as it is' },
    ]);
    const n = idx.scoreNormalized('cassandra events');
    assert.equal(n[0].score, 1);
    assert.ok(n.every((r) => r.score >= 0 && r.score <= 1));
  });

  test('empty index does not throw', () => {
    assert.deepEqual(new Bm25Index([]).score('anything'), []);
  });

  test('default params are the standard k1=1.5 b=0.75', () => {
    assert.deepEqual(DEFAULT_BM25, { k1: 1.5, b: 0.75 });
  });
});

describe('the corpus cases BM25 exists to win', () => {
  // These mirror real questions from test-fixtures/ci-v3-corpus/questions.json
  test('F-07: code identifier in a stack trace', () => {
    const idx = new Bm25Index([
      { id: 'err', text: 'TypeError at handlers.ts:114 undefined modeSnapshot at processAndSaveMeeting MeetingPersistence.ts:212' },
      { id: 'other', text: 'the meeting persistence layer stores transcripts and summaries' },
    ]);
    assert.equal(idx.score('which file and line threw the undefined modeSnapshot error')[0].id, 'err');
  });

  test('A-12: adjacent near-identical levels must not be confused', () => {
    const idx = new Bm25Index([
      { id: 'l3', text: 'L3: base 135-155k USD, equity 0.05-0.10%.' },
      { id: 'l4', text: 'L4: Backend L4 base 165-185k USD, equity 0.10-0.20%.' },
      { id: 'l5', text: 'L5: base 195-225k USD, equity 0.20-0.40%.' },
    ]);
    assert.equal(idx.score('what is the base salary band for a backend L4')[0].id, 'l4');
  });
});
