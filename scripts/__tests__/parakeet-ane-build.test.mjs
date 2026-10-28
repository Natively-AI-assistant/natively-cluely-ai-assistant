// Build contract for the Parakeet Neural Engine helper (scripts/build-parakeet-ane.js).
//
// Fixture based with a fake toolchain and a fake git: runs on macOS and
// Windows alike, never invokes Swift and never touches the network. The real
// build (and the real FluidAudio fetch) is exercised by release-macos.yml's
// packaging, and the packaged result by verify-packaged-local-assets.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildScript = require('../build-parakeet-ane.js');

const { FLUIDAUDIO } = buildScript;

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-ane-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'native', 'parakeet-ane'), { recursive: true });
  fs.writeFileSync(path.join(root, 'native', 'parakeet-ane', 'Package.swift'), '// swift-tools-version:6.2\n');
  return root;
}

const sourceDir = (root) => path.join(root, 'native', 'parakeet-ane', 'FluidAudio');

/**
 * Records every command. `git checkout` "checks out" FluidAudio (its licence
 * files) at `checkoutCommit`; `fetch` fails `fetchFailures` times first; and
 * `swift build` "produces" a binary of the given arch.
 */
function fakeToolchain(root, { builtArch = 'arm64', checkoutCommit = FLUIDAUDIO.commit, fetchFailures = 0, license = true } = {}) {
  const calls = [];
  const binDir = path.join(root, 'native', 'parakeet-ane', '.build', 'release');
  let head = null;
  let failuresLeft = fetchFailures;
  const run = (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === 'git') {
      const [, dir, sub] = args;
      if (sub === 'init') { fs.mkdirSync(path.join(dir, '.git'), { recursive: true }); return ''; }
      if (sub === 'sparse-checkout') return '';
      if (sub === 'fetch') {
        if (failuresLeft > 0) { failuresLeft -= 1; throw new Error('Could not resolve host: github.com'); }
        return '';
      }
      if (args.includes('checkout')) {
        fs.mkdirSync(path.join(dir, 'ThirdPartyLicenses'), { recursive: true });
        if (license) fs.writeFileSync(path.join(dir, 'LICENSE'), 'Apache License 2.0');
        fs.writeFileSync(path.join(dir, 'ThirdPartyLicenses', 'fastcluster-LICENSE.md'), 'BSD');
        head = checkoutCommit;
        return '';
      }
      if (sub === 'rev-parse') {
        if (!head) throw new Error('fatal: not a git repository');
        return `${head}\n`;
      }
      if (sub === 'status') return '';
    }
    if (command === 'xcrun' && args.includes('--show-bin-path')) return `${binDir}\n`;
    if (command === 'xcrun' && args.includes('build')) {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, buildScript.PRODUCT_NAME), builtArch);
      return '';
    }
    if (command === 'lipo' && args[0] === '-archs') return fs.readFileSync(args[1], 'utf8');
    if (command === 'codesign') return '';
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { calls, run };
}

const gitCalls = (calls, sub) => calls.filter((c) => c.command === 'git' && c.args[2] === sub);
const noWait = () => {};

test('helper name is in sync across build, runtime and packaged-asset gate', async () => {
  const disguise = require('../disguise-name.cjs');
  assert.equal(buildScript.HELPER_NAME, `${disguise.darwin}-parakeet`);
  const runtime = fs.readFileSync(path.join(repoRoot, 'electron/audio/whisper/parakeet/aneBackend.ts'), 'utf8');
  assert.match(runtime, new RegExp(`PARAKEET_ANE_HELPER = '${buildScript.HELPER_NAME}'`));
  const gate = await import('../verify-packaged-local-assets.mjs');
  assert.equal(gate.PARAKEET_ANE_HELPER, buildScript.HELPER_NAME);
});

test('ordinary Electron builds never invoke Swift', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-electron.js'), 'utf8');
  assert.doesNotMatch(source, /build-parakeet-ane|swift build/);
});

test('Windows and Linux skip the build without touching a toolchain', () => {
  for (const platform of ['win32', 'linux']) {
    const calls = [];
    const result = buildScript.buildParakeetAne({ platform, run: (...a) => { calls.push(a); return ''; } });
    assert.deepEqual(result, { skipped: true, platform });
    assert.equal(calls.length, 0);
  }
});

