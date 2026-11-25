// scripts/build-native.js must never let `napi build` rewrite the committed
// native-module/index.js and index.d.ts. napi only sees the Rust compiled for
// the machine running it, so a Mac build dropped the Windows-only exports and a
// Windows build the macOS-only ones (NativeBindingsCoverBothPlatforms checks
// the committed files). Every napi call must pass --no-js and send its type
// file into target/.
//
// Drives the REAL script with os.platform() forced to 'darwin' and then
// 'win32' and every command stubbed, so both branches are checked from either OS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, '../build-native.js');

const ARTIFACTS = {
  darwin: { arch: 'arm64', file: 'index.darwin-arm64.node' },
  win32: { arch: 'x64', file: 'index.win32-x64-msvc.node' },
};

function runBuildNative(platform) {
  const { arch, file } = ARTIFACTS[platform];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-build-bindings-'));
  const nativeDir = path.join(tmp, 'native-module');
  fs.mkdirSync(nativeDir, { recursive: true });
  const committed = { 'index.js': 'COMMITTED JS', 'index.d.ts': 'COMMITTED DTS' };
  for (const [name, body] of Object.entries(committed)) fs.writeFileSync(path.join(nativeDir, name), body);

  const napiCalls = [];
  const fakeChildProcess = {
    execSync: (cmd, opts) => {
      if (!String(cmd).includes('napi build')) return '';
      // What napi itself does with these arguments (@napi-rs/cli 3.6): the
      // type file is written to join(cwd, --dts) or index.d.ts, and the JS file
      // unless --no-js.
      napiCalls.push({ cmd, cwd: opts.cwd, dtsDirExists: fs.existsSync(path.join(nativeDir, 'target', 'napi')) });
      const dts = String(cmd).match(/--dts (\S+)/)?.[1] ?? 'index.d.ts';
      fs.writeFileSync(path.join(opts.cwd, dts), 'GENERATED DTS');
      if (!/--no-js\b/.test(cmd)) fs.writeFileSync(path.join(opts.cwd, 'index.js'), 'GENERATED JS');
      fs.writeFileSync(path.join(nativeDir, file), 'BINARY');
      return '';
    },
    spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
  };
  const fakeOs = { ...os, platform: () => platform, arch: () => arch };
  const tmpScripts = path.join(tmp, 'scripts');
  const fakeRequire = (id) => {
    const s = String(id);
    if (s.endsWith('native-link-checks.cjs')) return { assertMacWeakLinks() {}, assertNoDynamicVcRuntime() {} };
    if (s.endsWith('macho-align-strtab.cjs')) return { alignMachOStringTableFile: () => 0 };
    if (id === 'os' || id === 'node:os') return fakeOs;
    if (id === 'child_process' || id === 'node:child_process') return fakeChildProcess;
    // The script runs from tmp/scripts; its own helpers (scripts/lib/*) load from the repo.
    if (s.startsWith(tmpScripts + path.sep)) return require(path.join(__dirname, '..', path.relative(tmpScripts, s)));
    return require(id);
  };

  // A set CARGO_TARGET_DIR is used as is, so the build never looks for other
  // storage on this machine. The script only reads these.
  const saved = {
    NATIVELY_BUILD_ALL_MAC_ARCHES: process.env.NATIVELY_BUILD_ALL_MAC_ARCHES,
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR,
  };
  delete process.env.NATIVELY_BUILD_ALL_MAC_ARCHES;
  process.env.CARGO_TARGET_DIR = path.join(tmp, 'cargo-target');
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', fs.readFileSync(scriptPath, 'utf8'));
    fn(fakeRequire, { exports: {} }, {}, tmpScripts, path.join(tmpScripts, 'build-native.js'));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const read = (rel) => fs.readFileSync(path.join(nativeDir, rel), 'utf8');
  return { tmp, napiCalls, committed, read };
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: a build leaves the committed index.js and index.d.ts as they were`, () => {
    const { tmp, napiCalls, committed, read } = runBuildNative(platform);
    try {
      assert.equal(napiCalls.length, 1);
      for (const { cmd, dtsDirExists } of napiCalls) {
        assert.match(cmd, / --no-js\b/);
        assert.match(cmd, / --dts target\/napi\/index\.d\.ts\b/);
        assert.ok(dtsDirExists, 'napi only logs a failed type-file write, so the folder must exist before it runs');
      }
      for (const [name, body] of Object.entries(committed)) assert.equal(read(name), body, `${name} was rewritten`);
      assert.equal(read('target/napi/index.d.ts'), 'GENERATED DTS');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('target/ stays out of git and out of packages', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  assert.match(fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8'), /^native-module\/target\/$/m);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('!**/native-module/target'));
});
