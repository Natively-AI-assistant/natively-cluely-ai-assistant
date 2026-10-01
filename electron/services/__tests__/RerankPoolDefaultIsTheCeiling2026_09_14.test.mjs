// The candidate-count control must not lie about its own default (2026-09-14).
//
// MEASURED BY READING, 2026-09-14: nothing writes a default `reranker.candidateCount`
// — not SettingsManager, not any migration. So on an untouched install
// `resolveRerankPoolSize()` fell through to RERANK_CANDIDATE_POOL (30) while
// Settings > Reranker rendered `status.candidateCount ?? 15` and labelled 15
// "Recommended default". Three consequences, all wrong:
//
//   1. the displayed number disagreed with the pool actually used (15 vs 30);
//   2. CANDIDATE_CHOICES topped out at 20, so EVERY selectable value LOWERED
//      the pool below the untouched default — moving the slider to the
//      "recommended default" halved it;
//   3. the 20 label read "evaluates maximum context passages", but 30 is the
//      maximum and is what you get by leaving the control alone.
//
// The fix removes the drift class rather than re-syncing two literals: the pool
// ceiling is exported from ONE module, the IPC status reports it as
// `candidateCountDefault`, and the UI renders that instead of a hardcoded 15.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd());
const pool = require(path.join(repoRoot, 'dist-electron/electron/services/modes/rerankPool.js'));
const { RERANK_CANDIDATE_POOL, resolveRerankPoolSize } = pool;

describe('the pool ceiling has one home', () => {
  test('rerankPool exports the ceiling and the resolver', () => {
    assert.equal(typeof RERANK_CANDIDATE_POOL, 'number');
    assert.equal(RERANK_CANDIDATE_POOL, 30);
    assert.equal(typeof resolveRerankPoolSize, 'function');
  });

  test('ModeHybridRetriever no longer defines its own copy', () => {
    const s = fs.readFileSync(
      path.join(repoRoot, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8');
    assert.ok(
      !/^const RERANK_CANDIDATE_POOL\s*=/m.test(s),
      'the ceiling must be imported from rerankPool, not redeclared');
    assert.match(s, /from '\.\/rerankPool'/);
  });
});

describe('an untouched install resolves to the ceiling', () => {
  // The reader is injectable so this asserts the real resolver, with no
  // SettingsManager singleton and no mutation of module resolution.
  test('no stored value -> the full pool', () => {
    assert.equal(resolveRerankPoolSize(() => undefined), RERANK_CANDIDATE_POOL);
    assert.equal(resolveRerankPoolSize(() => null), RERANK_CANDIDATE_POOL);
  });

  test('a stored value is honoured, clamped to the ceiling', () => {
    assert.equal(resolveRerankPoolSize(() => 15), 15);
    assert.equal(resolveRerankPoolSize(() => 30), 30);
    assert.equal(resolveRerankPoolSize(() => 999), RERANK_CANDIDATE_POOL);
  });

  test('nonsense never silently narrows the pool', () => {
    for (const bad of [0, -5, NaN, Infinity, '15', {}]) {
      assert.equal(resolveRerankPoolSize(() => bad), RERANK_CANDIDATE_POOL,
        `${String(bad)} must fall back to the ceiling, not to a smaller pool`);
    }
  });

  test('a throwing reader falls back rather than breaking retrieval', () => {
    assert.equal(
      resolveRerankPoolSize(() => { throw new Error('settings store degraded'); }),
      RERANK_CANDIDATE_POOL);
  });
});

describe('the UI reports the default it actually gets', () => {
  const ui = fs.readFileSync(
    path.join(repoRoot, 'src/components/settings/RerankerSettings.tsx'), 'utf8');

  test('the ceiling is selectable', () => {
    const m = ui.match(/const CANDIDATE_CHOICES = \[([^\]]*)\]/);
    assert.ok(m, 'CANDIDATE_CHOICES must still exist');
    const choices = m[1].split(',').map((n) => Number(n.trim())).filter(Number.isFinite);
    assert.ok(choices.includes(RERANK_CANDIDATE_POOL),
      `the pool ceiling ${RERANK_CANDIDATE_POOL} must be reachable; got [${choices.join(', ')}]`);
    assert.ok(Math.max(...choices) <= RERANK_CANDIDATE_POOL,
      `no choice may exceed the ceiling the retriever clamps to; got [${choices.join(', ')}]`);
  });

  const code = ui
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  test('no hardcoded fallback stands in for the real default', () => {
    const literal = code.match(/candidateCount \?\? \d+/g);
    assert.equal(literal, null,
      `the displayed fallback must come from the IPC status, not a literal: ${String(literal)}`);
    assert.match(code, /candidateCount = status\.candidateCount \?\? status\.candidateCountDefault/);
  });

  test('no copy claims a fixed number is the maximum or the default', () => {
    const copy = code.split('\n').filter((l) => /candidateCount [<>=]/.test(l));
    assert.ok(copy.length >= 2, 'the candidates card must still describe its settings');
    for (const line of copy) {
      assert.ok(!/>= 20\b/.test(line),
        `20 is not the ceiling; copy must not treat it as one: ${line.trim()}`);
    }
    const full = copy.find((l) => /candidateCountDefault/.test(l));
    assert.ok(full,
      'the top-of-range copy must be keyed to the reported ceiling, not a literal');
  });

  test('the label for the ceiling says it is the default', () => {
    const i = code.indexOf('candidateCount >= status.candidateCountDefault');
    assert.ok(i > 0, 'there must be a branch for the full pool');
    const branch = code.slice(i, i + 400);
    assert.match(branch, /default/i,
      'the full pool is what an untouched install uses; the copy must say so');
  });
});

describe('the IPC status carries the default', () => {
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

  test('reranker:get-config reports candidateCountDefault from the one constant', () => {
    const line = ipc.split('\n').find((l) => /candidateCountDefault/.test(l));
    assert.ok(line, 'reranker:get-config must report candidateCountDefault');
    assert.ok(/RERANK_CANDIDATE_POOL/.test(line),
      `candidateCountDefault must come from the shared constant: ${line.trim()}`);
  });

  test('set-config clamps to the same ceiling', () => {
    const line = ipc.split('\n').find((l) => /merged\.candidateCount = /.test(l));
    assert.ok(line, 'set-config must still clamp candidateCount');
    assert.ok(/RERANK_CANDIDATE_POOL/.test(line),
      `the clamp must use the shared ceiling, not a literal: ${line.trim()}`);
  });
});
