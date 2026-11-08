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
import { createRequire } from 'node:module';

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

test('source maps are excluded from the shipped app', () => {
  // scripts/build-electron.js bundles every electron/**/*.ts as its own entry with
  // sourcemap: true, so each map repeats the shared graph: 2.9.2 shipped 1257 MB of
  // .map files inside app.asar (#660). Nothing at runtime reads them: no
  // setSourceMapsEnabled, --enable-source-maps or source-map-support in the app.
  // The same pattern also drops dependencies' maps from node_modules.
  const files = pkg.build?.files ?? [];
  assert.ok(
    files.includes('!**/*.map'),
    'build.files must exclude **/*.map (over 1 GB of source maps otherwise ships)'
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

test('every build path that packs a mac app also ensures BOTH llama.cpp runtimes', () => {
  // Same shape as the canvas guard above, for @node-llama-cpp/mac-x64: an
  // Apple-Silicon host never installs it, so a build path that skips this step
  // ships an Intel app in which no GGUF model can load.
  const STEP = 'ensure-node-llama-cpp-mac-deps';

  for (const script of ['app:build', 'app:build:signed']) {
    assert.ok(
      pkg.scripts[script]?.includes(STEP),
      `package.json script "${script}" must run ${STEP}`
    );
    // The gate that checks for the runtimes must come after the step that fetches them.
    assert.ok(
      pkg.scripts[script].indexOf(STEP) < pkg.scripts[script].indexOf('package-app.js'),
      `"${script}" must run ${STEP} before packaging`
    );
  }
  // Not postinstall: about 29 MB that only a packaged build needs.
  assert.ok(!pkg.scripts.postinstall.includes(STEP), 'postinstall should not fetch the Intel llama.cpp runtime');

  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'),
    'utf8'
  );
  assert.ok(
    workflow.indexOf(STEP) !== -1 && workflow.indexOf(STEP) < workflow.indexOf('electron-builder --mac'),
    `release-macos.yml hand-rolls its build stages, so it must call ${STEP} before electron-builder`
  );

  // The step asks for the two packages node-llama-cpp actually imports on a Mac,
  // at the versions the lockfile pins.
  const step = fs.readFileSync(path.join(repoRoot, 'scripts', `${STEP}.js`), 'utf8');
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const pinned = lock.packages['node_modules/node-llama-cpp'].optionalDependencies;
  for (const name of ['@node-llama-cpp/mac-arm64-metal', '@node-llama-cpp/mac-x64']) {
    assert.ok(step.includes(`'${name}'`), `${STEP}.js must require ${name}`);
    assert.match(pinned[name] ?? '', /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version in package-lock.json`);
  }
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

test('the release workflow checks out only the required premium submodule', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'),
    'utf8'
  );
  assert.doesNotMatch(
    workflow,
    /submodules:\s*(?:recursive|true)/,
    'release should explicitly authenticate and fetch only its required private submodule'
  );
  assert.match(workflow, /submodule update --init --force -- premium/);
  assert.match(workflow, /SUBMODULE_TOKEN\s*\|\|\s*secrets\.GH_APP_TOKEN/);
  assert.match(workflow, /test -f premium\/electron\/knowledge\/CompanyResearchEngine\.ts/);
});

test('renderer builds carry version and commit provenance', () => {
  const viteConfig = fs.readFileSync(path.join(repoRoot, 'vite.config.mts'), 'utf8');
  const about = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'AboutSection.tsx'), 'utf8');
  assert.match(viteConfig, /process\.env\.VITE_APP_VERSION\s*=\s*version/);
  assert.match(viteConfig, /process\.env\.VITE_BUILD_COMMIT\s*=/);
  assert.match(viteConfig, /git['"], \['rev-parse', '--verify', 'HEAD'\]/);
  assert.match(about, /VITE_APP_VERSION/);
  assert.match(about, /VITE_BUILD_COMMIT/);
});

test('macOS Dock/Finder show the brand, and CFBundleName is left to the builder default', () => {
  // Stealth reverted: productName IS the brand ("Natively"), so executable,
  // CFBundleName (builder default) and helpers all read the brand too.
  // CFBundleDisplayName still carries the brand explicitly (Dock, Finder,
  // Spotlight, permission-prompt titles, notifications). CFBundleName must stay
  // the builder default (= productName) so Electron's helper-app lookup, which
  // derives from CFBundleName, keeps matching the helper bundles — pinning it to
  // a different literal here is what caused the v2.9.1 launch crash.
  const extendInfo = pkg.build?.mac?.extendInfo ?? {};
  assert.equal(
    extendInfo.CFBundleDisplayName,
    'Natively',
    'build.mac.extendInfo.CFBundleDisplayName must be "Natively" (Dock/Finder brand)'
  );
  assert.ok(
    !('CFBundleName' in extendInfo),
    'build.mac.extendInfo must NOT set CFBundleName — it has to stay the builder ' +
      'default (= productName) so the helper-app lookup matches the helper bundles'
  );
  for (const key of Object.keys(extendInfo).filter((k) => k.endsWith('UsageDescription'))) {
    assert.match(
      extendInfo[key],
      /^Natively needs |^Natively uses /,
      `${key} renders next to the displayed app name, so it must address the ` +
        `user as Natively, not as the disguise alias`
    );
  }
});

test('ad-hoc-sign.js does NOT hand-set the MAIN app CFBundleName (Electron finds its helper by it)', () => {
  // THE v2.9.1 LAUNCH CRASH THIS GUARDS: enforceMainAppDisplayName in ad-hoc-sign.js
  // hand-set the main app's CFBundleName to a literal that differed from the helper
  // bundle names. Electron/Chromium derives its helper app name from the main bundle's
  // CFBundleName, so it looked for a helper app that did not exist and the main process
  // aborted at launch with electron_main_delegate_mac.mm "Unable to find helper app"
  // (SIGTRAP at ElectronMain). CFBundleName must stay the builder default (= productName)
  // so it always matches the helper bundles; only CFBundleDisplayName is set explicitly.
  const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'ad-hoc-sign.js'), 'utf8');
  assert.ok(
    !/Set :CFBundleName ['"]Natively/.test(src),
    'scripts/ad-hoc-sign.js must NOT hand-set the MAIN app CFBundleName to a literal: ' +
      'Electron locates its helper app by CFBundleName, so it must stay the builder ' +
      'default (= productName). Brand the main app only via CFBundleDisplayName.'
  );
});

test('committed productName matches the single source of truth (release builds use it verbatim)', () => {
  // release-macos.yml invokes electron-builder DIRECTLY (it hand-rolls stages to
  // dodge a rimraf race, so package-app.js's per-platform productName swap never
  // runs). The committed productName IS the release on-disk identity, so it must
  // equal scripts/disguise-name.cjs (now "Natively" — stealth reverted). If a
  // per-platform name is ever reintroduced there, this keeps the committed
  // default in lockstep with it.
  const disguise = createRequire(import.meta.url)('../disguise-name.cjs');
  assert.equal(
    pkg.build?.productName,
    disguise.darwin,
    `committed build.productName must equal disguise-name.cjs darwin ("${disguise.darwin}"); ` +
      `release-macos.yml uses the committed value verbatim`
  );
});

test('the default mac build makes a DMG, and only on an electron-builder whose DMG step is fixed', () => {
  // THE REGRESSION THIS GUARDS (v2.9.1): electron-builder 26.8.1's DMG step dropped
  // the Electron Framework binary from large apps and reported success
  // (electron-userland/electron-builder#9706). The fix is in the dmg-builder 1.2.3
  // toolset, first shipped by electron-builder 26.14.0. While that step was broken
  // the DMG was built by a plain `hdiutil create`, which has no install window
  // (no background, no icon positions) — so both halves are pinned here: the dmg
  // target stays on, and the builder stays at or above the fixed version.
  const targets = pkg.build?.mac?.target ?? [];
  for (const kind of ['zip', 'dmg']) {
    const t = targets.find((x) => x.target === kind);
    assert.ok(t, `build.mac.target must include "${kind}"`);
    assert.deepEqual([...t.arch].sort(), ['arm64', 'x64'], `mac ${kind} target must build both arches`);
  }

  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const locked = lock.packages?.['node_modules/dmg-builder']?.version;
  assert.ok(locked, 'package-lock.json must pin dmg-builder');
  const [major, minor] = locked.split('.').map(Number);
  assert.ok(
    major > 26 || (major === 26 && minor >= 14),
    `dmg-builder is locked at ${locked}; the DMG step silently drops files before 26.14.0`
  );
});

test('the mac DMG names its file and volume from productName', () => {
  // The DMG file and the mounted volume both resolve from productName (now the
  // brand, "Natively"): its own artifactName template keeps the file name from
  // inheriting the updater zip's, and the title names the mounted volume.
  assert.equal(pkg.build?.dmg?.artifactName, '${productName}-${version}-${arch}.${ext}');
  assert.equal(pkg.build?.dmg?.title, '${productName}');
});

test('sqlite-vec and its platform packages resolve to one version, and the fetch script follows the lockfile', () => {
  // THE REGRESSION THIS GUARDS (found 2026-10-04): scripts/ensure-sqlite-vec.js
  // hardcoded '0.1.7-alpha.2' and skipped any package that already existed, so
  // after the lockfile moved to 0.1.9 an Intel build made on Apple Silicon shipped
  // the 0.1.9 wrapper with a 0.1.7-alpha.2 extension. sqlite-vec pins its platform
  // packages to its own exact version, so all of them must agree.
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const wanted = lock.packages?.['node_modules/sqlite-vec']?.version;
  assert.ok(wanted, 'package-lock.json must pin sqlite-vec');
  for (const name of ['sqlite-vec-darwin-arm64', 'sqlite-vec-darwin-x64', 'sqlite-vec-windows-x64']) {
    assert.equal(
      lock.packages?.[`node_modules/${name}`]?.version,
      wanted,
      `${name} must be locked at the sqlite-vec version (${wanted})`
    );
  }

  const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'ensure-sqlite-vec.js'), 'utf8');
  assert.ok(
    !/SQLITE_VEC_VERSION\s*=\s*['"`]/.test(src),
    'scripts/ensure-sqlite-vec.js must not hardcode a version; it reads package-lock.json'
  );
  assert.match(src, /package-lock\.json/, 'scripts/ensure-sqlite-vec.js must read the version from package-lock.json');
});

test('the macOS native build pins its deployment target instead of taking Rust\'s default', () => {
  // THE REGRESSION THIS GUARDS (found 2026-10-04): Rust links x86_64-apple-darwin
  // for macOS 10.12 by default. At that target the linker records the Swift
  // overlay libraries as `@rpath/libswiftCoreMedia.dylib`, the app provides no
  // such rpath, and the Intel slice of the audio module fails at dlopen — while
  // the arm64 slice (default 11.0) works, so nothing fails on the build machine.
  const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-native.js'), 'utf8');
  assert.match(
    src,
    /MACOSX_DEPLOYMENT_TARGET:\s*process\.env\.MACOSX_DEPLOYMENT_TARGET\s*\|\|\s*MACOS_DEPLOYMENT_TARGET/,
    'scripts/build-native.js must pass MACOSX_DEPLOYMENT_TARGET to the napi build on macOS'
  );
  const pinned = /const MACOS_DEPLOYMENT_TARGET = '(\d+)\.(\d+)'/.exec(src);
  assert.ok(pinned, 'scripts/build-native.js must define MACOS_DEPLOYMENT_TARGET');
  assert.ok(
    Number(pinned[1]) >= 11,
    `MACOS_DEPLOYMENT_TARGET is ${pinned[1]}.${pinned[2]}; below 10.15 the Swift overlay libraries are linked by @rpath`
  );
});
