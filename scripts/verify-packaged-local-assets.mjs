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
//   node scripts/verify-packaged-local-assets.mjs --app <path-to-.app|unpacked> [--platform darwin|win32]
//     verifies the GENERATED package contents. Platform is auto-detected from
//     the artifact's own directory layout (Contents/Resources vs resources/);
//     --platform is only needed for an already-unpacked --dir output that has
//     neither wrapper, since detection has nothing to look at in that case.
//
// Exit code 1 on any missing required asset — including the bundled reranker:
// REQUIRED_MODEL_FILES below lists all four of its files, so a package missing
// the reranker FAILS this gate. (Stale-comment fix 2026-08-13: this header
// previously claimed the reranker was "OPTIONAL … intentionally NOT checked
// here", contradicting the list 20 lines down; the reranker download provider
// lazy-download path exists only as a dev/self-heal fallback.)

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
  // The bundled cross-encoder. ms-marco replaced bge-reranker-base on
  // 2026-09-04: bge measured WORSE than no reranker at all (MRR 0.7558 against
  // a 0.8368 baseline) while costing 283MB, where ms-marco is +0.0320 at 24MB
  // and 211ms. docs/reranker-benchmark-2026-09-04.md
  'Xenova/ms-marco-MiniLM-L-6-v2/config.json',
  'Xenova/ms-marco-MiniLM-L-6-v2/tokenizer.json',
  'Xenova/ms-marco-MiniLM-L-6-v2/tokenizer_config.json',
  'Xenova/ms-marco-MiniLM-L-6-v2/onnx/model_quantized.onnx',

  'pipecat-ai/smart-turn-v3/manifest.json',
  'pipecat-ai/smart-turn-v3/smart-turn-v3.1-cpu.onnx',
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
  '**/localEmbeddingWorker.js',
  '**/localRerankerWorker.js',
  '**/whisperWorker.js',
  // 2026-09-05: the interaction router's ONNX worker. RouterModel rewrites
  // app.asar to app.asar.unpacked when it resolves this path, and without the
  // glob that rewrite points at a file that was never unpacked. It fails only
  // in a packaged build, and only when the flag is on.
  '**/routerWorker.js',
  '**/node_modules/better-sqlite3/**',
  '**/node_modules/keytar/**',
  '**/node_modules/sqlite-vec/**',
  '**/node_modules/sqlite-vec-*/**',
  '**/node_modules/sharp/**',
  // 2026-08-02: sharp's TRANSITIVE runtime deps must be unpacked too. sharp
  // was unpacked but detect-libc/semver/@img/colour were not, and Node
  // resolution from the unpacked PHYSICAL path never re-enters app.asar —
  // workers loading sharp via @huggingface/transformers died with
  // "Cannot find module 'detect-libc'" (ModelPreloader + LocalEmbeddingProvider
  // degraded in the shipped 2.8.5). The scope-wide @img glob replaces the
  // narrower '@img/sharp*' one so @img/colour is covered as well; the
  // closure-based guard in OnnxWorkerIsolationHardening2026_07_05.test.mjs
  // recomputes sharp's real dependency tree so future dep drift is caught.
  '**/node_modules/detect-libc/**',
  '**/node_modules/semver/**',
  '**/node_modules/@img/**',
];

// Required built worker scripts (only checked after build:electron has run).
const REQUIRED_WORKER_FILES = [
  'dist-electron/electron/rag/providers/localEmbeddingWorker.js',
  'dist-electron/electron/rag/localRerankerWorker.js',
  'dist-electron/electron/audio/whisper/whisperWorker.js',
  'dist-electron/electron/llm/routing/routerWorker.js',
];

