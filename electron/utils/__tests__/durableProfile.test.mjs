import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  durableProfileVolatileNames,
  migrateDurableProfile,
  resolveDurableProfile,
} from '../durableProfile.mjs';

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe('durable Linux profile', () => {
  test('uses XDG data for packaged Linux but never for test or agent profiles', () => {
    const env = {};
    const plan = resolveDurableProfile({
      platform: 'linux',
      packaged: true,
      env,
      home: '/home/tester',
    });
    assert.deepEqual(plan, {
      durablePath: '/home/tester/.local/share/natively',
      legacyPaths: ['/home/tester/.config/natively', '/home/tester/.config/Natively'],
    });
    assert.equal(resolveDurableProfile({ platform: 'linux', packaged: false, env, home: '/home/tester' }), null);
    assert.equal(resolveDurableProfile({
      platform: 'linux',
      packaged: true,
      env: { NATIVELY_TEST_USERDATA: '/tmp/test-profile' },
      home: '/home/tester',
    }), null);
    assert.equal(resolveDurableProfile({
      platform: 'linux',
      packaged: true,
      env: { NATIVELY_AGENT_USER_DATA: '/tmp/agent-profile' },
      home: '/home/tester',
    }), null);
  });

  test('migrates missing user data without copying volatile Electron caches or overwriting newer data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-durable-profile-'));
    temporaryRoots.push(root);
    const legacy = path.join(root, 'legacy');
    const durable = path.join(root, 'durable');
    fs.mkdirSync(path.join(legacy, 'Cache'), { recursive: true });
    fs.mkdirSync(path.join(legacy, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'natively.db'), 'legacy-db');
    fs.writeFileSync(path.join(legacy, 'natively.db-wal'), 'legacy-wal');
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"autoAnswerEnabled":true}');
    fs.writeFileSync(path.join(legacy, 'Cache', 'junk'), 'cache');
    fs.writeFileSync(path.join(legacy, 'skills', 'custom.md'), '# keep');
    fs.mkdirSync(durable, { recursive: true });
    fs.writeFileSync(path.join(durable, 'settings.json'), '{"autoAnswerEnabled":false}');

    const result = migrateDurableProfile({ durablePath: durable, legacyPaths: [legacy] });

    assert.ok(result.copied.length >= 3);
    assert.equal(fs.readFileSync(path.join(durable, 'natively.db'), 'utf8'), 'legacy-db');
    assert.equal(fs.readFileSync(path.join(durable, 'natively.db-wal'), 'utf8'), 'legacy-wal');
    assert.equal(fs.readFileSync(path.join(durable, 'settings.json'), 'utf8'), '{"autoAnswerEnabled":false}');
    assert.equal(fs.readFileSync(path.join(durable, 'skills', 'custom.md'), 'utf8'), '# keep');
    assert.equal(fs.existsSync(path.join(durable, 'Cache')), false);
    assert.ok(durableProfileVolatileNames.includes('Cache'));
  });
});
