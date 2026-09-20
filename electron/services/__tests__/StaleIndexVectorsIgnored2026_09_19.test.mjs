// A stale index's vectors are never paired with fresh chunks (2026-09-19).
//
// Stored vectors are keyed (file_id, chunk_index) and matched to the chunks the
// query path produces NOW. After a chunker version bump the old index still read
// `ready` (status is looked up by file id and cannot see the content), neither
// prewarm nor the boot retry re-indexed it, and chunk i was scored with the vector
// of the OLD chunk i — silently. `needsReindexing` described the trap and had no
// caller. Found while checking what the chunker v2→v3 bump would do to existing
// users' files: it would have degraded every one of them.
//
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ModeHybridRetriever } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/ModeHybridRetriever.js')).href);
const { CHUNKER_VERSION } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/semanticChunker.js')).href);

const SPACE = 'natively:test:4';
const NEAR = [1, 0, 0, 0];   // the query, and the chunk that answers it
const FAR = [0, 1, 0, 0];    // every other chunk
const TARGET = 'The quorum lease timeout for the Halvorsen cluster is 750 milliseconds.';
// 14 sections, each its own chunk; neutral vocabulary so the vector arm decides.
const DOC = ['# Operations notes', '', ...Array.from({ length: 14 }, (_, i) => [`## Section ${String.fromCharCode(65 + i)}`, '',
  i === 9 ? TARGET : `Routine note ${i}: the weekly review covered staffing, the office move and the catering order for the offsite.`,
  'Further routine remarks about scheduling, room bookings and the shared calendar, repeated to give the section some body. '.repeat(3), ''].join('\n'))].join('\n');
const FILE = { id: 'f1', modeId: 'm', fileName: 'ops.md', content: DOC, createdAt: new Date().toISOString() };
const blob = (v) => Buffer.from(new Float32Array(v).buffer);

function setup() {
  const db = new Database(':memory:');
  const calls = { batch: 0 };
  const pipeline = {
    isReady: () => true, getActiveProviderName: () => 'natively', getActiveSpaceKey: () => SPACE, getActiveProviderMaxBatch: () => 100,
    getEmbeddingForQuery: async () => NEAR, getEmbedding: async () => NEAR,
    getEmbeddingsWithFallback: async (texts) => { calls.batch++; return { embeddings: texts.map((t) => (t.includes('quorum lease') ? NEAR : FAR)), space: SPACE }; },
  };
  const hr = new ModeHybridRetriever(db, { searchSimilar: async () => [], hasEmbeddings: () => false }, pipeline);
  return { db, hr, calls };
}
const ask = (hr) => hr.retrieve({ query: 'How long before a leader gives up its claim?', modeId: 'm', files: [FILE], tokenBudget: 1500, topK: 20, forceDocumentGrounding: true, allowRerank: false });
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('stale index', () => {
  test('control: a current index is used as stored, and nothing re-embeds', async () => {
    const { hr, calls } = setup();
    await hr.indexFile(FILE);
    const after = calls.batch;
    const r = await ask(hr);
    assert.ok(r.chunks[0].text.includes('quorum lease'), r.chunks[0].text.slice(0, 80));
    assert.equal(calls.batch, after, 'a current index must not trigger any document embedding');
  });

  test('an index built under an older chunker is NOT used, and the file re-indexes', async () => {
    const { db, hr, calls } = setup();
    await hr.indexFile(FILE);
    // Make it an older-chunker index, and POISON the stored vectors: if they are
    // used at all, a routine section (chunk 2) wins and the answer loses.
    const old = db.prepare('SELECT file_hash AS h FROM mode_reference_index_state WHERE file_id = ?').get(FILE.id).h;
    assert.ok(old.endsWith(`.c${CHUNKER_VERSION}`), old);
    db.prepare('UPDATE mode_reference_index_state SET file_hash = ? WHERE file_id = ?').run(old.replace(/\.c\d+$/, `.c${CHUNKER_VERSION - 1}`), FILE.id);
    db.prepare('UPDATE mode_reference_chunks SET embedding = ? WHERE file_id = ?').run(blob(FAR), FILE.id);
    db.prepare('UPDATE mode_reference_chunks SET embedding = ? WHERE file_id = ? AND chunk_index = 2').run(blob(NEAR), FILE.id);
    assert.equal(hr.needsReindexing(FILE), true);
    // …and yet it still READS as ready — which is why prewarm never caught it.
    assert.equal(hr.getFileIndexStatus(FILE.id).status, 'ready');

    const before = calls.batch;
    const r = await ask(hr);
    assert.ok(r.chunks[0].text.includes('quorum lease'), `poisoned stale vectors were used: ${r.chunks[0].text.slice(0, 80)}`);
    await settle();
    assert.ok(calls.batch > before, 'the stale file must be re-embedded');
    assert.equal(hr.needsReindexing(FILE), false, 'and its index state brought up to the current chunker');
  });
});
