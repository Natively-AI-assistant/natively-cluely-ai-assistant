/**
 * Phase 2: the child-side sandbox.
 *
 * These verify what the sandbox REFUSES. The header of `host/sandbox.ts` is
 * explicit that this is defence in depth against a sloppy extension and not a
 * boundary against a hostile one; nothing here should be read as claiming
 * otherwise. What it must do is turn undeclared capability use into a loud,
 * attributable error instead of silent success.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const { installSandbox, createChildProcessShim, createBrokeredFetch } = require(
  path.join(repoRoot, 'dist-electron/electron/services/extensions/host/sandbox.js'),
);

/** Captures the loader handler instead of patching the real Module._load. */
function fakeLoader() {
  const box = { handler: null };
  return {
    patch: { intercept(handler) { box.handler = handler; } },
    load(id) { return box.handler(id); },
  };
}

function install(overrides = {}) {
  const loader = fakeLoader();
  const target = {};
  const report = installSandbox({
    granted: ['filesystem.models'],
    preauthorizedBinaries: [],
    callBroker: async () => ({ status: 200, statusText: 'OK', headers: [], bodyBase64: '' }),
    target,
    moduleLoader: loader.patch,
    ...overrides,
  });
  return { loader, target, report };
}

test('raw network modules are removed, including their node: aliases', () => {
  const { loader } = install();
  for (const id of ['net', 'tls', 'dgram', 'http', 'https', 'http2', 'node:net', 'node:https']) {
    assert.throws(() => loader.load(id), /not available to extensions/, `${id} should be blocked`);
  }
});

test('modules an extension legitimately needs still resolve', () => {
  const { loader } = install();
  for (const id of ['fs', 'path', 'os', 'node:path', 'onnxruntime-node']) {
    assert.equal(loader.load(id).handled, false, `${id} should pass through`);
  }
});

test('fetch is replaced and socket-flavoured globals are removed', () => {
  const target = { fetch: 'original', WebSocket: class {}, XMLHttpRequest: class {} };
  const { report } = install({ target });
  assert.equal(typeof target.fetch, 'function');
  assert.notEqual(target.fetch, 'original');
  assert.equal('WebSocket' in target, false);
  assert.equal('XMLHttpRequest' in target, false);
  assert.deepEqual(report.stubbedGlobals, ['fetch']);
});

// ── child_process ─────────────────────────────────────────────────────────

test('child_process is replaced by a shim that refuses every shell-capable export', () => {
  const { loader } = install();
  const shim = loader.load('child_process').value;
  for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawnSync', 'fork']) {
    assert.equal(typeof shim[name], 'function', `${name} should exist so the refusal is explicit`);
    assert.throws(() => shim[name](), /not available to extensions/, `${name} should refuse`);
  }
});

test('spawn requires the process.spawn permission', () => {
  const shim = createChildProcessShim(new Set(['filesystem.models']), ['llama-server']);
  assert.throws(() => shim.spawn('llama-server'), /requires the "process\.spawn" permission/);
});

