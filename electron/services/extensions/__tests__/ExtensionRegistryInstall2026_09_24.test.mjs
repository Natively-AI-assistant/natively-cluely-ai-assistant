/**
 * Installing an extension from a published registry.
 *
 * This is the only path in Natively that downloads code and writes it where it
 * will later be executed, so these tests are almost entirely about what it
 * REFUSES. Each gate exists because without it the registry becomes a way to
 * run arbitrary code:
 *
 *   - the renderer names an extension, never a URL
 *   - https only, checked on every redirect hop, not once at the start
 *   - a host allowlist
 *   - a byte cap measured while reading, not taken from Content-Length
 *   - sha256 verified BEFORE anything reaches disk
 *
 * A sha256 published by the same registry proves integrity, not authenticity.
 * These tests pin the integrity check; the install trust prompt is what covers
 * the rest, and nothing here bypasses it.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
const base = path.join(repoRoot, 'dist-electron/electron/services/extensions');

const { downloadExtensionPayload, __testing } = require(path.join(base, 'ExtensionPayloadDownloader.js'));
const svc = require(path.join(base, 'extensionRegistryService.js'));

const sha = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex');
const CODE = 'export default class R { async init(){} async rerank(){return []} async dispose(){} }';
const MANIFEST = JSON.stringify({
  id: 'demo-reranker', name: 'Demo', version: '1.0.0', apiVersion: '1', type: 'reranker',
  entrypoint: 'dist/index.js', author: 'community', homepage: 'https://example.com/x',
  engines: { natively: '>=2.8.0' }, permissions: ['filesystem.models'], models: [],
});

const HOST = 'https://objects.githubusercontent.com';
const URLS = { code: `${HOST}/demo.js`, manifest: `${HOST}/demo.json` };
const GOOD = { ...URLS, sha256: { code: sha(CODE), manifest: sha(MANIFEST) } };

/** A fetch whose responses are declared per URL. Nothing touches the network. */
function fakeFetch(routes) {
  return async (url) => {
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    if (r.redirect) {
      return new Response(null, { status: 302, headers: { location: r.redirect } });
    }
    return new Response(r.body, { status: r.status ?? 200 });
  };
}

const okRoutes = { [URLS.code]: { body: CODE }, [URLS.manifest]: { body: MANIFEST } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ext-registry-'));

beforeEach(() => svc.clearRegistryCache());

// ── the downloader's gates ────────────────────────────────────────────────

test('a correct payload is written where the installer expects it', async () => {
  const dir = tmp();
  const r = await downloadExtensionPayload(GOOD, dir, { fetchImpl: fakeFetch(okRoutes) });
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.errors));
  assert.equal(fs.readFileSync(path.join(dir, 'dist/index.js'), 'utf8'), CODE);
  assert.equal(fs.readFileSync(path.join(dir, 'extension.json'), 'utf8'), MANIFEST);
});

