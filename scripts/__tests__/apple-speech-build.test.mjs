import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildScript = require('../build-apple-speech.js');
const { runAfterPack } = require('../after-pack.cjs');

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-speech-build-test-'));
  const source = path.join(root, 'native', 'apple-speech', 'main.swift');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, '@main struct Helper { static func main() {} }\n');
  return root;
}

function fakeToolchain({ sdkVersion = '26.5' } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === 'xcrun' && args.includes('--show-sdk-path')) return '/SDKs/MacOSX.sdk\n';
    if (command === 'xcrun' && args.includes('--show-sdk-version')) return `${sdkVersion}\n`;
    if (command === 'xcrun' && args.includes('swiftc')) {
      const output = args[args.indexOf('-o') + 1];
      const target = args[args.indexOf('-target') + 1];
      fs.writeFileSync(output, target.startsWith('x86_64') ? 'x86_64' : 'arm64');
      return '';
    }
    if (command === 'lipo' && args[0] === '-archs') {
      return fs.readFileSync(args[1], 'utf8');
    }
    if (command === 'lipo' && args[0] === '-create') {
      const output = args[args.indexOf('-output') + 1];
      fs.writeFileSync(output, 'arm64 x86_64');
      return '';
    }
    if (command === 'codesign') return '';
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { calls, run };
}

test('ordinary Electron builds and watch mode do not invoke Swift', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-electron.js'), 'utf8');
  assert.doesNotMatch(source, /build-apple-speech|swiftc/);
});

test('packaging uses the composite afterPack hook without a shared extraResource', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.build.afterPack, './scripts/after-pack.cjs');
  const extraResources = pkg.build.mac?.extraResources ?? [];
  assert.ok(
    !extraResources.some((entry) => String(entry?.from ?? entry).includes('apple-speech')),
    'mac packaging must not copy a shared, potentially wrong-arch Apple Speech binary'
  );
});

test('packaged and development apps declare the Apple Speech privacy purpose', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(
    pkg.build.mac?.extendInfo?.NSSpeechRecognitionUsageDescription ?? '',
    /Apple Speech.*on your device/i,
  );
  const devPlistPatch = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'patch-electron-plist.js'),
    'utf8',
  );
  assert.match(devPlistPatch, /NSSpeechRecognitionUsageDescription/);
});

test('release runner carries the macOS 26 SDK required by SpeechTranscriber', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'),
    'utf8'
  );
  assert.match(workflow, /runs-on:\s*macos-26\b/);
});

test('generated local helper is gitignored', () => {
  const ignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.match(ignore, /^\/resources\/apple-speech\/natively-apple-speech$/m);
});

test('Swift bridge drains resampler state before flush and end-of-input', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'native', 'apple-speech', 'main.swift'),
    'utf8',
  );
  assert.match(source, /outStatus\.pointee\s*=\s*\.endOfStream/);
  assert.match(
    source,
    /if type == "flush"[^]*flushConverter\(converter[^]*converter = nil[^]*analyzer\.finalizeAndFinishThroughEndOfInput/s,
  );
  // The invariant is ordering, not proximity: a distance window broke the
  // moment a comment was added above continuation.finish(). Every finish must
  // be preceded by a converter drain with no audio yielded in between, or the
  // resampler's tail frames are dropped on the floor.
  const finishes = [...source.matchAll(/continuation\.finish\(\)/g)].map((m) => m.index);
  assert.ok(finishes.length >= 1, 'the analyzer input continuation must be finished');
  for (const at of finishes) {
    const lastDrain = source.slice(0, at).lastIndexOf('flushConverter(converter');
    assert.ok(lastDrain > 0, 'every continuation.finish() must be preceded by a converter drain');
    assert.doesNotMatch(
      source.slice(lastDrain, at),
      /continuation\.yield\(/,
      'no audio may be yielded between the final converter drain and finishing the stream',
    );
  }
});

test('non-macOS builds skip before consulting Xcode or the filesystem', () => {
  let invoked = false;
  const result = buildScript.buildAppleSpeech({
    platform: 'win32',
    root: '/does/not/exist',
    run: () => {
      invoked = true;
      throw new Error('must not run');
    },
  });
  assert.deepEqual(result, { skipped: true, platform: 'win32' });
  assert.equal(invoked, false);
});

