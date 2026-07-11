// electron/rag/__tests__/EmbeddingFallbackSinglePath.test.mjs
//
// Regression tests for the single-text embedding paths. Batch embedding already
// had local fallback promotion; getEmbedding() and getEmbeddingForQuery() also
// need it so resume/JD/reference-file ingestion and live query embeddings do not
// fail into lexical-only rows after a cloud provider dies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function methodBlock(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const next = source.indexOf('\n    /**', start + 1);
  return source.slice(start, next > start ? next : start + 1800);
}

describe('EmbeddingPipeline single-text fallback promotion', () => {
  test('getEmbedding() falls back to fallbackProvider and promotes it after primary failure', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = methodBlock(source, 'async getEmbedding(text: string)');
    assert.match(block, /try\s*\{[\s\S]*embedWithTimeout\(this\.provider, text, 'live-chunk'\)/, 'primary single embed should be attempted first');
    assert.match(block, /catch\s*\(primaryError\)[\s\S]*const fallback = this\.fallbackProvider/, 'primary failure should enter fallback branch');
    assert.match(block, /embedWithTimeout\(fallback, text, 'fallback-live-chunk'\)/, 'fallback provider should perform the single embed');
    assert.match(block, /this\.promoteFallbackProvider\(fallback\)/, 'successful fallback should become the active provider/space');
  });

  test('getEmbeddingForQuery() falls back to fallbackProvider and promotes it after primary failure', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = methodBlock(source, 'async getEmbeddingForQuery(text: string)');
    assert.match(block, /const provider = this\.provider/, 'query path should capture the starting provider');
    assert.match(block, /const runQuery = \(p: IEmbeddingProvider, label: string\)/, 'query path should support running against either provider');
    assert.match(block, /return await runQuery\(provider, 'live-query'\)/, 'primary query embed should be attempted first');
    assert.match(block, /runQuery\(fallback, 'fallback-live-query'\)/, 'fallback provider should perform the query embed');
    assert.match(block, /this\.promoteFallbackProvider\(fallback\)/, 'successful query fallback should become active');
  });

  test('fallback promotion persists last_embedding_space and emits a warning if persistence fails', () => {
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = methodBlock(source, 'private promoteFallbackProvider');
    assert.match(block, /this\.provider\s*=\s*fallback/, 'promotion should replace the active provider');
    assert.match(block, /last_embedding_space/, 'promotion should persist the active embedding space');
    assert.match(block, /embedding:space-persist-failed/, 'persist failure should be visible to the renderer');
  });

  test('getEmbeddingsWithFallback captures the provider before the await (space label matches producer)', () => {
    // Regression for the space-labeling race: the SUCCESS path used to re-read
    // this.provider / getActiveSpaceKey() AFTER the await, so a concurrent
    // promoteFallbackProvider() (from another caller failing over) would stamp
    // embeddings produced by the OLD provider with the NEW provider's space.
    const source = read('electron/rag/EmbeddingPipeline.ts');
    const block = methodBlock(source, 'async getEmbeddingsWithFallback(texts: string[])');
    assert.match(block, /const active = this\.provider/, 'must capture the active provider before awaiting');
    assert.match(block, /const embeddings = await this\.getEmbeddings\(texts\)/, 'batch embed still awaited');
    assert.match(block, /const space = active\.space/, 'space must come from the captured provider, not a post-await this.provider read');
    assert.match(block, /provider: active\.name, dimensions: active\.dimensions/, 'name/dimensions must come from the captured provider');
    // Guard against a regression back to the racy post-await re-read on the
    // SUCCESS path specifically (the fallback path legitimately reads
    // this.getActiveSpaceKey elsewhere).
    assert.doesNotMatch(
      block.split('catch (primaryError)')[0],
      /space\s*=\s*this\.getActiveSpaceKey\(\)/,
      'success path must not re-derive space from this.getActiveSpaceKey() after the await',
    );
  });
});

// ─── Behavioral: space label is stable under a concurrent promotion ──────────

describe('EmbeddingPipeline space-label race (behavioral)', () => {
  test('a promotion during an in-flight getEmbeddingsWithFallback does not relabel the result', async () => {
    const { fileURLToPath: f2, pathToFileURL } = await import('node:url');
    const distPath = path.resolve(
      path.dirname(f2(import.meta.url)),
      '../../../dist-electron/electron/rag/EmbeddingPipeline.js',
    );
    const { EmbeddingPipeline } = await import(pathToFileURL(distPath).href);

    // Fake providers with distinct spaces. The primary resolves embedBatch on a
    // later tick so we can promote the fallback while it is "in flight".
    const makeProvider = (name, space, dims) => ({
      name,
      space,
      dimensions: dims,
      async embedBatch(texts) {
        // slow-ish resolve so a promotion can interleave before we return
        await new Promise((r) => setTimeout(r, 20));
        return texts.map(() => new Array(dims).fill(0.1));
      },
    });

    const primary = makeProvider('cloud', 'cloud:model:3072', 3072);
    const fallback = makeProvider('local', 'local:model:384', 384);

    // Stub db so promoteFallbackProvider's INSERT is a no-op.
    const stubDb = { prepare: () => ({ run: () => {} }) };
    const pipe = new EmbeddingPipeline(stubDb, /* vectorStore */ {});
    pipe['provider'] = primary;
    pipe['fallbackProvider'] = fallback;

    // Kick off the embed against the primary; while its embedBatch is pending,
    // promote the fallback (simulating another caller's failover).
    const inflight = pipe.getEmbeddingsWithFallback(['hello world']);
    pipe['promoteFallbackProvider'](fallback); // reassigns this.provider = fallback

    const result = await inflight;

    // The embeddings were produced by the PRIMARY, so their space label MUST be
    // the primary's — NOT the freshly-promoted fallback's.
    assert.equal(result.space, 'cloud:model:3072', 'space must match the producing (captured) provider');
    assert.equal(result.provider, 'cloud');
    assert.equal(result.dimensions, 3072);
    assert.equal(result.embeddings[0].length, 3072, 'embedding width matches the producing provider');
  });
});
