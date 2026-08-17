// F-204 regression test (audit/autopilot-2026-08-18).
//
// setSampleRate must reconnect exactly when the auth frame has already
// committed the OLD rate server-side. That frame is sent in ws.on('open'),
// but the old gate used `isConnected`, which only flips on the SERVER's
// {status:'connected'} reply — one round-trip later. The window
// readyState===OPEN && !isConnected was therefore silently un-reconnected:
// the server transcoded at the stale rate while bytes arrived at the new one
// (garbled transcripts, no error). Reproduced in scripts/audit/F-204-repro.mjs.
//
// The negative cases matter just as much: the block's comment documents that
// reconnecting while null/CONNECTING wastes a TLS round-trip and logs a
// spurious "closed before the connection was established" — the open handler
// will read the updated rate anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getAppPath: () => '/tmp/fake', isReady: () => false, getPath: () => '/tmp' } };
  }
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { NativelyProSTT } = await import(path.join(distRoot, 'NativelyProSTT.js'));

function probe({ readyState, isConnected }) {
  const stt = new NativelyProSTT('audit-key', 'system');
  stt.on('error', () => {});
  let closed = false;
  stt.isActive = true;
  stt.isConnected = isConnected;
  stt.ws = readyState === null ? null : {
    readyState,
    removeAllListeners() {}, on() {}, send() {},
    close() { closed = true; },
  };
  stt.setSampleRate(48000);
  const scheduled = !!stt.pendingConnectTimer || closed || stt.intentionalClose === true;
  if (stt.pendingConnectTimer) clearTimeout(stt.pendingConnectTimer);
  return scheduled;
}

test('OPEN but not yet server-confirmed DOES reconnect (auth frame already committed the rate)', () => {
  assert.equal(probe({ readyState: 1, isConnected: false }), true,
    'the auth frame commits sample_rate in ws.on(open); a later rate change must force a reconnect (F-204)');
});

test('server-confirmed connection reconnects (unchanged behaviour)', () => {
  assert.equal(probe({ readyState: 1, isConnected: true }), true);
});

test('CONNECTING does NOT reconnect (open handler will read the new rate)', () => {
  assert.equal(probe({ readyState: 0, isConnected: false }), false,
    'reconnecting pre-handshake wastes a TLS round-trip and logs a spurious abort error');
});

test('no socket does NOT reconnect', () => {
  assert.equal(probe({ readyState: null, isConnected: false }), false);
});