test('the Intel Mac package skips the build: it keeps the ONNX engine', () => {
  const calls = [];
  const result = buildScript.buildParakeetAne({ platform: 'darwin', arch: 'x64', run: (...a) => { calls.push(a); return ''; } });
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

test('arm64: release swift build, arch check, copy, ad-hoc sign and verify', (t) => {
  const root = fixtureRoot(t);
  const { calls, run } = fakeToolchain(root);
  const output = path.join(root, 'out', buildScript.HELPER_NAME);
  const result = buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output, run, wait: noWait });
  assert.deepEqual(result, { skipped: false, arch: 'arm64', output });

  // FluidAudio's source: one shallow fetch of the pinned commit, sparse, before Swift runs.
  const [fetch] = gitCalls(calls, 'fetch');
  assert.deepEqual(fetch.args.slice(3), ['--quiet', '--depth', '1', FLUIDAUDIO.url, FLUIDAUDIO.commit]);
  assert.deepEqual(gitCalls(calls, 'sparse-checkout')[0].args.slice(5), buildScript.FLUIDAUDIO_PATHS);
  const firstSwift = calls.findIndex((c) => c.command === 'xcrun');
  assert.ok(calls.indexOf(fetch) < firstSwift, 'the source is in place before swift build');
  assert.equal(fs.readFileSync(output, 'utf8'), 'arm64');
  assert.equal(fs.statSync(output).mode & 0o111, 0o111);

  const build = calls.find((c) => c.command === 'xcrun' && c.args.includes('build') && !c.args.includes('--show-bin-path'));
  assert.ok(build, 'swift build must run');
  for (const flag of ['-c', 'release', '--arch', 'arm64', '--package-path']) assert.ok(build.args.includes(flag), flag);
  assert.deepEqual(
    calls.filter((c) => c.command === 'codesign').map((c) => c.args),
    [['--force', '--sign', '-', output], ['--verify', '--strict', output]],
  );
  // Apache-2.0 notices ship beside the statically linked helper.
  const licenses = path.join(path.dirname(output), 'licenses', 'FluidAudio');
  assert.equal(fs.readFileSync(path.join(licenses, 'LICENSE'), 'utf8'), 'Apache License 2.0');
  assert.equal(fs.readFileSync(path.join(licenses, 'ThirdPartyLicenses', 'fastcluster-LICENSE.md'), 'utf8'), 'BSD');
});

test('a build without FluidAudio\'s LICENSE fails instead of shipping without it', (t) => {
  const root = fixtureRoot(t);
  const { run } = fakeToolchain(root, { license: false });
  assert.throws(
    () => buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output: path.join(root, 'out', 'h'), run, wait: noWait }),
    /LICENSE is missing/,
  );
});

test('a clean checkout of the pinned commit is reused: no network on a rebuild', (t) => {
  const root = fixtureRoot(t);
  const { calls, run } = fakeToolchain(root);
  const output = path.join(root, 'out', buildScript.HELPER_NAME);
  buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output, run, wait: noWait });
  calls.length = 0;
  buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output, run, wait: noWait });
  assert.equal(gitCalls(calls, 'fetch').length, 0);
});

test('a failed fetch is retried with a growing pause', (t) => {
  const root = fixtureRoot(t);
  const { calls, run } = fakeToolchain(root, { fetchFailures: 2 });
  const waits = [];
  buildScript.ensureFluidAudioSource(path.join(root, 'native', 'parakeet-ane'), { run, wait: (ms) => waits.push(ms) });
  assert.equal(gitCalls(calls, 'fetch').length, 3);
  assert.deepEqual(waits, [5_000, 10_000]);
});

test('a fetch that keeps failing stops with a clear error and leaves no partial source', (t) => {
  const root = fixtureRoot(t);
  const { calls, run } = fakeToolchain(root, { fetchFailures: 99 });
  assert.throws(
    () => buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output: path.join(root, 'out', 'h'), run, wait: noWait }),
    /Could not fetch FluidAudio .* after 3 attempts/,
  );
  assert.equal(fs.existsSync(sourceDir(root)), false);
  assert.equal(calls.some((c) => c.command === 'xcrun'), false, 'Swift never ran');
});

test('source at any other commit is refused and removed', (t) => {
  const root = fixtureRoot(t);
  const { calls, run } = fakeToolchain(root, { checkoutCommit: 'f'.repeat(40) });
  assert.throws(
    () => buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output: path.join(root, 'out', 'h'), run, wait: noWait }),
    new RegExp(`expected ${FLUIDAUDIO.commit}`),
  );
  assert.equal(fs.existsSync(sourceDir(root)), false);
  assert.equal(calls.some((c) => c.command === 'xcrun'), false, 'Swift never ran');
});

