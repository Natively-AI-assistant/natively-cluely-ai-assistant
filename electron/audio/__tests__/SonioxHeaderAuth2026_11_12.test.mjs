// BYOK Soniox sends its key in the WebSocket upgrade's Authorization header,
// not in the config frame.
//
// 2026-11-12. Soniox deprecated api_key in the config frame: from 2027-01-15 a
// connection that sends the key only there is refused, and a config key that
// differs from the header key is a 400. Live-checked the same day: header auth
// opens in the same time, gives the same transcript, and a bad key still
// upgrades and then fails in-band with 401 unauthenticated, so the app's error
// handling needs no change.
//
// Platform: no platform branch here; Electron's main process uses the same
// `ws` client on darwin and win32, so one run covers both.
//
// Run: npm run build:electron && node --test electron/audio/__tests__/SonioxHeaderAuth2026_11_12.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(repoRoot, 'dist-electron/electron/audio');
const load = (f) => require(path.join(distDir, f));
const src = (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8');

describe('Soniox header auth', () => {
  const mod = load('SonioxStreamingSTT.js');
  const { streamingStttWsOptions } = load('dnsHelpers.js');

  test('the header carries the key as a Bearer token', () => {
    assert.deepEqual(mod.sonioxAuthHeaders('k1'), { Authorization: 'Bearer k1' });
  });

  test('the config frame carries no api_key', () => {
    const stt = Object.create(mod.SonioxStreamingSTT.prototype);
    Object.assign(stt, { apiKey: 'secret', sampleRate: 16000, numChannels: 1, isActive: false });
    const cfg = stt.buildConfigFrame();
    assert.equal('api_key' in cfg, false);
    assert.equal(JSON.stringify(cfg).includes('secret'), false, 'the key appears nowhere in the frame');
  });

  test('the session socket passes the header and keeps the IPv4 + handshake options', () => {
    assert.match(src('electron/audio/SonioxStreamingSTT.ts'),
      /new WebSocket\(SONIOX_WEBSOCKET_URL, streamingStttWsOptions\(\{ headers: sonioxAuthHeaders\(this\.apiKey\) \}\)/);
    const opts = streamingStttWsOptions({ headers: mod.sonioxAuthHeaders('k') });
    assert.equal(opts.family, 4);
    assert.equal(opts.handshakeTimeout, 15000);
    assert.equal(typeof opts.lookup, 'function');
    assert.equal(opts.headers.Authorization, 'Bearer k');
  });

  test('the Settings key test authenticates the same way', () => {
    const ipc = src('electron/ipcHandlers.ts');
    const i = ipc.indexOf("if (provider === 'soniox')");
    assert.ok(i > 0);
    const block = ipc.slice(i, ipc.indexOf("ws.on('message'", i));
    assert.match(block, /headers: \{ Authorization: `Bearer \$\{apiKey\}` \}/);
    assert.doesNotMatch(block, /api_key/);
  });
});
