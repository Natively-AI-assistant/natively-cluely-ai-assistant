// electron/rag/jinaListwiseRerank.ts
//
// jina-reranker-v3.5's scoring protocol, which is not like any other reranker
// in this app.
//
// Every other reranker here is a cross-encoder: one query/passage pair in, one
// number out. v3.5 is LISTWISE. The query and every passage go through the
// backbone in a single pass; each passage carries an `<|embed_token|>` and the
// query an `<|rerank_token|>`, and the score is the cosine between the
// projected hidden states at those positions:
//
//     score_i = cos( P(h[embed_i]), P(h[rerank]) )
//     P(x)    = W2 @ relu(W1 @ x)          both nn.Linear(bias=False)
//
// P is NOT in the GGUF. Jina ship it separately as `projector.safetensors`,
// two BF16 matrices, and say so in their README. A .gguf on its own can never
// score anything with this model, which is why the catalogue entry downloads
// all three files.
//
// ── Why this can run here at all, when Jina's own README says it cannot ─────
//
// Jina's GGUF instructions tell you to build a forked `llama-embedding`,
// because their driver needs three things upstream lacks. Two of them turn out
// not to apply to the path taken here:
//
//   `--output-token-ids` — a CLI flag on their Python driver. What it exposes
//     is per-position hidden states, and node-llama-cpp can already produce
//     those: `_decodeTokens` takes a per-token `logits` mask, and
//     `getEmbedding(batchIndex + 1)` reads `llama_get_embeddings_ith`. Marking
//     several positions returns several distinct vectors. Verified.
//
//   non-causal encoder mode — their driver's concern. The published HF
//     reference (`modeling.py`) subclasses `Qwen3ForCausalLM` and calls
//     `super().forward()` with no mask override, so the model this file
//     reproduces is plain causal. llama.cpp runs it causal by default
//     (`cparams.causal_attn = hparams.causal_attn`, and the GGUF declares no
//     `attention.causal` key). The two agree.
//
//   the SWA fix (llama.cpp PR #26286, still open) — this one is real. The GGUF
//     declares `sliding_window_pattern arr[bool,28]` with 16 layers sliding at
//     window 1024; llama.cpp b10361 reads that key and then reports n_swa = 0,
//     running all 28 layers with full attention.
//
// The third is real, and it is the only one that constrains this file.
//
// Sliding-window attention with window W is IDENTICAL to full attention for any
// sequence of at most W tokens: the constraint it imposes, that a token may not
// attend further back than W, is vacuous when nothing is further back than W.
// So a prompt under 1024 tokens is scored exactly right despite the discard.
//
// MEASURED (jinaai/jina-reranker-v3.5 in fp32, published `layer_types` vs.
// every layer forced to full_attention — same weights, same prompt):
//
//     prompt tokens   max |score delta|   Kendall tau   order
//        235               0.0                1.0       identical
//        321               0.0                1.0       identical
//       1457               0.0235             0.867     differs
//       4277               0.0499             0.867     differs
//       8406               0.0573             0.848     differs
//
// The obvious conclusion — pack blocks to 1024 tokens and be exact — is WRONG,
// and it took a second measurement to find out. This is a LISTWISE model: a
// passage's score depends on which other passages share its block. Forcing
// small blocks to dodge the SWA error destroys more accuracy than the SWA error
// costs.
//
// MEASURED again, this implementation against the published model's own
// `rerank()` on realistic retrieved chunks (mean Kendall tau over three cases,
// and how often the top-1 and top-3 sets matched the reference):
//
//     block budget   mean tau   top-1   top-3 set
//         1024         0.791     2/3       2/3
//         2048         0.939     3/3       3/3
//         4096         0.939     3/3       3/3
//         8192         0.939     3/3       3/3
//
// So the budget is set well ABOVE the sliding window, deliberately, and the
// residual SWA error is accepted as the smaller of two evils. Above 2048 the
// numbers stop moving — the pools this reranker sees already fit — so the
// choice among the rest is about memory, not accuracy.
//
// Reference: `modeling.py` from jinaai/jina-reranker-v3.5 — specifically its
// `rerank()` method, which is the model card's own API. The `rerank.py` in the
// GGUF repo formats a different prompt (an extra EARLY rerank token and a
// trailing ranking instruction) for a variant the published weights do not
// match; following it would score a prompt the model was not given here.

import fs from 'fs';
import path from 'path';

