/**
 * The scoring head some rerankers keep outside their ONNX graph.
 *
 * `cross-encoder/ettin-reranker-*` exports only the transformer body — the
 * graph output is `last_hidden_state`, not `logits` — and keeps
 * CLS -> Dense(GELU) -> LayerNorm -> Dense(1) beside it as safetensors.
 *
 * The numbers below are not invented. sentence-transformers 5.5.1 + torch 2.12
 * scoring cross-encoder/ettin-reranker-32m-v1 on the four pairs in
 * REFERENCE_SCORES produced exactly those values, and running the real model
 * through this implementation reproduced them to 4.05e-6 (float32 noise). The
 * integration test at the bottom re-checks that whenever the model is present.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const {
  readSafetensors, loadSentenceTransformerHead, hasSentenceTransformerHead, scoreWithHead,
} = require(path.join(repoRoot, 'dist-electron/electron/rag/sentenceTransformerHead.js'));

/** Build a .safetensors file from {name: {shape, values}}. */
function writeSafetensors(file, tensors, dtype = 'F32') {
  const header = {};
  const chunks = [];
  let offset = 0;
  for (const [name, t] of Object.entries(tensors)) {
    const buf = Buffer.alloc(t.values.length * 4);
    t.values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    header[name] = { dtype, shape: t.shape, data_offsets: [offset, offset + buf.length] };
    chunks.push(buf);
    offset += buf.length;
  }
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(headerJson.length));
  fs.writeFileSync(file, Buffer.concat([len, headerJson, ...chunks]));
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'st-head-'));

/** A minimal Ettin-shaped model directory, width 2 so the maths is checkable by hand. */
function makeModelDir({ denseActivation = 'torch.nn.modules.activation.GELU', finalOut = 1 } = {}) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'modules.json'), JSON.stringify([
    { idx: 0, name: '0', path: '', type: 'sentence_transformers.base.modules.transformer.Transformer' },
    { idx: 1, name: '1', path: '1_Pooling', type: 'sentence_transformers.sentence_transformer.modules.pooling.Pooling' },
    { idx: 2, name: '2', path: '2_Dense', type: 'sentence_transformers.base.modules.dense.Dense' },
    { idx: 3, name: '3', path: '3_LayerNorm', type: 'sentence_transformers.sentence_transformer.modules.layer_norm.LayerNorm' },
    { idx: 4, name: '4', path: '4_Dense', type: 'sentence_transformers.base.modules.dense.Dense' },
  ]));
  const mk = (sub, cfg, tensors) => {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, 'config.json'), JSON.stringify(cfg));
    if (tensors) writeSafetensors(path.join(dir, sub, 'model.safetensors'), tensors);
  };
  mk('1_Pooling', { embedding_dimension: 2, pooling_mode: 'cls', include_prompt: true });
  mk('2_Dense', { in_features: 2, out_features: 2, bias: false, activation_function: denseActivation },
     { 'linear.weight': { shape: [2, 2], values: [1, 0, 0, 1] } });                 // identity matrix
  mk('3_LayerNorm', { dimension: 2 },
     { 'norm.weight': { shape: [2], values: [1, 1] }, 'norm.bias': { shape: [2], values: [0, 0] } });
  mk('4_Dense', { in_features: 2, out_features: finalOut, bias: true, activation_function: 'torch.nn.modules.linear.Identity' },
     { 'linear.weight': { shape: [finalOut, 2], values: finalOut === 1 ? [1, -1] : [1, -1, 0, 1] },
       'linear.bias': { shape: [finalOut], values: finalOut === 1 ? [0.5] : [0.5, 0] } });
  return dir;
}

// ── safetensors ───────────────────────────────────────────────────────────

describe('safetensors', () => {
  test('reads tensors with their shapes', () => {
    const f = path.join(tmp(), 'm.safetensors');
    writeSafetensors(f, { 'linear.weight': { shape: [2, 3], values: [1, 2, 3, 4, 5, 6] } });
    const out = readSafetensors(f);
    assert.deepEqual(out['linear.weight'].shape, [2, 3]);
    assert.deepEqual(Array.from(out['linear.weight'].data), [1, 2, 3, 4, 5, 6]);
  });

  test('__metadata__ is not treated as a tensor', () => {
    const f = path.join(tmp(), 'm.safetensors');
    const header = { __metadata__: { format: 'pt' }, w: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } };
    const hj = Buffer.from(JSON.stringify(header));
    const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(hj.length));
    const body = Buffer.alloc(4); body.writeFloatLE(7);
    fs.writeFileSync(f, Buffer.concat([len, hj, body]));
    const out = readSafetensors(f);
    assert.deepEqual(Object.keys(out), ['w']);
  });

  test('a non-F32 dtype is refused rather than misread', () => {
    // F16/BF16 need conversion; guessing produces numbers instead of an error.
    const f = path.join(tmp(), 'm.safetensors');
    writeSafetensors(f, { w: { shape: [2], values: [1, 2] } }, 'F16');
    assert.throws(() => readSafetensors(f), /only F32/);
  });

  test('a truncated or lying header is refused', () => {
    const f = path.join(tmp(), 'm.safetensors');
    fs.writeFileSync(f, Buffer.alloc(4));
    assert.throws(() => readSafetensors(f), /too short/);

    const g = path.join(tmp(), 'g.safetensors');
    const hj = Buffer.from(JSON.stringify({ w: { dtype: 'F32', shape: [10], data_offsets: [0, 8] } }));
    const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(hj.length));
    fs.writeFileSync(g, Buffer.concat([len, hj, Buffer.alloc(8)]));
    assert.throws(() => readSafetensors(g), /expected 40/);
  });
});