test('a sha256 mismatch is refused and leaves NOTHING on disk', async () => {
  const dir = tmp();
  const bad = { ...GOOD, sha256: { ...GOOD.sha256, code: sha('something else') } };
  const r = await downloadExtensionPayload(bad, dir, { fetchImpl: fakeFetch(okRoutes) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /sha256 mismatch/);
  assert.deepEqual(fs.readdirSync(dir), [], 'a failed verification must not write a payload');
});

test('a non-https URL is refused', async () => {
  const dir = tmp();
  const insecure = { ...GOOD, code: 'http://objects.githubusercontent.com/demo.js' };
  const r = await downloadExtensionPayload(insecure, dir, { fetchImpl: fakeFetch(okRoutes) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /https only/);
});

test('a host outside the allowlist is refused', async () => {
  const dir = tmp();
  const evil = { ...GOOD, code: 'https://evil.example.com/demo.js' };
  const r = await downloadExtensionPayload(evil, dir, { fetchImpl: fakeFetch(okRoutes) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /not in the allowlist/);
});

test('a REDIRECT to a disallowed host is refused — the check is per hop', async () => {
  // The whole reason redirects are followed by hand. fetch's own following
  // would resolve this invisibly and only surface the final response.
  const dir = tmp();
  const routes = {
    'https://github.com/r/demo.js': { redirect: 'https://evil.example.com/demo.js' },
    'https://evil.example.com/demo.js': { body: CODE },
    [URLS.manifest]: { body: MANIFEST },
  };
  const r = await downloadExtensionPayload(
    { ...GOOD, code: 'https://github.com/r/demo.js' }, dir, { fetchImpl: fakeFetch(routes) },
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /evil\.example\.com.*not in the allowlist/);
});

test('a redirect WITHIN the allowlist is followed', async () => {
  const dir = tmp();
  const routes = {
    'https://github.com/r/demo.js': { redirect: URLS.code },
    ...okRoutes,
  };
  const r = await downloadExtensionPayload(
    { ...GOOD, code: 'https://github.com/r/demo.js' }, dir, { fetchImpl: fakeFetch(routes) },
  );
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.errors));
});

test('an oversized payload is refused, measured rather than trusted', async () => {
  const dir = tmp();
  const big = 'x'.repeat(5000);
  const routes = { [URLS.code]: { body: big }, [URLS.manifest]: { body: MANIFEST } };
  const r = await downloadExtensionPayload(
    { ...GOOD, sha256: { code: sha(big), manifest: sha(MANIFEST) } },
    dir, { fetchImpl: fakeFetch(routes), maxBytes: 1024 },
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /over the 1024 limit/);
});

test('a redirect loop terminates', async () => {
  const dir = tmp();
  const routes = { [URLS.code]: { redirect: URLS.code }, [URLS.manifest]: { body: MANIFEST } };
  const r = await downloadExtensionPayload(GOOD, dir, { fetchImpl: fakeFetch(routes), maxRedirects: 2 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /too many redirects/);
});

test('a manifest entrypoint that escapes the payload directory is refused', async () => {
  const dir = tmp();
  const evilManifest = JSON.stringify({ ...JSON.parse(MANIFEST), entrypoint: '../../escape.js' });
  const routes = { [URLS.code]: { body: CODE }, [URLS.manifest]: { body: evilManifest } };
  const r = await downloadExtensionPayload(
    { ...GOOD, sha256: { code: sha(CODE), manifest: sha(evilManifest) } },
    dir, { fetchImpl: fakeFetch(routes) },
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /escapes the payload directory/);
});

test('a malformed download block is refused before any request', async () => {
  const dir = tmp();
  let called = false;
  const spy = async (...a) => { called = true; return fakeFetch(okRoutes)(...a); };
  for (const bad of [
    { ...GOOD, sha256: { code: 'nothex', manifest: GOOD.sha256.manifest } },
    { ...GOOD, code: '' },
  ]) {
    const r = await downloadExtensionPayload(bad, dir, { fetchImpl: spy });
    assert.equal(r.ok, false);
  }
  assert.equal(called, false, 'a malformed descriptor must not reach the network');
});

// ── the registry service ──────────────────────────────────────────────────

const registryBody = (extensions) => JSON.stringify({ version: 1, extensions });
const ENTRY = {
  id: 'demo-reranker', repo: 'o/r', version: '1.0.0', apiVersion: '1', category: 'reranker',
  modelLicenses: ['Apache-2.0'], requiresExternalRuntime: ['llama-server'], download: GOOD,
};
const REG_URL = 'https://api.natively.software/v1/extensions/registry.json';

function registryFetch(extensions, extra = {}) {
  const routes = { [REG_URL]: { body: registryBody(extensions) }, ...okRoutes, ...extra };
  return fakeFetch(routes);
}

test('the default registry URL is a product address, not an account', () => {
  // Hardcoding the hosting account would put its name in every shipped
  // app.asar, which anyone can extract. It points at Natively's own API, which
  // proxies rather than redirects — a redirect would leak the upstream in its
  // Location header and undo exactly that.
  assert.equal(svc.DEFAULT_REGISTRY_URL, REG_URL);
  assert.doesNotMatch(svc.DEFAULT_REGISTRY_URL, /github\.com|githubusercontent/);
});

test('a non-https registry URL is refused', () => {
  const r = svc.resolveRegistryUrl('http://natively.software/x.json');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'registry_must_be_https');
});

test('the download block survives the registry read', async () => {
  const snap = await svc.browseRegistry({ fetchImpl: registryFetch([ENTRY]) });
  assert.equal(snap.ok, true);
  assert.equal(snap.entries[0].download.sha256.code, GOOD.sha256.code);
  assert.deepEqual(snap.entries[0].requiresExternalRuntime, ['llama-server']);
  assert.equal(snap.entries[0].latestVersion, '1.0.0', 'version should map to latestVersion');
});

test('a half-formed download block is dropped rather than shown as installable', async () => {
  const broken = { ...ENTRY, download: { code: 'https://x/y.js', manifest: '', sha256: {} } };
  const snap = await svc.browseRegistry({ fetchImpl: registryFetch([broken]) });
  assert.equal(snap.entries[0].download, undefined);
});

test('the registry is cached, and a later failure falls back to the cache', async () => {
  let calls = 0;
  const counting = async (...a) => { calls++; return registryFetch([ENTRY])(...a); };
  await svc.browseRegistry({ fetchImpl: counting });
  const second = await svc.browseRegistry({ fetchImpl: counting });
  assert.equal(calls, 1, 'a fresh cache must not re-fetch');
  assert.equal(second.cached, true);

  const failing = async () => { throw new Error('offline'); };
  const offline = await svc.browseRegistry({ fetchImpl: failing, force: true });
  assert.equal(offline.entries.length, 1, 'an outage must not make the catalogue vanish');
  assert.equal(offline.error, 'registry_unreachable');
});

test('an id absent from the registry is reported as such', async () => {
  const r = await svc.stageFromRegistry('not-there', { fetchImpl: registryFetch([ENTRY]) });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_in_registry');
});

test('an entry with no published build says so', async () => {
  const meta = { ...ENTRY, download: undefined };
  const r = await svc.stageFromRegistry('demo-reranker', { fetchImpl: registryFetch([meta]) });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no_published_build');
});

test('a good entry stages through the SAME path a folder install uses', async () => {
  const staging = tmp();
  const r = await svc.stageFromRegistry('demo-reranker', {
    fetchImpl: registryFetch([ENTRY]), stagingDir: staging,
  });
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r));
  assert.equal(r.manifestJson.id, 'demo-reranker');
  assert.ok(fs.existsSync(path.join(r.payloadDir, 'dist/index.js')));
});

test('a failed download leaves no staging directory behind', async () => {
  const staging = tmp();
  const bad = { ...ENTRY, download: { ...GOOD, sha256: { ...GOOD.sha256, code: sha('nope') } } };
  const r = await svc.stageFromRegistry('demo-reranker', {
    fetchImpl: registryFetch([bad]), stagingDir: staging,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'download_failed');
  assert.equal(fs.existsSync(staging), false, 'a failed install must not leave a payload behind');
});
