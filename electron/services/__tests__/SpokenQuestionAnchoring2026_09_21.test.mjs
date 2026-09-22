// Nine of fifteen misses on a HELD-OUT question set (written by an agent that saw only the documents) were
// never routed to retrieval at all — every one spoken-style. The corpus probe charged each word the
// documents never contain at the weight of their rarest word, so one inflection or synonym ("milliseconds"
// where the file says timeout_ms; "drained" where it says "Drain") sank a question that otherwise named the
// section exactly. Held-out set, markdown, of 120: vectors 105 -> 112, lexical 98 -> 105; spoken-style
// 77% -> 95%; general-knowledge negatives anchored: unchanged (1 of 36).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/lexicalTokens.js')).href);

// Ten service families and ten pod families, three of each — as in a real handbook, a given name is
// in a handful of chunks, not in a third of them (the first version of this fixture had "ledgerline" in
// 30 of 81 chunks, where nothing is distinctive and nothing should anchor).
const SVC = ['Ledgerline', 'Beacon', 'Conduit', 'Tributary', 'Quasar', 'Dynamo', 'Harbor', 'Lattice', 'Meridian', 'Nimbus'];
const POD = ['Isthmus', 'Hollow', 'Lantern', 'Rampart', 'Bramble', 'Umbra', 'Tundra', 'Osprey', 'Jetty', 'Anvil'];
const svc = (i) => `Service: ${SVC[i % 10]}-store-${i}\nOwned by Core Identity. Configuration: ${SVC[i % 10]}.store.${i}.timeout_ms = ${400 + i}. Availability target 99.${i}%.`;
const pod = (i) => `Team profile: Growth Platform (${POD[i % 10]} pod ${i})\nThe pod owns the ingestion pipeline. Nice to have: familiarity with Kubernetes and Temporal.`;
const chunks = [...Array.from({ length: 30 }, (_, i) => svc(i)), ...Array.from({ length: 30 }, (_, i) => pod(i)),
  'Runbook: regional failover\n1. Freeze deploys. 2. Drain the write queue before promoting the replica. 3. Flip the traffic weight to the standby.',
  ...Array.from({ length: 20 }, (_, i) => `Postmortem ${i}: throughput regression after an upgrade; resolved in ${100 + i} minutes.`)];
const stats = L.buildLexicalStats(chunks);

describe('spoken-style questions reach the documents', () => {
  for (const q of ['whats the timeout on ledgerline store twenty in milliseconds', 'regional failover after ive drained the write queue whats the next step', 'so uh isthmus pod ten whats the nice to have stuff they want familiarity with'])
    test(`anchored: "${q}"`, () => assert.equal(L.corpusAnchorsQuestion(q, stats), true));
  test('a number SPOKEN as a word contributes its digit form ("pod seven" -> "7")', () => {
    assert.ok(L.questionContentWords('isthmus pod seven').has('7'));
    assert.ok(!L.questionContentWords('isthmus pod seven').has('seven'), 'the word itself is a function word for the probe');
  });
  test('contractions that lost their apostrophe and fillers neither anchor nor count against', () => {
    const w = L.questionContentWords('so uh whats the thing ive got here like');
    for (const x of ['whats', 'ive', 'uh', 'so', 'like', 'thing']) assert.ok(!w.has(x), x);
  });
});

describe('what must NOT become a document question', () => {
  test('general knowledge: the distinctive words are not in the documents', () => {
    for (const q of ['whats the difference between tcp and udp', 'how does a b tree differ from an lsm tree', 'explain the cap theorem']) assert.equal(L.corpusAnchorsQuestion(q, stats), false, q);
  });
  test('mostly unseen words: two shared rare terms are not enough', () => {
    assert.equal(L.corpusAnchorsQuestion('compare isthmus canal shipping tonnage against suez panama traffic growth with kubernetes', stats), false);
  });
  test('one distinctive term alone does not anchor', () => assert.equal(L.corpusAnchorsQuestion('tell me about failover', stats), false));
});