test('old macOS SDK fails with an actionable Xcode requirement', () => {
  const root = fixtureRoot();
  const { run } = fakeToolchain({ sdkVersion: '15.4' });
  assert.throws(
    () => buildScript.buildAppleSpeech({ platform: 'darwin', arch: 'arm64', root, run }),
    /macOS 26 SDK or newer is required.*15\.4.*Xcode 26\+/s
  );
});

test('thin helper is cross-compiled for the requested package architecture', () => {
  const root = fixtureRoot();
  const output = path.join(root, 'out', 'natively-apple-speech');
  const { calls, run } = fakeToolchain();
  const result = buildScript.buildAppleSpeech({
    platform: 'darwin',
    arch: 1,
    root,
    output,
    run,
  });

  assert.equal(result.arch, 'x64');
  assert.equal(fs.readFileSync(output, 'utf8'), 'x86_64');
  if (process.platform !== 'win32') {
    assert.ok((fs.statSync(output).mode & 0o111) !== 0, 'helper must be executable');
  }
  const swift = calls.find((call) => call.command === 'xcrun' && call.args.includes('swiftc'));
  assert.ok(swift);
  assert.equal(swift.args[swift.args.indexOf('-target') + 1], 'x86_64-apple-macosx26.0');
  assert.ok(calls.some((call) => call.command === 'codesign' && call.args.includes('--sign')));
});

test('universal local build merges arm64 and x64 slices', () => {
  const root = fixtureRoot();
  const output = path.join(root, 'out', 'natively-apple-speech');
  const { calls, run } = fakeToolchain();
  buildScript.buildAppleSpeech({ platform: 'darwin', arch: 'universal', root, output, run });

  assert.equal(fs.readFileSync(output, 'utf8'), 'arm64 x86_64');
  const targets = calls
    .filter((call) => call.command === 'xcrun' && call.args.includes('swiftc'))
    .map((call) => call.args[call.args.indexOf('-target') + 1]);
  assert.deepEqual(targets, ['arm64-apple-macosx26.0', 'x86_64-apple-macosx26.0']);
  assert.ok(calls.some((call) => call.command === 'lipo' && call.args[0] === '-create'));
});

test('afterPack destination is private to one target app', () => {
  const projectDir = path.resolve('repo-fixture');
  const appOutDir = path.resolve('release-fixture', 'mac-arm64');
  const result = buildScript.afterPackOutput({
    appOutDir,
    packager: {
      info: { projectDir },
      appInfo: { productFilename: 'Natively' },
    },
  });
  assert.deepEqual(result, {
    root: projectDir,
    output: path.join(
      appOutDir,
      'Natively.app',
      'Contents',
      'Resources',
      'apple-speech',
      'natively-apple-speech',
    ),
  });
});

test('composite afterPack builds the helper before the existing signing hook', async () => {
  const events = [];
  const context = { arch: 3 };
  await runAfterPack(context, {
    buildHelper: async (received) => {
      assert.equal(received, context);
      events.push('build');
    },
    signApp: async (received) => {
      assert.equal(received, context);
      events.push('sign');
    },
  });
  assert.deepEqual(events, ['build', 'sign']);
});

test('a helper build failure stops signing and therefore stops packaging', async () => {
  let signed = false;
  await assert.rejects(
    runAfterPack({}, {
      buildHelper: async () => { throw new Error('SDK too old'); },
      signApp: async () => { signed = true; },
    }),
    /SDK too old/
  );
  assert.equal(signed, false);
});

test('CLI parser accepts explicit universal output and rejects missing values', () => {
  const parsed = buildScript.parseCliArgs(['--arch=universal', '--output', './helper']);
  assert.equal(parsed.arch, 'universal');
  assert.equal(parsed.output, path.resolve('./helper'));
  assert.throws(() => buildScript.parseCliArgs(['--arch']), /requires a value/);
  assert.throws(() => buildScript.parseCliArgs(['--output']), /requires a value/);
});

