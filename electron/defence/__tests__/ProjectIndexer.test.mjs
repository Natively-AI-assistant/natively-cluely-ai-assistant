import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ProjectIndexer } from '../../../dist-electron/electron/defence/projectIndexer.js';
import { HybridRetriever } from '../../../dist-electron/electron/defence/retriever.js';

function invariant(progress) { assert.equal(progress.eligibleTotal, progress.indexedNew + progress.indexedUpdated + progress.skippedUnchanged + progress.failedTotal); assert.equal(progress.discoveredTotal, progress.excludedTotal + progress.eligibleTotal); }

test('index accounting is explicit across add/update/delete and every exclusion reason', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'defence-index-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  spawnSync('git', ['init'], { cwd: root, windowsHide: true });
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored.log\n');
  await fs.writeFile(path.join(root, 'ignored.log'), 'must not index');
  await fs.writeFile(path.join(root, 'README.md'), '# Retrieval\nThe hybrid retrieval pipeline combines keyword and vector ranking.\nIt returns source evidence.\n');
  await fs.writeFile(path.join(root, 'service.ts'), 'export function retrieve(query: string) {\n  return query;\n}\n');
  await fs.writeFile(path.join(root, '.env'), 'OPENAI_API_KEY=TEST_SECRET_VALUE_DO_NOT_INDEX\n');
  await fs.writeFile(path.join(root, 'unsupported.bin'), 'unsupported');
  await fs.writeFile(path.join(root, 'oversized.txt'), 'x'); await fs.truncate(path.join(root, 'oversized.txt'), 20 * 1024 * 1024 + 1);
  let symlinkCreated = false; try { await fs.symlink(path.join(root, 'README.md'), path.join(root, 'linked.md'), 'file'); symlinkCreated = true; } catch (error) { if (error.code !== 'EPERM') throw error; }
  const indexer = new ProjectIndexer(root, path.join(root, '.defence-index'));
  const first = await indexer.index(); invariant(first); assert.equal(first.indexedNew, 2); assert.equal(first.eligibleTotal, 2); assert.equal(first.failedTotal, 0); assert.equal(first.ignoredByGit, 1); assert.equal(first.secretExcluded, 1); assert.equal(first.oversizedExcluded, 1); assert.ok(first.unsupportedTypeExcluded >= 2); if (symlinkCreated) assert.equal(first.symlinkExcluded, 1);
  const manifest = await indexer.load(); assert.equal(Object.keys(manifest.files).includes('.env'), false); assert.equal(manifest.chunks.some(chunk => chunk.content.includes('TEST_SECRET_VALUE')), false);
  for (const chunk of manifest.chunks) { const lines = (await fs.readFile(path.join(root, chunk.path), 'utf8')).split('\n').length; assert.ok(chunk.lineStart >= 1); assert.ok(chunk.lineEnd <= lines); }
  assert.equal(new HybridRetriever(manifest.chunks).search('hybrid retrieval keyword vector evidence')[0].path, 'README.md');
  const second = await indexer.index(); invariant(second); assert.equal(second.skippedUnchanged, 2); assert.equal(second.indexedUpdated, 0);
  await fs.writeFile(path.join(root, 'service.ts'), 'export function retrieve(query: string) {\n  return query.trim();\n}\n');
  const third = await indexer.index(); invariant(third); assert.equal(third.indexedUpdated, 1); assert.equal(third.skippedUnchanged, 1);
  await fs.writeFile(path.join(root, 'new.md'), '# New evidence\nA newly documented capability.\n');
  const fourth = await indexer.index(); invariant(fourth); assert.equal(fourth.indexedNew, 1);
  await fs.rm(path.join(root, 'service.ts')); const fifth = await indexer.index(); invariant(fifth); assert.equal(fifth.deletedFromIndex, 1);
});
