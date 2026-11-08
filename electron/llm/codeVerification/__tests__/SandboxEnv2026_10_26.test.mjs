// electron/llm/codeVerification/__tests__/SandboxEnv2026_10_26.test.mjs
//
// BUG (Windows): the scrubbed env the verifier spawns tools with set only the
// POSIX HOME/TMPDIR. Windows tools read USERPROFILE/LOCALAPPDATA/APPDATA and
// TEMP/TMP instead, so Go refused to build ("GOCACHE is not defined and
// %LocalAppData% is not defined") and every Go answer verified as an error.
// Both platform branches are exercised here on any host.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { sandboxEnv } from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const cwd = '/tmp/natively-verify-x';

describe('sandboxEnv', () => {
  test('darwin: PATH plus HOME/TMPDIR in the run dir, nothing Windows-only', () => {
    assert.deepEqual(sandboxEnv(cwd, 'darwin'), { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd });
  });

  test('win32: the per-user and temp dirs Windows tools read also point at the run dir', () => {
    const env = sandboxEnv(cwd, 'win32');
    for (const key of ['HOME', 'TMPDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) {
      assert.equal(env[key], cwd, key);
    }
    assert.equal(env.PATH, process.env.PATH);
  });

  test('no other variable from the main process gets through, on either platform', () => {
    const saved = process.env.NATIVELY_TEST_SECRET_KEY;
    process.env.NATIVELY_TEST_SECRET_KEY = 'sk-should-not-leak';
    try {
      for (const platform of ['darwin', 'win32']) {
        const env = sandboxEnv(cwd, platform);
        assert.equal(env.NATIVELY_TEST_SECRET_KEY, undefined, platform);
        assert.ok(!Object.values(env).includes('sk-should-not-leak'), platform);
      }
    } finally {
      if (saved === undefined) delete process.env.NATIVELY_TEST_SECRET_KEY;
      else process.env.NATIVELY_TEST_SECRET_KEY = saved;
    }
  });
});
