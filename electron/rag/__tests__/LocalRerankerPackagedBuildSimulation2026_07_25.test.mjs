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
    const script = fs.readFileSync(path.resolve(repoRoot, 'scripts/download-models.js'), 'utf8');
    assert.doesNotMatch(script, /'Xenova\/bge-reranker-base\/onnx\/model_quantized\.onnx'/,
      'requiring the weights would fail every build that no longer downloads them');
    assert.doesNotMatch(script, /pipeline\('text-classification', 'Xenova\/bge-reranker-base'/,
      'the weights must not be fetched at build time any more');

    // The two models that ARE still bundled must keep their gate, or this
    // change quietly removes the protection for all three.
    assert.match(script, /Xenova\/all-MiniLM-L6-v2\/onnx\/model_quantized\.onnx/);
    assert.match(script, /Xenova\/mobilebert-uncased-mnli\/onnx\/model_quantized\.onnx/);
    assert.match(script, /process\.exit\(1\)/, 'verifyModels must still fail the build on a missing required file');
  });

  test('the release asset gate matches — JSONs required, weights not', () => {
    // A gate that still demanded the .onnx would fail every signed build.
    const gate = fs.readFileSync(path.resolve(repoRoot, 'scripts/verify-packaged-local-assets.mjs'), 'utf8');
    assert.match(gate, /'Xenova\/bge-reranker-base\/config\.json'/,
      'the tracked JSONs still ship, so the lazy downloader has a directory');
    assert.doesNotMatch(gate, /'Xenova\/bge-reranker-base\/onnx\/model_quantized\.onnx'/);
  });
});

describe('resources/models/Xenova/bge-reranker-base — JSONs tracked, weights not', () => {
  const dir = path.resolve(repoRoot, 'resources/models/Xenova/bge-reranker-base');

  test('the three tracked JSON files exist with non-zero size', () => {
    // These are in git and still ship: they cost nothing and give
    // rerankerDownloadProvider a directory to fill for anyone who explicitly
    // selects the model.
    for (const rel of ['tokenizer.json', 'config.json', 'tokenizer_config.json']) {
      const full = path.join(dir, rel);
      assert.ok(fs.existsSync(full), `expected ${rel} to exist`);
      assert.ok(fs.statSync(full).size > 0, `expected ${rel} to be non-empty`);
    }
  });

  test('the WEIGHTS are not required to be present', () => {
    // This used to assert onnx/model_quantized.onnx exists. It passed on a
    // developer machine that had run download-models before the model was
    // unbundled, and would have failed on a clean checkout — a test whose
    // result depends on local history rather than on the repository.
    //
    // The weights are no longer downloaded at build time (see step 3 of
    // download-models.js): the model measured WORSE than no reranker at all.
    // Present or absent, this must pass.
    const weights = path.join(dir, 'onnx/model_quantized.onnx');
    assert.equal(typeof fs.existsSync(weights), 'boolean');
  });
});

describe('LocalReranker.isCached() resolves true against a SIMULATED packaged-build resourcesPath layout', () => {
  test('with app.isPackaged=true and resourcesPath pointing at a copy mirroring extraResources\' output layout, isCached() is true and rerank() actually runs (not a silent no-op)', async (t) => {
    // Needs the real weights, which are no longer bundled — the model measured
    // worse than no reranker (docs/reranker-benchmark-2026-09-04.md). Absent is
    // the normal state on a clean checkout, so skip rather than fail; run
    // `node scripts/download-models.js` or select the model in Settings to
    // exercise this path.
    const weightsPath = path.resolve(repoRoot, 'resources/models/Xenova/bge-reranker-base/onnx/model_quantized.onnx');
    if (!fs.existsSync(weightsPath)) {
      t.skip('bge-reranker-base weights are not present (no longer bundled)');
      return;
    }

    // Simulate electron-builder's packaged layout: a resourcesPath directory
    // containing models/Xenova/bge-reranker-base/... — exactly what
    // extraResources: [{from: 'resources/models/', to: 'models/'}] produces,
    // and exactly what LocalReranker.resolveModelPath's
    // `path.join(process.resourcesPath, 'models')` candidate checks first
    // when app.isPackaged is true.
    const simulatedResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'reranker-packaged-sim-'));
    const modelsDestDir = path.join(simulatedResourcesPath, 'models', 'Xenova', 'bge-reranker-base');
    fs.mkdirSync(path.join(modelsDestDir, 'onnx'), { recursive: true });
    const srcDir = path.resolve(repoRoot, 'resources/models/Xenova/bge-reranker-base');
    fs.copyFileSync(path.join(srcDir, 'tokenizer.json'), path.join(modelsDestDir, 'tokenizer.json'));
    fs.copyFileSync(path.join(srcDir, 'config.json'), path.join(modelsDestDir, 'config.json'));
    fs.copyFileSync(path.join(srcDir, 'tokenizer_config.json'), path.join(modelsDestDir, 'tokenizer_config.json'));
    fs.copyFileSync(
      path.join(srcDir, 'onnx/model_quantized.onnx'),
      path.join(modelsDestDir, 'onnx/model_quantized.onnx'),
    );

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
