// F-204 repro: NativelyProSTT.setSampleRate's gate diverges from its own
// comment, so a rate change is SKIPPED in the window where it matters most.
//
// The comment says only two pre-handshake states need no reconnect:
// `this.ws === null` and `readyState === CONNECTING` ("WS open, but auth
// frame not sent yet — the open handler reads the updated rate"). The code
// instead gates on `isActive && isConnected`, and isConnected only flips when
// the SERVER's {status:'connected'} frame arrives — one full round-trip AFTER
// the auth frame (which commits sample_rate) was sent in ws.on('open').
//
// In the window readyState===OPEN && !isConnected the old rate is already
// committed server-side, yet setSampleRate returns without reconnecting: the
// server keeps transcoding at the stale rate while the bytes arrive at the
// new one — the sped-up/slowed-down garbage transcript the comment warns
// about, with no error and no reconnect. main.ts calls setSampleRate on the
// first system chunk (~5-7s after start on macOS CoreAudio Tap), so the
// window is real whenever the relay is slow to confirm.
//
// Expected (correct): a rate change while OPEN-but-unconfirmed triggers the
// reconnect → exit 0. Bug (F-204): silently skipped → exit 1.
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getAppPath: () => '/tmp/fake', isReady: () => false, getPath: () => '/tmp' } };
  }
  if (request.endsWith('.node') || request.includes('native-module')) return {};
  return origLoad.apply(this, arguments);
};

const { NativelyProSTT } = await import(path.join(distRoot, 'NativelyProSTT.js'));
const stt = new NativelyProSTT('audit-key', 'system');
stt.on('error', () => {});

let closed = false;
stt.isActive = true;
stt.isConnected = false;               // server has NOT confirmed yet
stt.ws = {                              // auth frame already sent in 'open'
  readyState: 1,                        // WebSocket.OPEN
  removeAllListeners() {},
  on() {},
  close() { closed = true; },
  send() {},
};

stt.setSampleRate(48000);               // differs from the default

const reconnectScheduled = !!stt.pendingConnectTimer || closed || stt.intentionalClose === true;
console.log('[F-204] OPEN-but-unconfirmed rate change →',
  { closedUpstream: closed, intentionalClose: stt.intentionalClose === true, reconnectScheduled });

if (stt.pendingConnectTimer) clearTimeout(stt.pendingConnectTimer);

if (!reconnectScheduled) {
  console.error('[F-204] FAIL: rate change skipped while the auth frame had already committed the OLD rate — server transcodes at the stale rate (F-204 reproduced).');
  process.exit(1);
}
console.log('[F-204] PASS: rate change reconnects once the auth frame is committed.');
process.exit(0);
