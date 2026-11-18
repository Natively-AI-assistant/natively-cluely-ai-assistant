// The stale-store failure, found and undone, on Electron's own TLS (2026-11-18, #759).
//
// The failure only exists in BoringSSL, Electron's TLS: Node's OpenSSL picks the
// valid certificate and never complains, so the same test on plain Node proves
// nothing and is skipped there. Run with:
//   npm run build:electron && node scripts/run-with-env.mjs --set ELECTRON_RUN_AS_NODE=1 -- electron --test electron/services/__tests__/ConnectivityStaleStoreElectron2026_11_18.test.mjs
//
// What it proves, with a real handshake and no mocks of the thing under test:
//  1. the list Node ships connects, and the list with an expired twin of the
//     server's intermediate merged in fails with CERT_HAS_EXPIRED;
//  2. the diagnosis calls that exactly, and says the app can heal it;
//  3. dropSystemCertificates() makes the very next request on the DEFAULT list work.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import { createRealProbes } from '../connectivityProbes.ts';
import { diagnoseConnection } from '../connectivityDiagnosis.ts';
import { dropSystemCertificates } from '../../utils/systemCertificates.ts';
import { makeStaleStoreChain } from '../../utils/__tests__/fakeAvChain.mjs';

const skip = process.versions.electron ? false : 'needs Electron\'s TLS (BoringSSL); plain Node verifies this chain';
const chain = makeStaleStoreChain();

async function withServer(fn) {
  const server = https.createServer({ key: chain.serverKeyPem, cert: chain.serverPem }, (_req, res) => res.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(server.address().port); } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
}
const fetchDefault = (port) => fetch(`https://localhost:${port}/`).then((r) => r.text()).then(() => 'ok', (e) => e.cause?.code || e.message);

describe('a stale OS store, on Electron', { skip }, () => {
  const stale = [chain.rootPem, chain.expiredIntermediatePem]; // what the old merge produced

  test('Node\'s list connects, the merged list does not, and the diagnosis says so and offers the undo', async () => {
    await withServer(async (port) => {
      const probes = createRealProbes({
        port,
        caLists: { builtin: () => [chain.rootPem], merged: () => stale },
        controlUrls: [], env: {}, resolveProxy: async () => 'DIRECT',
        fetchImpl: async () => ({ status: 401 }),
      });
      assert.equal((await probes.tls('localhost', 'builtin')).ok, true);
      const m = await probes.tls('localhost', 'merged');
      assert.equal(m.ok, false);
      assert.equal(m.code, 'CERT_HAS_EXPIRED');

      const d = await diagnoseConnection(probes, 'localhost', { reason: 'pro_check' });
      assert.equal(d.verdict, 'stale_store');
      assert.equal(d.heal, 'drop_system_ca');
      assert.equal(d.report.tls_builtin, 'ok');
      assert.equal(d.report.tls_merged, 'cert_has_expired');
    });
  });

  test('dropSystemCertificates makes the next request on the default list work', async () => {
    const original = tls.getCACertificates('default');
    try {
      tls.setDefaultCACertificates(stale);
      assert.equal(await withServer(fetchDefault), 'CERT_HAS_EXPIRED', 'the bug is present before the undo');
      const done = dropSystemCertificates({
        tls: { getCACertificates: (t) => (t === 'bundled' ? [chain.rootPem] : []), setDefaultCACertificates: (c) => tls.setDefaultCACertificates(c) },
      });
      assert.equal(done, true);
      assert.equal(await withServer(fetchDefault), 'ok', 'and gone after it');
    } finally {
      tls.setDefaultCACertificates(original);
    }
  });
});
