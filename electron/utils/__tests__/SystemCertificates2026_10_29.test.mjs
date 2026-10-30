// electron/utils/systemCertificates.ts — Node's TLS also trusts the OS
// certificate store (2026-10-29).
//
// A Windows customer's transcription only worked after turning off Kaspersky,
// Defender and the firewall. Antivirus HTTPS scanning re-signs connections
// with a root installed only in the OS store; Chromium trusts it, Node (where
// every STT socket and LLM call lives) did not.
//
// makeFakeAvChain() (fakeAvChain.mjs) builds a throwaway root and a localhost server
// certificate it signs, fresh on every run (no key is kept in the repo). The
// integration tests stand that root in for "the OS store" and connect the same
// ways the app does: `ws` (Natively relay, Soniox, ElevenLabs, OpenAI), Node's WebSocket
// (Deepgram SDK), fetch (LLM SDKs) and https (axios).
//
// Run with: npm run build:electron && node --test electron/utils/__tests__/SystemCertificates2026_10_29.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeFakeAvChain } from './fakeAvChain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { trustSystemCertificates } = require(path.resolve(__dirname, '../../../dist-electron/electron/utils/systemCertificates.js'));
const WebSocketLib = require('ws');

const chain = makeFakeAvChain();
const fakeRoot = chain.rootPem;

function fakeTls({ defaults, system, onSet }) {
  return {
    getCACertificates: (type) => (type === 'system' ? system : defaults),
    setDefaultCACertificates: (certs) => onSet(certs),
  };
}

describe('trustSystemCertificates (injected store)', () => {
  test('appends only the system certificates Node does not already have', () => {
    let set = null;
    const result = trustSystemCertificates({
      tls: fakeTls({ defaults: ['A', 'B'], system: ['B', 'C', 'C\n'], onSet: (c) => { set = c; } }),
      env: {}, log: () => {},
    });
    assert.deepEqual(set, ['A', 'B', 'C']);
    assert.deepEqual(result, { applied: true, systemCount: 3, addedCount: 1 });
  });

  test('changes nothing when the store adds nothing new (second call is a no-op)', () => {
    let calls = 0;
    const result = trustSystemCertificates({
      tls: fakeTls({ defaults: ['A', 'B'], system: ['B'], onSet: () => { calls++; } }),
      env: {}, log: () => {},
    });
    assert.equal(calls, 0);
    assert.equal(result.reason, 'nothing-new');
  });

  test('NATIVELY_SYSTEM_CA=0 keeps the bundled list', () => {
    let calls = 0;
    const result = trustSystemCertificates({
      tls: fakeTls({ defaults: ['A'], system: ['C'], onSet: () => { calls++; } }),
      env: { NATIVELY_SYSTEM_CA: '0' }, log: () => {},
    });
    assert.equal(calls, 0);
    assert.equal(result.reason, 'disabled');
  });

  test('a Node without the CA API is left alone', () => {
    assert.equal(trustSystemCertificates({ tls: {}, env: {}, log: () => {} }).reason, 'unsupported');
  });

  test('a store that cannot be read never throws into startup', () => {
    const logs = [];
    const result = trustSystemCertificates({
      tls: { getCACertificates: () => { throw new Error('store locked'); }, setDefaultCACertificates: () => {} },
      env: {}, log: (m) => logs.push(m),
    });
    assert.equal(result.reason, 'read-failed');
    assert.match(logs[0], /store locked/);
  });

  test('a rejected list never throws into startup', () => {
    const result = trustSystemCertificates({
      tls: fakeTls({ defaults: ['A'], system: ['C'], onSet: () => { throw new Error('bad pem'); } }),
      env: {}, log: () => {},
    });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'set-failed');
  });

  test('the real Node in this Electron has the API (Electron 43 = Node 24)', () => {
    assert.equal(typeof tls.getCACertificates, 'function');
    assert.equal(typeof tls.setDefaultCACertificates, 'function');
    assert.ok(Array.isArray(tls.getCACertificates('system')));
  });
});

describe('a connection re-signed by an antivirus root (real TLS)', () => {
  async function withServer(fn) {
    const server = https.createServer({
      key: chain.serverKeyPem,
      cert: chain.serverPem,
    }, (_req, res) => res.end('ok'));
    new WebSocketLib.WebSocketServer({ server }).on('connection', (socket) => socket.send('hello'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      return await fn(server.address().port);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const probes = {
    ws: (port) => new Promise((resolve) => {
      const ws = new WebSocketLib(`wss://localhost:${port}`);
      ws.on('message', () => { ws.close(); resolve('ok'); });
      ws.on('error', (err) => resolve(err.code || err.message));
    }),
    nodeWebSocket: (port) => new Promise((resolve) => {
      const ws = new WebSocket(`wss://localhost:${port}`);
      ws.onmessage = () => { ws.close(); resolve('ok'); };
      ws.onerror = () => resolve('error');
    }),
    fetch: (port) => fetch(`https://localhost:${port}/`).then((r) => r.text()).then(() => 'ok', (err) => err.cause?.code || err.message),
    https: (port) => new Promise((resolve) => {
      https.get(`https://localhost:${port}/`, (res) => { res.resume(); resolve('ok'); }).on('error', (err) => resolve(err.code));
    }),
  };

  async function probeAll(port) {
    const out = {};
    for (const [name, probe] of Object.entries(probes)) out[name] = await probe(port);
    return out;
  }

  test('fails everywhere before, succeeds everywhere once the OS store is trusted', async () => {
    await withServer(async (port) => {
      const before = await probeAll(port);
      for (const [name, outcome] of Object.entries(before)) {
        assert.notEqual(outcome, 'ok', `${name} must reject the unknown root before the fix`);
      }
      assert.match(before.ws, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);

      // The fake root stands in for what Kaspersky installs in the Windows store.
      const result = trustSystemCertificates({
        tls: {
          getCACertificates: (type) => (type === 'system' ? [fakeRoot] : tls.getCACertificates(type)),
          setDefaultCACertificates: (certs) => tls.setDefaultCACertificates(certs),
        },
        env: {}, log: () => {},
      });
      assert.equal(result.applied, true);
      assert.equal(result.addedCount, 1);

      const after = await probeAll(port);
      assert.deepEqual(after, { ws: 'ok', nodeWebSocket: 'ok', fetch: 'ok', https: 'ok' });
    });
  });
});