// Required native binaries for the packaged app (the asarUnpack globs must place
// them under app.asar.unpacked). Checked in packaged mode only.
//
// Split per platform (2026-09-09): this list was macOS-only despite the script
// itself already being able to verify a Windows artifact (resolveResourcesDir
// below has handled the Windows resources/ layout all along) — a Windows
// packaged build had no check that sqlite-vec-windows-x64, keytar, or the Rust
// native-module actually landed under app.asar.unpacked, even though
// package.json lists sqlite-vec-windows-x64 as a real shipped
// optionalDependency. Entries shared by both platforms (better-sqlite3,
// keytar) use an identical relative path on every OS, so they live in COMMON.
// onnxruntime-node/bin is checked per-platform sub-directory
// (bin/napi-v6/<platform>), not the bare bin/ dir — a bare-directory check
// would pass even if the OTHER platform's binaries were the only ones
// unpacked.
const REQUIRED_UNPACKED_NATIVE_COMMON = [
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/keytar/build/Release/keytar.node',
];
const REQUIRED_UNPACKED_NATIVE_DARWIN = [
  'node_modules/onnxruntime-node/bin/napi-v6/darwin',
  'node_modules/@img/sharp-darwin-arm64/lib',
  'node_modules/@img/sharp-libvips-darwin-arm64/lib',
  'node_modules/@img/sharp-darwin-x64/lib',
  'node_modules/@img/sharp-libvips-darwin-x64/lib',
  'node_modules/sqlite-vec-darwin-arm64/vec0.dylib',
  'node_modules/sqlite-vec-darwin-x64/vec0.dylib',
  'native-module/index.darwin-arm64.node',
  'native-module/index.darwin-x64.node',
];
// Windows entries are UNVERIFIED against a real packaged artifact — this repo
// has no Windows machine to build and check one from. They are derived from
// each dependency's own published package layout (sharp 0.34.5's package.json
// lists @img/sharp-win32-{arch} but NO @img/sharp-libvips-win32-{arch} — unlike
// darwin, the win32 package carries libvips-42.dll in its own lib/, so a
// separate libvips entry here named a directory no Windows build contains;
// sqlite-vec-windows-x64 ships vec0.dll at its package root, confirmed
// locally; the Rust native-module's win32 binary name comes from
// native-module/index.js's own require() fallback chain, msvc-first).
// Requires physical Windows verification before this list can be trusted the
// way the DARWIN one is.
const REQUIRED_UNPACKED_NATIVE_WIN32 = [
  'node_modules/onnxruntime-node/bin/napi-v6/win32',
  'node_modules/@img/sharp-win32-x64/lib',
  'node_modules/sqlite-vec-windows-x64/vec0.dll',
];
// native-module ships one of two ABI variants per arch (index.js tries msvc
// first, falls back to gnu) — checked with checkAny, not checkFile.
const REQUIRED_UNPACKED_NATIVE_WIN32_ANY = [
  ['native-module/index.win32-x64-msvc.node', 'native-module/index.win32-x64-gnu.node'],
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
  if (exists(macResources)) return { resources: macResources, platform: 'darwin' };
  const winResources = path.join(abs, 'resources');
  if (exists(winResources)) return { resources: winResources, platform: 'win32' };
  if (exists(path.join(abs, 'app.asar.unpacked')) || exists(path.join(abs, 'models'))) {
    return { resources: abs, platform: null };
  }
  return { resources: macResources, platform: 'darwin' };
}

function verifyPackaged(appArg, platformArg) {
  console.log('[verify-packaged-local-assets] packaged mode:', appArg);
  const { resources, platform: detectedPlatform } = resolveResourcesDir(appArg);
  if (!exists(resources)) {
    errors.push(`Could not locate Resources dir under: ${appArg}`);
    return;
  }
  // --platform overrides detection for a layout resolveResourcesDir can't tell
  // apart on its own (an already-unpacked --dir output with no Contents/ or
  // resources/ wrapper); detection wins when it found one, since the actual
  // directory structure is stronger evidence than a caller-supplied guess.
  const platform = detectedPlatform || platformArg;
  if (platform !== 'darwin' && platform !== 'win32') {
    errors.push(
      `Could not determine target platform for ${appArg} — pass --platform darwin|win32 explicitly.`,
    );
    return;
  }
  console.log('[verify-packaged-local-assets] target platform:', platform);

  const modelsRoot = path.join(resources, 'models');
  for (const rel of REQUIRED_MODEL_FILES) checkFile(modelsRoot, rel, 'packaged model file');

  const unpacked = path.join(resources, 'app.asar.unpacked');
  for (const dir of REQUIRED_PACKAGE_DIRS) {
    if (!exists(path.join(unpacked, dir))) errors.push(`Missing unpacked dependency: app.asar.unpacked/${dir}`);
  }

  // Native binaries & modules that must be present in the packaged app.
  const platformNative = platform === 'darwin' ? REQUIRED_UNPACKED_NATIVE_DARWIN : REQUIRED_UNPACKED_NATIVE_WIN32;
  for (const rel of [...REQUIRED_UNPACKED_NATIVE_COMMON, ...platformNative]) {
    checkAny(unpacked, [rel], `unpacked native asset ${rel}`);
  }
  if (platform === 'win32') {
    for (const candidates of REQUIRED_UNPACKED_NATIVE_WIN32_ANY) {
      checkAny(unpacked, candidates, `unpacked native asset (one of ${candidates.join(' | ')})`);
    }
  }

  for (const rel of REQUIRED_WORKER_FILES) {
    const full = path.join(unpacked, rel);
    if (!exists(full)) errors.push(`Missing unpacked worker: app.asar.unpacked/${rel}`);
  }
}

const appIdx = process.argv.indexOf('--app');
const platformIdx = process.argv.indexOf('--platform');
const platformArg = platformIdx !== -1 ? process.argv[platformIdx + 1] : undefined;
if (appIdx !== -1 && process.argv[appIdx + 1]) {
  verifyPackaged(process.argv[appIdx + 1], platformArg);
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
