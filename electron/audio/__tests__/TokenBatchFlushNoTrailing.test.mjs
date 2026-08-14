import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractAround(needle, before = 200, after = 1500) {
  const idx = mainSource.indexOf(needle);
  assert.ok(idx >= 0, `could not locate ${needle}`);
  return mainSource.slice(Math.max(0, idx - before), idx + after);
}

test('clearImmediate semantics match the patch: a queued flush is cancellable, and a re-arm after flush still fires', () => {
  // Behavioral proof that the patch shape works against Node's own setImmediate/clearImmediate.
  // Mirrors the patched flushBatchesNow / scheduleBatchFlush / queueBatch closure in main.ts.
  const sent = [];
  const tokenBatches = new Map();
  let pendingFlushHandle = null;
  let batchFlushScheduled = false;
  const send = (kind, items) => sent.push({ kind, items });
  const flushBatchesNow = () => {
    if (pendingFlushHandle) {
      clearImmediate(pendingFlushHandle);
      pendingFlushHandle = null;
    }
    batchFlushScheduled = false;
    for (const [kind, items] of tokenBatches.entries()) {
      if (items.length > 0) send(kind, items.slice());
    }
    tokenBatches.clear();
  };
  const scheduleBatchFlush = () => {
    if (batchFlushScheduled) return;
    batchFlushScheduled = true;
    pendingFlushHandle = setImmediate(() => {
      pendingFlushHandle = null;
      batchFlushScheduled = false;
      flushBatchesNow();
    });
  };
  const queueBatch = (kind, item) => {
    let arr = tokenBatches.get(kind);
    if (!arr) { arr = []; tokenBatches.set(kind, arr); }
    arr.push(item);
    scheduleBatchFlush();
  };

  queueBatch('suggested_answer', { token: 'a' });
  queueBatch('suggested_answer', { token: 'b' });
  flushBatchesNow(); // synchronous final-answer barrier
  const finalMarker = { kind: 'final', payload: 'X' };
  sent.push(finalMarker);

  return new Promise((resolve) => {
    setImmediate(() => {
      try {
        // The cancelled flush must NOT have fired after the final marker.
        const finalIndex = sent.indexOf(finalMarker);
        assert.ok(finalIndex >= 0, 'final marker must be present');
        const trailingBatches = sent.slice(finalIndex + 1).filter((s) => s.kind === 'suggested_answer');
        assert.equal(trailingBatches.length, 0, 'BUG: trailing token batch landed after the final answer.');

        // Producer enqueues again after flush — must schedule a fresh setImmediate that fires.
        queueBatch('suggested_answer', { token: 'c' });
        setImmediate(() => {
          try {
            const reArm = sent.filter((s) => s.kind === 'suggested_answer');
            assert.equal(reArm.length, 2, 'BUG: re-armed flush after final answer must deliver one new batch with one token.');
            assert.deepEqual(reArm[1].items, [{ token: 'c' }], 'BUG: re-armed flush must contain only the post-final token.');
            resolve();
          } catch (e) {
            resolve(Promise.reject(e));
          }
        });
      } catch (e) {
        resolve(Promise.reject(e));
      }
    });
  });
});

test('intelligence token batch flush cancels its pending setImmediate so trailing tokens cannot land after a final answer', () => {
  const region = extractAround('const tokenBatches = new Map<BatchKind, any[]>()', 100, 1_800);

  assert.ok(
    /let\s+pendingFlushHandle:\s*NodeJS\.Immediate\s*\|\s*null\s*=\s*null/.test(region),
    'BUG: token batcher must track its pending setImmediate handle so it can cancel it.',
  );
  assert.ok(
    /clearImmediate\s*\(\s*pendingFlushHandle\s*\)/.test(region),
    'BUG: flushBatchesNow must clearImmediate the pending handle to prevent trailing batches after the final answer send.',
  );
  assert.ok(
    /pendingFlushHandle\s*=\s*null;[\s\S]{0,200}batchFlushScheduled\s*=\s*false/.test(region),
    'BUG: flushBatchesNow must reset pendingFlushHandle and batchFlushScheduled synchronously so a follow-up queueBatch can schedule a fresh flush.',
  );
  assert.ok(
    /pendingFlushHandle\s*=\s*setImmediate\s*\(/.test(region),
    'BUG: scheduleBatchFlush must capture the setImmediate handle when it queues a flush.',
  );
});
