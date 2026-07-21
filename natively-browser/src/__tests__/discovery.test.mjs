// Tests for the auto-pairing primitives: resolveLivePort (port discovery via
// /healthz) and fetchPairToken (the one-click /pair handshake). Both are pure
// relative to an injected fetch, so no browser/chrome.* is needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../dist-test/service-worker.js');
const { resolveLivePort, fetchPairToken } = await import(pathToFileURL(modPath).href);

// Build a fake fetch where only the given ports answer /healthz with {ok:true}.
function healthFetch(livePorts, opts = {}) {
  const calls = [];
  const fn = async (url, _init) => {
    calls.push(url);
    const m = url.match(/127\.0\.0\.1:(\d+)\/healthz/);
    if (m && livePorts.includes(Number(m[1]))) {
      return { status: 200, json: async () => ({ ok: true, clients: 0 }) };
    }
    if (opts.throwOnDead) throw new Error('ECONNREFUSED');
    return { status: 200, json: async () => ({ ok: false }) }; // wrong body → not live
  };
  fn.calls = calls;
  return fn;
}

describe('resolveLivePort', () => {
  test('finds the live port within 4123..4134', async () => {
    const f = healthFetch([4125], { throwOnDead: true });
    assert.equal(await resolveLivePort(f), 4125);
  });

  test('tries the hint first (fast path)', async () => {
    const f = healthFetch([4123, 4130]);
    const port = await resolveLivePort(f, 4130);
    assert.equal(port, 4130);
    assert.match(f.calls[0], /:4130\/healthz/); // hint probed first
  });

  test('returns null when nothing responds (Phone Mirror off)', async () => {
    const f = healthFetch([], { throwOnDead: true });
    assert.equal(await resolveLivePort(f), null);
  });

  test('ignores a 200 with ok:false (not a real PhoneMirror)', async () => {
    const f = healthFetch([]); // every port returns ok:false
    assert.equal(await resolveLivePort(f), null);
  });

  test('ignores an out-of-range hint and still scans the range', async () => {
    const f = healthFetch([4123]);
    assert.equal(await resolveLivePort(f, 9999), 4123);
  });
});

describe('fetchPairToken', () => {
  const ok = (body) => async () => ({ status: 200, json: async () => body });
  const status = (code) => async () => ({ status: code, json: async () => ({}) });

  test('200 with a token → paired', async () => {
    const out = await fetchPairToken(4123, ok({ token: 'A'.repeat(32), port: 4123 }));
    assert.equal(out.kind, 'paired');
    assert.equal(out.token, 'A'.repeat(32));
  });

  test('200 with a too-short token → error (not paired)', async () => {
    const out = await fetchPairToken(4123, ok({ token: 'short' }));
    assert.equal(out.kind, 'error');
  });

  test('410 → not-armed', async () => {
    const out = await fetchPairToken(4123, status(410));
    assert.equal(out.kind, 'not-armed');
  });

  test('403 → forbidden', async () => {
    const out = await fetchPairToken(4123, status(403));
    assert.equal(out.kind, 'forbidden');
  });

  test('fetch throw (refused) → refused', async () => {
    const out = await fetchPairToken(4123, async () => { throw new Error('ECONNREFUSED'); });
    assert.equal(out.kind, 'refused');
  });
});
