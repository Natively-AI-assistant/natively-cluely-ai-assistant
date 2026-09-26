// Deep-test defects D2/D3/D4 — retrieval-side regressions (2026-08-01).
//
// D2: the tokenizer keeps hyphens, so `TECH-SMALL-CANARY-524` was ONE opaque
//     token and "What is the small technical canary?" shared zero tokens with
//     the line that answers it (fts exactly 0.0000, unrecoverable by any floor).
// D4: "What is the last-page canary?" names a POSITION; when the target line is
//     a bare identifier every chunk of the document ties on stopwords and the
//     tail chunk loses by noise.
// D3: the per-file floor walked candidates in GLOBAL score order, so a large
//     file consumed the token budget before a small file's guaranteed picks.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href;

const { wordsOf } = await import(dist('services/modes/lexicalTokens.js'));
const { ModeHybridRetriever, isPlaceholderOnlyContent } = await import(dist('services/modes/ModeHybridRetriever.js'));

describe('image-only PDF detection (live-run regression)', () => {
  test('page-marker-only content is placeholder-only', () => {
    assert.equal(isPlaceholderOnlyContent('[Page 1]\n\n[Page 2]'), true);
    assert.equal(isPlaceholderOnlyContent('[Page 1]\n \n[Page 2]\n  '), true);
  });
  test('real documents are not', () => {
    assert.equal(isPlaceholderOnlyContent('[Page 1]\nThe recovery objective for a single-region failure is 12 minutes and the system uses Kafka.'), false);
    assert.equal(isPlaceholderOnlyContent('# QueueForge Architecture\n- API: FastAPI'), false);
    assert.equal(isPlaceholderOnlyContent(''), false);
  });
});

describe('D2: hyphenated identifiers emit their sub-tokens (additive)', () => {
  test('a hyphenated canary yields both the full identifier and its parts', () => {
    const tokens = wordsOf('Small technical canary: TECH-SMALL-CANARY-524');
    assert.ok(tokens.includes('tech-small-canary-524'), JSON.stringify(tokens));
    assert.ok(tokens.includes('canary'), JSON.stringify(tokens));
    assert.ok(tokens.includes('524'), JSON.stringify(tokens));
  });

  test('a natural-language question now overlaps the identifier line', () => {
    const q = new Set(wordsOf('What is the small technical canary?'));
    const chunk = wordsOf('# TECH-SMALL-CANARY-524');
    assert.ok(chunk.some((t) => q.has(t)),
      `no overlap between question and identifier chunk: ${JSON.stringify(chunk)}`);
  });

  test('dotted identifiers still split (unchanged) and full-identifier queries still match', () => {
    const chunk = wordsOf('Dead-letter topic: queueforge.jobs.dead');
    for (const t of ['queueforge', 'jobs', 'dead', 'dead-letter', 'letter', 'topic']) {
      assert.ok(chunk.includes(t), `${t} missing from ${JSON.stringify(chunk)}`);
    }
    const idQuery = wordsOf('TECH-PDF-START-481');
    assert.ok(idQuery.includes('tech-pdf-start-481'));
  });
});

const mkRetriever = () => {
  const mockDb = { prepare: () => ({ get: () => null, all: () => [], run: () => {} }), exec: () => {} };
  const mockVectorStore = { searchSimilar: async () => [], hasEmbeddings: () => false };
  const mockEmbeddingPipeline = {
    isReady: () => true,
    getEmbeddingForQuery: async () => { throw new Error('offline'); },
    getEmbeddingsWithFallback: async () => { throw new Error('offline'); },
    getEmbedding: async () => { throw new Error('offline'); },
    getActiveProviderName: () => 'offline',
  };
  return new ModeHybridRetriever(mockDb, mockVectorStore, mockEmbeddingPipeline);
};

// A synthetic "large PDF": many pages of near-identical boilerplate, the canary
// only on the final page as a bare identifier — the measured worst case.
const bigPdfContent = () => {
  const pages = [];
  for (let p = 1; p <= 14; p++) {
    const fact = p === 13
      ? 'The recovery objective for a single-region failure is 12 minutes. The recovery point objective is 3 minutes.'
      : `The orchestration layer handles queue processing stage ${p} with retry semantics and durable state.`;
    const canary = p === 1 ? 'SYNTH-PDF-START-111' : p === 14 ? 'SYNTH-PDF-END-999' : '';
    pages.push(`[Page ${p}]\nPage ${p}: Section heading\n${canary}\n${fact}\nThis section is part of the current system-design dossier and should be treated as authoritative.`);
  }
  return pages.join('\n');
};

describe('D4: positional locator queries reach the document tail', () => {
  test('"What is the last-page canary?" admits the final chunk', async () => {
    const retriever = mkRetriever();
    const files = [{ id: 'f-pdf', modeId: 'm1', fileName: 'system_design_large.pdf', content: bigPdfContent(), createdAt: new Date().toISOString() }];
    const result = await retriever.retrieve({
      query: 'What is the last-page canary?', modeId: 'm1', files,
      tokenBudget: 1600, topK: 6, forceDocumentGrounding: true,
    });
    const joined = (result.chunks ?? []).map((c) => c.text).join('\n');
    assert.match(joined, /SYNTH-PDF-END-999/,
      `tail chunk not retrieved; got chunks: ${(result.chunks ?? []).map((c) => c.chunkIndex).join(',')}`);
  });

  test('"What is the first-page canary?" admits the opening chunk', async () => {
    const retriever = mkRetriever();
    const files = [{ id: 'f-pdf', modeId: 'm1', fileName: 'system_design_large.pdf', content: bigPdfContent(), createdAt: new Date().toISOString() }];
    const result = await retriever.retrieve({
      query: 'What is the first-page canary?', modeId: 'm1', files,
      tokenBudget: 1600, topK: 6, forceDocumentGrounding: true,
    });
    const joined = (result.chunks ?? []).map((c) => c.text).join('\n');
    assert.match(joined, /SYNTH-PDF-START-111/);
  });
});

describe('D3: per-file floor survives a budget-hungry large file', () => {
  test('a small file keeps its guaranteed slots when a big file dominates', async () => {
    const retriever = mkRetriever();
    // Big file: many chunks sharing the query vocabulary; small file: the fact.
    const bigLines = [];
    for (let i = 0; i < 40; i++) {
      bigLines.push(`Batch processing pipeline stage ${i} handles worker coordination and batch scheduling across the cluster with retry batch semantics and worker pools.`);
    }
    const files = [
      { id: 'f-big', modeId: 'm1', fileName: 'big_design.md', content: bigLines.join('\n'), createdAt: new Date().toISOString() },
      { id: 'f-small', modeId: 'm1', fileName: 'config.py', content: 'CACHE_TTL_SECONDS = 420\nMAX_RETRY_ATTEMPTS = 5\nWORKER_BATCH_SIZE = 64', createdAt: new Date().toISOString() },
    ];
    const result = await retriever.retrieve({
      query: 'What is the worker batch size?', modeId: 'm1', files,
      tokenBudget: 700, topK: 6, forceDocumentGrounding: true,
    });
    const sources = new Set((result.chunks ?? []).map((c) => c.sourceId));
    assert.ok(sources.has('f-small'),
      `small file starved: chunks came only from ${[...sources].join(',')}`);
  });
});
