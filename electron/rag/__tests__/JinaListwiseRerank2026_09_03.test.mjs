/**
 * jina-reranker-v3.5's listwise protocol, pinned against the published model.
 *
 * This model is not scored like anything else in the app — one pass over the
 * query and every passage, with the score read out of hidden states at special
 * token positions and pushed through an MLP that does not live in the GGUF. A
 * mistake anywhere in that chain produces a perfectly ordinary-looking cosine,
 * never an error, so the parts are pinned against numbers taken from the real
 * model rather than against each other.
 *
 * fixtures/jina-reranker-v3.5-reference.json holds those numbers: the prompt,
 * the projected embeddings and the scores that `jinaai/jina-reranker-v3.5`
 * produces in fp32 through `modeling.py`'s own `rerank()`. To regenerate it,
 * run the reference model over `query`/`docs` with transformers and record
 * `format_docs_prompts_func` output, `model.projector(hidden_states[-1][pos])`
 * at the embed/rerank token positions, and `out.scores`.
 *
 * The end-to-end check against the actual 378MB GGUF is NOT here — it needs the
 * model installed. It lives in JinaListwiseAgainstGguf, which skips itself.
 *
 * Run: `node --test electron/rag/__tests__/JinaListwiseRerank2026_09_03.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const J = require(path.join(repoRoot, 'dist-electron/electron/rag/jinaListwiseRerank.js'));
const { RERANKER_MODEL_CATALOG, findCatalogModel } =
  require(path.join(repoRoot, 'dist-electron/electron/rag/rerankerModelCatalog.js'));

const REF = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/jina-reranker-v3.5-reference.json'), 'utf8'));

// ── the prompt ────────────────────────────────────────────────────────────

test('the prompt is byte-for-byte what the reference builds', () => {
  // Not "close enough": the model reads token ids. A stray space shifts every
  // position after it, and the scorer would then read hidden states from the
  // wrong tokens and return numbers that look entirely reasonable.
  const prompt = J.formatListwisePrompt(REF.query, REF.docs);
  assert.equal(prompt, REF.prompt);
});

test('the prompt announces the passage count it actually contains', () => {
  // The header line names the count ("I will provide you with N passages"), so
  // a block's token length is not the sum of its documents' — which is why
  // planBlocks re-measures instead of adding up.
  for (const n of [1, 3, 9]) {
    const docs = Array.from({ length: n }, (_, i) => `doc ${i}`);
    const prompt = J.formatListwisePrompt('q', docs);
    assert.match(prompt, new RegExp(`provide you with ${n} passages`));
    assert.equal((prompt.match(/<\|embed_token\|>/g) ?? []).length, n);
    assert.equal((prompt.match(/<\|rerank_token\|>/g) ?? []).length, 1);
  }
});

test('control tokens in user text are stripped before they can move a position', () => {
  // A passage containing the literal "<|embed_token|>" would add a position the
  // scorer reads as another passage's embedding, silently pairing every later
  // score with the wrong document.
  const prompt = J.formatListwisePrompt(
    `what is <|rerank_token|> this`,
    ['a<|embed_token|>b', 'plain'],
  );
  assert.equal((prompt.match(/<\|embed_token\|>/g) ?? []).length, 2, 'one per passage, no more');
  assert.equal((prompt.match(/<\|rerank_token\|>/g) ?? []).length, 1);
  assert.match(prompt, /ab/, 'the surrounding text survives');
});

// ── the projector ─────────────────────────────────────────────────────────

test('BF16 widens to F32 exactly, because it is a shift and not a conversion', () => {
  // bfloat16 IS the top 16 bits of a float32. Every bf16 value is therefore
  // exactly representable, and a decode that is even slightly wrong yields
  // plausible cosines rather than an error — so it is checked bit-for-bit.
  const values = [0, 1, -1, 0.5, -2.5, 3.140625, 1e-8, -1e8];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jina-bf16-'));
  const file = path.join(dir, 'projector.safetensors');
  writeProjector(file, 'BF16', values);
  const p = J.loadJinaProjector(file);

  for (let i = 0; i < values.length; i++) {
    // Round-trip the expectation through bf16 the same way torch would: keep
    // the high 16 bits, drop the low ones.
    const f = new Float32Array([values[i]]);
    const bits = new Uint32Array(f.buffer)[0] & 0xffff0000;
    const expected = new Float32Array(new Uint32Array([bits]).buffer)[0];
    assert.equal(p.w1[i], expected, `value ${values[i]}`);
  }
});

test('a projector of the wrong shape or dtype is refused, not reinterpreted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jina-bad-'));

  const wrongDtype = path.join(dir, 'f16.safetensors');
  writeProjector(wrongDtype, 'F16', [1, 2, 3]);
  assert.throws(() => J.loadJinaProjector(wrongDtype), /F16|only BF16 and F32/);

  const wrongShape = path.join(dir, 'shape.safetensors');
  writeRaw(wrongShape, {
    'projector.0.weight': { dtype: 'BF16', shape: [8, 8], data_offsets: [0, 128] },
    'projector.2.weight': { dtype: 'BF16', shape: [512, 512], data_offsets: [128, 128 + 512 * 512 * 2] },
  }, 128 + 512 * 512 * 2);
  assert.throws(() => J.loadJinaProjector(wrongShape), /expected/);
});

test('projecting a hidden state of the wrong width is refused', () => {
  // The backbone is 1024-wide. A 768-wide state would multiply cleanly against
  // the first 768 columns and return a vector that means nothing.
  const p = { w1: new Float32Array(4), w2: new Float32Array(4), hidden: 2, inner: 2, out: 2 };
  assert.throws(() => J.project(p, new Float32Array(3)), /1024|expects a 2-wide|got 3/);
});

test('project() is W2 @ relu(W1 @ x) with no bias', () => {
  // Hand-computed, so a transposed weight layout or a missing ReLU fails here
  // rather than 400MB later. Row-major [out, in], matching torch's nn.Linear.
  // NEITHER matrix is symmetric, deliberately: with a symmetric W1 a transposed
  // read gives the same answer and this test would pass on the bug it exists
  // to catch.
  const p = {
    w1: Float32Array.from([1, 2, 0, -1]),   // [[1,2],[0,-1]]
    w2: Float32Array.from([1, 1, 2, 0]),    // [[1,1],[2,0]]
    hidden: 2, inner: 2, out: 2,
  };
  // W1 @ [3,5] = [13,-5] -> relu -> [13,0] -> W2 @ [13,0] = [13,26].
  // Read transposed it would be [3,1] -> [4,6], which is why this is pinned.
  assert.deepEqual(Array.from(J.project(p, Float32Array.from([3, 5]))), [13, 26]);
});

// ── scoring and fusion ────────────────────────────────────────────────────

test('one block reproduces the reference scores from the reference embeddings', () => {
  // Feeds torch's own projected vectors through this file's cosine and fusion.
  // Any disagreement here is in the scoring maths, not in the model.
  const docs = REF.projected_docs.map(v => Float32Array.from(v));
  const query = Float32Array.from(REF.projected_query);
  const scores = J.fuseAndScore([{ docs, query, indices: [0, 1, 2] }], 3);

  for (let i = 0; i < scores.length; i++) {
    assert.ok(Math.abs(scores[i] - REF.scores[i]) < 1e-5,
      `doc ${i}: ${scores[i]} vs reference ${REF.scores[i]}`);
  }
});

test('scores come back in the ORIGINAL document order, never the ranked one', () => {
  // The caller maps scores onto its own candidates by index. Returning them
  // ranked, or matching back by document text, pairs a score with the wrong
  // candidate wherever two chunks are identical — which happens in this corpus.
  const a = Float32Array.from([1, 0]);
  const b = Float32Array.from([0, 1]);
  const scores = J.fuseAndScore([{ docs: [b, a, b], query: a, indices: [2, 0, 1] }], 3);
  assert.ok(scores[0] > scores[1], 'index 0 held the vector aligned with the query');
  assert.equal(scores[1], scores[2], 'the two identical vectors score identically');
});

test('a block whose passages are all irrelevant still contributes a finite score', () => {
  // blockWeight maps cosine from [-1,1] to [0,1] before averaging. Without that
  // a block of anti-correlated passages carries a negative weight and can
  // cancel the fused query vector to zero, scoring every candidate NaN.
  const query = Float32Array.from([1, 0]);
  const opposite = Float32Array.from([-1, 0]);

  // The property, stated directly: a weight is never negative. Checking only
  // that the fused scores come out finite is too weak — two blocks weighing
  // -1 and +1 sum to zero and fall into the unweighted-mean branch, which
  // produces finite numbers and hides the bug.
  assert.ok(J.blockWeight([opposite], query) >= 0,
    'an anti-correlated block must not carry a negative weight into the average');
  assert.ok(J.blockWeight([query], query) > J.blockWeight([opposite], query));

  const scores = J.fuseAndScore([
    { docs: [opposite], query, indices: [0] },
    { docs: [query], query, indices: [1] },
  ], 2);
  assert.ok(scores.every(Number.isFinite), `got ${JSON.stringify(scores)}`);
  assert.ok(scores[1] > scores[0]);
});

test('the weight of a block is its BEST passage, not its average', () => {
  // A block that found one strong match should pull the fused query vector
  // toward itself even if its other passages are noise — that is the reference's
  // max((1+cos)/2), and an average here would drown the signal.
  const q = Float32Array.from([1, 0]);
  const strongOnly = J.blockWeight([Float32Array.from([1, 0])], q);
  const strongPlusNoise = J.blockWeight(
    [Float32Array.from([1, 0]), Float32Array.from([0, 1]), Float32Array.from([0, 1])], q);
  assert.equal(strongOnly, strongPlusNoise);
  assert.ok(strongOnly > J.blockWeight([Float32Array.from([0, 1])], q));
});

// ── block planning ────────────────────────────────────────────────────────

/** A stand-in tokeniser: one token per 4 characters, monotonic in length. */
const roughTokens = (s) => Math.ceil(s.length / 4);