test('spawn refuses a binary outside the pre-authorised set', () => {
  const shim = createChildProcessShim(new Set(['process.spawn']), ['llama-server']);
  assert.throws(() => shim.spawn('bash'), /not in this extension's "allowedBinaries"/);
  assert.throws(() => shim.spawn('/bin/sh'), /not in this extension's "allowedBinaries"/);
});

// A name no machine can have. NOT a real tool name.
//
// This test used to authorise and spawn `llama-server`, on the reasoning that
// it "does not exist" so Node would report ENOENT and nothing would run. That
// is true on CI and false on any developer machine with llama.cpp installed —
// which is precisely the machines that work on the reranker extensions. There,
// `shim.spawn('llama-server')` launched a REAL server with no arguments, whose
// stdio pipes then held the test runner open: 11 of 12 assertions passing, zero
// failures, and the FILE hanging for ~590s until the runner killed it.
//
// Measured both ways: with llama-server off PATH the file exits on its own;
// with it installed it hangs. So the fixture must be a name that cannot resolve
// anywhere, and it must never be swapped for something plausible.
const UNSPAWNABLE = 'natively-test-nonexistent-binary';

test('an authorised binary spawns, and the Windows .exe suffix is tolerated', () => {
  const shim = createChildProcessShim(new Set(['process.spawn']), [UNSPAWNABLE]);
  for (const name of [UNSPAWNABLE, `${UNSPAWNABLE}.exe`]) {
    const child = shim.spawn(name);
    assert.ok(child, `${name} should be authorised`);
    // ENOENT arrives asynchronously; swallow it so it is not an unhandled error.
    child.on('error', () => {});
    // Deliberately NOT calling child.kill(): on a child whose spawn failed,
    // `pid` is undefined and Node signals the CURRENT PROCESS GROUP, which
    // takes down the test runner. Adapter authors hit the same trap.
    //
    // Nothing else is needed to release the runner — proven by the off-PATH
    // run above — because a spawn that never started owns no live handles.
  }
});

test('the spawn fixture cannot be a binary that might actually exist', () => {
  // The guard for the bug above. A future edit that "tidies" the fixture back
  // to a real tool name reintroduces a silent 590s hang on developer machines
  // and stays green on CI, which is the worst possible split.
  assert.doesNotMatch(UNSPAWNABLE, /^(llama|node|sh|bash|python|git|curl)/,
    'the fixture must not be a name any machine could resolve');
  // Resolved by scanning PATH in Node, NOT by shelling out to `which`.
  // `which` does not exist on Windows (it is `where`), so execFileSync threw
  // ENOENT there, the catch set resolved=false, and the assertion passed for
  // every possible fixture name — the guard was vacuous on half the supported
  // platforms, which is the same shape as the bug it exists to catch.
  //
  // PATHEXT is honoured because the test above deliberately spawns
  // `${UNSPAWNABLE}.exe`, so the executable forms have to be checked too.
  const exts = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const resolved = dirs.some(d => exts.some(ext => {
    try { return fs.statSync(path.join(d, UNSPAWNABLE + ext)).isFile(); }
    catch { return false; }
  }));
  assert.equal(resolved, false, `${UNSPAWNABLE} resolves on this machine — pick a name that cannot`);
  // And the scan must be capable of finding something, or it proves nothing.
  // `node` is running this file, so it is on PATH by construction.
  const canFindAnything = dirs.some(d => exts.some(ext => {
    try { return fs.statSync(path.join(d, 'node' + ext)).isFile(); } catch { return false; }
  }));
  assert.ok(canFindAnything, 'the PATH scan found no `node` — it cannot resolve anything, so it proves nothing');
});

// ── fetch ─────────────────────────────────────────────────────────────────

test('brokered fetch asks the broker for the exact host and port', async () => {
  const seen = [];
  const fetchFn = createBrokeredFetch(async (request, payload) => {
    seen.push({ request, payload });
    return { status: 204, statusText: 'No Content', headers: [], bodyBase64: '' };
  });

  await fetchFn('https://huggingface.co/api/models');
  await fetchFn('http://127.0.0.1:8080/rerank', { method: 'POST', body: '{}' });

  assert.deepEqual(seen[0].request, { kind: 'network.connect', host: 'huggingface.co', port: 443 });
  assert.deepEqual(seen[1].request, { kind: 'network.connect', host: '127.0.0.1', port: 8080 });
  assert.equal(seen[1].payload.init.method, 'POST');
});

test('a broker denial surfaces as a rejected fetch naming the reason', async () => {
  const fetchFn = createBrokeredFetch(async () => {
    throw new Error('host "evil.com" is not in the manifest allowlist');
  });
  await assert.rejects(() => fetchFn('https://evil.com/x'), /not in the manifest allowlist/);
});

test('the proxied response is reconstructed with status, headers and body', async () => {
  const fetchFn = createBrokeredFetch(async () => ({
    status: 201,
    statusText: 'Created',
    headers: [['content-type', 'application/json']],
    bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
  }));

  const response = await fetchFn('https://huggingface.co/x');
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { ok: true });
});

test('fetch rejects a malformed URL before consulting the broker', async () => {
  let called = false;
  const fetchFn = createBrokeredFetch(async () => { called = true; return {}; });
  await assert.rejects(() => fetchFn('not-a-url'), /could not parse the URL/);
  await assert.rejects(() => fetchFn(undefined), /requires a URL string/);
  assert.equal(called, false);
});