/** `<|embed_token|>` — one per passage, marks where its hidden state is read. */
export const DOC_EMBED_TOKEN_ID = 151670;
/** `<|rerank_token|>` — one per block, marks the query's hidden state. */
export const QUERY_EMBED_TOKEN_ID = 151671;

export const DOC_EMBED_TOKEN = '<|embed_token|>';
export const QUERY_EMBED_TOKEN = '<|rerank_token|>';

/** The backbone's hidden width, and the projector's input. */
export const HIDDEN_SIZE = 1024;
/** The projector's output width. Scores are cosines in this space. */
export const PROJECTOR_DIM = 512;

/**
 * The most tokens allowed in one block's prompt.
 *
 * 4096, not the model's 1024-token sliding window — see the two tables in the
 * header. Lowering this to chase SWA-exactness measurably makes the ranking
 * WORSE, because it starves the listwise comparison. Raising it past 2048 buys
 * nothing measurable and costs KV cache: llama.cpp sizes its cache and compute
 * buffers from the context, and this model trains at 131,072 tokens, so the
 * default would reserve gigabytes for a window nothing here can fill.
 *
 * 4096 also matches RERANK_CONTEXT_SIZE in ggufRerankerWorker.ts, which was
 * measured at ~452 MB for a 0.6B model against ~4.3 GB for the untouched
 * default.
 */
export const BLOCK_TOKEN_BUDGET = 4096;

/**
 * The window the GGUF declares, and the length below which the discarded
 * sliding-window pattern provably costs nothing. Not the block budget — kept
 * because it is what makes the trade-off above legible.
 */
export const SLIDING_WINDOW = 1024;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PREFIX =
  '<|im_start|>system\n'
  + 'You are a search relevance expert who can determine a ranking of the passages based on how relevant they are to the query. '
  + 'If the query is a question, how relevant a passage is depends on how well it answers the question. '
  + 'If not, try to analyze the intent of the query and assess how well each passage satisfies the intent. '
  + 'If an instruction is provided, you should follow the instruction when determining the ranking.'
  + '<|im_end|>\n<|im_start|>user\n';

// The empty <think> block is `no_thinking=True` in the reference: Qwen3 emits a
// reasoning block unless one is already closed for it. Nothing is generated
// here — only hidden states are read — but the prompt must still match what the
// model was trained on, token for token.
const ASSISTANT_SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n';

/**
 * Remove the two control tokens from user text.
 *
 * Without this a passage containing the literal string `<|embed_token|>` adds a
 * position the scorer would read as another passage's embedding, silently
 * shifting every score after it onto the wrong document. Mirrors
 * `sanitize_input` in the reference.
 */
export function sanitizeInput(text: string): string {
  return text.split(DOC_EMBED_TOKEN).join('').split(QUERY_EMBED_TOKEN).join('');
}

/**
 * The listwise prompt for one block, byte-for-byte as
 * `format_docs_prompts_func` builds it.
 */
export function formatListwisePrompt(query: string, docs: readonly string[], instruction?: string): string {
  const q = sanitizeInput(query);
  const ds = docs.map(sanitizeInput);

  let body =
    `I will provide you with ${ds.length} passages, each indicated by a numerical identifier. `
    + `Rank the passages based on their relevance to query: ${q}\n`;

  if (instruction) body += `<instruct>\n${sanitizeInput(instruction)}\n</instruct>\n`;

  body += ds.map((doc, i) => `<passage id="${i}">\n${doc}${DOC_EMBED_TOKEN}\n</passage>`).join('\n') + '\n';
  body += `<query>\n${q}${QUERY_EMBED_TOKEN}\n</query>`;

  return SYSTEM_PREFIX + body + ASSISTANT_SUFFIX;
}

// ---------------------------------------------------------------------------
// Block planning
// ---------------------------------------------------------------------------

export interface Block {
  /** Indices into the ORIGINAL document array. Order is preserved. */
  readonly indices: number[];
  readonly prompt: string;
  readonly tokenCount: number;
}

/**
 * Pack documents into blocks whose prompts each fit the token budget.
 *
 * Greedy and re-measured: the prompt's header names the passage COUNT
 * ("I will provide you with 7 passages"), so a block's token count is not the
 * sum of its documents' and cannot be predicted by addition. Every candidate
 * block is formatted and tokenised for real.
 *
 * A single document that cannot fit alone still gets its own block. Splitting
 * it would change what the model reads, and dropping it would sink that
 * candidate below every candidate the reranker never saw — the host rejects a
 * partial ranking wholesale. Over-budget means degraded, which the first table
 * in the header quantifies; missing means wrong.
 */