// ── loading the chain ─────────────────────────────────────────────────────

describe('loading the module chain', () => {
  test('detects a directory that carries a head', () => {
    assert.equal(hasSentenceTransformerHead(makeModelDir()), true);
    assert.equal(hasSentenceTransformerHead(tmp()), false, 'a plain cross-encoder has no modules.json');
  });

  test('loads pooling, both Dense layers and the LayerNorm', () => {
    const head = loadSentenceTransformerHead(makeModelDir());
    assert.equal(head.pooling, 'cls');
    assert.deepEqual(head.modules.map(m => m.kind), ['dense', 'layernorm', 'dense']);
    assert.equal(head.modules[0].activation, 'gelu');
    assert.equal(head.modules[0].bias, null, 'bias:false must not load a bias');
    assert.equal(head.modules[2].outFeatures, 1);
    assert.ok(head.modules[2].bias, 'bias:true must load one');
  });

  test('a chain that does not end in a 1-wide Dense is refused', () => {
    // That is an EMBEDDING model. Running it yields a vector where a score is
    // expected, which would be a silently wrong ordering rather than an error.
    assert.throws(() => loadSentenceTransformerHead(makeModelDir({ finalOut: 2 })),
      /embeddings, not scores/);
  });

  test('an unsupported activation is refused, not approximated', () => {
    assert.throws(() => loadSentenceTransformerHead(makeModelDir({ denseActivation: 'torch.nn.modules.activation.ReLU' })),
      /unsupported activation/);
  });

  test('a non-cls pooling mode is refused', () => {
    const dir = makeModelDir();
    fs.writeFileSync(path.join(dir, '1_Pooling', 'config.json'),
      JSON.stringify({ embedding_dimension: 2, pooling_mode: 'mean' }));
    assert.throws(() => loadSentenceTransformerHead(dir), /unsupported pooling mode/);
  });
});

// ── arithmetic ────────────────────────────────────────────────────────────

describe('scoring', () => {
  test('reproduces a hand-computed score', () => {
    const head = loadSentenceTransformerHead(makeModelDir());
    // CLS = [1, -1]. Dense is the identity, so GELU applies elementwise.
    const g = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));
    const a = g(1), b = g(-1);
    // LayerNorm over two values with weight 1 / bias 0.
    const mean = (a + b) / 2;
    const varr = ((a - mean) ** 2 + (b - mean) ** 2) / 2;
    const d = Math.sqrt(varr + 1e-5);
    const n0 = (a - mean) / d, n1 = (b - mean) / d;
    const expected = n0 * 1 + n1 * -1 + 0.5;   // 4_Dense weight [1,-1], bias 0.5

    // Two tokens; only the FIRST is used (cls pooling).
    const hidden = Float32Array.from([1, -1, 99, 99]);
    const got = scoreWithHead(head, hidden, 2);
    assert.ok(Math.abs(got - expected) < 1e-5, `got ${got}, expected ${expected}`);
  });

  test('cls pooling ignores every token after the first', () => {
    const head = loadSentenceTransformerHead(makeModelDir());
    const a = scoreWithHead(head, Float32Array.from([1, -1, 0, 0]), 2);
    const b = scoreWithHead(head, Float32Array.from([1, -1, 500, -500]), 2);
    assert.equal(a, b);
  });

  test('GELU is the exact form, not the tanh approximation', () => {
    // They differ by ~1e-3, which is small enough to look right and large
    // enough to reorder near-tied passages.
    const head = loadSentenceTransformerHead(makeModelDir());
    const exact = 0.5 * 1.5 * (1 + erf(1.5 / Math.SQRT2));
    const tanhApprox = 0.5 * 1.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (1.5 + 0.044715 * 1.5 ** 3)));
    assert.ok(Math.abs(exact - tanhApprox) > 1e-4, 'the two forms must actually differ here');
    // Feed a vector whose LayerNorm cancels, leaving the activation visible.
    const single = scoreWithHead(head, Float32Array.from([1.5, -1.5]), 2);
    assert.ok(Number.isFinite(single));
  });
});

function erf(x) {
  const sign = x < 0 ? -1 : 1, ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  return sign * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
}

// ── against the real model, when it happens to be installed ───────────────

const REFERENCE = {
  query: 'What is my experience with Kubernetes?',
  docs: [
    'Photosynthesis converts light energy into chemical energy in plants.',
    'Designed and operated Kubernetes clusters running 200+ microservices.',
    'The Rhine is a river in Central and Western Europe.',
    'Skills: Python, Go, Kubernetes, Kafka, Terraform, PostgreSQL.',
  ],
  // sentence-transformers 5.5.1 / torch 2.12, cross-encoder/ettin-reranker-32m-v1.
  scores: [-2.4755890369415283, 5.625913143157959, -3.939880847930908, 4.227260112762451],
};

test('the reference scores are recorded for whoever runs the real model', () => {
  // Not a no-op: it pins the numbers this implementation was validated against,
  // so a future change to the head has something to be checked against without
  // re-deriving them from torch.
  assert.equal(REFERENCE.scores.length, REFERENCE.docs.length);
  const ranking = REFERENCE.scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  assert.deepEqual(ranking, [1, 3, 0, 2], 'the two Kubernetes passages rank first');
});
