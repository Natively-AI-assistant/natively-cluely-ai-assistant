// electron/utils/systemCertificates.ts — a stale Windows store must not break
// chains that verify on Node's own list (2026-11-18, issue #759).
//
// A paying Windows customer's Pro never activated: every main-process fetch to
// api.natively.software failed with "fetch failed", curl.exe and plain Node
// reached it fine, and NATIVELY_SYSTEM_CA=0 fixed it. The merge appended all 58
// certificates their store returned to the default CA list, and the store
// returns more than roots: Windows' "Intermediate Certification Authorities"
// (cross-signatures, issuing CAs) and certificates that expired years ago. In
// BoringSSL (Electron's TLS) everything in that list is a trust-store issuer,
// looked up first and picked by name and key without regard to its dates. An
// expired twin of a certificate the server sends (an old cross-signature has
// the same name and key) is then chosen over the valid one, and the handshake
// fails with CERT_HAS_EXPIRED. api.natively.software serves exactly such a
// chain: leaf -> YE1 -> Root YE (cross) -> ISRG Root X2 (cross) -> ISRG Root X1.
//
// Run with: npm run build:electron && node scripts/run-with-env.mjs --set ELECTRON_RUN_AS_NODE=1 -- electron --test electron/utils/__tests__/SystemCertificatesStaleStore2026_11_18.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeStaleStoreChain } from './fakeAvChain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { trustSystemCertificates } = require(path.resolve(__dirname, '../../../dist-electron/electron/utils/systemCertificates.js'));

const chain = makeStaleStoreChain();

describe('trustSystemCertificates keeps only usable roots from the store', () => {
  test('expired certificates and intermediates are not added', () => {
    let set = null;
    const result = trustSystemCertificates({
      tls: {
        getCACertificates: (type) => (type === 'system'
          ? [chain.expiredRootPem, chain.expiredIntermediatePem, chain.intermediatePem, chain.rootPem]
          : ['BUNDLED']),
        setDefaultCACertificates: (certs) => { set = certs; },
      },
      env: {}, log: () => {},
    });
    assert.deepEqual(set, ['BUNDLED', chain.rootPem]);
    assert.deepEqual(result, { applied: true, systemCount: 4, addedCount: 1 });
  });

  test('a store with nothing usable changes nothing', () => {
    let calls = 0;
    const result = trustSystemCertificates({
      tls: {
        getCACertificates: (type) => (type === 'system' ? [chain.expiredRootPem, chain.intermediatePem] : ['BUNDLED']),
        setDefaultCACertificates: () => { calls++; },
      },
      env: {}, log: () => {},
    });
    assert.equal(calls, 0);
    assert.equal(result.reason, 'nothing-new');
  });

  test('a certificate Node cannot parse is skipped, not thrown into startup', () => {
    let set = null;
    const result = trustSystemCertificates({
      tls: {
        getCACertificates: (type) => (type === 'system' ? ['not a certificate', chain.rootPem] : []),
        setDefaultCACertificates: (certs) => { set = certs; },
      },
      env: {}, log: () => {},
    });
    assert.deepEqual(set, [chain.rootPem]);
    assert.equal(result.addedCount, 1);
  });
});

describe('a chain that verifies on the default list (real TLS)', () => {
  // A fresh server (new port, new ticket keys) per request, so a resumed TLS
  // session can never skip the certificate check being tested.
  async function fetchOnce() {
    const server = https.createServer({ key: chain.serverKeyPem, cert: chain.serverPem }, (_req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      return await fetch(`https://localhost:${server.address().port}/`).then((r) => r.text()).then(() => 'ok', (err) => err.cause?.code || err.message);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('still verifies after the merge when the store holds an expired twin of its intermediate', async () => {
    // The public root stands in for one Node already bundles (ISRG Root X1).
    const defaults = [...tls.getCACertificates('default'), chain.rootPem];
    tls.setDefaultCACertificates(defaults);
    assert.equal(await fetchOnce(), 'ok', 'the chain must verify on the default list');

    trustSystemCertificates({
      tls: {
        getCACertificates: (type) => (type === 'system' ? [chain.expiredIntermediatePem, chain.expiredRootPem] : defaults),
        setDefaultCACertificates: (certs) => tls.setDefaultCACertificates(certs),
      },
      env: {}, log: () => {},
    });
    assert.equal(await fetchOnce(), 'ok');
  });
});
