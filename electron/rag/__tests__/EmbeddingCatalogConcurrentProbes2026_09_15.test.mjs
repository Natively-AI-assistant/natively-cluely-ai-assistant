// electron/rag/__tests__/EmbeddingCatalogConcurrentProbes2026_09_15.test.mjs
//
// THE BUG THIS PREVENTS. `embedding:get-catalog` probes three independent
// sources — the local Ollama daemon, a user-hosted custom endpoint, and
// OpenRouter's public listing over the internet. They used to be awaited one
// after another, so their AbortSignal timeouts ADDED UP: 5s + 5s + 10s, a ~20s
// worst case.
//
// Nothing in the UI renders that wait as progress. The Embeddings panel keeps
// its Active Model selector DISABLED until the catalogue resolves, so on a slow
// or offline network the control simply sat greyed out — showing a model the
// panel already knew, and refusing to open. Measured before the fix: the card
// painted at 41ms and the selector unlocked at 281-800ms even on a fast warm
// connection.
//
// Two independent guards, because either one alone can regress silently:
//   1. the three probes are issued together, not in series;
//   2. the renderer seeds the ACTIVE model into the option list, so the
//      selector never depends on the catalogue to become usable at all.
//
// Source-level assertions: the handler needs the whole Electron main process to
// execute, and the renderer memo is .tsx, which this runner cannot import.
// Comments are stripped before matching so that prose describing the old
// behaviour (including the comments above the code itself) can never satisfy or
// break an assertion.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8');

/** Strip // line comments and block comments, so only real code is matched. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The body of one safeHandle('<channel>', ...) registration.
 *
 * The opening brace is found by walking parenthesis depth rather than taking
 * the first `{` after the channel name. safeHandle's own call parens put the
 * callback at depth 1, so the body brace is the first `{` seen at depth 1
 * AFTER the arrow — which skips a type literal in the parameter list, e.g.
 * `safeHandle('x', async (_e, o: { a: number }) => {`. Taking the first brace
 * would have grabbed `{ a: number }` and silently asserted against the wrong
 * text.
 */
function handlerBody(src, channel) {
  const start = src.indexOf(`safeHandle('${channel}'`);
  assert.notEqual(start, -1, `${channel} is not registered at all`);

  let paren = 0, arrowSeen = false, open = -1;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '=' && src[i + 1] === '>' && paren === 1) { arrowSeen = true; i++; }
    else if (c === '{' && arrowSeen && paren === 1) { open = i; break; }
  }
  assert.notEqual(open, -1, `${channel} has no callback body`);

  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  throw new Error(`unbalanced braces in ${channel}`);
}

const PROBES = [
  'listOllamaEmbeddingModels(',
  'listCustomEmbeddingModels(',
  'listOpenRouterEmbeddingModels(',
];

describe('embedding catalogue probes run concurrently', () => {
  const body = stripComments(handlerBody(read('electron/ipcHandlers.ts'), 'embedding:get-catalog'));

  test('all three provider probes are issued inside one Promise.all', () => {
    const open = body.indexOf('Promise.all([');
    assert.notEqual(open, -1, 'the handler no longer batches its probes with Promise.all');

    // Bound the Promise.all([...]) argument list by bracket depth, so a later
    // unrelated array cannot make this pass by accident.
    let depth = 0, close = -1;
    for (let i = open + 'Promise.all('.length; i < body.length; i++) {
      if (body[i] === '[') depth++;
      else if (body[i] === ']' && --depth === 0) { close = i; break; }
    }
    assert.notEqual(close, -1, 'unbalanced Promise.all([...])');
    const batch = body.slice(open, close);

    for (const probe of PROBES) {
      assert.ok(batch.includes(probe), `${probe} is not inside the Promise.all batch`);
    }
  });

  test('no provider probe is awaited on its own before the batch', () => {
    // `await listX(` outside the batch is exactly the serial shape that made the
    // timeouts additive. isOllamaReachable() is deliberately exempt: it runs
    // only when Ollama listed nothing, to tell "daemon down" from "no embedders".
    for (const probe of PROBES) {
      const serial = new RegExp(`await\\s+(?:require\\([^)]*\\)\\.)?${probe.replace('(', '\\(')}`);
      assert.ok(!serial.test(body), `${probe} is still awaited serially`);
    }
  });
});

describe('the Active Model selector does not wait on the catalogue', () => {
  const src = stripComments(read('src/components/settings/EmbeddingSettings.tsx'));

  test('activeOptions seeds the active model when the catalogue lacks it', () => {
    const start = src.indexOf('const activeOptions');
    assert.notEqual(start, -1, 'activeOptions no longer exists');
    const memo = src.slice(start, src.indexOf('}, [providers, active]);', start));
    assert.ok(
      /activeId\s*&&\s*!\w+\.some\(/.test(memo),
      'activeOptions no longer guarantees the active model is in the list — the '
      + 'selector will sit disabled until the catalogue network call returns',
    );
  });

  test('the selector is still gated on the option list, so the seed is what unlocks it', () => {
    assert.ok(
      src.includes('disabled={!!pending || activeOptions.length === 0}'),
      'the selector gate changed; re-check that it cannot be disabled while the '
      + 'active model is known',
    );
  });
});