export function planBlocks(
  query: string,
  docs: readonly string[],
  countTokens: (prompt: string) => number,
  budget: number = BLOCK_TOKEN_BUDGET,
  instruction?: string,
): Block[] {
  const blocks: Block[] = [];
  let start = 0;

  while (start < docs.length) {
    let end = start + 1;
    let best: Block = measure(query, docs, start, end, countTokens, instruction);

    // Grow while the NEXT size still fits. `best` always holds a formatted,
    // measured block, so the loop cannot emit an unmeasured guess.
    while (end < docs.length) {
      const candidate = measure(query, docs, start, end + 1, countTokens, instruction);
      if (candidate.tokenCount > budget) break;
      best = candidate;
      end += 1;
    }

    blocks.push(best);
    start = end;
  }

  return blocks;
}

function measure(
  query: string,
  docs: readonly string[],
  start: number,
  end: number,
  countTokens: (prompt: string) => number,
  instruction?: string,
): Block {
  const indices: number[] = [];
  for (let i = start; i < end; i++) indices.push(i);
  const prompt = formatListwisePrompt(query, indices.map(i => docs[i]), instruction);
  return { indices, prompt, tokenCount: countTokens(prompt) };
}

// ---------------------------------------------------------------------------
// Projector
// ---------------------------------------------------------------------------

export interface JinaProjector {
  /** nn.Linear(1024, 512, bias=False).weight — row-major [out, in]. */
  readonly w1: Float32Array;
  /** nn.Linear(512, 512, bias=False).weight — row-major [out, in]. */
  readonly w2: Float32Array;
  readonly hidden: number;
  readonly inner: number;
  readonly out: number;
}

interface SafetensorsEntry { dtype: string; shape: number[]; data_offsets: [number, number] }

/**
 * BF16 -> F32.
 *
 * bfloat16 IS the top 16 bits of an IEEE-754 float32 — same exponent, mantissa
 * truncated — so widening is a shift, exactly representable, no rounding. That
 * is why this is not the same problem as F16, which would need a real decode.
 */
function bf16ToFloat32(bytes: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count);
  const view = new DataView(out.buffer);
  for (let i = 0; i < count; i++) {
    // safetensors is little-endian by specification.
    const hi = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    view.setUint32(i * 4, hi << 16, true);
  }
  return out;
}

/**
 * Load `projector.safetensors`.
 *
 * Kept here rather than in sentenceTransformerHead.ts because that file's
 * reader deliberately refuses anything but F32 — a rule worth keeping, since a
 * silently mis-decoded dtype produces numbers instead of an error. This is the
 * one BF16 file in the app, and it is decoded exactly.
 */
export function loadJinaProjector(filePath: string): JinaProjector {
  const buf = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  if (buf.length < 8) throw new Error(`${name} is too short to be safetensors`);

  const headerLength = Number(buf.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerLength) || headerLength <= 0 || 8 + headerLength > buf.length) {
    throw new Error(`${name} has an implausible safetensors header length`);
  }

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(buf.subarray(8, 8 + headerLength).toString('utf8'));
  } catch {
    throw new Error(`${name} has an unreadable safetensors header`);
  }

  const dataStart = 8 + headerLength;

  const read = (key: string, expected: [number, number]): Float32Array => {
    const entry = header[key] as SafetensorsEntry | undefined;
    if (!entry) throw new Error(`${name}: missing tensor "${key}"`);
    if (entry.shape.length !== 2 || entry.shape[0] !== expected[0] || entry.shape[1] !== expected[1]) {
      throw new Error(`${name}: "${key}" is [${entry.shape}], expected [${expected}]`);
    }
    const count = expected[0] * expected[1];
    const [s, e] = entry.data_offsets;
    if (entry.dtype === 'BF16') {
      if (e - s !== count * 2) throw new Error(`${name}: "${key}" is ${e - s} bytes, expected ${count * 2}`);
      return bf16ToFloat32(buf.subarray(dataStart + s, dataStart + e), count);
    }
    if (entry.dtype === 'F32') {
      if (e - s !== count * 4) throw new Error(`${name}: "${key}" is ${e - s} bytes, expected ${count * 4}`);
      const aligned = Uint8Array.prototype.slice.call(buf.subarray(dataStart + s, dataStart + e));
      return new Float32Array(aligned.buffer, aligned.byteOffset, count);
    }
    // Refuse rather than guess: a wrongly decoded projector still returns
    // plausible-looking cosines.
    throw new Error(`${name}: "${key}" is ${entry.dtype}, only BF16 and F32 are supported`);
  };

  // Both key conventions Jina ship — `projector.N.weight` from a torch
  // Sequential, `N.weight` when the Sequential was saved on its own.
  const prefix = ('projector.0.weight' in header) ? 'projector.' : '';
  const w1 = read(`${prefix}0.weight`, [PROJECTOR_DIM, HIDDEN_SIZE]);
  const w2 = read(`${prefix}2.weight`, [PROJECTOR_DIM, PROJECTOR_DIM]);

  return { w1, w2, hidden: HIDDEN_SIZE, inner: PROJECTOR_DIM, out: PROJECTOR_DIM };
}

