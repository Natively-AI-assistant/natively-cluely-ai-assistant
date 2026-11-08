// Reference files that index for hours and flip status on their own
// (customer report, 30 PDFs, 2026-10-29). Against a real SQLite index:
//
//  - a file stopped part-way by a rate limit RESUMES at the first unembedded
//    chunk; every retry used to embed it again from chunk 0, meet the same
//    rate limit at the same place, and stop again;
//  - one file is stored in ONE embedding space: a promotion between two
//    sub-batches used to append stand-in vectors to the primary's and label
//    the whole file with whichever came last;
//  - while a stand-in covers for the primary embedder, a file already indexed
//    in the primary's space is kept (no delete, no re-embed) and still reads
//    "ready"; a deliberate provider change still migrates it;
//  - background re-indexing (boot retry, mode prewarm) reports each file to
//    the Modes Manager badges, as an upload does.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/ReferenceIndexResumeStandIn2026_10_29.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href;
const { ModeHybridRetriever } = await import(dist('services/modes/ModeHybridRetriever.js'));
const { ModesManager } = await import(dist('services/ModesManager.js'));
const Database = require('better-sqlite3');

const PRIMARY = 'natively:voyage-4:4';
const STAND_IN = 'local:xenova/multilingual-e5-small:4';

// Enough text for several chunks; one chunk per sub-batch (max batch 1).
const SECTIONS = Array.from({ length: 6 }, (_, i) => `## Sección ${i + 1}\n\n` + `La arquitectura de microservicios número ${i + 1} separa responsabilidades, escala cada servicio de forma independiente y se comunica mediante colas de mensajes y APIs bien definidas. `.repeat(12));
const FILE = { id: 'f1', modeId: 'm1', fileName: 'apuntes.pdf', createdAt: '', content: SECTIONS.join('\n\n') };

/** A pipeline double whose batch outcomes are scripted per call. */
function scriptedPipeline(script) {
  const state = { active: PRIMARY, standIn: false, embeddedTexts: 0, call: 0 };
  return {
    state,
    isReady: () => true,
    getActiveSpaceKey: () => state.active,
    getActiveProviderName: () => 'natively',
    getActiveProviderMaxBatch: () => 1,
    isRunningOnStandIn: () => state.standIn,
    getEmbeddingForQuery: async () => [1, 0, 0, 0],
    getEmbeddingsWithFallback: async (texts) => {
      const outcome = script(state.call++, state);
      if (outcome instanceof Error) throw outcome;
      state.embeddedTexts += texts.length;
      return { embeddings: texts.map(() => [0.5, 0.5, 0, 0]), space: outcome };
    },
  };
}

const permanent = () => Object.assign(new Error('429 quota window'), { retryable: false });

let db;
beforeEach(() => { db = new Database(':memory:'); });

const rows = () => db.prepare('SELECT chunk_index, embedding IS NOT NULL AS has_vec, embedding_space FROM mode_reference_chunks WHERE file_id = ? ORDER BY chunk_index').all('f1');

describe('a stopped index resumes where it stopped', () => {
  test('the second run embeds only the chunks the first one did not', async () => {
    // Run 1: two sub-batches land, the third is rate-limited.
    let failAt = 2;
    const pipeline = scriptedPipeline((n) => (n === failAt ? permanent() : PRIMARY));
    const r = new ModeHybridRetriever(db, {}, pipeline);
    await r.indexFile(FILE);
    const total = rows().length;
    assert.ok(total >= 4, `fixture must chunk into several pieces (got ${total})`);
    const first = r.getFileIndexStatus('f1');
    assert.equal(first.embeddedChunkCount, 2);
    assert.equal(first.status, 'pending', 'a partial file is reported unfinished');

    // Run 2: nothing fails.
    failAt = -1;
    pipeline.state.embeddedTexts = 0;
    await r.indexFile(FILE);
    assert.equal(pipeline.state.embeddedTexts, total - 2, 'only the tail is embedded again');
    assert.deepEqual(r.getFileIndexStatus('f1'), { status: 'ready', chunkCount: total, embeddedChunkCount: total });
    assert.ok(rows().every((row) => row.has_vec === 1 && row.embedding_space === PRIMARY));
  });

  test('a prefix whose text no longer matches is not reused', async () => {
    let failAt = 1;
    const pipeline = scriptedPipeline((n) => (n === failAt ? permanent() : PRIMARY));
    const r = new ModeHybridRetriever(db, {}, pipeline);
    await r.indexFile(FILE);
    db.prepare("UPDATE mode_reference_chunks SET text = 'tampered' WHERE file_id = 'f1' AND chunk_index = 0").run();
    failAt = -1;
    pipeline.state.embeddedTexts = 0;
    await r.indexFile(FILE);
    assert.equal(pipeline.state.embeddedTexts, rows().length, 'embedded from the start');
  });
});

