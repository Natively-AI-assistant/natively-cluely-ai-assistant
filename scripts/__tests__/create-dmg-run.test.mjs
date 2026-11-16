// Tests for scripts/lib/create-dmg-run.cjs — create-dmg with a retry for its flaky
// Finder (AppleScript) step. Fake exec + a temp dir: no create-dmg, hdiutil or Finder
// needed, so this runs on any CI host. process.platform is never touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCreateDmg, leftoverWorkImages } = require('../lib/create-dmg-run.cjs');

const quiet = { log() {}, warn() {}, error() {} };
const noSleep = () => {};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-dmg-run-'));
  return { dir, outDmg: path.join(dir, 'Natively-3.2.0-arm64.dmg') };
}
const fail = (status) => Object.assign(new Error(`Command failed: create-dmg … (status ${status})`), { status });

test('success on the first try: one call, returns ok', () => {
  const { outDmg } = setup();
  let calls = 0;
  const res = runCreateDmg({ args: ['a'], outDmg, exec: () => { calls++; fs.writeFileSync(outDmg, 'dmg'); }, sleepSync: noSleep, log: quiet });
  assert.equal(res, 'ok');
  assert.equal(calls, 1);
});

test('exit 64 (Finder step) is retried, and the leftover rw image is removed before the retry', () => {
  const { dir, outDmg } = setup();
  let calls = 0;
  const leftoverSeenAtRetry = [];
  const exec = () => {
    calls++;
    leftoverSeenAtRetry.push(fs.readdirSync(dir).filter((f) => f.startsWith('rw.')).length);
    if (calls === 1) {
      fs.writeFileSync(path.join(dir, 'rw.33719.Natively-3.2.0-arm64.dmg'), 'x');
      throw fail(64);
    }
    fs.writeFileSync(outDmg, 'dmg');
  };
  const sleeps = [];
  assert.equal(runCreateDmg({ args: [], outDmg, exec, sleepSync: (ms) => sleeps.push(ms), log: quiet, retryDelayMs: 1000 }), 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(leftoverSeenAtRetry, [0, 0], 'the second attempt starts with no leftover working image');
  assert.deepEqual(sleeps, [1000]);
  assert.deepEqual(leftoverWorkImages(outDmg), []);
});

test('exit 64 on every attempt: gives up after maxAttempts with a SHORT error naming the cause', () => {
  const { dir, outDmg } = setup();
  let calls = 0;
  const exec = () => { calls++; fs.writeFileSync(path.join(dir, `rw.${calls}.Natively-3.2.0-arm64.dmg`), 'x'); throw fail(64); };
  assert.throws(
    () => runCreateDmg({ args: [], outDmg, exec, sleepSync: noSleep, log: quiet, maxAttempts: 3 }),
    (e) => {
      assert.equal(e.status, 64);
      assert.match(e.message, /exit 64: Finder layout \(AppleScript\) step failed, attempt 3\/3/);
      assert.ok(e.message.length < 200, 'short enough for the job record');
      assert.ok(!/--volname/.test(e.message), 'no command line in the message');
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('rw.')), [], 'no 3 GB leftovers after giving up');
});

test('exit 2 with the DMG on disk is accepted without a retry (cosmetic layout skipped)', () => {
  const { outDmg } = setup();
  let calls = 0;
  const exec = () => { calls++; fs.writeFileSync(outDmg, 'dmg'); throw fail(2); };
  assert.equal(runCreateDmg({ args: [], outDmg, exec, sleepSync: noSleep, log: quiet }), 'cosmetic');
  assert.equal(calls, 1);
});

test('exit 2 WITHOUT a DMG, and any other exit code, fail at once (no retry)', () => {
  for (const status of [2, 1, null]) {
    const { outDmg } = setup();
    let calls = 0;
    assert.throws(() => runCreateDmg({ args: [], outDmg, exec: () => { calls++; throw fail(status); }, sleepSync: noSleep, log: quiet }));
    assert.equal(calls, 1, `status ${status} is not retried`);
  }
});

test('only THIS dmg\'s working images are removed, never another arch\'s or other files', () => {
  const { dir, outDmg } = setup();
  for (const f of ['rw.1.Natively-3.2.0-arm64.dmg', 'rw.2.Natively-3.2.0.dmg', 'Natively-3.2.0.dmg', 'rw.notes.txt', 'rw.x.Natively-3.2.0-arm64.dmg']) {
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  assert.deepEqual(leftoverWorkImages(outDmg).map((p) => path.basename(p)), ['rw.1.Natively-3.2.0-arm64.dmg']);
});
