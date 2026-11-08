// Electron fuses are flipped in afterPack for every packaged build (macOS and
// Windows): no --inspect, no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, app.asar
// integrity checked and the app loaded only from it. A fake packager stands in
// for electron-builder, so the same test runs on either system.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NATIVELY_FUSES, flipFusesForAfterPack } = require('../electron-fuses.cjs');

const quiet = { log() {}, warn() {} };

function fakeContext(platform) {
  const calls = [];
  return {
    calls,
    context: {
      electronPlatformName: platform,
      appOutDir: '/out',
      packager: {
        generateFuseConfig: async (fuses) => { calls.push(['generate', fuses]); return { version: '1', ...fuses }; },
        addElectronFuses: async (ctx, config) => { calls.push(['flip', ctx.electronPlatformName, config]); },
      },
    },
  };
}

test('the fuses that close the main-process doors', () => {
  assert.deepEqual({ ...NATIVELY_FUSES }, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  });
  assert.ok(Object.isFrozen(NATIVELY_FUSES));
});

for (const platform of ['darwin', 'win32']) {
  test(`flipped for ${platform} through electron-builder's packager`, async () => {
    const { calls, context } = fakeContext(platform);
    assert.equal(await flipFusesForAfterPack(context, { env: {}, log: quiet }), true);
    assert.deepEqual(calls[0], ['generate', NATIVELY_FUSES]);
    assert.equal(calls[1][0], 'flip');
    assert.equal(calls[1][1], platform);
    assert.equal(calls[1][2].runAsNode, false);
  });
}

test('a packager that cannot flip them fails the build rather than ship without', async () => {
  await assert.rejects(flipFusesForAfterPack({ electronPlatformName: 'win32' }, { env: {}, log: quiet }), /cannot flip Electron fuses/);
});

test('NATIVELY_NO_FUSES=1 skips them, loudly', async () => {
  const { calls, context } = fakeContext('darwin');
  const warned = [];
  assert.equal(await flipFusesForAfterPack(context, { env: { NATIVELY_NO_FUSES: '1' }, log: { log() {}, warn: (m) => warned.push(m) } }), false);
  assert.equal(calls.length, 0);
  assert.match(warned[0], /Never ship/);
});
