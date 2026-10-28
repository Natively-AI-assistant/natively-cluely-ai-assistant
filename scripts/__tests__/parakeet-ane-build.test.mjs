// Build contract for the Parakeet Neural Engine helper (scripts/build-parakeet-ane.js).
//
// Fixture based with a fake toolchain: runs on macOS and Windows alike and
// never invokes Swift. The real build is exercised by release-macos.yml's
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

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-ane-build-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'native', 'parakeet-ane'), { recursive: true });
  fs.writeFileSync(path.join(root, 'native', 'parakeet-ane', 'Package.swift'), '// swift-tools-version:6.2\n');
  // What SwiftPM leaves after resolving FluidAudio.
  const checkout = path.join(root, 'native', 'parakeet-ane', '.build', 'checkouts', 'FluidAudio');
  fs.mkdirSync(path.join(checkout, 'ThirdPartyLicenses'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'LICENSE'), 'Apache License 2.0');
  fs.writeFileSync(path.join(checkout, 'ThirdPartyLicenses', 'fastcluster-LICENSE.md'), 'BSD');
  return root;
}

/** Records every command; `swift build` "produces" a binary of the given arch. */
function fakeToolchain(root, { builtArch = 'arm64' } = {}) {
  const calls = [];
  const binDir = path.join(root, 'native', 'parakeet-ane', '.build', 'release');
  const run = (command, args) => {
    calls.push({ command, args: [...args] });
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
  const result = buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output, run });
  assert.deepEqual(result, { skipped: false, arch: 'arm64', output });
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
  fs.rmSync(path.join(root, 'native', 'parakeet-ane', '.build', 'checkouts', 'FluidAudio', 'LICENSE'));
  const { run } = fakeToolchain(root);
  assert.throws(
    () => buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output: path.join(root, 'out', 'h'), run }),
    /LICENSE is missing/,
  );
});

test('universal requests build the arm64 helper only', (t) => {
  const root = fixtureRoot(t);
  const { run } = fakeToolchain(root);
  const output = path.join(root, 'out', buildScript.HELPER_NAME);
  const result = buildScript.buildParakeetAne({ platform: 'darwin', arch: 'universal', root, output, run });
  assert.equal(result.arch, 'arm64');
});

test('a wrong-arch product is refused and nothing is installed', (t) => {
  const root = fixtureRoot(t);
  const { run } = fakeToolchain(root, { builtArch: 'x86_64' });
  const output = path.join(root, 'out', buildScript.HELPER_NAME);
  assert.throws(
    () => buildScript.buildParakeetAne({ platform: 'darwin', arch: 'arm64', root, output, run }),
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

test('Package.swift pins FluidAudio exactly and opts out of its prebuilt binary', () => {
  const manifest = fs.readFileSync(path.join(repoRoot, 'native', 'parakeet-ane', 'Package.swift'), 'utf8');
  assert.match(manifest, /FluidInference\/FluidAudio\.git", exact: "\d+\.\d+\.\d+", traits: \[\]/);
  // Trait opt-out needs tools 6.2 (FluidAudio's own Package@swift-6.2.swift).
  assert.match(manifest, /^\/\/ swift-tools-version:6\.2/);
  const resolved = JSON.parse(fs.readFileSync(path.join(repoRoot, 'native', 'parakeet-ane', 'Package.resolved'), 'utf8'));
  assert.deepEqual(resolved.pins.map((p) => p.identity), ['fluidaudio'], 'FluidAudio must stay dependency-free');
});

test('CLI parser rejects missing values and unknown flags', () => {
  assert.equal(buildScript.parseCliArgs(['--arch=arm64']).arch, 'arm64');
  assert.throws(() => buildScript.parseCliArgs(['--arch']), /requires a value/);
  assert.throws(() => buildScript.parseCliArgs(['--output']), /requires a value/);
  assert.throws(() => buildScript.parseCliArgs(['--bogus']), /Unknown argument/);
});
