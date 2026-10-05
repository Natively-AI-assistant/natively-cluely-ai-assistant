// The reranker must be SHOWN every file's best chunks (2026-09-07).
// See electron/services/modes/rerankPool.ts for the measured case.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd());
const { buildRerankPool } = require(path.join(repoRoot, 'dist-electron/electron/services/modes/rerankPool.js'));

// 40 padding chunks from one file outrank everything, then 5 small files.
const sorted = [
  ...Array.from({ length: 40 }, (_, i) => ({ sourceId: 'big', id: `big${i}` })),
  { sourceId: 'resume', id: 'resume0' }, { sourceId: 'resume', id: 'resume1' },
  { sourceId: 'anchors', id: 'anchors0' },
  { sourceId: 'debug', id: 'debug0' }, { sourceId: 'debug', id: 'debug1' },
  { sourceId: 'arch', id: 'arch0' },
  { sourceId: 'coding', id: 'coding0' },
];

describe('ordinary turn: one chunk per file, then fill by score', () => {
  test('every file has its best chunk in a 15-pool; the rest is the big file', () => {
    const pool = buildRerankPool(sorted, 15);
    const ids = pool.map((c) => c.id);
    for (const f of ['resume0', 'anchors0', 'debug0', 'arch0', 'coding0']) assert.ok(ids.includes(f), f);
    assert.equal(pool.length, 15);
    assert.equal(pool.filter((c) => c.sourceId === 'big').length, 10);
    assert.ok(!ids.includes('resume1'), 'only the FLOOR is reserved; second picks compete by score');
  });
  test('pool order is hybrid order (a failed rerank falls back to it unchanged)', () => {
    const pool = buildRerankPool(sorted, 15);
    const idx = (id) => sorted.findIndex((c) => c.id === id);
    for (let i = 1; i < pool.length; i++) assert.ok(idx(pool[i - 1].id) < idx(pool[i].id));
  });
});

describe('exhaustive turn: balanced across files', () => {
  test('a 30-pool over 6 files gives each file up to 5 slots, unfilled slots go to the leaders', () => {
    const pool = buildRerankPool(sorted, 30, { balanced: true });
    assert.equal(pool.length, 30);
    const count = (f) => pool.filter((c) => c.sourceId === f).length;
    assert.equal(count('resume'), 2);
    assert.equal(count('debug'), 2);
    assert.equal(count('anchors'), 1);
    assert.equal(count('big'), 30 - 2 - 2 - 1 - 1 - 1);
  });
});

describe('edges', () => {
  test('a single file is a plain prefix; size never exceeds the input', () => {
    const one = Array.from({ length: 5 }, (_, i) => ({ sourceId: 'x', id: i }));
    assert.deepEqual(buildRerankPool(one, 3).map((c) => c.id), [0, 1, 2]);
    assert.equal(buildRerankPool(one, 50).length, 5);
    assert.deepEqual(buildRerankPool([], 10), []);
  });
});

describe('the retriever uses it', () => {
  test('ModeHybridRetriever builds the pool with the floor and appends the tail by membership', () => {
    const s = fs.readFileSync(path.join(repoRoot, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8');
    assert.match(s, /const pool = buildRerankPool\(sorted, poolSize, \{ balanced: mult > 1 \}\);/);
    assert.match(s, /const pooled = new Set<ChunkCandidate>\(pool\);/);
    assert.ok(!/for \(let i = poolSize; i < sorted\.length; i\+\+\)/.test(s), 'the prefix-based tail is gone');
  });
});
