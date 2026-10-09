// What a model row says when a download, a file check or a repair does not
// finish. The installers and the downloader report in developer text; the row
// must get a sentence with no file names, addresses, digests or error codes,
// and nothing at all for a transfer the user cancelled.
//
// Nothing here branches on the OS: "in use" is simply what Windows reports for
// a file a running model still has open, so its wording is tested like the rest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { classifyModelTransferFailure, describeModelTransferFailure } =
  require(path.join(repoRoot, 'dist-electron/electron/services/extensions/modelTransferFailure.js'));

// The real strings, copied from where they are produced.
const RAW = {
  cancelledByInstaller: 'cancelled',
  cancelledByDownloader: 'download cancelled',
  notInstalled: 'Ettin Reranker 68M is not fully downloaded',
  inUse: 'could not replace model.gguf: the existing file is in use. Turn the extension off before re-downloading its model. (EBUSY)',
  noSpace: 'ENOSPC: no space left on device, write',
  wrongSize: 'onnx/model.onnx is the wrong size: expected 597000000 bytes, got 1024',
  wrongHash: 'model.gguf failed verification: expected ' + 'a'.repeat(64) + ', got ' + 'b'.repeat(64),
  http: 'HTTP 404 fetching https://huggingface.co/org/name/resolve/0123abcd/config.json',
  network: 'fetch failed',
  patch: 'config.json for Jina Reranker v2 could not be updated with the settings this model needs. Download it again.',
  nodeError: "EACCES: permission denied, open '/Users/someone/Library/Application Support/natively/local-models/org/name/config.json.part'",
};

test('each raw reason is recognised for what it is', () => {
  assert.equal(classifyModelTransferFailure(RAW.cancelledByInstaller), 'cancelled');
  assert.equal(classifyModelTransferFailure(RAW.cancelledByDownloader), 'cancelled');
  assert.equal(classifyModelTransferFailure(RAW.notInstalled), 'not-installed');
  assert.equal(classifyModelTransferFailure(RAW.inUse), 'in-use');
  assert.equal(classifyModelTransferFailure(RAW.noSpace), 'no-space');
  assert.equal(classifyModelTransferFailure(RAW.wrongSize), 'not-intact');
  assert.equal(classifyModelTransferFailure(RAW.wrongHash), 'not-intact');
  assert.equal(classifyModelTransferFailure(RAW.patch), 'settings-not-written');
  assert.equal(classifyModelTransferFailure('Jina Reranker v2 needs its config.json adjusted, but that file is verified by hash and must not be changed'), 'settings-not-written');
  // A config.json in an address or a path is not that.
  assert.equal(classifyModelTransferFailure(RAW.nodeError), 'other');
  assert.equal(classifyModelTransferFailure(RAW.http), 'other');
  assert.equal(classifyModelTransferFailure(RAW.network), 'other');
  assert.equal(classifyModelTransferFailure(undefined), 'other');
});

test('a cancelled transfer has no message, whatever was being done', () => {
  for (const action of ['download', 'repair', 'check']) {
    for (const raw of [RAW.cancelledByInstaller, RAW.cancelledByDownloader]) {
      assert.deepEqual(describeModelTransferFailure('Model X', raw, action), { kind: 'cancelled', message: null });
    }
  }
});

test('no sentence carries a path, an address, a digest, a byte count or an error code', () => {
  const leaks = /https?:|\/Users\/|[A-Za-z]:\\|\.part\b|\.gguf\b|\.onnx\b|\.json\b|[a-f0-9]{32,}|\b\d{4,}\b|\bE[A-Z]{4,}\b|HTTP \d/;
  for (const action of ['download', 'repair', 'check']) {
    for (const [label, raw] of Object.entries(RAW)) {
      const { message } = describeModelTransferFailure('Model X', raw, action);
      if (message === null) continue;
      assert.doesNotMatch(message, leaks, `${action} / ${label}: ${message}`);
      assert.match(message, /Model X/, `${action} / ${label} should name the model`);
      assert.match(message, /\.$/, `${action} / ${label} should be a sentence`);
    }
  }
});

test('a repair that failed says what the user can do about that cause', () => {
  const say = (raw) => describeModelTransferFailure('Model X', raw, 'repair').message;
  assert.match(say(RAW.network), /damaged, and downloading them again did not work\. Check your connection/);
  // Windows, with the model still loaded: a connection hint would send the user the wrong way.
  assert.match(say(RAW.inUse), /while the model is in use\. Choose another model, then check its files again\./);
  assert.doesNotMatch(say(RAW.inUse), /connection/);
  assert.match(say(RAW.noSpace), /not enough free disk space/);
  assert.match(say(RAW.notInstalled), /is not fully downloaded\. Download it first\./);
});

test('a download that failed says what the user can do about that cause', () => {
  const say = (raw) => describeModelTransferFailure('Model X', raw, 'download').message;
  assert.match(say(RAW.http), /could not be downloaded\. Check your connection and try again\./);
  assert.match(say(RAW.wrongSize), /did not arrive intact\. Try the download again\./);
  assert.match(say(RAW.wrongHash), /did not arrive intact/);
  assert.match(say(RAW.noSpace), /not enough free disk space to download Model X\./);
  assert.match(say(RAW.inUse), /because the model is in use/);
  assert.match(say(RAW.patch), /the settings it needs could not be written/);
});

test('a check that could not run does not claim the files are damaged', () => {
  const { message } = describeModelTransferFailure('Model X', 'TypeError: something unexpected', 'check');
  assert.match(message, /could not be checked/);
  assert.doesNotMatch(message, /damaged/);
});
