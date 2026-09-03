/**
 * Two holes that only open once the sandbox is actually installed.
 *
 * Both were invisible to the existing tests because those call the factories
 * directly — `createChildProcessShim()` without `installSandbox()`, so the
 * `Module._load` patch is never in play.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const { createExtensionHost } = require(path.join(repoRoot, 'dist-electron/electron/services/extensions/ExtensionHost.js'));

// ── the authorised spawn path must not recurse ────────────────────────────

test('an authorised spawn works AFTER the sandbox is installed', () => {
  // Reproduced in a child process, because installSandbox() patches
  // Module._load for the whole process and this runner needs its own.
  //
  // The bug: the shim's spawn called require('child_process'), which goes
  // through the very patch that returns the shim, so `real.spawn` WAS the
  // shim's own spawn — infinite recursion, RangeError, and the only path that
  // is supposed to work was the one that could not. Both llama.cpp-backed
  // reranker extensions depend on it.
  const sandboxPath = path.join(repoRoot, 'dist-electron/electron/services/extensions/host/sandbox.js');
  const script = `
    const { installSandbox } = require(${JSON.stringify(sandboxPath)});
    // The authorised binary is whatever THIS runner is, not the literal
    // "node": npm test runs these under ELECTRON_RUN_AS_NODE=1 electron, so
    // process.execPath is Electron and a hardcoded 'node' would refuse the one
    // spawn the test needs to succeed. normalizeBinary() takes the basename.
    installSandbox({ granted: ['process.spawn'], preauthorizedBinaries: [${JSON.stringify(path.basename(process.execPath))}], brokerFetch: async () => { throw new Error('unused'); } });
    const cp = require('child_process');
    const child = cp.spawn(process.execPath, ['-e', 'process.exit(0)']);
    if (typeof child.pid !== 'number') { console.log('NO_PID'); process.exit(1); }
    console.log('SPAWN_OK');
  `;
  let out;
  try {
    out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20_000 });
  } catch (e) {
    const combined = String(e.stdout ?? '') + String(e.stderr ?? '');
    assert.ok(!/Maximum call stack/i.test(combined),
      'the authorised spawn recursed — the shim must not require() its own patched module');
    throw new Error(`authorised spawn failed: ${combined.slice(0, 400)}`);
  }
  assert.match(out, /SPAWN_OK/);
});

test('an unauthorised binary is still refused after the sandbox is installed', () => {
  const sandboxPath = path.join(repoRoot, 'dist-electron/electron/services/extensions/host/sandbox.js');
  const script = `
    const { installSandbox } = require(${JSON.stringify(sandboxPath)});
    installSandbox({ granted: ['process.spawn'], preauthorizedBinaries: ['llama-server'], brokerFetch: async () => { throw new Error('unused'); } });
    try { require('child_process').spawn('curl', []); console.log('LEAKED'); }
    catch (e) { console.log(/allowedBinaries/.test(e.message) ? 'REFUSED' : 'OTHER:' + e.message); }
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20_000 });
  assert.match(out, /REFUSED/, 'the fix must not open the allowlist');
});

// ── the sandbox must gate ESM, not only require() ─────────────────────────

test('an ESM import of child_process still goes through the shim', () => {
  // THE hole this closes. bootstrap.ts loads extensions with dynamic import(),
  // and all three shipped extensions are `"type": "module"` doing
  // `import { spawn } from 'child_process'`. An ESM import of a builtin never
  // passes through Module._load, so before registerHooks() the shim and the
  // whole BLOCKED_MODULES list were unenforced for the format extensions
  // actually use — while the install prompt still promised those permissions
  // were being checked.
  const sandboxPath = path.join(repoRoot, 'dist-electron/electron/services/extensions/host/sandbox.js');
  const script = `
    import { installSandbox } from ${JSON.stringify(pathToFileURL(sandboxPath).href)};
    // The authorised binary is whatever THIS runner is, not the literal
    // "node": npm test runs these under ELECTRON_RUN_AS_NODE=1 electron, so
    // process.execPath is Electron and a hardcoded 'node' would refuse the one
    // spawn the test needs to succeed. normalizeBinary() takes the basename.
    installSandbox({ granted: ['process.spawn'], preauthorizedBinaries: [${JSON.stringify(path.basename(process.execPath))}], brokerFetch: async () => { throw new Error('unused'); } });
    const cp = await import('child_process');
    try { cp.spawn('curl', []); console.log('LEAKED'); }
    catch (e) { console.log(/allowedBinaries/.test(e.message) ? 'REFUSED' : 'OTHER'); }
    const child = cp.spawn(process.execPath, ['-e', 'process.exit(0)']);
    console.log(typeof child.pid === 'number' ? 'AUTHORISED_OK' : 'NO_PID');
    try { await import('net'); console.log('NET_LEAKED'); }
    catch (e) { console.log(/not available to extensions/.test(e.message) ? 'NET_BLOCKED' : 'NET_OTHER'); }
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.match(out, /REFUSED/, 'an unauthorised binary must still be refused over ESM');
  assert.match(out, /AUTHORISED_OK/, 'an authorised binary must still work over ESM');
  assert.match(out, /NET_BLOCKED/, 'BLOCKED_MODULES must apply to ESM too');
});

test('the host tells the child to stop, it does not just give up locally', () => {
  // The child used to build an AbortController nothing ever aborted, so every
  // extension's `opts.signal.aborted` check was permanently false and work
  // continued past the host's deadline.
  const hostSrc = fs.readFileSync(path.join(repoRoot, 'electron/services/extensions/ExtensionHost.ts'), 'utf8');
  const bootSrc = fs.readFileSync(path.join(repoRoot, 'electron/services/extensions/host/bootstrap.ts'), 'utf8');
  assert.match(hostSrc, /kind: 'cancel', cancelId: id/, 'the host must send a cancel');
  // Both failure paths must cancel, not just one — a timeout and an explicit
  // abort leave the child in the same state.
  assert.equal((hostSrc.match(/cancelChild\(\);/g) || []).length, 2,
    'cancelChild() must be called on BOTH the timeout and the abort path');
  assert.match(bootSrc, /case 'cancel':/, 'the child must handle it');
  assert.match(bootSrc, /inFlight\.get\(cancelId\)\?\.abort\(\)/, 'and actually abort that call');
  assert.match(bootSrc, /inFlight\.set\(id, controller\)/, 'tracking the controller per request id');
});

// ── the approved host must bind the actual fetch ──────────────────────────

function makeHost({ allowedHosts = ['api.example.com'], permissions = ['network.remote'] } = {}) {
  const decisions = [];
  return {
    decisions,
    host: createExtensionHost({
      manifest: {
        id: 'probe', name: 'Probe', version: '1.0.0', apiVersion: '1', type: 'reranker',
        entrypoint: 'dist/index.js', author: 'a', homepage: 'https://x.example',
        engines: { natively: '*' }, permissions, allowedHosts, models: [],
      },
      extensionDir: '/tmp/probe',
      modelDir: '/tmp/probe-models',
      broker: {
        decide: (_grant, request) => {
          decisions.push(request);
          if (request.kind !== 'network.connect') return { allowed: true };
          return allowedHosts.includes(request.host)
            ? { allowed: true }
            : { allowed: false, reason: `host ${request.host} is not in allowedHosts` };
        },
      },
      config: {},
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onCrash: () => {},
    }),
  };
}

const brokered = (url) => ({ request: { kind: 'network.connect', host: 'api.example.com', port: 443 }, payload: { url } });

test('the URL that is fetched is the URL that was approved', async () => {
  // The broker decided on body.request.host; the fetch used body.payload.url,
  // a separate field the child also controls. Asking about an allowed host
  // while passing a URL for another must not work.
  const { host, decisions } = makeHost();
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('fetch must not be reached'); };
  try {
    await assert.rejects(
      () => host.performBrokeredWork(brokered('https://evil.example/steal')),
      /not allowed/,
    );
    assert.ok(decisions.some(d => d.host === 'evil.example'),
      'the decision must be re-taken against the URL actually being fetched');
  } finally {
    globalThis.fetch = original;
  }
});

test('a redirect to an unapproved host is refused, not followed', async () => {
  const { host } = makeHost();
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(String(url));
    assert.equal(init?.redirect, 'manual', 'redirects must not be followed by fetch itself');
    return {
      status: 302,
      statusText: 'Found',
      headers: new Map([['location', 'https://evil.example/payload']]),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  // `headers` needs .get and .entries
  const wrap = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    const r = await wrap(u, i);
    r.headers = { get: (k) => (k.toLowerCase() === 'location' ? 'https://evil.example/payload' : null), entries: () => [] };
    return r;
  };
  try {
    await assert.rejects(
      () => host.performBrokeredWork(brokered('https://api.example.com/ok')),
      /evil\.example is not allowed/,
    );
    assert.deepEqual(seen, ['https://api.example.com/ok'], 'only the approved hop may be fetched');
  } finally {
    globalThis.fetch = original;
  }
});

test('an approved request still succeeds', async () => {
  const { host } = makeHost();
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    statusText: 'OK',
    headers: { get: () => null, entries: () => [['content-type', 'application/json']] },
    arrayBuffer: async () => new TextEncoder().encode('{"ok":true}').buffer,
  });
  try {
    const result = await host.performBrokeredWork(brokered('https://api.example.com/thing'));
    assert.equal(result.status, 200);
    assert.equal(Buffer.from(result.bodyBase64, 'base64').toString('utf8'), '{"ok":true}');
  } finally {
    globalThis.fetch = original;
  }
});
