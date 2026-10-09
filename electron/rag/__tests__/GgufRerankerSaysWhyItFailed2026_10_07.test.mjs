// Regression test for: choosing a GGUF reranker in a packaged app said
// "the model loaded but did not return a usable ranking" when the llama.cpp
// runtime had never started.
//
// THE BUG. GgufReranker.rerank() fails closed: a worker that rejects with
// "Cannot find package 'chalk' ..." is caught, logged, and turned into `null`.
// The Settings self-test (ipcHandlers reranker:use-local-model) only saw `null`,
// and worded every `null` as a model that loaded but returned nothing usable.
// The real cause was in the log and nowhere the user could see.
//
// THE FIX, guarded here: the port remembers why its last rerank returned null
// (`lastFailure`), and describeRerankActivationFailure() turns that into a
// sentence that names the cause without module names, paths or Node error text.
//
// Platform note: pure JS, no OS branches. The wording is deliberately generic
// ("reinstall or update"), so it is correct on macOS and Windows alike.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { GgufReranker } = require(path.join(repoRoot, 'dist-electron/electron/rag/GgufReranker.js'));
const { describeRerankActivationFailure } =
  require(path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankActivationFailure.js'));

const MODEL_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-why-')), 'model.gguf');
fs.writeFileSync(MODEL_PATH, '');

/** A worker whose replies are scripted per message type. */
function scriptedWorker(replyFor) {
  const worker = new EventEmitter();
  worker.postMessage = (msg) => {
    const reply = replyFor(msg);
    if (reply === undefined) return;
    setImmediate(() => worker.emit('message', { requestId: msg.requestId, ...reply }));
  };
  worker.terminate = async () => 0;
  return worker;
}

function portWith(worker) {
  let called = 0;
  // spawnWorker is the LAST constructor parameter; see the dispose test for why
  // the slot matters (a wrong slot spawns a real llama.cpp worker).
  const port = new GgufReranker(MODEL_PATH, 'rank', null, null, () => { called += 1; return worker; });
  return { port, injected: () => called > 0 };
}

const PASSAGES = ['Paris is the capital of France.', 'The Rhine is a river.'];

describe('GgufReranker.lastFailure', () => {
  test('a runtime that cannot start is reported, not swallowed', async () => {
    const message = "Cannot find package 'chalk' imported from C:\\app\\node_modules\\node-llama-cpp\\dist\\bindings\\Llama.js";
    const { port, injected } = portWith(scriptedWorker((m) => (m.type === 'init' ? { type: 'error', error: message } : undefined)));
    assert.equal(port.lastFailure, null, 'healthy before anything has run');

    assert.equal(await port.rerank('capital of France', PASSAGES), null, 'still fails closed');
    assert.ok(injected(), 'the stand-in worker must be the one used');
    assert.match(port.lastFailure ?? '', /Cannot find package 'chalk'/);
    await port.dispose();
  });

  test('a later success clears it', async () => {
    let fail = true;
    const { port } = portWith(scriptedWorker((m) => {
      if (m.type === 'init') return { type: 'ready' };
      if (m.type === 'rerank') return fail ? { type: 'rerank', scores: [1] } : { type: 'rerank', scores: [0.9, 0.1] };
    }));
    assert.equal(await port.rerank('q', PASSAGES), null, 'one score for two passages is refused');
    assert.match(port.lastFailure ?? '', /different number of scores/);

    fail = false;
    const ranked = await port.rerank('q', PASSAGES);
    assert.equal(ranked?.length, 2);
    assert.equal(port.lastFailure, null);
    await port.dispose();
  });
});

describe('describeRerankActivationFailure', () => {
  test('a missing dependency is worded as a broken install, with no module name or path', () => {
    const text = describeRerankActivationFailure(
      "Cannot find package 'chalk' imported from C:\\Users\\user\\AppData\\Local\\Programs\\app\\Llama.js",
    );
    assert.match(text, /part of it is missing from this install/);
    assert.doesNotMatch(text, /chalk|Users|Llama\.js|ERR_/);
  });

  test('both Node spellings of a missing module are recognised', () => {
    for (const raw of [
      "Cannot find module '/Applications/x.app/Contents/Resources/app.asar.unpacked/y.js'",
      "Cannot find package 'ora' imported from /x/y.js",
      'ERR_MODULE_NOT_FOUND',
    ]) {
      assert.match(describeRerankActivationFailure(raw), /missing from this install/, raw);
    }
  });

  test('timeouts, missing files and dead workers each get their own sentence', () => {
    assert.match(describeRerankActivationFailure('gguf reranker timed out after 90000ms'), /did not answer in time/);
    assert.match(describeRerankActivationFailure('gguf model not found at x.gguf'), /file could not be found/);
    assert.match(describeRerankActivationFailure('gguf reranker worker exited with code 3'), /stopped unexpectedly/);
  });

  test('no reason still gives the original sentence', () => {
    for (const none of [null, undefined, '', '   ']) {
      assert.equal(describeRerankActivationFailure(none), 'the model loaded but did not return a usable ranking');
    }
  });

  test('an unrecognised reason never reaches the UI verbatim', () => {
    const text = describeRerankActivationFailure("EACCES: permission denied, open 'C:\\Users\\user\\models\\x.gguf'");
    assert.equal(text, 'the model could not run. Details are in the app log');
    assert.doesNotMatch(text, /EACCES|Users|\.gguf/);
  });
});
