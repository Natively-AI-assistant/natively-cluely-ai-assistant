// The real probes behind the connection check, against local servers — no
// internet, no OS store, so macOS and Windows run the same cases.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { createRealProbes } from '../connectivityProbes.ts';
import { classifyIssuer } from '../connectivityDiagnosis.ts';
import { makeFakeAvChain } from '../../utils/__tests__/fakeAvChain.mjs';

const chain = makeFakeAvChain();
let server; let port;
before(async () => {
  server = https.createServer({ key: chain.serverKeyPem, cert: chain.serverPem }, (req, res) => { res.setHeader('Date', new Date(2_000_000_000_000).toUTCString()); res.writeHead(401); res.end('{}'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise((r) => server.close(r)));

const base = () => ({ port, caLists: { builtin: () => [], merged: () => [chain.rootPem] }, controlUrls: [`https://localhost:${port}/`], env: {}, resolveProxy: async () => 'DIRECT' });

describe('tls', () => {
  test('a root the list lacks → a certificate code, and who signed it', async () => {
    const r = await createRealProbes(base()).tls('localhost', 'builtin');
    assert.equal(r.ok, false);
    assert.match(r.code, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
    assert.equal(r.issuer, 'Natively Test Antivirus Root');
  });
  test('the same server with the root in the list → ok', async () => {
    const r = await createRealProbes(base()).tls('localhost', 'merged');
    assert.equal(r.ok, true);
  });
  test('nothing listening → ECONNREFUSED, no issuer', async () => {
    const dead = await new Promise((res) => { const s = https.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    const r = await createRealProbes({ ...base(), port: dead }).tls('localhost', 'merged');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ECONNREFUSED');
    assert.equal(r.issuer, undefined);
  });
});

describe('the rest', () => {
  test('dns: a name that resolves is ok; one that does not names the error', async () => {
    const p = createRealProbes(base());
    assert.equal((await p.dns('localhost')).ok, true);
    const bad = await p.dns('no-such-host.invalid');
    assert.equal(bad.ok, false);
    assert.ok(['ENOTFOUND', 'EAI_AGAIN'].includes(bad.code), bad.code);
  });
  test('control: reachable without trusting anyone, with the server\'s own clock', async () => {
    const r = await createRealProbes(base()).control();
    assert.equal(r.ok, true);
    assert.equal(r.serverTime, 2_000_000_000_000);
  });
  test('control: nothing reachable → not ok', async () => {
    const r = await createRealProbes({ ...base(), controlUrls: ['https://no-such-host.invalid/'] }).control();
    assert.equal(r.ok, false);
  });
  test('control: switched off by an empty list → unknown, with no request made', async () => {
    const r = await createRealProbes({ ...base(), controlUrls: [] }).control();
    assert.deepEqual(r, { ok: false, unknown: true });
  });
  test('proxy: direct → none; a proxy chosen by the system → system; an environment proxy → env', async () => {
    assert.equal(await createRealProbes(base()).proxy(), 'none');
    assert.equal(await createRealProbes({ ...base(), resolveProxy: async () => 'PROXY corp:8080' }).proxy(), 'system');
    assert.equal(await createRealProbes({ ...base(), env: { HTTPS_PROXY: 'http://x:1' } }).proxy(), 'env');
    assert.equal(await createRealProbes({ ...base(), resolveProxy: async () => { throw new Error('x'); } }).proxy(), 'none');
  });
  test('the issuer found by tls is turned into a fixed name, never echoed', async () => {
    const r = await createRealProbes(base()).tls('localhost', 'builtin');
    assert.equal(classifyIssuer(r.issuer), 'other');
  });
});
