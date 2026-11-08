// Live 2026-10-16 (user in France, natively_debug 15): the meeting started
// before the call audio did. System audio produced 0 chunks, the only traffic
// was a WebSocket ping (which Soniox does not count), and after ~20 s Soniox
// sent `408 Request timeout` and closed CLEANLY (1000). The close handler read
// 1000 as deliberate and set isActive=false, and write() then dropped every
// chunk: the interviewer side stayed deaf for the rest of the meeting, so
// Auto Answer had nothing to answer.
//
// Pinned here on the compiled class:
//   1. an idle socket sends Soniox's own {"type":"keepalive"} message;
//   2. a socket carrying audio does not;
//   3. the close after a 408 keeps the channel alive (lazy reconnect), a
//      429/5xx backs off, and auth/config errors still end the session.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const origLoad = Module._load;
Module._load = function patchedLoad(request) {
  if (request === 'electron') {
    return { app: { getAppPath: () => '/tmp/fake-natively-app', isPackaged: false, isReady: () => false } };
  }
  return origLoad.apply(this, arguments);
};

const { SonioxStreamingSTT, sonioxCloseAction } = await import(pathToFileURL(path.join(distRoot, 'SonioxStreamingSTT.js')).href);

const OPEN = 1;
/** An open socket stand-in that records what is sent. */
const fakeOpenSocket = () => ({ readyState: OPEN, sent: [], pings: 0, send(x) { this.sent.push(x); }, ping() { this.pings++; }, close() {} });
const keepalives = (sock) => sock.sent.filter((x) => typeof x === 'string' && JSON.parse(x).type === 'keepalive').length;

describe('an idle Soniox socket is kept alive with the control message', () => {
  test('no audio → {"type":"keepalive"} on each tick', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const stt = new SonioxStreamingSTT('k');
    const sock = fakeOpenSocket();
    stt.ws = sock;
    stt.configSent = true;
    stt.lastAudioSentAt = 0;
    try {
      stt.startKeepAlive();
      t.mock.timers.tick(5000);
      t.mock.timers.tick(5000);
      assert.equal(keepalives(sock), 2, 'a silent call must not let Soniox time the session out');
      assert.equal(sock.pings, 2, 'the transport ping still runs');
    } finally {
      stt.clearKeepAlive();
    }
  });

  test('audio flowing → no keepalive message', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const stt = new SonioxStreamingSTT('k');
    const sock = fakeOpenSocket();
    stt.ws = sock;
    stt.configSent = true;
    stt.isActive = true;
    try {
      stt.startKeepAlive();
      for (let i = 0; i < 10; i++) {
        t.mock.timers.tick(1000);
        stt.sendAudio(Buffer.alloc(640));
      }
      assert.equal(keepalives(sock), 0, 'keepalive is only for stretches with no audio frames');
    } finally {
      stt.clearKeepAlive();
    }
  });

  test('before the config frame is sent, nothing but the ping goes out', (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const stt = new SonioxStreamingSTT('k');
    const sock = fakeOpenSocket();
    stt.ws = sock;
    stt.configSent = false;
    try {
      stt.startKeepAlive();
      t.mock.timers.tick(5000);
      assert.equal(keepalives(sock), 0, 'the first message on a Soniox socket must be the config');
    } finally {
      stt.clearKeepAlive();
    }
  });
});

describe('what the close after a server error does', () => {
  test('408 idle timeout → stay active, reconnect on the next audio', () => {
    assert.equal(sonioxCloseAction(true, 1000, 408), 'lazy');
  });
  test('429 and 5xx → backoff ladder, never per chunk', () => {
    for (const code of [429, 500, 502, 503]) assert.equal(sonioxCloseAction(true, 1000, code), 'backoff', String(code));
  });
  test('auth, config and billing errors still end the session', () => {
    for (const code of [400, 401, 402, 403]) assert.equal(sonioxCloseAction(true, 1000, code), 'inactive', String(code));
  });
  test('a clean close with no error frame backs off instead of going silent (2026-11-01)', () => {
    // Was 'inactive': the channel stopped with nothing emitted. A finished
    // session never reaches the close handler (closeFinishedSession detaches
    // it), so this close is unexplained; retry, bounded by the max attempts.
    assert.equal(sonioxCloseAction(true, 1000, null), 'backoff');
  });
  test('an unexpected close reconnects as before', () => {
    assert.equal(sonioxCloseAction(true, 1006, null), 'backoff');
  });
  test('a stopped session never reconnects', () => {
    assert.equal(sonioxCloseAction(false, 1000, 408), 'inactive');
    assert.equal(sonioxCloseAction(false, 1006, null), 'inactive');
  });

  test('after the 408 close, the next audio reconnects (the live failure)', () => {
    const stt = new SonioxStreamingSTT('k');
    let connects = 0;
    stt.connect = () => { connects++; };
    stt.isActive = true;
    stt.shouldReconnect = true;
    stt.ws = null;
    stt.configSent = false;
    stt.isConnecting = false;
    stt.write(Buffer.alloc(640));
    assert.equal(connects, 1, 'an active session with no socket must reconnect on audio');
    assert.equal(stt.buffer.length, 1, 'the chunk is kept for the new socket');
  });
});
