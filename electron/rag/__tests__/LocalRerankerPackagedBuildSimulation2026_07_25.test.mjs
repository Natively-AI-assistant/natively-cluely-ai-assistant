// electron/rag/__tests__/LocalRerankerPackagedBuildSimulation2026_07_25.test.mjs
//
// Phase 6 Slice 6 (context-rebuild, 05_MIGRATION_PLAN.md Slice 6): pre-
// required test for the rerank decision (D16k) — "a test asserting the
// chosen rerank implementation... is actually invoked in a packaged
// production build simulation (not just a dev/test run) — the direct
// regression test for Routing Audit §B.6's finding that today's reranker
// silently no-ops in packaged builds."
//
// INVESTIGATION FINDING (this changes Slice 6's blocked status for the
// rerank half of that slice, independent of the UnifiedRetriever
// sequencing which remains blocked — see 05_MIGRATION_PLAN.md's Slice 6
// STATUS note): the audit's "unbundled in packaged production" finding
// (03_ROUTING_AND_RETRIEVAL_AUDIT.md §B.6, cited by 05_COMPONENT_
// DISPOSITION.md's D16k row) predates this repo's current state. As of
// this pass:
//   - resources/models/Xenova/bge-reranker-base/{tokenizer.json,config.json,
//     tokenizer_config.json,onnx/model_quantized.onnx} exist on disk and are
//     git-tracked (confirmed via `git ls-files`).
//   - scripts/download-models.js's REQUIRED_MODEL_FILES list includes all
//     four bge-reranker-base files and its verifyModels() exits nonzero if
//     any are missing/empty — this is a build-time gate, not optional.
//   - package.json's electron-builder config already copies
//     `resources/models/` to `models/` under extraResources (so
//     process.resourcesPath/models/... is where LocalReranker.resolveModelPath
//     looks when app.isPackaged, matching exactly).
// So option (a) from target arch §5a ("bundle the model into extraResources")
// already shipped as a side effect of other work — this test is the direct
// regression check confirming it actually resolves and is invoked in a
// packaged-build path simulation, closing the gap the audit named, WITHOUT
// requiring the blocked UnifiedRetriever sequencing to land first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

/**
 * A file's CODE, with comments stripped.
 *
 * Every build script here explains at length why bge-reranker-base was removed
 * — and a scan of the raw text then reports the explanation as the bug. Two
 * assertions in this file fell for exactly that before the helper existed, and
 * so did the extension protocol tests. "This string does not appear" only means
 * "this is not required" once the prose is gone.
 */
