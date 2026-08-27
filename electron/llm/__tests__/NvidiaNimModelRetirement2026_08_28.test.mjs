// NVIDIA NIM's Test Connection failed for every user, TWICE, for the same
// underlying reason: the probe was asking "did this model answer?" when the only
// question it exists to answer is "was the key accepted?".
//
//   1. It pinned meta/llama-3.1-8b-instruct, which NVIDIA retired on 2026-08-26.
//      410 Gone -> reported as a bad key.
//   2. The first fix pinned a live-LOOKING replacement, which returned 404
//      "Model not found" -> reported as a bad key. But NVIDIA answers a bad key
//      with 403 on every non-retired id, so it only reaches a 404 AFTER
//      authenticating. That 404 was proof the key WORKED.
//
// The response matrix these pin (probed directly, 403 reproduced twice):
//   no auth header       401   invalid key      403
//   valid key, bad model 404   retired model    410 (pre-auth)
//
// The predicates are IMPORTED from the build output. Only the ipcHandlers
// wiring — which cannot be imported without an Electron main process — is
// checked by reading the file.
//
// Platform: pure constants and HTTP status matching; no platform branch exists
// in any module under test, so one run covers macOS and Windows identically.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.resolve(__dirname, rel)).href);

// Loaded from the BUILD OUTPUT, the same way GroqModelLadder does it: what
// ships is what gets asserted, and a module that never made it into the bundle
// fails here rather than passing against source that nothing imports.
// Run: npm run build:electron, then node --test on this file.
const nv = await load('../../../dist-electron/electron/llm/nvidiaNimModels.js');

describe('what one probe response settles', () => {
  const verdict = (e) => nv.classifyNvidiaNimProbeError(e);

  test('THE LOAD-BEARING CASE: 404 "Model not found" means the KEY WORKED', () => {
    // NVIDIA authenticates before it resolves the model, so this status is only
    // reachable with a key it accepted. Reporting it as a failure is bug #2.
    assert.equal(
      verdict({ response: { status: 404, data: { message: 'Model not found' } } }),
      'key-ok',
    );
  });

  test('400 and 422 are the same story — a post-auth per-model rejection', () => {
    assert.equal(verdict({ response: { status: 400, data: { detail: 'unsupported' } } }), 'key-ok');
    assert.equal(verdict({ response: { status: 422, data: { detail: 'bad shape' } } }), 'key-ok');
  });

  test('the plain-text routing 404 is NOT proof of auth — it has no JSON body', () => {
    // An id NVIDIA never routed answers "404 page not found" as plain text,
    // before auth. Treating that as a working key would report success for a
    // typo'd key.
    assert.equal(verdict({ response: { status: 404, data: '404 page not found' } }), 'inconclusive');
  });

  test('403 is the bad-key answer — NVIDIA uses 403, not 401, for a wrong key', () => {
    assert.equal(
      verdict({ response: { status: 403, data: { status: 403, title: 'Forbidden', detail: 'Authorization failed' } } }),
      'key-bad',
    );
  });

  test('401 is the missing-header answer, also the key\'s problem', () => {
    assert.equal(verdict({ response: { status: 401 } }), 'key-bad');
  });

  test('410 is the ONLY status that advances the ladder — it is returned pre-auth', () => {
    assert.equal(verdict({ response: { status: 410 } }), 'try-next');
    assert.equal(nv.isNvidiaNimModelGone({ response: { status: 410 } }), true);
    assert.equal(nv.isNvidiaNimModelGone({ response: { status: 404, data: { message: 'Model not found' } } }), false);
  });

  test('a rate limit is never reported as "connected" — throttled is not working', () => {
    assert.equal(verdict({ response: { status: 429 } }), 'inconclusive');
  });

  test('a server error and a dead socket stay inconclusive', () => {
    assert.equal(verdict({ response: { status: 500, data: { detail: 'oops' } } }), 'inconclusive');
    assert.equal(verdict({ code: 'ECONNRESET', message: 'socket hang up' }), 'inconclusive');
  });
});

