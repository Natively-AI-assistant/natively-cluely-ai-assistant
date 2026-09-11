// The intent classifier's MobileBERT left the code on 2026-09-05, but every
// machine that ever warmed it kept a 94 MB copy under <userData>/whisper-models.
// This sweep is the only thing that removes it. It must remove exactly the
// retired ids and nothing beside them, and it must run on every launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const { purgeObsoleteModelCaches } = require(path.join(repoRoot, 'dist-electron/electron/audio/whisper/modelManager.js'));

function scaffold() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-cache-sweep-'));
  const mk = (rel) => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  mk('Xenova/mobilebert-uncased-mnli/onnx/model_quantized.onnx');
  mk('Xenova/mobilebert-uncased-mnli/config.json');
  mk('Xenova/whisper-tiny.en/onnx/encoder_model.onnx');
  mk('Xenova/all-MiniLM-L6-v2/config.json');
  return root;
}

test('removes the retired MobileBERT cache and returns its id', () => {
  const root = scaffold();
  try {
    const removed = purgeObsoleteModelCaches(root);
    assert.deepEqual(removed, ['Xenova/mobilebert-uncased-mnli']);
    assert.equal(fs.existsSync(path.join(root, 'Xenova', 'mobilebert-uncased-mnli')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('leaves every other cached model alone', () => {
  const root = scaffold();
  try {
    purgeObsoleteModelCaches(root);
    assert.equal(fs.existsSync(path.join(root, 'Xenova', 'whisper-tiny.en', 'onnx', 'encoder_model.onnx')), true, 'a Whisper download must survive');
    assert.equal(fs.existsSync(path.join(root, 'Xenova', 'all-MiniLM-L6-v2', 'config.json')), true, 'the embedder cache must survive');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('is a no-op the second time, and on a cache dir that does not exist', () => {
  const root = scaffold();
  try {
    purgeObsoleteModelCaches(root);
    assert.deepEqual(purgeObsoleteModelCaches(root), []);
    assert.deepEqual(purgeObsoleteModelCaches(path.join(root, 'never-created')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('main.ts runs the sweep inside the local-fallback preflight timer', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const timer = src.indexOf('const preflightTimer = setTimeout(');
  const sweep = src.indexOf('purgeObsoleteModelCaches();');
  const preflight = src.indexOf('runLocalFallbackPreflight({', timer);
  assert.ok(timer !== -1 && sweep !== -1 && preflight !== -1, 'anchors present');
  assert.ok(timer < sweep && sweep < preflight, 'the sweep runs after the launcher paints and before the preflight reports');
});
