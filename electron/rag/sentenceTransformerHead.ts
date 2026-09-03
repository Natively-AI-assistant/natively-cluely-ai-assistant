/**
 * The scoring head some rerankers keep OUTSIDE their ONNX graph.
 *
 * `cross-encoder/ettin-reranker-*` exports `onnx/model.onnx` as the transformer
 * BACKBONE only — its graph output is `last_hidden_state`, not `logits`. The
 * part that turns a hidden state into a relevance score lives beside it as a
 * Sentence-Transformers module chain, in safetensors:
 *
 *     modules.json
 *       0 Transformer   -> the ONNX graph
 *       1 Pooling       1_Pooling/config.json        pooling_mode: "cls"
 *       2 Dense         2_Dense/*                    384 -> 384, GELU, no bias
 *       3 LayerNorm     3_LayerNorm/*                384
 *       4 Dense         4_Dense/*                    384 -> 1,   Identity, bias
 *
 * Loaded without that chain the model initialises cleanly and then produces
 * nothing usable — `output.logits` is `undefined` — which is why this looked
 * like an unsupported model rather than a missing 40 lines of arithmetic.
 *
 * VERIFIED AGAINST THE REFERENCE, not reasoned about. sentence-transformers
 * 5.5.1 + torch 2.12 scoring the same four pairs gives
 *   [-2.4756, 5.6259, -3.9399, 4.2273]
 * and this implementation reproduces them; the test pins those numbers.
 *
 * Only the shapes these models actually use are implemented. Anything else —
 * a different pooling mode, a dtype other than F32, an activation that is not
 * GELU or Identity — is REFUSED rather than approximated, because a silently
 * wrong score reorders the user's evidence with no error anywhere.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DenseModule {
  kind: 'dense';
  /** Row-major [outFeatures][inFeatures], as torch stores nn.Linear.weight. */
  weight: Float32Array;
  bias: Float32Array | null;
  inFeatures: number;
  outFeatures: number;
  activation: 'gelu' | 'identity';
}

export interface LayerNormModule {
  kind: 'layernorm';
  weight: Float32Array;
  bias: Float32Array | null;
  dimension: number;
}

export type HeadModule = DenseModule | LayerNormModule;

export interface SentenceTransformerHead {
  /** Only 'cls' is implemented; 'mean' would need the attention mask. */
  pooling: 'cls';
  modules: HeadModule[];
  /** Width the head expects out of the backbone. */
  inputDimension: number;
}

/** torch's default nn.LayerNorm eps. The ST config carries only `dimension`. */
const LAYER_NORM_EPS = 1e-5;

// ---------------------------------------------------------------------------
// safetensors
// ---------------------------------------------------------------------------

interface SafetensorsEntry { dtype: string; shape: number[]; data_offsets: [number, number] }

/**
 * Read a .safetensors file.
 *
 * Layout: 8-byte little-endian u64 header length, that many bytes of JSON
 * describing every tensor, then the raw buffer the offsets index into.
 */