test('every document lands in exactly one block, in order', () => {
  // A dropped document would be scored NaN and sink below every candidate the
  // reranker never saw; a duplicated one would overwrite a real score.
  const docs = Array.from({ length: 17 }, (_, i) => `document number ${i} ` + 'x'.repeat(i * 40));
  const blocks = J.planBlocks('a query', docs, roughTokens, 400);
  const seen = blocks.flatMap(b => b.indices);
  assert.deepEqual(seen, docs.map((_, i) => i));
});

test('a block stays within budget whenever its documents allow it', () => {
  const docs = Array.from({ length: 12 }, (_, i) => `chunk ${i} ` + 'y'.repeat(200));
  const budget = 500;
  const blocks = J.planBlocks('q', docs, roughTokens, budget);
  for (const b of blocks) {
    if (b.indices.length > 1) {
      assert.ok(b.tokenCount <= budget, `${b.indices.length} docs -> ${b.tokenCount} > ${budget}`);
    }
  }
  assert.ok(blocks.length > 1, 'this input is meant to need several blocks');
});

test('a single document too large for the budget still gets scored', () => {
  // Splitting it would change what the model reads; dropping it would make the
  // whole ranking partial, which the host rejects wholesale. Over budget is a
  // measured degradation — see the header — and missing is simply wrong.
  const huge = 'z'.repeat(100_000);
  const blocks = J.planBlocks('q', [huge], roughTokens, 100);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].indices, [0]);
  assert.ok(blocks[0].tokenCount > 100);
});