function codeOf(relPath) {
  return fs.readFileSync(path.resolve(repoRoot, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The model that is actually BUNDLED, read from the source.
 *
 * This suite exists to prove the shipped reranker loads and ranks in a packaged
 * layout. It was pinned to `Xenova/bge-reranker-base`, and when that model was
 * unbundled on 2026-09-04 the assertion did not fail — it SKIPPED, because the
 * weights it looked for were legitimately gone. A suite whose entire purpose is
 * "the bundled model works" silently stopped checking anything.
 *
 * Deriving the id means the next swap re-points it instead of muting it.
 */
const BUNDLED_MODEL = (() => {
  const src = fs.readFileSync(path.resolve(repoRoot, 'electron/rag/LocalReranker.ts'), 'utf8');
  const m = src.match(/const DEFAULT_RERANKER_MODEL = '([^']+)'/);
  assert.ok(m, 'DEFAULT_RERANKER_MODEL is gone from LocalReranker.ts');
  return m[1];
})();

describe('electron-builder config actually bundles the reranker model (source-pinned)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'package.json'), 'utf8'));

  test('extraResources copies resources/models/ to models/ (the exact path LocalReranker.resolveModelPath checks under app.isPackaged)', () => {
    const entry = pkg.build.extraResources.find((r) => r.from === 'resources/models/');
    assert.ok(entry, 'expected an extraResources entry for resources/models/');
    assert.equal(entry.to, 'models/');
  });

  test('the build no longer gates on — or downloads — the reranker WEIGHTS', () => {
    // Reversed on 2026-09-04. This model was bundled so a clean install could
    // rerank offline; then it was benchmarked and turned out to score MRR
    // 0.7558 against a 0.8368 NO-RERANKER baseline, moving 7 of 24 queries
    // down. The installer was 283MB heavier in order to make retrieval worse.
    // docs/reranker-benchmark-2026-09-04.md
    const script = codeOf('scripts/download-models.js');
    assert.doesNotMatch(script, /'Xenova\/bge-reranker-base\/onnx\/model_quantized\.onnx'/,
      'requiring the weights would fail every build that no longer downloads them');
    assert.doesNotMatch(script, /pipeline\('text-classification', 'Xenova\/bge-reranker-base'/,
      'the weights must not be fetched at build time any more');

    // The two models that ARE still bundled must keep their gate, or this
    // change quietly removes the protection for all three.
    assert.match(script, /Xenova\/all-MiniLM-L6-v2\/onnx\/model_quantized\.onnx/);
    // MobileBERT removed 2026-09-05 with the intent classifier; the build must not download it.
    assert.doesNotMatch(script, /mobilebert-uncased-mnli/);
    assert.match(script, /process\.exit\(1\)/, 'verifyModels must still fail the build on a missing required file');
  });

  test('the release asset gate requires the BUNDLED model, and nothing else', () => {
    // Written when bge's JSONs were still shipped; they are not any more. A
    // gate naming a model nothing fetches fails every build — which is exactly
    // how this assertion earned its keep, by going red the moment the JSONs
    // were removed and the gate was not updated with them.
    const gate = codeOf('scripts/verify-packaged-local-assets.mjs');
    for (const rel of ['config.json', 'tokenizer.json', 'onnx/model_quantized.onnx']) {
      assert.ok(gate.includes(`${BUNDLED_MODEL}/${rel}`),
        `the gate must require ${BUNDLED_MODEL}/${rel} — it is what the installer ships`);
    }
    assert.doesNotMatch(gate, /bge-reranker-base/,
      'nothing fetches bge any more, so requiring it would fail every build');
  });
});

describe('bge-reranker-base is gone from the bundle entirely', () => {
  // It was the bundled default until 2026-09-04, when it measured WORSE than
  // no reranker at all (MRR 0.7558 against a 0.8368 baseline). First its
  // weights stopped being fetched, then its tracked JSONs, its lazy download
  // provider and worker, and its entries in both build gates were removed —
  // it was never a catalogue entry, so there was nothing left worth keeping a
  // download path for. docs/reranker-benchmark-2026-09-04.md
  test('nothing of it remains in resources/models', () => {
    assert.equal(
      fs.existsSync(path.resolve(repoRoot, 'resources/models/Xenova/bge-reranker-base')), false,
      'the directory should be gone, not merely emptied');
  });

  test('neither build gate asks for it any more', () => {
    // A gate still naming it would fail every build, since nothing fetches it.
    //
    // CODE only. Both files explain at length why bge was removed, and a scan
    // of the raw text reports the explanation as the bug — the same trap that
    // made the extension protocol tests fail on their own comments.
    for (const rel of ['scripts/download-models.js', 'scripts/verify-packaged-local-assets.mjs']) {
      const required = codeOf(rel).slice(0, codeOf(rel).indexOf('];'));
      assert.doesNotMatch(required, /bge-reranker-base/,
        `${rel} still requires a model that is no longer shipped`);
    }
  });
});

describe('LocalReranker.isCached() resolves true against a SIMULATED packaged-build resourcesPath layout', () => {
  test('with app.isPackaged=true and resourcesPath pointing at a copy mirroring extraResources\' output layout, isCached() is true and rerank() actually runs (not a silent no-op)', async (t) => {
    // The BUNDLED model, not a hardcoded one. Its weights must be present —
    // they are what `npm run build` fetches — so this must RUN, never skip. A
    // skip here means the thing this file exists to prove is unproven.
    const srcDir = path.resolve(repoRoot, 'resources/models', ...BUNDLED_MODEL.split('/'));
    const weightsPath = path.join(srcDir, 'onnx/model_quantized.onnx');
    assert.ok(fs.existsSync(weightsPath),
      `${BUNDLED_MODEL} weights are missing from resources/models — run `
      + '`node scripts/download-models.js`. They are what the installer ships, so '
      + 'their absence is a build problem rather than a reason to skip this test.');

    // Simulate electron-builder's packaged layout: a resourcesPath directory
    // containing models/<modelId>/... — exactly what
    // extraResources: [{from: 'resources/models/', to: 'models/'}] produces,
    // and exactly what LocalReranker.resolveModelPath's
    // `path.join(process.resourcesPath, 'models')` candidate checks first
    // when app.isPackaged is true.
    //
    // path.join over the SPLIT id, never the raw string: the id carries a
    // forward slash and Windows needs a backslash on disk.
    const simulatedResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-packaged-sim-'));
    const modelsDestDir = path.join(simulatedResourcesPath, 'models', ...BUNDLED_MODEL.split('/'));
    fs.mkdirSync(path.join(modelsDestDir, 'onnx'), { recursive: true });
    for (const rel of ['tokenizer.json', 'config.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
      fs.copyFileSync(path.join(srcDir, ...rel.split('/')), path.join(modelsDestDir, ...rel.split('/')));
    }

    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-packaged-userdata-'));
    const origLoad = Module._load;
    Module._load = function patched(request, _p, _m) {
      if (request === 'electron') {
        return {
          app: {
            getPath: () => userData,
            isReady: () => true,
            isPackaged: true,
            getAppPath: () => path.join(simulatedResourcesPath, 'app'),
          },
        };
      }
      return origLoad.apply(this, arguments);
    };
    const origResourcesPath = process.resourcesPath;
    Object.defineProperty(process, 'resourcesPath', { value: simulatedResourcesPath, configurable: true });

    try {
      const rerankerPath = path.resolve(repoRoot, 'dist-electron/electron/rag/LocalReranker.js');
      const { getLocalReranker } = await import(`${pathToFileURL(rerankerPath).href}?t=${Date.now()}`);
      const reranker = getLocalReranker();

      const cached = await reranker.isCached();
      assert.equal(cached, true, 'isCached() must resolve true against the simulated packaged resourcesPath layout — this is the direct regression check for the audit\'s "unbundled in packaged production" finding');

      const available = await reranker.isAvailable();
      assert.equal(available, true, 'the packaged-layout model must actually load and be usable, not silently degrade to top-K');

      const results = await reranker.rerank('What is the capital of France?', [
        'Bananas are a good source of potassium.',
        'Paris is the capital and most populous city of France.',
      ]);
      assert.ok(Array.isArray(results) && results.length === 2, 'rerank() must actually run end-to-end against the packaged-layout model, not no-op');
      assert.equal(results[0].index, 1, 'the relevant passage must rank first — proves real inference, not a stub');
    } finally {
      Module._load = origLoad;
      Object.defineProperty(process, 'resourcesPath', { value: origResourcesPath, configurable: true });
      fs.rmSync(simulatedResourcesPath, { recursive: true, force: true });
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});