describe('nothing Natively ships points at a retired id', () => {
  test('the probe ladder is clean', () => {
    assert.ok(nv.NVIDIA_NIM_TEST_MODEL_LADDER.length >= 2,
      'the ladder needs a second rung for the 410 case, where the response is pre-auth');
    for (const id of nv.NVIDIA_NIM_TEST_MODEL_LADDER) {
      assert.equal(nv.isNvidiaNimRetiredModelId(id), false, `${id} is on the retired list`);
    }
  });

  test('the ladder does not stack rungs from one owner — an EOL batch is per-vendor', () => {
    const owners = nv.NVIDIA_NIM_TEST_MODEL_LADDER.map((id) => id.split('/')[0]);
    assert.equal(new Set(owners).size, owners.length, `all rungs share an owner: ${owners.join(', ')}`);
  });

  test('the model picker offers no retired id', () => {
    // Read the ids out of the shared picker table rather than duplicating them.
    const ids = /nvidia_nim:\s*\{[\s\S]*?ids:\s*\[([\s\S]*?)\]/.exec(src('src/utils/modelUtils.ts'))?.[1];
    assert.ok(ids, 'could not find STANDARD_CLOUD_MODELS.nvidia_nim.ids');
    const parsed = [...ids.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(parsed.length > 0, 'the picker offers no NVIDIA model at all');
    for (const id of parsed) {
      assert.ok(id.startsWith('nvidia_nim/'), `${id} is missing the routing prefix`);
      assert.equal(nv.isNvidiaNimRetiredModelId(id), false, `the picker still offers retired ${id}`);
    }
  });

  test('both ids the picker used to ship are recorded as retired, prefixed or bare', () => {
    assert.equal(nv.isNvidiaNimRetiredModelId('meta/llama-3.1-8b-instruct'), true);
    assert.equal(nv.isNvidiaNimRetiredModelId('nvidia_nim/meta/llama-3.1-8b-instruct'), true);
    assert.equal(nv.isNvidiaNimRetiredModelId('z-ai/glm4.7'), true);
    assert.equal(nv.isNvidiaNimRetiredModelId('nvidia_nim/z-ai/glm4.7'), true);
  });

  test('a live id is not swept up by the retired set', () => {
    assert.equal(nv.isNvidiaNimRetiredModelId('nvidia_nim/nvidia/nemotron-nano-3-30b-a3b'), false);
    assert.equal(nv.isNvidiaNimRetiredModelId(''), false);
    assert.equal(nv.isNvidiaNimRetiredModelId(null), false);
  });
});

describe("NVIDIA's RFC-7807 body reaches the user", () => {
  test('detail is extracted — this is the sentence that was missing', () => {
    const msg = nv.nvidiaNimErrorDetail({
      response: {
        data: {
          type: 'about:blank', title: 'Gone', status: 410,
          detail: "The model 'meta/llama-3.1-8b-instruct' has reached its end of life on 2026-08-26T09:00:00Z and is no longer available.",
        },
      },
    });
    assert.match(msg, /Gone: The model .* has reached its end of life/);
  });

  test('a bad key reads as an auth problem, not a mystery status code', () => {
    assert.equal(
      nv.nvidiaNimErrorDetail({ response: { data: { status: 403, title: 'Forbidden', detail: 'Authorization failed' } } }),
      'Forbidden: Authorization failed',
    );
  });

  test('an OpenAI-shaped body returns null so the generic extractor keeps priority', () => {
    assert.equal(nv.nvidiaNimErrorDetail({ response: { data: { error: { message: 'bad key' } } } }), null);
    assert.equal(nv.nvidiaNimErrorDetail({ response: { data: '404 page not found' } }), null);
    assert.equal(nv.nvidiaNimErrorDetail({ message: 'socket hang up' }), null);
  });
});

describe('the ipcHandlers wiring', () => {
  const handlers = src('electron/ipcHandlers.ts');

  test('the connection probe walks the ladder instead of pinning an id', () => {
    assert.doesNotMatch(handlers, /model: 'meta\/llama-3\.1-8b-instruct'/,
      'the retired pin is still in the probe');
    assert.match(handlers, /for \(const candidate of NVIDIA_NIM_TEST_MODEL_LADDER\)/);
  });

  test('only a 410 advances the ladder; a post-auth rejection reports success', () => {
    assert.match(handlers, /const verdict = classifyNvidiaNimProbeError\(nvidiaErr\);/);
    assert.match(handlers, /if \(verdict === 'try-next'\) \{ lastNvidiaError = nvidiaErr; continue; \}/);
    assert.match(handlers, /if \(verdict === 'key-ok'\)/);
    assert.match(handlers, /if \(nvidiaKeyAccepted && !response\) return \{ success: true \};/);
  });

  test('an all-retired ladder reports "could not verify", never a rung the user never chose', () => {
    // 410 is pre-auth, so exhaustion proves nothing about the key. Rethrowing
    // the last rung's error would show an EOL notice for a model the user has
    // never heard of, in a dialog asking about their key.
    assert.match(handlers, /classifyNvidiaNimProbeError\(lastNvidiaError\) === 'try-next'/);
    assert.match(handlers, /Could not verify the key: every model this test uses has been retired/);
  });

  test('the failing rung is named in the log — not knowing which one cost a round trip', () => {
    assert.match(handlers, /NVIDIA NIM test: \$\{candidate\}/);
  });

  test('the retired-default repair covers NVIDIA, not just Groq', () => {
    assert.match(handlers, /isNvidiaNimRetiredModelId\(modelId\)/);
    assert.match(handlers, /if \(!isRetiredId\(defaultModel\) && modelAvailable\(defaultModel\)\) return null;/);
  });

  test("the error extractor reads NVIDIA's detail", () => {
    assert.match(handlers, /nvidiaNimErrorDetail\(error\)/);
  });

  test('the SECOND persisted store — nvidia_nimPreferredModel — is withheld when retired', () => {
    // AIProvidersSettings bridges this into the default-model dropdown even when
    // it is not in the offered list, so correcting the picker table alone leaves
    // the dead id selectable.
    assert.match(handlers,
      /\.isNvidiaNimRetiredModelId\(creds\.nvidia_nimPreferredModel\)\s*\n?\s*\? undefined/);
  });
});

describe('the runtime retry classifier treats 410 as permanent', () => {
  test('410 is listed with 404 in the model_gone branch', () => {
    assert.match(src('electron/llm/visionStreamFallback.ts'),
      /status === 404 \|\| status === 410/);
  });
});