export function readSafetensors(filePath: string): Record<string, { shape: number[]; data: Float32Array }> {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 8) throw new Error(`${path.basename(filePath)} is too short to be safetensors`);

  const headerLength = Number(buf.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerLength) || headerLength <= 0 || 8 + headerLength > buf.length) {
    throw new Error(`${path.basename(filePath)} has an implausible safetensors header length`);
  }

  let header: Record<string, SafetensorsEntry | unknown>;
  try {
    header = JSON.parse(buf.subarray(8, 8 + headerLength).toString('utf8'));
  } catch {
    throw new Error(`${path.basename(filePath)} has an unreadable safetensors header`);
  }

  const dataStart = 8 + headerLength;
  const out: Record<string, { shape: number[]; data: Float32Array }> = {};

  for (const [name, raw] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    const entry = raw as SafetensorsEntry;
    if (!entry || !Array.isArray(entry.shape) || !Array.isArray(entry.data_offsets)) continue;
    if (entry.dtype !== 'F32') {
      // F16/BF16 would need conversion, and guessing the wrong one produces
      // numbers rather than an error. These files are F32; refuse the rest.
      throw new Error(`${path.basename(filePath)}: tensor "${name}" is ${entry.dtype}, only F32 is supported`);
    }
    const [start, end] = entry.data_offsets;
    const expected = entry.shape.reduce((a, b) => a * b, 1) * 4;
    if (end - start !== expected) {
      throw new Error(`${path.basename(filePath)}: tensor "${name}" is ${end - start} bytes, expected ${expected}`);
    }
    // Copy rather than view: the slice must not alias a Buffer whose byteOffset
    // is unaligned for Float32Array, which throws on some inputs.
    //
    // The copy is ONE native memcpy, not a per-element JS loop. This used to be
    // `for (i...) data[i] = bytes.readFloatLE(i * 4)`, which is one bounds-
    // checked call per float: a single 768x768 dense layer is 589,824 of them,
    // and a head with a couple of dense modules plus layer norms runs into the
    // millions — all on the worker's load path. `Uint8Array.prototype.slice`
    // yields a fresh, correctly-aligned ArrayBuffer, so the alignment concern
    // the original comment describes is still handled.
    //
    // ENDIANNESS: readFloatLE was explicit; Float32Array uses the platform's
    // native order. safetensors is little-endian by specification, and every
    // architecture this app ships on (macOS arm64/x64, Windows x64/arm64) is
    // little-endian, so the two agree. A big-endian port would need a DataView
    // pass here.
    const bytes = buf.subarray(dataStart + start, dataStart + end);
    const aligned = Uint8Array.prototype.slice.call(bytes);
    const data = new Float32Array(aligned.buffer, aligned.byteOffset, entry.shape.reduce((a, b) => a * b, 1));
    out[name] = { shape: entry.shape, data };
  }

  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** True when this directory carries an ST module chain that needs applying. */
export function hasSentenceTransformerHead(modelDir: string): boolean {
  try {
    const modules = readJson(path.join(modelDir, 'modules.json'));
    return Array.isArray(modules) && modules.some((m: any) => typeof m?.path === 'string' && m.path);
  } catch {
    return false;
  }
}

/**
 * Load the chain described by `modules.json`.
 *
 * Throws on anything unrecognised. The caller treats a throw as "this model is
 * not usable", which is the honest outcome — the alternative is scoring with a
 * head that is subtly not the one that was trained.
 */
