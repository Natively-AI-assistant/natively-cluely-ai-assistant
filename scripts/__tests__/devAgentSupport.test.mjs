import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  electronArgs, isReservedPort, killPlan, resolveDevPort, RESERVED_PORTS,
} from '../devAgentSupport.mjs';

describe('reserved ports', () => {
  test("never hands out Chrome's 9222 or Node's 9229", () => {
    // Handing either out is how an agent ends up attached to a debugger it did
    // not start — the failure this launcher exists to prevent.
    assert.equal(isReservedPort(9222), true);
    assert.equal(isReservedPort(9229), true);
    assert.equal(isReservedPort(9223), false);
    assert.equal(isReservedPort(58863), false);
  });

  test('the list is frozen, so a caller cannot widen it at runtime', () => {
    assert.throws(() => { RESERVED_PORTS.push(1234); });
  });
});

describe('killPlan — both platform branches', () => {
  test('win32 uses taskkill with the whole tree, not a signal', () => {
    // electron and vite each spawn children; SIGTERM alone leaves them running
    // on Windows, which CLAUDE.md calls out explicitly.
    const plan = killPlan('win32', 4321);
    assert.equal(plan.kind, 'spawn');
    assert.equal(plan.command, 'taskkill');
    assert.deepEqual(plan.args, ['/pid', '4321', '/T', '/F']);
  });

  test('darwin uses a signal', () => {
    assert.deepEqual(killPlan('darwin', 4321), { kind: 'signal', signal: 'SIGTERM' });
  });

  test('linux takes the POSIX branch too', () => {
    assert.equal(killPlan('linux', 99).kind, 'signal');
  });

  test('arguments stay an array, so nothing can be shell-reparsed', () => {
    const plan = killPlan('win32', 7);
    assert.ok(Array.isArray(plan.args));
    assert.ok(plan.args.every(a => typeof a === 'string'));
  });

  test('refuses a nonsense pid rather than signalling the process group', () => {
    // kill(0) and kill(-1) are the dangerous ones: 0 is "my whole group",
    // -1 is "every process I am allowed to signal".
    for (const bad of [0, -1, 1.5, NaN, undefined]) {
      assert.throws(() => killPlan('darwin', bad), /refusing to act on pid/);
    }
  });
});

describe('resolveDevPort', () => {
  test('defaults to 5180 so every existing script is unaffected', () => {
    assert.equal(resolveDevPort(undefined), 5180);
    assert.equal(resolveDevPort(''), 5180);
  });

  test('honours a real port', () => {
    assert.equal(resolveDevPort('58864'), 58864);
  });

  test('falls back on junk instead of pointing the windows at port 0', () => {
    // The symptom of not doing this is four blank chrome-error:// windows and
    // no explanation of why.
    for (const bad of ['0', '-1', '99999', 'abc', '51.8']) {
      assert.equal(resolveDevPort(bad), 5180, `"${bad}" should fall back`);
    }
  });
});

describe('electronArgs', () => {
  test('passes --user-data-dir, so credentials are isolated from the real profile', () => {
    // app.setPath() alone ran after CredentialsManager had captured the real
    // profile's credentials.enc path: agent instances read, and could
    // overwrite, the developer's keys.
    const args = electronArgs('/repo', 51234, '/repo/.agent/userdata');
    assert.ok(args.includes('--user-data-dir=/repo/.agent/userdata'));
  });

  test('keeps the app root first and the CDP port', () => {
    const args = electronArgs('/repo', 51234, '/repo/.agent/userdata');
    assert.equal(args[0], '/repo');
    assert.ok(args.includes('--remote-debugging-port=51234'));
  });

  test('a Windows path with spaces stays ONE argument', () => {
    const dir = 'C:\\Users\\Some One\\natively\\.agent\\userdata';
    const args = electronArgs('C:\\Users\\Some One\\natively', 51234, dir);
    assert.equal(args.filter(a => a.startsWith('--user-data-dir=')).length, 1);
    assert.ok(args.includes(`--user-data-dir=${dir}`));
    assert.ok(args.every(a => typeof a === 'string'));
  });

  test('refuses to launch without a userData dir rather than use the real profile', () => {
    for (const bad of ['', undefined, null]) {
      assert.throws(() => electronArgs('/repo', 51234, bad), /own userData dir/);
    }
  });
});