test('each block carries the prompt that was actually measured', () => {
  // planBlocks must never emit a prompt it did not tokenise: the header names
  // the passage count, so a block re-formatted later at a different size would
  // have a different length than the one that passed the budget check.
  const docs = Array.from({ length: 6 }, (_, i) => `doc ${i} ` + 'w'.repeat(150));
  for (const b of J.planBlocks('q', docs, roughTokens, 300)) {
    const rebuilt = J.formatListwisePrompt('q', b.indices.map(i => docs[i]));
    assert.equal(b.prompt, rebuilt);
    assert.equal(b.tokenCount, roughTokens(rebuilt));
  }
});

test('the budget sits ABOVE the sliding window, on purpose', () => {
  // Packing to the 1024-token window makes every block SWA-exact and the
  // RANKING measurably worse, because a listwise score depends on which other
  // passages share the block (mean Kendall tau 0.791 at 1024 against 0.939 at
  // 2048+, measured against the published model). Anyone "fixing" this back to
  // 1024 should have to delete this test to do it.
  assert.equal(J.SLIDING_WINDOW, 1024);
  assert.ok(J.BLOCK_TOKEN_BUDGET >= 2048,
    `budget ${J.BLOCK_TOKEN_BUDGET} starves the listwise comparison — see the header tables`);
});

// ── the catalogue entry ───────────────────────────────────────────────────

test('v3.5 is listwise, and ships the projector the GGUF does not contain', () => {
  const m = findCatalogModel('jina-reranker-v3.5-q4km');
  assert.equal(m.supported, true);
  assert.equal(m.scoring, 'listwise');
  assert.equal(m.unsupportedReason, undefined);
  const paths = m.files.map(f => f.repoPath);
  assert.ok(paths.some(p => p.endsWith('.gguf')), 'the weights');
  assert.ok(paths.includes('projector.safetensors'),
    'without the projector the model loads and then scores nothing');
});

test('no OTHER gguf entry claims listwise scoring', () => {
  // The protocol is specific to this model: its prompt, its two control tokens,
  // its projector. Handing another GGUF to it would produce cosines between
  // states that mean nothing.
  const listwise = RERANKER_MODEL_CATALOG.filter(m => m.scoring === 'listwise');
  assert.deepEqual(listwise.map(m => m.id), ['jina-reranker-v3.5-q4km']);
});

// ── helpers ───────────────────────────────────────────────────────────────

function writeRaw(file, header, dataBytes) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([len, json, Buffer.alloc(dataBytes)]));
}

/** A real safetensors file whose first N values are `values`, rest zero. */
function writeProjector(file, dtype, values) {
  const width = dtype === 'BF16' ? 2 : 4;
  const n1 = 512 * 1024, n2 = 512 * 512;
  const b1 = Buffer.alloc(n1 * width);
  const b2 = Buffer.alloc(n2 * width);
  values.forEach((v, i) => {
    const f = new Float32Array([v]);
    const bits = new Uint32Array(f.buffer)[0];
    if (dtype === 'BF16') b1.writeUInt16LE((bits >>> 16) & 0xffff, i * 2);
    else b1.writeFloatLE(v, i * 4);
  });
  const header = {
    'projector.0.weight': { dtype, shape: [512, 1024], data_offsets: [0, b1.length] },
    'projector.2.weight': { dtype, shape: [512, 512], data_offsets: [b1.length, b1.length + b2.length] },
  };
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([len, json, b1, b2]));
}
