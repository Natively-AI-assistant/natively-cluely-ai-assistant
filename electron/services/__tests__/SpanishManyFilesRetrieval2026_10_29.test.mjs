// "It doesn't grasp the terms I indexed" (customer report, Spanish, 30 PDFs,
// 2026-10-29). Two lexical causes, both on the path that runs whenever the
// embedder is cold, rate-limited or down:
//
//  - accents: a question typed or transcribed as "replicacion" shared no term
//    with a PDF that says "replicación", and a PDF whose extractor produced
//    decomposed accents (o + U+0301) did not even match the composed form;
//  - many files: the per-file floor gave each of 12 files one chunk, so the
//    file the question was about contributed a single chunk to the answer.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/SpanishManyFilesRetrieval2026_10_29.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href;
const { wordsOf } = await import(dist('services/modes/lexicalTokens.js'));
const { ModeHybridRetriever } = await import(dist('services/modes/ModeHybridRetriever.js'));
const Database = createRequire(import.meta.url)('better-sqlite3');

const mkRetriever = () => {
  const mockDb = { prepare: () => ({ get: () => null, all: () => [], run: () => {} }), exec: () => {} };
  const mockVectorStore = { searchSimilar: async () => [], hasEmbeddings: () => false };
  const offline = async () => { throw new Error('offline'); };
  return new ModeHybridRetriever(mockDb, mockVectorStore, {
    isReady: () => true,
    getEmbeddingForQuery: offline,
    getEmbeddingsWithFallback: offline,
    getEmbedding: offline,
    getActiveProviderName: () => 'offline',
  });
};
const file = (id, content) => ({ id, modeId: 'm1', fileName: `${id}.pdf`, content, createdAt: new Date().toISOString() });

describe('accents do not split a word in two', () => {
  test('accented, unaccented and decomposed spellings are one token', () => {
    const composed = wordsOf('replicación síncrona');
    assert.deepEqual(wordsOf('replicacion sincrona'), composed);
    assert.deepEqual(wordsOf('replicación síncrona'), composed);
    assert.deepEqual(wordsOf('REPLICACIÓN SÍNCRONA'), composed);
  });

  test('PDF ligatures split into letters', () => {
    assert.deepEqual(wordsOf('conﬁguración'), wordsOf('configuracion'));
  });

  test('marks outside the Latin accent block are kept', () => {
    // Devanagari vowel signs and virama, Japanese voiced kana: other blocks.
    assert.deepEqual(wordsOf('नमस्ते दुनिया'), ['नमस्ते', 'दुनिया']);
    assert.deepEqual(wordsOf('データベース 設計'), ['データベース']);
  });

  test('an unaccented question finds the accented passage', async () => {
    const files = [file('apuntes', [
      '## Tema 1. Introducción',
      'Este curso cubre los fundamentos de los sistemas distribuidos y su historia.',
      '',
      '## Tema 2. Replicación',
      'La replicación síncrona confirma la escritura cuando todas las réplicas la aplican; el líder espera el acuse de recibo de cada seguidor.',
    ].join('\n'))];
    const result = await mkRetriever().retrieve({
      query: 'como funciona la replicacion sincrona', modeId: 'm1', files,
      tokenBudget: 1200, topK: 2, forceDocumentGrounding: true,
    });
    assert.match(result.chunks[0]?.text ?? '', /réplicas la aplican/);
  });
});

describe('a mode with many files', () => {
  // One file is about the question, in three sections far enough apart to be
  // three chunks; 29 others each mention a term from it in passing.
  const section = (title, fact) => `## ${title}\n\n${fact} ` + 'Replicación de bases de datos: el líder registra cada escritura en el log y los seguidores la aplican en orden. '.repeat(40);
  const target = file('replicacion', [
    section('Replicación síncrona', 'RESPUESTA-A: la escritura se confirma cuando todas las réplicas responden.'),
    section('Replicación asíncrona', 'RESPUESTA-B: el líder confirma sin esperar y los seguidores pueden quedar atrás.'),
    section('Replicación semisíncrona', 'RESPUESTA-C: el líder espera a un solo seguidor antes de confirmar.'),
  ].join('\n\n'));
  const others = Array.from({ length: 29 }, (_, i) => file(`tema-${i}`,
    `## Tema ${i}\n\nResumen del tema ${i}: los datos del trimestre se guardan en una base distinta y se revisan cada semana con el equipo de ventas.`));

  // A working embedder over a real index: the target file's chunks sit close
  // to the question, the other 29 files' further away but still related (one
  // course's notes), as a multilingual embedder places them.
  const indexedRetriever = async (files) => {
    const vec = (t) => (t.includes('el líder registra') ? [0.98, 0.2, 0, 0] : [0.8, 0.6, 0, 0]);
    const pipeline = {
      isReady: () => true,
      getActiveSpaceKey: () => 'natively:voyage-4:4',
      getActiveProviderName: () => 'natively',
      isRunningOnStandIn: () => false,
      getEmbeddingForQuery: async () => [1, 0, 0, 0],
      getEmbedding: async (t) => vec(t),
      getEmbeddingsWithFallback: async (texts) => ({ embeddings: texts.map(vec), space: 'natively:voyage-4:4' }),
    };
    const r = new ModeHybridRetriever(new Database(':memory:'), {}, pipeline);
    for (const f of files) await r.indexFile(f);
    return r;
  };

  test('the file the question is about gets more than one slot', async () => {
    const r = await indexedRetriever([target, ...others]);
    const result = await r.retrieve({
      query: '¿Cómo funciona la replicación de bases de datos con el líder y los seguidores?', modeId: 'm1',
      files: [target, ...others], tokenBudget: 6000, topK: 12, forceDocumentGrounding: true,
    });
    const fromTarget = result.chunks.filter((c) => c.sourceId === 'replicacion');
    assert.ok(fromTarget.length >= 3, `the relevant file contributed ${fromTarget.length} of ${result.chunks.length} chunks`);
    const joined = fromTarget.map((c) => c.text).join('\n');
    for (const k of ['RESPUESTA-A', 'RESPUESTA-B', 'RESPUESTA-C']) assert.match(joined, new RegExp(k));
  });

  test('with few files the floor is unchanged: each still gets its slots', async () => {
    const small = file('config', 'CACHE_TTL_SECONDS = 420\nMAX_RETRY_ATTEMPTS = 5\nWORKER_BATCH_SIZE = 64');
    const result = await mkRetriever().retrieve({
      query: 'What is the worker batch size?', modeId: 'm1',
      files: [target, small], tokenBudget: 6000, topK: 12, forceDocumentGrounding: true,
    });
    assert.ok(result.chunks.some((c) => c.sourceId === 'config'));
  });
});
