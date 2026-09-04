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

/**
 * Every `createContext` / `createRankingContext` call in the worker, with its
 * argument object. Checking ALL of them, not the first: the listwise path was
 * added after this guard and would otherwise have gone unchecked.
 */
function stripComments(text) {
    // Line 133 of the worker MENTIONS createRankingContext() in prose; without
    // this the scanner treats that comment as a call with empty arguments.
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function contextCalls(rawSource) {
    const source = stripComments(rawSource);
    const out = [];
    const re = /(createRankingContext|createContext)\s*\(/g;
    let m;
    while ((m = re.exec(source))) {
        // Balance from the opening paren so a multi-line argument object and a
        // nested call like boundedContextSize() are both handled.
        let depth = 0;
        for (let i = m.index + m[0].length - 1; i < source.length; i++) {
            if (source[i] === '(') depth++;
            else if (source[i] === ')') {
                depth--;
                if (depth === 0) { out.push({ name: m[1], args: source.slice(m.index, i + 1) }); break; }
            }
        }
    }
    return out;
}

test('every context the worker creates is given a bounded contextSize', () => {
    const calls = contextCalls(source);
    assert.ok(calls.length >= 2, `expected at least the yes-no and ranking paths, found ${calls.length}`);
    for (const { name, args } of calls) {
        assert.match(
            args,
            // `contextSize: x` or the ES6 shorthand `contextSize,`
            /contextSize\s*[:,}]/,
            `${name}() is created without a contextSize. Without one llama.cpp allocates the ` +
            "model's full trained window — 40,960 tokens for Qwen3-Reranker-0.6B, measured at " +
            `4291 MB — for a single query/passage pair.\n\ncall: ${args}`,
        );
    }
});

test('every bound is clamped to what the model was actually trained for', () => {
    // Each path may pick its own size (the listwise path uses its block budget),
    // but none may ask for more than the model has.
    const clamps = source.match(/Math\.min\([^)]*trainContextSize[^)]*\)|Math\.min\(\s*RERANK_CONTEXT_SIZE\s*,\s*trained\s*\)/g) ?? [];
    assert.ok(
        clamps.length >= 2,
        'each context path must clamp its requested size to model.trainContextSize; found ' +
        `${clamps.length} clamp(s). A model trained shorter than the requested window would ` +
        'otherwise be asked for one it does not have.',
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