describe('one file, one embedding space', () => {
  test('a promotion between sub-batches stops at the switch instead of mixing spaces', async () => {
    const pipeline = scriptedPipeline((n) => (n < 2 ? PRIMARY : STAND_IN));
    const r = new ModeHybridRetriever(db, {}, pipeline);
    await r.indexFile(FILE);
    const stored = rows();
    const withVec = stored.filter((row) => row.has_vec === 1);
    assert.equal(withVec.length, 2, 'the two primary sub-batches are kept');
    assert.ok(withVec.every((row) => row.embedding_space === PRIMARY), 'no stand-in vector is labelled as the primary');
    assert.ok(stored.slice(2).every((row) => row.has_vec === 0), 'the tail stays lexical');
  });
});

describe('a stand-in does not migrate files out of the primary\'s space', () => {
  async function indexedInPrimary() {
    const pipeline = scriptedPipeline(() => pipeline.state.active);
    const r = new ModeHybridRetriever(db, {}, pipeline);
    await r.indexFile(FILE);
    assert.equal(r.getFileIndexStatus('f1').status, 'ready');
    return { pipeline, r };
  }

  test('while the primary is down and re-probed: kept, and still "ready"', async () => {
    const { pipeline, r } = await indexedInPrimary();
    pipeline.state.active = STAND_IN;
    pipeline.state.standIn = true;
    pipeline.state.embeddedTexts = 0;
    assert.equal(r.getFileIndexStatus('f1').status, 'ready', 'no "not indexed" badge for a temporary stand-in');
    await r.indexFile(FILE);
    assert.equal(pipeline.state.embeddedTexts, 0, 'nothing re-embedded at the stand-in\'s width');
    assert.ok(rows().every((row) => row.has_vec === 1 && row.embedding_space === PRIMARY), 'the primary\'s vectors survive');
  });

  test('a deliberate provider change still migrates the file', async () => {
    const { pipeline, r } = await indexedInPrimary();
    pipeline.state.active = STAND_IN;
    pipeline.state.standIn = false;
    assert.equal(r.getFileIndexStatus('f1').status, 'pending');
    await r.indexFile(FILE);
    assert.ok(rows().every((row) => row.embedding_space === STAND_IN));
  });
});

describe('background re-indexing reports to the badges', () => {
  function managerWith(statusById) {
    const mm = Object.create(ModesManager.prototype);
    const events = [];
    const indexed = [];
    mm.getModes = () => [{ id: 'm1' }];
    mm.getReferenceFiles = () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    mm.modeContextRetriever = {
      getReferenceFileIndexStatus: (id) => ({ status: statusById[id] }),
      referenceFileNeedsReindex: () => false,
      indexReferenceFile: async (f) => { indexed.push(f.id); },
      retryLexicalOnlyFiles: async (files) => { for (const f of files) indexed.push(f.id); },
    };
    mm.setReferenceIndexStatusListener((e) => events.push(`${e.fileId}:${e.phase}`));
    return { mm, events, indexed };
  }

  test('the boot retry reports each file it re-indexes, in order', async () => {
    const { mm, events, indexed } = managerWith({ a: 'failed', b: 'ready', c: 'pending' });
    await mm.retryAllLexicalOnlyFiles();
    assert.deepEqual(indexed, ['a', 'c']);
    assert.deepEqual(events, ['a:indexing', 'a:done', 'c:indexing', 'c:done']);
  });

  test('mode prewarm reports each file it indexes', async () => {
    const { mm, events } = managerWith({ a: 'ready', b: 'lexical_only', c: 'ready' });
    await mm.prewarmModeReferenceIndex('m1');
    assert.deepEqual(events, ['b:indexing', 'b:done']);
  });

  test('a throwing listener never breaks indexing', async () => {
    const { mm, indexed } = managerWith({ a: 'failed', b: 'ready', c: 'ready' });
    mm.setReferenceIndexStatusListener(() => { throw new Error('window gone'); });
    await mm.retryAllLexicalOnlyFiles();
    assert.deepEqual(indexed, ['a']);
  });
});