/** `W2 @ relu(W1 @ x)`, no biases — the reference Sequential has none. */
export function project(p: JinaProjector, hidden: Float32Array | number[]): Float32Array {
  if (hidden.length !== p.hidden) {
    throw new Error(`projector expects a ${p.hidden}-wide hidden state, got ${hidden.length}`);
  }

  const mid = new Float32Array(p.inner);
  for (let o = 0; o < p.inner; o++) {
    let sum = 0;
    const row = o * p.hidden;
    for (let i = 0; i < p.hidden; i++) sum += p.w1[row + i] * hidden[i];
    mid[o] = sum > 0 ? sum : 0;      // ReLU
  }

  const out = new Float32Array(p.out);
  for (let o = 0; o < p.out; o++) {
    let sum = 0;
    const row = o * p.inner;
    for (let i = 0; i < p.inner; i++) sum += p.w2[row + i] * mid[i];
    out[o] = sum;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring and fusion
// ---------------------------------------------------------------------------

export function norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

export function cosine(a: Float32Array, b: Float32Array, aNorm?: number, bNorm?: number): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const denom = (aNorm ?? norm(a)) * (bNorm ?? norm(b));
  return denom === 0 ? 0 : dot / denom;
}

export interface BlockEmbeddings {
  /** Projected passage embeddings, in the block's own document order. */
  readonly docs: Float32Array[];
  /** The block's projected query embedding. */
  readonly query: Float32Array;
  /** Indices into the original document array, parallel to `docs`. */
  readonly indices: number[];
}

/**
 * `max((1 + cos) / 2)` over the block — the reference's block weight.
 *
 * A block whose best passage is a poor match contributes less to the fused
 * query vector than one that found something. Mapped from [-1, 1] to [0, 1]
 * first, because np.average rejects negative weights and a block of purely
 * irrelevant passages would otherwise pull the fusion the wrong way.
 */
export function blockWeight(docs: Float32Array[], query: Float32Array): number {
  const qn = norm(query);
  let best = -Infinity;
  for (const d of docs) best = Math.max(best, cosine(d, query, undefined, qn));
  return (1 + best) / 2;
}

/**
 * Fuse per-block query embeddings and score every passage against the result.
 *
 * This is the reference's `rerank()` tail: a weighted average of the blocks'
 * query vectors, then one cosine per passage. Scores are returned in the
 * ORIGINAL document order — the caller maps them back to its own candidates by
 * index, and matching by text would pair a score with the wrong candidate
 * wherever two chunks are identical, which happens in this corpus.
 */
export function fuseAndScore(blocks: readonly BlockEmbeddings[], totalDocs: number): number[] {
  if (blocks.length === 0) return [];

  const weights = blocks.map(b => blockWeight(b.docs, b.query));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const fused = new Float32Array(blocks[0].query.length);
  if (weightSum > 0) {
    for (let b = 0; b < blocks.length; b++) {
      const w = weights[b] / weightSum;
      const q = blocks[b].query;
      for (let i = 0; i < fused.length; i++) fused[i] += w * q[i];
    }
  } else {
    // Every block weighed zero, which means every cosine was exactly -1. Fall
    // back to an unweighted mean rather than dividing by zero and scoring NaN.
    for (const block of blocks) {
      for (let i = 0; i < fused.length; i++) fused[i] += block.query[i] / blocks.length;
    }
  }

  const fusedNorm = norm(fused);
  const scores = new Array<number>(totalDocs).fill(NaN);
  for (const block of blocks) {
    for (let i = 0; i < block.docs.length; i++) {
      scores[block.indices[i]] = cosine(block.docs[i], fused, undefined, fusedNorm);
    }
  }
  return scores;
}
