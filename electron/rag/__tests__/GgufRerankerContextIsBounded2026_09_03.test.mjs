// Regression test for: the GGUF reranker allocated a 40,960-token context to
// score one query/passage pair, costing ~4.3 GB.
//
// THE BUG. ggufRerankerWorker created its scoring context with no contextSize:
//
//     context = await model.createContext({ sequences: 1 });   // yes-no path
//     context = await model.createRankingContext();            // ranking path
//
// llama.cpp defaults a context to the model's FULL trained length and sizes the
// KV cache and compute buffers from it. Qwen3-Reranker-0.6B — the model this
// branch ships as the default local GGUF reranker — trains at 40,960 tokens.
//
// MEASURED 2026-09-03, Qwen3-Reranker-0.6B Q4_K_M, macOS arm64, clean process
// per row, RSS cost of createContext alone with the model already loaded:
//
//     contextSize        cost
//     40960 (default)    4291 MB
//      4096 (the fix)     452 MB
//      2048               227 MB
//
// End to end through GgufReranker.rerank() on the real model, peak RSS for
// scoring two short passages:
//
//     BEFORE: 588 / 1783 / 2628 / 5159 / 5177 MB   (wildly variable, up to 5.2 GB)
//     AFTER:  1274 / 1315 / 1282 MB                (stable, ~1.3 GB)
//
// And the scores are bit-identical across the change:
//     [{"index":0,"score":0.9963399102377497},{"index":1,"score":0.006041806736594444}]
// so the ~3.8 GB is bought back for nothing.
//
// Nothing in this system can fill a 40,960-token window for a rerank. A passage
// is one chunk, and the chunker emits 140 words with 30 overlap
// (ModeContextRetriever CHUNK_WORDS / CHUNK_OVERLAP; the fine path is 45) — at
// 2 tokens/word that is ~280 tokens, plus template and query.
//
// THE FIX, guarded here: both context paths pass a bounded contextSize,
// clamped to the model's own trained length so a smaller model is never asked
// for a window it does not have.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const source = readFileSync(path.join(repoRoot, 'electron/rag/ggufRerankerWorker.ts'), 'utf8');

test('the yes-no scoring context is created with a bounded contextSize', () => {
    const call = /createContext\(\{[^}]*\}\)/.exec(source)?.[0] ?? '';
    assert.match(
        call,
        /contextSize\s*:/,
        'model.createContext() must pass a contextSize. Without one llama.cpp allocates the ' +
        "model's full trained window — 40,960 tokens for Qwen3-Reranker-0.6B, measured at " +
        '4291 MB — to score a single query/passage pair.',
    );
});

test('the ranking context is created with a bounded contextSize', () => {
    // NB: the argument contains a call of its own, so match the braces, not
    // the first closing paren.
    const call = /createRankingContext\(\{[^}]*\}\)/.exec(source)?.[0] ?? '';
    assert.match(
        call,
        /contextSize\s*:/,
        'model.createRankingContext() must pass a contextSize for the same reason as the ' +
        'yes-no path — a bge-class ranking model defaults to its full trained window too.',
    );
});

test('the bound is clamped to the model trained context length', () => {
    assert.match(
        source,
        /Math\.min\(\s*RERANK_CONTEXT_SIZE\s*,\s*trained\s*\)/,
        'the requested contextSize must be clamped to model.trainContextSize, so a model ' +
        'trained shorter than RERANK_CONTEXT_SIZE is never asked for a window it lacks.',
    );
});

test('the bound leaves real headroom over the retriever budget', () => {
    const declared = Number(/const RERANK_CONTEXT_SIZE = (\d+)/.exec(source)?.[1]);
    assert.ok(Number.isFinite(declared), 'RERANK_CONTEXT_SIZE must be a literal number');
    // A passage is one 140-word chunk (~280 tokens at 2 tokens/word) plus the
    // Qwen template and the query. Anything near that would risk truncating a
    // passage, which changes its score with no error anywhere.
    assert.ok(
        declared >= 2048,
        `RERANK_CONTEXT_SIZE=${declared} is too small: a query + passage + prompt template must ` +
        'fit without truncation, or scores change silently.',
    );
    assert.ok(
        declared <= 8192,
        `RERANK_CONTEXT_SIZE=${declared} gives back most of the memory this fix exists to save ` +
        '(4291 MB at 40960, 452 MB at 4096 — the cost scales with the window).',
    );
});

test('mutation probe: dropping the contextSize argument fails the guard', () => {
    const mutated = source.replace(/,?\s*contextSize:\s*boundedContextSize\(\)/g, '');
    const call = /createContext\(\{[^}]*\}\)/.exec(mutated)?.[0] ?? '';
    assert.doesNotMatch(
        call,
        /contextSize\s*:/,
        'removing the contextSize argument left a match behind — the guard above is vacuous',
    );
});
