#!/usr/bin/env node
// Fail-loud validation that Natively's REQUIRED packaged assets are present so a
// clean machine with no Ollama, no API keys, no internet, and no dev repo can:
//   - launch the app
//   - run local diagnostics
//   - use the packaged local fallback stack (intent + embedding)
//
// Runs in two modes:
//
//   node scripts/verify-packaged-local-assets.mjs                       (source mode)
//     verifies the repo tree before packaging.
//
//   node scripts/verify-packaged-local-assets.mjs --app <path-to-.app|unpacked>
//     verifies the GENERATED package contents.
//
// Exit code 1 on any missing required asset. The bge reranker is OPTIONAL
// (lazy-downloaded) and intentionally NOT checked here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Required packaged model files (the source of truth for the local fallback stack).
const REQUIRED_MODEL_FILES = [
  'Xenova/all-MiniLM-L6-v2/config.json',
  'Xenova/all-MiniLM-L6-v2/tokenizer.json',
  'Xenova/all-MiniLM-L6-v2/tokenizer_config.json',
  'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx',
  'Xenova/mobilebert-uncased-mnli/config.json',
  'Xenova/mobilebert-uncased-mnli/tokenizer.json',
  'Xenova/mobilebert-uncased-mnli/tokenizer_config.json',
  'Xenova/mobilebert-uncased-mnli/onnx/model_quantized.onnx',
  'Xenova/bge-reranker-base/config.json',
  'Xenova/bge-reranker-base/tokenizer.json',
  'Xenova/bge-reranker-base/tokenizer_config.json',
  'Xenova/bge-reranker-base/onnx/model_quantized.onnx',
];

// Required dependency directories in node_modules.
const REQUIRED_PACKAGE_DIRS = [
  'node_modules/@huggingface/transformers',
  'node_modules/onnxruntime-common',
  'node_modules/onnxruntime-node',
];

// Required asarUnpack globs (kept as a single source of truth for the
// package.json#build.asarUnpack list).
const REQUIRED_ASARUNPACK_GLOBS = [
  '**/node_modules/@huggingface/transformers/**',
  '**/node_modules/onnxruntime-common/**',
  '**/node_modules/onnxruntime-node/**',
  '**/intentClassifierWorker.js',
  '**/localEmbeddingWorker.js',
  '**/localRerankerWorker.js',
  '**/rerankerDownloadWorker.js',
  '**/whisperWorker.js',
  '**/vectorSearchWorker.js',
  '**/node_modules/better-sqlite3/**',
  '**/node_modules/keytar/**',
  '**/node_modules/sqlite-vec/**',
  '**/node_modules/sqlite-vec-*/**',
  '**/node_modules/sharp/**',
  '**/node_modules/@img/sharp*/**',
];

// Required built worker scripts (only checked after build:electron has run).
const REQUIRED_WORKER_FILES = [
  'dist-electron/electron/llm/intentClassifierWorker.js',
  'dist-electron/electron/rag/providers/localEmbeddingWorker.js',
  'dist-electron/electron/rag/localRerankerWorker.js',
  'dist-electron/electron/rag/rerankerDownloadWorker.js',
  'dist-electron/electron/audio/whisper/whisperWorker.js',
  'dist-electron/electron/rag/vectorSearchWorker.js',
];

// Required native binaries for the packaged app (the asarUnpack globs must place
// them under app.asar.unpacked). Checked in packaged mode only.
const REQUIRED_UNPACKED_NATIVE = [
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/keytar/build/Release/keytar.node',
  'node_modules/onnxruntime-node/bin',
  'node_modules/@img/sharp-darwin-arm64/lib',
  'node_modules/@img/sharp-libvips-darwin-arm64/lib',
  'node_modules/@img/sharp-darwin-x64/lib',
  'node_modules/@img/sharp-libvips-darwin-x64/lib',
  'node_modules/sqlite-vec-darwin-arm64/vec0.dylib',
  'node_modules/sqlite-vec-darwin-x64/vec0.dylib',
  'native-module/index.darwin-arm64.node',
  'native-module/index.darwin-x64.node',
];

