import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectIndexer } from '../../../dist-electron/electron/defence/projectIndexer.js';
import { HybridRetriever } from '../../../dist-electron/electron/defence/retriever.js';

test('incremental index excludes secrets and keeps real line ranges', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'defence-index-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'README.md'), '# Retrieval\nThe hybrid retrieval pipeline combines keyword and vector ranking.\nIt returns source evidence.\n');
  await fs.writeFile(path.join(root, 'service.ts'), 'export function retrieve(query: string) {\n  return query;\n}\n');
  await fs.writeFile(path.join(root, '.env'), 'OPENAI_API_KEY=TEST_SECRET_VALUE_DO_NOT_INDEX\n');
  await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules', 'noise.js'), 'secret');
  const indexer = new ProjectIndexer(root, path.join(root, '.defence-index'));
  const first = await indexer.index(); assert.equal(first.added, 2); assert.ok(first.excluded >= 1);
  const manifest = await indexer.load(); assert.equal(Object.keys(manifest.files).includes('.env'), false);
  assert.equal(manifest.chunks.some(chunk => chunk.content.includes('TEST_SECRET_VALUE')), false);
  for (const chunk of manifest.chunks) { const lines = (await fs.readFile(path.join(root, chunk.path), 'utf8')).split('\n').length; assert.ok(chunk.lineStart >= 1); assert.ok(chunk.lineEnd <= lines); }
  const results = new HybridRetriever(manifest.chunks).search('hybrid retrieval keyword vector evidence'); assert.equal(results[0].path, 'README.md');
  const second = await indexer.index(); assert.equal(second.skipped, 2); assert.equal(second.updated, 0);
  await fs.writeFile(path.join(root, 'service.ts'), 'export function retrieve(query: string) {\n  return query.trim();\n}\n');
  const third = await indexer.index(); assert.equal(third.updated, 1);
  await fs.rm(path.join(root, 'service.ts')); const fourth = await indexer.index(); assert.equal(fourth.deleted, 1);
});
