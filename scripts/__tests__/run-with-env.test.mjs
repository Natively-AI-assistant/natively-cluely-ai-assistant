// Unit tests for the cross-platform build-script helpers.
//
// These two scripts sit on `npm run dist`, `npm run dist:signed` and
// `test:electron`, and they exist specifically to paper over macOS/Windows
// shell differences — so they are exactly the code that must not be verified
// only on whichever host happened to run it. Every helper below is pure and
// takes its platform-dependent inputs (tmpdir, resolver, signal table) as
// parameters, so both platform shapes are exercised from either host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { applyEnv, resolveCommand, exitCodeFor, UsageError } from '../run-with-env.mjs';

// ---------------------------------------------------------------------------
// applyEnv — the `VAR=value CMD` and `${VAR:-default}` replacements.
// ---------------------------------------------------------------------------

test('--set always overwrites', () => {
  const env = applyEnv(['--set', 'A=1'], { A: 'existing' });
  assert.equal(env.A, '1');
});

test('--default fills in only when unset', () => {
  assert.equal(applyEnv(['--default', 'PORT=5173'], {}).PORT, '5173');
  assert.equal(applyEnv(['--default', 'PORT=5173'], { PORT: '9999' }).PORT, '9999');
});

test('--default treats set-but-empty as unset, matching ${VAR:-default}', () => {
  assert.equal(applyEnv(['--default', 'PORT=5173'], { PORT: '' }).PORT, '5173');
});

test('--default-tmpdir builds a platform-correct path under the given tmpdir', () => {
  const win = applyEnv(['--default-tmpdir', 'UD=natively-test-userdata'], {}, 'C:\\Temp');
  assert.equal(win.UD, path.join('C:\\Temp', 'natively-test-userdata'));

  const posix = applyEnv(['--default-tmpdir', 'UD=natively-test-userdata'], {}, '/tmp');
  assert.equal(posix.UD, path.join('/tmp', 'natively-test-userdata'));
});

test('--default-tmpdir splits nested subpaths rather than embedding a raw slash', () => {
  const env = applyEnv(['--default-tmpdir', 'UD=a/b'], {}, 'ROOT');
  assert.equal(env.UD, path.join('ROOT', 'a', 'b'));
});

test('applyEnv does not mutate the base environment', () => {
  const base = { KEEP: 'yes' };
  applyEnv(['--set', 'NEW=1'], base);
  assert.deepEqual(base, { KEEP: 'yes' });
});

test('applyEnv rejects malformed and unknown options', () => {
  assert.throws(() => applyEnv(['--set', 'NOEQUALS'], {}), UsageError);
  assert.throws(() => applyEnv(['--set', '=novalue'], {}), UsageError);
  assert.throws(() => applyEnv(['--nope', 'A=1'], {}), UsageError);
  assert.throws(() => applyEnv(['--set'], {}), UsageError);
});

// ---------------------------------------------------------------------------
// resolveCommand — bin resolution instead of node_modules/.bin shims.
// ---------------------------------------------------------------------------

test('node resolves to the running executable, not a shim', () => {
  const { file, args } = resolveCommand('node', { execPath: '/usr/bin/node' });
  assert.equal(file, '/usr/bin/node');
  assert.deepEqual(args, []);
});

test('a local dependency resolves to its package.json bin entrypoint under node', () => {
  // Fake resolver so this asserts the resolution SHAPE on any host, rather
  // than depending on which packages happen to be installed.
  const fakeManifest = path.join('/repo', 'node_modules', 'playwright', 'package.json');
  const { file, args } = resolveCommand('playwright', {
    execPath: '/usr/bin/node',
    resolve: (request) => {
      assert.equal(request, 'playwright/package.json');
      return fakeManifest;
    },
    load: () => ({ bin: { playwright: 'cli.js' } }),
  });

  assert.equal(file, '/usr/bin/node', 'the bin must be run under node, never via a .cmd shim');
  assert.equal(args.length, 1);
  assert.ok(args[0].startsWith(path.dirname(fakeManifest)), 'the entrypoint must resolve inside the package');
});

test('an unresolvable command fails loudly instead of falling back to a shell', () => {
  // The PATH fallback this replaces used `shell: true`, under which Node does
  // NOT quote array args — "C:\Program Files\x" would have been split in two
  // and `&` in a value would have run a second command.
  assert.throws(
    () => resolveCommand('definitely-not-installed-xyz', { resolve: () => { throw new Error('not found'); } }),
    (error) => error instanceof UsageError && /not a resolvable local dependency/.test(error.message)
  );
});

test('a dependency with no bin entry is reported rather than silently mis-spawned', () => {
  assert.throws(
    () => resolveCommand('nobin', {
      resolve: () => path.join('/repo', 'node_modules', 'nobin', 'package.json'),
      load: () => ({ name: 'nobin' }), // no `bin` field
    }),
    (error) => error instanceof UsageError && /declares no "bin" entrypoint/.test(error.message)
  );
});

test('the real playwright and electron deps both resolve through the bin branch', () => {
  // The two commands actually used by package.json today. If either ever stops
  // resolving, the scripts would previously have fallen back to an unquoted
  // shell; now they fail loudly, so pin that they resolve.
  for (const name of ['playwright', 'electron']) {
    const { file, args } = resolveCommand(name);
    assert.equal(file, process.execPath, `${name} must run under node`);
    assert.match(args[0], /\.(js|cjs|mjs)$/, `${name} must resolve to a JS entrypoint, not a shim`);
  }
});

// ---------------------------------------------------------------------------
// exitCodeFor — bash `$?` parity, including signal deaths.
// ---------------------------------------------------------------------------

const SIGNALS = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

test('a normal exit propagates its status verbatim', () => {
  assert.equal(exitCodeFor({ status: 0, signal: null }, SIGNALS), 0);
  assert.equal(exitCodeFor({ status: 7, signal: null }, SIGNALS), 7);
});

test('signal deaths become 128+N like sh, not a flat 1', () => {
  // 130 = operator pressed Ctrl-C; 137 = OOM-killed. Release tooling keys off
  // these to distinguish a transient kill from a genuine build failure.
  assert.equal(exitCodeFor({ status: null, signal: 'SIGINT' }, SIGNALS), 130);
  assert.equal(exitCodeFor({ status: null, signal: 'SIGKILL' }, SIGNALS), 137);
  assert.equal(exitCodeFor({ status: null, signal: 'SIGTERM' }, SIGNALS), 143);
});

test('an unknown signal still reports a nonzero failure', () => {
  assert.equal(exitCodeFor({ status: null, signal: 'SIGWEIRD' }, SIGNALS), 128);
});

test('a launch failure reports 1', () => {
  assert.equal(exitCodeFor({ error: new Error('ENOENT'), status: null, signal: null }, SIGNALS), 1);
});