const errors = [];
const notes = [];

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function checkFile(root, rel, label) {
  const full = path.join(root, rel);
  if (!exists(full)) {
    errors.push(`Missing ${label}: ${full}`);
    return;
  }
  let size = 0;
  try { size = fs.statSync(full).size; } catch {}
  if (size === 0) errors.push(`Empty ${label} (0 bytes): ${full}`);
}

function checkAny(root, relCandidates, label) {
  let found = false;
  for (const rel of relCandidates) {
    if (exists(path.join(root, rel))) { found = true; break; }
  }
  if (!found) errors.push(`Missing ${label}: tried ${relCandidates.map((r) => path.join(root, r)).join(', ')}`);
}

function verifySource() {
  console.log('[verify-packaged-local-assets] source mode');
  const modelsRoot = path.join(repoRoot, 'resources', 'models');
  for (const rel of REQUIRED_MODEL_FILES) checkFile(modelsRoot, rel, 'required model file');
  for (const dir of REQUIRED_PACKAGE_DIRS) {
    if (!exists(path.join(repoRoot, dir))) errors.push(`Missing required dependency dir: ${dir} (run npm ci)`);
  }

  // Assert the asarUnpack/extraResources config still lists what runtime needs.
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const asarUnpack = pkg?.build?.asarUnpack || [];
  for (const glob of REQUIRED_ASARUNPACK_GLOBS) {
    if (!asarUnpack.includes(glob)) errors.push(`package.json build.asarUnpack is missing required glob: ${glob}`);
  }
  const extraResources = pkg?.build?.extraResources || [];
  const hasModels = extraResources.some((e) => (typeof e === 'object' ? e.from : e) === 'resources/models/');
  if (!hasModels) errors.push('package.json build.extraResources must copy resources/models/ → models/');

  // Worker files exist only after build:electron; warn (not fail) if not built yet.
  for (const rel of REQUIRED_WORKER_FILES) {
    if (!exists(path.join(repoRoot, rel))) notes.push(`worker not built yet (run build:electron): ${rel}`);
  }
}

function resolveResourcesDir(appArg) {
  const abs = path.resolve(appArg);
  const macResources = path.join(abs, 'Contents', 'Resources');
  if (exists(macResources)) return macResources;
  const winResources = path.join(abs, 'resources');
  if (exists(winResources)) return winResources;
  if (exists(path.join(abs, 'app.asar.unpacked')) || exists(path.join(abs, 'models'))) return abs;
  return macResources;
}

function verifyPackaged(appArg) {
  console.log('[verify-packaged-local-assets] packaged mode:', appArg);
  const resources = resolveResourcesDir(appArg);
  if (!exists(resources)) {
    errors.push(`Could not locate Resources dir under: ${appArg}`);
    return;
  }

  const modelsRoot = path.join(resources, 'models');
  for (const rel of REQUIRED_MODEL_FILES) checkFile(modelsRoot, rel, 'packaged model file');

  const unpacked = path.join(resources, 'app.asar.unpacked');
  for (const dir of REQUIRED_PACKAGE_DIRS) {
    if (!exists(path.join(unpacked, dir))) errors.push(`Missing unpacked dependency: app.asar.unpacked/${dir}`);
  }

  // Native binaries & modules that must be present in the packaged app.
  for (const rel of REQUIRED_UNPACKED_NATIVE) {
    checkAny(unpacked, [rel], `unpacked native asset ${rel}`);
  }

  for (const rel of REQUIRED_WORKER_FILES) {
    const full = path.join(unpacked, rel);
    if (!exists(full)) errors.push(`Missing unpacked worker: app.asar.unpacked/${rel}`);
  }
}

const appIdx = process.argv.indexOf('--app');
if (appIdx !== -1 && process.argv[appIdx + 1]) {
  verifyPackaged(process.argv[appIdx + 1]);
} else {
  verifySource();
}

for (const note of notes) console.warn('[verify-packaged-local-assets] NOTE:', note);

if (errors.length > 0) {
  console.error('\n[verify-packaged-local-assets] FAILED — required packaged assets missing:');
  for (const e of errors) console.error('  ✗', e);
  process.exit(1);
}

console.log('[verify-packaged-local-assets] OK — all required packaged assets present.');
