// Regression test for: two live llama.cpp contexts, and a reset that reached
// only one of them.
//
// THE BUG. rerankerConfig held the loaded GGUF port in a module-local:
//
//     let ggufPort: { id: string; port: RerankSeamPort } | null = null;
//
// That is safe only if the module has one instance per process. It does not.
// esbuild gives every electron entry its own bundle and INLINES this module
// into each one — a `require('./rerankerConfig')` is rewritten to
// `(init_rerankerConfig(), __toCommonJS(rerankerConfig_exports))`, the bundle's
// OWN copy, not a runtime load of the shared file.
//
// VERIFIED 2026-09-03 in dist-electron: 30 built bundles each define
// `buildLocalGgufPort`, and both ipcHandlers.js and main.js carried their own
// `var ... ggufPort`.
//
// Two consequences, both live:
//   1. Settings (`reranker:use-local-model`, ipcHandlers) loaded a model into
//      ITS copy. The retrieval path (RerankerRegistry) then saw its own copy
//      still null and loaded a SECOND — two llama.cpp contexts for one selected
//      model, 452 MB apiece at the bounded context size (and far more before
//      GgufRerankerContextIsBounded2026_09_03 capped it).
//   2. `resetLocalGgufPort()` called from Settings cleared only the Settings
//      copy, so the retrieval context stayed resident for the life of the
//      process with nothing able to reach it.
//
// THE FIX, guarded here: the port lives on the process singleton — the same
// rule RerankerRegistry already follows, and the one this file's own header
// warns about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const SINGLETON_PATH = path.join(
    repoRoot, 'dist-electron/electron/services/extensions/singleton.js',
);
const GGUF_PORT_KEY = 'natively.reranker.ggufPort';

test('rerankerConfig holds the gguf port on the process, not in a module-local', () => {
    const source = require('node:fs').readFileSync(
        path.join(repoRoot, 'electron/services/reranking/rerankerConfig.ts'), 'utf8',
    );
    assert.doesNotMatch(
        source,
        /^\s*let ggufPort/m,
        'a module-local `let ggufPort` is duplicated per esbuild bundle, so Settings and the ' +
        'retrieval path each get their own — two llama.cpp contexts for one selected model, and ' +
        'a reset that clears only one of them.',
    );
    assert.match(
        source,
        /peekProcessSingleton|setProcessSingleton/,
        'the port must be read and written through the process singleton',
    );
});

test('every mutation of the port goes through the singleton accessors', () => {
    const source = require('node:fs').readFileSync(
        path.join(repoRoot, 'electron/services/reranking/rerankerConfig.ts'), 'utf8',
    );
    // A bare assignment would reintroduce per-bundle state for that one path.
    assert.doesNotMatch(
        source,
        /(?<!function )\bggufPort\s*=(?!=)/,
        'found a direct assignment to ggufPort — every write must go through setGgufPort() or ' +
        'that path gets bundle-local state again',
    );
});

test('the process singleton really is shared across separate module instances', () => {
    // This is the property the fix depends on: two bundles hold two copies of
    // singleton.js, and they must still agree. Anchoring on globalThis is what
    // makes that true — proven here by deliberately creating a second instance.
    const first = require(SINGLETON_PATH);
    const marker = { id: `probe-${Date.now()}` };
    first.setProcessSingleton(GGUF_PORT_KEY, marker);

    delete require.cache[require.resolve(SINGLETON_PATH)];
    const second = require(SINGLETON_PATH);

    assert.notEqual(
        second.setProcessSingleton,
        first.setProcessSingleton,
        'precondition: the second require must be a genuinely separate module instance',
    );
    assert.deepEqual(
        second.peekProcessSingleton(GGUF_PORT_KEY),
        marker,
        'a separate module instance must observe the same value — otherwise the singleton does ' +
        'not actually solve the per-bundle duplication it exists for',
    );

    first.resetProcessSingleton(GGUF_PORT_KEY);
});

test('resetLocalGgufPort disposes the port it is releasing', () => {
    const source = require('node:fs').readFileSync(
        path.join(repoRoot, 'electron/services/reranking/rerankerConfig.ts'), 'utf8',
    );
    const body = source.slice(source.indexOf('export function resetLocalGgufPort'));
    assert.match(
        body.slice(0, 400),
        /dispose\?\.\(\)/,
        'releasing the reference without disposing leaves the llama.cpp worker running',
    );
});
