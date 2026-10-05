// electron/rag/__tests__/EmbeddingTensorSlice2026_09_21.test.mjs
//
// Regression guard for a SILENT-CORRUPTION defect in localEmbeddingWorker.ts.
//
// The worker used to split its output tensor at a hardcoded `DIMENSIONS = 384`
// regardless of the loaded model's real width. Correct for the bundled MiniLM;
// against a 768- or 1024-dim model, batch item i receives the bytes belonging
// to item i/2. The vectors are finite, unit-norm and correctly shaped — nothing
// throws — so the only symptom is degraded retrieval that reads as a model
// quality result.
//
// Measured against real Snowflake/snowflake-arctic-embed-m tensors
// (scripts/embedding-slicing-negative-control.mjs), cosine of old-slicing vs
// correct, per batch item: 1.000000, -0.015464, 0.584062, -0.045578.
//
// ITEM 0 SCORES A PERFECT 1.000 EVEN WHEN BROKEN, because its first 384 floats
// genuinely are its own. A test that inspected only the first vector of a batch
// would have passed against the defect. This one sweeps every item, and
// `oldBuggySlice` below reproduces the original arithmetic so the assertions
// are demonstrably non-vacuous: the same fixtures are shown to FAIL against it.
//
// No ONNX, no model download — the slicing arithmetic is isolated in
// embeddingTensorSlice.ts precisely so this can run in CI in milliseconds.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (p) =>
  import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', p)).href);

const { sliceEmbeddingTensor, deriveEmbeddingWidth } = await load('providers/embeddingTensorSlice.js');

/** A pooled tensor whose every value encodes (item, position) so misattribution is visible. */
function makeTensor(batch, width) {
  const data = new Float32Array(batch * width);
  for (let i = 0; i < batch; i++) {
    for (let j = 0; j < width; j++) data[i * width + j] = i * 1000 + j;
  }
  return { data, dims: [batch, width] };
}

/** EXACTLY what localEmbeddingWorker.ts did before the fix. Kept to prove the guard bites. */
const HARDCODED_384 = 384;
function oldBuggySlice(tensor, batch) {
  const out = [];
  for (let i = 0; i < batch; i++) {
    out.push(Array.from(tensor.data.slice(i * HARDCODED_384, (i + 1) * HARDCODED_384)));
  }
  return out;
}

describe('deriveEmbeddingWidth', () => {
  test('takes the LAST axis of dims, not the first', () => {
    assert.equal(deriveEmbeddingWidth({ data: new Float32Array(8 * 768), dims: [8, 768] }, 384), 768);
  });

  test('falls back only when the tensor reports no dims', () => {
    assert.equal(deriveEmbeddingWidth({ data: new Float32Array(384) }, 384), 384);
    assert.equal(deriveEmbeddingWidth({ data: new Float32Array(384), dims: [] }, 384), 384);
  });
});

describe('sliceEmbeddingTensor — correct attribution at every width', () => {
  for (const width of [384, 768, 1024]) {
    test(`${width}d: every batch item gets ITS OWN contiguous slice`, () => {
      const batch = 16;
      const vectors = sliceEmbeddingTensor(makeTensor(batch, width), batch, 384, `test-${width}d`);

      assert.equal(vectors.length, batch);
      for (let i = 0; i < batch; i++) {
        assert.equal(vectors[i].length, width, `item ${i} wrong width`);
        // Encoding is i*1000 + j, so a misattributed item is caught immediately.
        assert.equal(vectors[i][0], i * 1000, `item ${i} got another item's data`);
        assert.equal(vectors[i][width - 1], i * 1000 + width - 1, `item ${i} tail misaligned`);
      }
    });
  }
});

describe('the exact defect this guards against', () => {
  test('768d: the OLD hardcoded-384 slicing misattributes items 1+ (guard is not vacuous)', () => {
    const batch = 4;
    const width = 768;
    const tensor = makeTensor(batch, width);

    const broken = oldBuggySlice(tensor, batch);
    const fixed = sliceEmbeddingTensor(tensor, batch, 384, 'arctic-m-like');

    // Item 0 is identical under both — this is why a first-vector-only check
    // could never have caught the bug.
    assert.equal(broken[0][0], fixed[0][0], 'item 0 should agree under both, by construction');

    // Every later item is wrong under the old arithmetic.
    for (let i = 1; i < batch; i++) {
      assert.notEqual(
        broken[i][0], fixed[i][0],
        `item ${i}: old slicing should NOT match the correct vector — if this passes, ` +
        `the fixture no longer reproduces the defect and the guard is vacuous`,
      );
      // Concretely: the old code handed item i the data of item floor(i/2).
      assert.equal(broken[i][0], Math.floor(i / 2) * 1000 + (i % 2) * 384);
    }

    // And the old slicing also silently produced the WRONG WIDTH.
    assert.equal(broken[1].length, 384);
    assert.equal(fixed[1].length, 768);
  });
});

describe('fails loudly rather than emitting mislabelled vectors', () => {
  test('throws when data length is not batch x width', () => {
    assert.throws(
      () => sliceEmbeddingTensor({ data: new Float32Array(1000), dims: [4, 768] }, 4, 384, 'ragged'),
      /unexpected tensor shape/,
    );
  });

  test('throws on a nonsensical width', () => {
    assert.throws(
      () => sliceEmbeddingTensor({ data: new Float32Array(10), dims: [2, 0] }, 2, 384, 'zero-width'),
      /unexpected tensor shape/,
    );
  });

  test('throws on a nonsensical batch size', () => {
    assert.throws(
      () => sliceEmbeddingTensor({ data: new Float32Array(768), dims: [1, 768] }, 0, 384, 'zero-batch'),
      /invalid batchSize/,
    );
  });

  test('the error names the model, so a failure is actionable', () => {
    assert.throws(
      () => sliceEmbeddingTensor({ data: new Float32Array(5), dims: [2, 768] }, 2, 384, 'nomic-v1.5'),
      /nomic-v1\.5/,
    );
  });
});

describe('bundled MiniLM behaviour is unchanged', () => {
  test('384d single text', () => {
    const v = sliceEmbeddingTensor(makeTensor(1, 384), 1, 384, 'Xenova/all-MiniLM-L6-v2');
    assert.equal(v.length, 1);
    assert.equal(v[0].length, 384);
    assert.equal(v[0][0], 0);
  });

  test('384d batch matches the old arithmetic exactly — no behaviour change for the default', () => {
    const batch = 8;
    const tensor = makeTensor(batch, 384);
    assert.deepEqual(
      sliceEmbeddingTensor(tensor, batch, 384, 'Xenova/all-MiniLM-L6-v2'),
      oldBuggySlice(tensor, batch),
    );
  });
});
