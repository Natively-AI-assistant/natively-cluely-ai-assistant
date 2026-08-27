// Packaging-configuration invariants.
//
// These assert facts about package.json and the release workflow that are easy to
// regress silently and expensive to discover — each one below was an actual defect
// found on 2026-08-26 while shipping v2.8.7.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('no Windows target builds 32-bit (ia32)', () => {
  // onnxruntime-node (local models, Whisper, embeddings, rerankers), sqlite-vec
  // (vector search / RAG) and @napi-rs/canvas (PDF text extraction) publish NO
  // 32-bit Windows build. An ia32 installer therefore ships three dead subsystems,
  // so the target must stay off unless every one of those gains ia32 support.
  const targets = pkg.build?.win?.target ?? [];
  for (const t of targets) {
    const arches = typeof t === 'string' ? [] : (t.arch ?? []);
    assert.ok(
      !arches.includes('ia32'),
      `win target "${t.target}" includes ia32, but onnxruntime-node / sqlite-vec / @napi-rs/canvas have no 32-bit build`
    );
  }
});

test('the TypeScript native compiler is excluded from the shipped app', () => {
  // `typescript7` is an npm ALIAS (npm:typescript@^7.0.2), so npm never marks the
  // transitive @typescript/native-preview* packages as dev — electron-builder then
  // packs them as production deps. That put 24 MB of compiler in every install.
  const files = pkg.build?.files ?? [];
  assert.ok(
    files.includes('!**/node_modules/@typescript/**'),
    'build.files must exclude **/node_modules/@typescript/** (24 MB of TS compiler otherwise ships)'
  );
});

test('every build path that packs a mac app also ensures BOTH canvas arches', () => {
  // THE REGRESSION THIS GUARDS: the release workflow deliberately does NOT use
  // `npm run app:build:signed` (its stage list avoids a rimraf/native-rebuild race),
  // so adding the ensure step to the npm scripts alone left tagged releases still
  // shipping an Intel DMG with no @napi-rs/canvas-darwin-x64 — and, once the packed
  // arch-family guard landed, failing the release job outright at afterPack.
  const STEP = 'ensure-napi-canvas-mac-deps';

  for (const script of ['app:build', 'app:build:signed', 'postinstall']) {
    assert.ok(
      pkg.scripts[script]?.includes(STEP),
      `package.json script "${script}" must run ${STEP}`
    );
  }

  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'),
    'utf8'
  );
  assert.ok(
    workflow.includes(STEP),
    'release-macos.yml hand-rolls its build stages, so it must call ' +
      `${STEP} explicitly — it never runs app:build:signed`
  );
});

test('the release workflow allows enough time for the notary retry budget', () => {
  // A DMG submit retries up to 3x (~25 min each) and stapleWithRetry adds ~8 min of
  // backoff per DMG, on top of a ~55 min signed build with two app notarizations.
  // Too small a timeout kills the job mid-retry and the retry buys nothing.
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'),
    'utf8'
  );
  const m = workflow.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(m, 'release-macos.yml should declare timeout-minutes');
  assert.ok(
    Number(m[1]) >= 150,
    `timeout-minutes is ${m[1]}; the retry budget needs materially more than the original 90`
  );
});
