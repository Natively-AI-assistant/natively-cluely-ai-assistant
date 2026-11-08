// electron/llm/codeVerification/__tests__/InterpreterProbe2026_10_26.test.mjs
//
// BUG: the "is this toolchain installed?" probe gave every command 2s and cached
// the answer for the whole run. On a cold Windows machine `go version` can take
// longer (CI saw it), so that session silently stopped checking Go answers.
// The probe now waits 10s on Windows, never caches a probe that ran out of time,
// and lets a late clean exit cache "available" for the next answer.
//
// The probes run the Electron binary itself (ELECTRON_RUN_AS_NODE is inherited),
// so the same tests run on macOS and Windows.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterpreterProbe, createPythonResolver, interpreterProbeTimeoutMs } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const node = process.execPath;
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (check, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await wait(50); }
  return false;
};
// A probe "command" that records each launch in `log`, then sleeps `ms`.
const sleeper = (log, ms, exitCode = 0) =>
  ['-e', `require('fs').appendFileSync(${JSON.stringify(log)}, 'x'); setTimeout(() => process.exit(${exitCode}), ${ms})`];
const launches = log => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').length : 0);
const tmpLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'natively-probe-')), 'launches.txt');

describe('interpreter probe', () => {
  test('Windows waits 10s for the first answer, other platforms 2s', () => {
    assert.equal(interpreterProbeTimeoutMs('win32'), 10000);
    assert.equal(interpreterProbeTimeoutMs('darwin'), 2000);
    assert.equal(interpreterProbeTimeoutMs('linux'), 2000);
  });

  test('a clean exit is cached: the command is launched once', async () => {
    const probe = createInterpreterProbe(15000);
    const log = tmpLog();
    assert.equal(await probe(node, sleeper(log, 0)), true);
    assert.equal(await probe(node, sleeper(log, 0)), true);
    assert.equal(launches(log), 1);
  });

  test('a failing exit and a missing command are cached as unavailable', async () => {
    const probe = createInterpreterProbe(15000);
    const log = tmpLog();
    assert.equal(await probe(node, sleeper(log, 0, 3)), false);
    assert.equal(await probe(node, sleeper(log, 0, 3)), false);
    assert.equal(launches(log), 1);
    assert.equal(await probe('natively-no-such-command-2026'), false);
  });

  test('a slow probe answers "unavailable" now, and its late clean exit makes the next answer "available"', async () => {
    const probe = createInterpreterProbe(1, 30000);
    const log = tmpLog();
    assert.equal(await probe(node, sleeper(log, 400)), false, 'out of time: not available for this answer');
    assert.ok(await until(async () => (await probe(node, sleeper(log, 400))) === true), 'the late exit was cached as available');
    assert.equal(launches(log), 1, 'calls made while the slow probe ran did not launch another');
  });

  test('a probe that never exits is killed, not cached, and tried again next time', async () => {
    // The give-up must outlast a slow Windows runner starting Electron as node.
    const probe = createInterpreterProbe(1, 10000);
    const log = tmpLog();
    assert.equal(await probe(node, sleeper(log, 60000)), false);
    assert.ok(await until(() => launches(log) === 1));
    assert.ok(await until(async () => { await probe(node, sleeper(log, 60000)); return launches(log) >= 2; }),
      'after giving up, the next call probes again instead of reusing a cached "no"');
  });

  test('simultaneous calls share one launch', async () => {
    const probe = createInterpreterProbe(15000);
    const log = tmpLog();
    const answers = await Promise.all([1, 2, 3].map(() => probe(node, sleeper(log, 100))));
    assert.deepEqual(answers, [true, true, true]);
    assert.equal(launches(log), 1);
  });
});

describe('Windows: no console window flashes for a verification run', () => {
  test('every spawn in the local runner passes windowsHide', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'localRunner.ts'), 'utf8');
    const spawns = src.match(/\bspawn\([^;]*?\{[^}]*\}/g) ?? [];
    assert.ok(spawns.length >= 4, `found ${spawns.length} spawn calls`);
    for (const call of spawns) assert.match(call, /windowsHide: true/, call);
  });
});

// The Python lookup tried its three Windows candidates one after another, so
// three hung probes held the first Python answer for 30s. They now run together.
describe('Python lookup', () => {
  // A fake probe: each command answers `ok` after `ms`, and records when it started.
  const fakeProbe = (answers) => {
    const started = [];
    const t0 = Date.now();
    const probe = (cmd) => { started.push([cmd, Date.now() - t0]); const [ok, ms] = answers[cmd]; return new Promise(r => setTimeout(() => r(ok), ms)); };
    return { probe, started };
  };
  const WIN = [['python', ['--version']], ['py', ['-3', '--version']], ['python3', ['--version']]];

  test('all candidates start together, so hung ones cost one wait, not one each', async () => {
    const { probe, started } = fakeProbe({ python: [false, 300], py: [false, 300], python3: [true, 300] });
    const t0 = Date.now();
    assert.deepEqual(await createPythonResolver(probe, WIN)(), ['python3']);
    assert.ok(Date.now() - t0 < 700, `took ${Date.now() - t0}ms; one after another would be ~900ms`);
    assert.deepEqual(started.map(([c]) => c), ['python', 'py', 'python3']);
    assert.ok(started.every(([, at]) => at < 50), 'every candidate started at once');
  });

  test('the list order still decides: a slower "python" beats a faster "py"', async () => {
    const { probe } = fakeProbe({ python: [true, 200], py: [true, 10], python3: [true, 10] });
    assert.deepEqual(await createPythonResolver(probe, WIN)(), ['python']);
  });

  test('the launcher keeps its -3 selector, and a found interpreter is cached', async () => {
    const { probe, started } = fakeProbe({ python: [false, 5], py: [true, 5], python3: [false, 5] });
    const resolve = createPythonResolver(probe, WIN);
    assert.deepEqual(await resolve(), ['py', '-3']);
    assert.deepEqual(await resolve(), ['py', '-3']);
    assert.equal(started.length, 3, 'the second lookup probes nothing');
  });

  test('"none found" is not cached, so an interpreter that answers later is used', async () => {
    let late = false;
    const resolve = createPythonResolver(async () => late, [['python3', ['--version']]]);
    assert.equal(await resolve(), null);
    late = true;
    assert.deepEqual(await resolve(), ['python3']);
  });
});