test('a flush restarts the analysis session instead of force-finalizing it', () => {
  // MEASURED, not assumed. Driving the compiled helper with one sentence and a
  // flush 1.6s in (scripts/__tests__ cannot run this — it needs macOS 26 and a
  // built helper, so the contract is pinned here instead):
  //
  //   analyzer.finalize(through: nil)      →  11.1% word recall, and in a
  //                                           second harness NO final arrived
  //                                           within 20s at all
  //   analyzer.finalize(through: <time>)   →  deadlocks, no output
  //   session restart on flush             →  77.8% word recall, flush→final 77ms
  //
  // SpeechAnalyzer.finalize(through:) does not survive mid-stream use: the audio
  // that follows it is recognised as punctuation debris (",.........."). The only
  // finalization Apple honours cleanly is finalizeAndFinishThroughEndOfInput,
  // which ends the session — so a flush must end this session and open the next.
  const swift = fs.readFileSync(
    path.join(repoRoot, 'native', 'apple-speech', 'main.swift'),
    'utf8',
  );

  assert.doesNotMatch(
    swift,
    /analyzer\.finalize\s*\(\s*through\s*:/,
    'finalize(through:) must never be used — it destroys recognition of the audio after it',
  );

  // Pin the flush branch itself, not just "these words appear somewhere".
  const flush = /if type == "flush" \{([\s\S]*?)\n            \}/.exec(swift)?.[1];
  assert.ok(flush, 'the flush branch must still exist');
  for (const [re, why] of [
    [/continuation\.finish\(\)/, 'must close the current input stream'],
    [/try await analyzer\.finalizeAndFinishThroughEndOfInput\(\)/, 'must finalize through real end-of-input'],
    [/await results\.value/, 'must drain the session results before replacing them'],
    [/\(analyzer, continuation, results\) = try await startSession\(\)/, 'must open a fresh session'],
  ]) {
    assert.match(flush, re, `flush ${why}`);
  }

  // Ordering is load-bearing: finishing after finalizing, or restarting before
  // draining, loses the very final the flush exists to produce.
  const order = ['continuation.finish()', 'finalizeAndFinishThroughEndOfInput()', 'await results.value', 'startSession()']
    .map((needle) => flush.indexOf(needle));
  assert.ok(order.every((i) => i >= 0), 'every flush step must be present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'flush steps must run in order');
});

test('only main() may terminate the helper — no exit from a detached task', () => {
  // The results task used to call exit(1) itself: a second exit path on a
  // background task that bypassed main()'s handler and every defer, and could
  // in principle fire for a session a flush had already replaced. Measured, that
  // teardown does not throw — four flush-restart cycles produced zero catches —
  // so this pins the structure rather than a failure seen in the wild.
  // Strip comments first: the doc comment explaining this very rule contains
  // the literal exit(1), and counting it made the guard fail against the fixed
  // source as well as the broken one — a test that can never pass proves nothing.
  const swift = fs.readFileSync(
    path.join(repoRoot, 'native', 'apple-speech', 'main.swift'),
    'utf8',
  ).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  // Every exit(1) must sit in main()'s dispatch, which is the only place that
  // reports the error and returns a non-zero status.
  const dispatch = /static func main\(\) async \{[\s\S]*?\n    \}/.exec(swift)?.[0];
  assert.ok(dispatch, 'main() dispatch must still exist');
  const exitsInMain = (dispatch.match(/exit\(1\)/g) || []).length;
  const exitsTotal = (swift.match(/exit\(1\)/g) || []).length;
  assert.equal(
    exitsTotal, exitsInMain,
    `all exit(1) must be inside main(); found ${exitsTotal - exitsInMain} elsewhere`,
  );

  // The results task reports through the box and returns.
  const results = /for try await result in t\.results \{[\s\S]*?\n                \}/.exec(swift)?.[0];
  assert.ok(results, 'the results loop must still exist');
  const tail = swift.slice(swift.indexOf(results), swift.indexOf(results) + 900);
  assert.match(tail, /failure\.set\(error\.localizedDescription\)/, 'the results task must record the failure');
  assert.doesNotMatch(tail, /exit\(/, 'the results task must never terminate the process itself');

  // And the main loop has to actually look, or a recorded failure is inert.
  assert.match(
    swift,
    /if let message = failure\.current \{ throw BridgeError\(message: message\) \}/,
    'the main loop must surface a recorded failure',
  );
});
