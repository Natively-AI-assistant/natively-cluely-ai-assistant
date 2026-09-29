// F-201 repro: removeAllListeners() before close() on a CONNECTING WebSocket
// escalates to a process-level uncaughtException — which main.ts answers with
// emergencyCloseDatabase() (irreversible; on this branch the process then
// KEEPS RUNNING with dead persistence).
//
// ws@8 close() on a CONNECTING socket routes through abortHandshake(), which
// unconditionally emits 'error' on the next tick ("WebSocket was closed
// before the connection was established"). OpenAIStreamingSTT's 10s
// connection timer strips ALL listeners and then close()s — the emit finds
// no listener and Node promotes it to uncaughtException. The same
// strip-then-close shape exists in the 5s session timer, _closeWs,
// ElevenLabs stop(), and NativelyProSTT.closeUpstream() (main's 21c4e22f
// fixed the last one; this branch predates it — see the merge advisory).
//
// Harness: REAL ws module, URL rewritten to a local TCP server that accepts
// and never responds (socket stays CONNECTING; the 10s timer wins the race
// against dnsHelpers' 15s handshakeTimeout, exactly as in production).
//
// Expected (correct): no uncaughtException — the abort error is consumed →
// exit 0. Bug (F-201): uncaughtException within ~12s → exit 1.
//
// Run: node scripts/audit/F-201-repro.mjs   (requires npm run build:electron)
import Module from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../dist-electron/electron/audio');
const require_ = createRequire(import.meta.url);

// Stalled server: accept TCP, never complete the WS handshake.
const server = net.createServer(() => { /* hold the socket open, say nothing */ });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// esbuild INLINES ws into the dist bundle, so hooking require('ws') is
// useless — but Node BUILTINS stay as real requires, and ws performs its
// handshake through https.request. Redirect that to the stalled server: the
// TLS client waits forever for a ServerHello, the socket stays CONNECTING,
// and the provider's 10s timer fires exactly as on a real stalled network.
const realHttps = require_('node:https');
const redirect = (fn) => (opts, ...rest) => {
  const o = typeof opts === 'string' ? { path: opts } : { ...opts };
  o.host = '127.0.0.1';
  o.hostname = '127.0.0.1';
  o.port = port;
  delete o.lookup;
  o.rejectUnauthorized = false;
  return fn.call(realHttps, o, ...rest);
};
const httpsShim = { ...realHttps, request: redirect(realHttps.request), get: redirect(realHttps.get) };

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'https' || request === 'node:https') return httpsShim;
  if (request === 'electron') {
    return { app: { isPackaged: false, getAppPath: () => '/tmp/fake', isReady: () => false, getPath: () => '/tmp' } };
  }
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const uncaught = [];
process.on('uncaughtException', (err) => {
  uncaught.push(String(err?.message ?? err));
});

const { OpenAIStreamingSTT } = await import(pathToFileURL(path.join(distRoot, 'OpenAIStreamingSTT.js')).href);
const stt = new OpenAIStreamingSTT('sk-audit-fake-key');
stt.on('error', () => {}); // instance-level errors are expected and fine
stt.start();

// The 10s connection timer must fire while the socket is still CONNECTING.
await new Promise((r) => setTimeout(r, 12_000));

try { stt.stop(); } catch { /* teardown best-effort */ }
server.close();
await new Promise((r) => setTimeout(r, 500));

console.log('[F-201] uncaughtException count:', uncaught.length, uncaught.slice(0, 3));
if (uncaught.some((m) => /closed before the connection was established/i.test(m))) {
  console.error('[F-201] FAIL: the CONNECTING-cancel abort error escaped as an uncaughtException — in the app this triggers emergencyCloseDatabase with no reopen (F-201 reproduced).');
  process.exit(1);
}
if (uncaught.length > 0) {
  console.error('[F-201] FAIL: unexpected uncaughtException(s):', uncaught);
  process.exit(1);
}
console.log('[F-201] PASS: connection-timeout cancellation was fully contained.');
process.exit(0);