export function loadSentenceTransformerHead(modelDir: string): SentenceTransformerHead {
  const modules = readJson(path.join(modelDir, 'modules.json'));
  if (!Array.isArray(modules)) throw new Error('modules.json is not a list');

  let pooling: 'cls' | null = null;
  let inputDimension = 0;
  const loaded: HeadModule[] = [];

  for (const entry of modules) {
    const type = String(entry?.type ?? '');
    const rel = String(entry?.path ?? '');

    if (type.endsWith('Transformer')) continue;               // that is the ONNX graph

    if (type.endsWith('Pooling')) {
      const cfg = readJson(path.join(modelDir, rel, 'config.json'));
      if (cfg.pooling_mode !== 'cls') {
        throw new Error(`unsupported pooling mode "${cfg.pooling_mode}" (only cls is implemented)`);
      }
      pooling = 'cls';
      inputDimension = Number(cfg.embedding_dimension) || 0;
      continue;
    }

    if (type.endsWith('Dense')) {
      const cfg = readJson(path.join(modelDir, rel, 'config.json'));
      const tensors = readSafetensors(path.join(modelDir, rel, 'model.safetensors'));
      const weight = tensors['linear.weight'];
      if (!weight) throw new Error(`${rel}: no linear.weight in model.safetensors`);

      const activationName = String(cfg.activation_function ?? '');
      const activation: DenseModule['activation'] =
        activationName.endsWith('GELU') ? 'gelu'
          : activationName.endsWith('Identity') ? 'identity'
            : (() => { throw new Error(`${rel}: unsupported activation ${activationName}`); })();

      const outFeatures = Number(cfg.out_features);
      const inFeatures = Number(cfg.in_features);
      if (weight.shape[0] !== outFeatures || weight.shape[1] !== inFeatures) {
        throw new Error(
          `${rel}: weight is ${weight.shape.join('x')} but config says ${outFeatures}x${inFeatures}`,
        );
      }

      loaded.push({
        kind: 'dense',
        weight: weight.data,
        bias: cfg.bias ? (tensors['linear.bias']?.data ?? null) : null,
        inFeatures, outFeatures, activation,
      });
      continue;
    }

    if (type.endsWith('LayerNorm')) {
      const cfg = readJson(path.join(modelDir, rel, 'config.json'));
      const tensors = readSafetensors(path.join(modelDir, rel, 'model.safetensors'));
      const weight = tensors['norm.weight'];
      if (!weight) throw new Error(`${rel}: no norm.weight in model.safetensors`);
      loaded.push({
        kind: 'layernorm',
        weight: weight.data,
        bias: tensors['norm.bias']?.data ?? null,
        dimension: Number(cfg.dimension) || weight.shape[0],
      });
      continue;
    }

    throw new Error(`unsupported module type "${type}" in modules.json`);
  }

  if (!pooling) throw new Error('modules.json declares no Pooling module');
  if (loaded.length === 0) throw new Error('modules.json declares no scoring modules');

  const last = loaded[loaded.length - 1];
  if (last.kind !== 'dense' || last.outFeatures !== 1) {
    // A chain ending in anything but a 1-wide Dense is an EMBEDDING model, not
    // a reranker. Running it would yield a vector where a score is expected.
    throw new Error('the module chain does not end in a single-output Dense, so it produces embeddings, not scores');
  }

  return { pooling, modules: loaded, inputDimension };
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * torch's exact GELU: 0.5x(1 + erf(x/sqrt2)).
 *
 * NOT the tanh approximation. nn.GELU defaults to the exact form, and the two
 * differ by ~1e-3 — small enough to look fine and large enough to reorder
 * near-tied passages.
 */
function gelu(x: number): number {
  return 0.5 * x * (1 + erf(x / Math.SQRT2));
}

/** Abramowitz & Stegun 7.1.26. Max error ~1.5e-7, well inside float32. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-ax * ax);
  return sign * y;
}

function applyDense(input: Float32Array, m: DenseModule): Float32Array {
  const out = new Float32Array(m.outFeatures);
  for (let o = 0; o < m.outFeatures; o++) {
    // torch stores nn.Linear.weight as [out, in] and computes x @ W^T.
    const row = o * m.inFeatures;
    let sum = m.bias ? m.bias[o] : 0;
    for (let i = 0; i < m.inFeatures; i++) sum += input[i] * m.weight[row + i];
    out[o] = m.activation === 'gelu' ? gelu(sum) : sum;
  }
  return out;
}

function applyLayerNorm(input: Float32Array, m: LayerNormModule): Float32Array {
  const n = input.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += input[i];
  mean /= n;
  // Biased variance, matching torch.nn.LayerNorm.
  let variance = 0;
  for (let i = 0; i < n; i++) { const d = input[i] - mean; variance += d * d; }
  variance /= n;
  const denominator = Math.sqrt(variance + LAYER_NORM_EPS);

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const normalized = (input[i] - mean) / denominator;
    out[i] = normalized * m.weight[i] + (m.bias ? m.bias[i] : 0);
  }
  return out;
}

/**
 * Score one sequence from its hidden states.
 *
 * `hidden` is that sequence's `last_hidden_state`, [tokens][width] flattened
 * row-major — the shape transformers.js hands back.
 */
export function scoreWithHead(head: SentenceTransformerHead, hidden: Float32Array, width: number): number {
  // The backbone's width must be the width the head was trained on. Without
  // this, applyDense indexes input[i] for i < inFeatures and simply reads past
  // the CLS vector into the NEXT token's floats — returning a finite, plausible,
  // WRONG score. That is the one outcome this module refuses everywhere else
  // (unknown pooling, non-F32 tensors, unknown activations); the same rule has
  // to apply to the shape actually being fed in.
  const expected = head.modules.find((m) => m.kind === 'dense')?.inFeatures ?? head.inputDimension;
  if (expected && width !== expected) {
    throw new Error(
      `backbone width ${width} does not match the head's input dimension ${expected}`,
    );
  }

  // CLS pooling: the first token's vector, and nothing else.
  let x = hidden.subarray(0, width) as Float32Array;
  for (const m of head.modules) {
    x = m.kind === 'dense' ? applyDense(x, m) : applyLayerNorm(x, m);
  }
  if (x.length !== 1) throw new Error(`head produced ${x.length} values, expected 1`);
  return x[0];
}