test('--fetch-source fetches on macOS only', (t) => {
  for (const platform of ['win32', 'linux']) {
    const calls = [];
    assert.deepEqual(buildScript.fetchSource({ platform, run: (...a) => { calls.push(a); return ''; } }), { skipped: true, platform });
    assert.equal(calls.length, 0);
  }
  const root = fixtureRoot(t);
  const { calls, run } = fakeToolchain(root);
  assert.deepEqual(buildScript.fetchSource({ root, platform: 'darwin', run, wait: noWait }), { skipped: false, dir: sourceDir(root) });
  assert.equal(gitCalls(calls, 'fetch').length, 1);
  assert.equal(calls.some((c) => c.command === 'xcrun'), false, 'fetching never builds');
});

test('release CI fetches the source in its own step before packaging', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'), 'utf8');
  const fetchStep = workflow.indexOf('node scripts/build-parakeet-ane.js --fetch-source');
  assert.ok(fetchStep > 0, 'release-macos.yml must fetch the FluidAudio source');
  assert.ok(fetchStep < workflow.indexOf('electron-builder --mac'), 'before electron-builder runs afterPack');
});

test('universal requests build the arm64 helper only', (t) => {
  const root = fixtureRoot(t);
  const { run } = fakeToolchain(root);
  const output = path.join(root, 'out', buildScript.HELPER_NAME);
  const result = buildScript.buildParakeetAne({ platform: 'darwin', arch: 'universal', root, output, run, wait: noWait });
  assert.equal(result.arch, 'arm64');
});

test('a wrong-arch product is refused and nothing is installed', (t) => {
  const root = fixtureRoot(t);
  const { run } = fakeToolchain(root, { builtArch: 'x86_64' });
  const output = path.join(root, 'out', buildScript.HELPER_NAME);
  assert.throws(
    () => buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output, run, wait: noWait }),
    /expected arm64/,
  );
  assert.equal(fs.existsSync(output), false);
});

test('a missing Swift package fails clearly', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-ane-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, run: () => '' }),
    /Swift package is missing/,
  );
});

test('afterPack: arm64 builds into the app bundle; x64 and Windows build nothing', (t) => {
  const root = fixtureRoot(t);
  const appOutDir = path.join(root, 'release', 'mac-arm64');
  const context = (arch, electronPlatformName = 'darwin') => ({
    arch,
    electronPlatformName,
    appOutDir,
    packager: { info: { projectDir: root }, appInfo: { productFilename: 'Natively' } },
  });
  assert.deepEqual(buildScript.afterPackOutput(context(3)), {
    root,
    output: path.join(appOutDir, 'Natively.app', 'Contents', 'Resources', 'parakeet-ane', buildScript.HELPER_NAME),
  });
  assert.equal(buildScript.buildForAfterPack(context(1)).skipped, true, 'x64');
  assert.equal(buildScript.buildForAfterPack(context(1, 'win32')).skipped, true, 'win32');
  assert.throws(() => buildScript.buildForAfterPack(context(4)), /unsupported macOS arch/);
});

test('Package.swift has no package dependencies, so SwiftPM downloads nothing', () => {
  const dir = path.join(repoRoot, 'native', 'parakeet-ane');
  const manifest = fs.readFileSync(path.join(dir, 'Package.swift'), 'utf8');
  assert.match(manifest, /^\/\/ swift-tools-version:6\.2/);
  // SwiftPM downloads every binary target of a dependency, traits or not: FluidAudio
  // is compiled from its fetched source instead, with no binary target at all.
  assert.doesNotMatch(manifest, /\.package\(/);
  assert.doesNotMatch(manifest, /binaryTarget/);
  assert.equal(fs.existsSync(path.join(dir, 'Package.resolved')), false);
  for (const target of ['FluidAudio', 'FastClusterWrapper', 'MachTaskSelfWrapper']) {
    assert.ok(buildScript.FLUIDAUDIO_PATHS.includes(`/Sources/${target}/`), `${target} is checked out`);
  }
  assert.ok(!buildScript.FLUIDAUDIO_PATHS.some((p) => /Package/.test(p)), 'FluidAudio\'s own manifest is never checked out');
  assert.match(FLUIDAUDIO.commit, /^[0-9a-f]{40}$/, 'pinned to a full commit, not a tag');
});

test('CLI parser rejects missing values and unknown flags', () => {
  assert.equal(buildScript.parseCliArgs(['--arch=arm64']).arch, 'arm64');
  assert.equal(buildScript.parseCliArgs(['--fetch-source']).fetchSourceOnly, true);
  assert.equal(buildScript.parseCliArgs([]).fetchSourceOnly, false);
  assert.throws(() => buildScript.parseCliArgs(['--arch']), /requires a value/);
  assert.throws(() => buildScript.parseCliArgs(['--output']), /requires a value/);
  assert.throws(() => buildScript.parseCliArgs(['--bogus']), /Unknown argument/);
});
