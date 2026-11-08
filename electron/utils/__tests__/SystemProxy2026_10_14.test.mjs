// electron/utils/__tests__/SystemProxy2026_10_14.test.mjs
//
// Local model downloads use Node's built-in fetch in a worker thread, which
// ignores the operating system's proxy. On a network that requires one, every
// model download failed with "fetch failed" while the rest of the app worked.
//
// The main process now asks Chromium which proxy applies (it reads macOS
// System Settings, Windows proxy settings and PAC scripts) and starts the
// download worker with it. Verified by hand on this runtime (Electron 43 /
// Node 24.21): a worker created with the env built here sent
// `CONNECT huggingface.co:443` to a local proxy; without it, it went direct.
//
// This file covers the parts that are pure: the strings Chromium returns on
// either OS, the worker environment, and that the lookup can never block or
// fail a download. Not executed against a real corporate proxy on either OS.
//
// Run: npm run build:electron && node --test electron/utils/__tests__/SystemProxy2026_10_14.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  proxyUrlFromChromiumList,
  workerEnvForProxy,
  refreshSystemProxy,
  getCachedSystemProxy,
  __resetSystemProxyForTests,
} = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/utils/systemProxy.js')).href);

beforeEach(() => __resetSystemProxyForTests());

test('Chromium\'s proxy list is read the way Chromium would use it', () => {
  assert.equal(proxyUrlFromChromiumList('DIRECT'), null);
  assert.equal(proxyUrlFromChromiumList('PROXY proxy.corp.example:8080'), 'http://proxy.corp.example:8080');
  assert.equal(proxyUrlFromChromiumList('PROXY 10.0.0.1:3128; DIRECT'), 'http://10.0.0.1:3128');
  assert.equal(proxyUrlFromChromiumList('HTTPS secure.corp.example:443'), 'https://secure.corp.example:443');
  assert.equal(proxyUrlFromChromiumList('DIRECT; PROXY late.example:1'), null, 'DIRECT first means no proxy');
  // SOCKS cannot be expressed as an HTTP CONNECT proxy — skip to the next usable entry.
  assert.equal(proxyUrlFromChromiumList('SOCKS5 s.example:1080; PROXY p.example:8080'), 'http://p.example:8080');
  assert.equal(proxyUrlFromChromiumList('SOCKS5 s.example:1080'), null);
  for (const junk of ['', '   ', null, undefined, 'PROXY', ';;']) {
    assert.equal(proxyUrlFromChromiumList(junk), null);
  }
});

test('no proxy means the worker environment is not touched at all', () => {
  assert.equal(workerEnvForProxy(null, { PATH: '/usr/bin' }), undefined);
});

test('a system proxy is handed to the worker with the opt-in Node needs', () => {
  const env = workerEnvForProxy('http://proxy.corp.example:8080', { PATH: '/usr/bin', Path: 'C:\\Windows' });
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.corp.example:8080');
  assert.equal(env.HTTP_PROXY, 'http://proxy.corp.example:8080');
  assert.equal(env.PATH, '/usr/bin', 'the rest of the environment is kept');
  assert.equal(env.Path, 'C:\\Windows', 'including Windows\' own casing of PATH');
});

test('a proxy the user configured themselves wins over the system\'s', () => {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const env = workerEnvForProxy('http://system.example:1', { [key]: 'http://mine.example:2' });
    assert.equal(env.NODE_USE_ENV_PROXY, '1');
    assert.equal(env[key], 'http://mine.example:2');
    assert.notEqual(env.HTTPS_PROXY, 'http://system.example:1');
  }
});

test('the lookup remembers the answer', async () => {
  assert.equal(await refreshSystemProxy(async () => 'PROXY p.example:8080'), 'http://p.example:8080');
  assert.equal(getCachedSystemProxy(), 'http://p.example:8080');
  assert.equal(await refreshSystemProxy(async () => 'DIRECT'), null, 'leaving the proxied network clears it');
  assert.equal(getCachedSystemProxy(), null);
});

test('the lookup never rejects and never blocks a download', async () => {
  await refreshSystemProxy(async () => 'PROXY p.example:8080');
  // A resolver that throws keeps the previous answer.
  assert.equal(await refreshSystemProxy(async () => { throw new Error('no session'); }), 'http://p.example:8080');
  // A resolver that never answers is abandoned at the deadline.
  const started = Date.now();
  assert.equal(await refreshSystemProxy(() => new Promise(() => {}), 60), 'http://p.example:8080');
  assert.ok(Date.now() - started < 1500, 'bounded by the timeout, not by the resolver');
  // No Electron session at all (unit tests, early startup).
  assert.equal(await refreshSystemProxy(null), 'http://p.example:8080');
});
