// CR-07 (code-review, 2026-08-21): the `msg.finished` branch closed the socket
// and then set `this.ws = null`. The socket's own 'close' event fires AFTER
// that, so the F-203 identity guard (`ws !== this.ws`, and this.ws is now null)
// returns early — BEFORE the close handler's clearKeepAlive(). One 5s interval
// leaked per finished session, for the life of the process.
//
// Same strategy the repo already uses for NativelyProSTTCloseUpstreamTimers:
// load the compiled class, force a REAL timer handle onto the instance, invoke
// the REAL teardown, and assert the field is cleared.
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

const { SonioxStreamingSTT } = await import(pathToFileURL(path.join(distRoot, 'SonioxStreamingSTT.js')).href);

/** A socket stand-in that records close() — the real ws is bundled into dist. */
const fakeSocket = () => { const s = { closed: 0, close() { this.closed++; } }; return s; };

describe('a FINISHED session must not leak its keep-alive interval', () => {
  test('closeFinishedSession clears the keep-alive timer', () => {
    const stt = new SonioxStreamingSTT('cr07-key', 'mic');
    const sock = fakeSocket();
    stt.ws = sock;

    // A REAL interval, exactly as startKeepAlive creates.
    stt.startKeepAlive();
    assert.notEqual(stt.keepAliveTimer, null, 'precondition: a keep-alive timer must be running');

    stt.closeFinishedSession();

    try {
      assert.equal(sock.closed, 1, 'the socket must be closed');
      assert.equal(stt.keepAliveTimer, null,
        'the keep-alive interval leaked: the close handler cannot clear it, because nulling this.ws '
        + 'makes the F-203 identity guard return first');
      assert.equal(stt.ws, null, 'the socket reference must be released so the next audio reconnects');
      assert.equal(stt.configSent, false, 'config must be re-sent on the next connection');
    } finally {
      // If this regresses, the LEAKED interval keeps the runner's event loop
      // alive and the process hangs instead of reporting — the bug hiding its
      // own failure. Clear it unconditionally so a regression reports cleanly.
      stt.clearTimers?.();
      stt.clearKeepAlive?.();
    }
  });

  test('it is safe to call with no socket (idempotent teardown)', () => {
    const stt = new SonioxStreamingSTT('cr07-key', 'mic');
    stt.ws = null;
    assert.doesNotThrow(() => stt.closeFinishedSession());
    assert.equal(stt.keepAliveTimer, null);
  });

  test('the finished branch routes through the shared teardown', () => {
    // The bug was duplicated teardown logic drifting from the close handler's.
    // Pin that the branch calls the ONE named helper rather than re-inlining it.
    const src = origLoad('fs').readFileSync(
      path.resolve(__dirname, '../SonioxStreamingSTT.ts'), 'utf8');
    const codeOnly = src.split('\n').map((l) => l.replace(/\s*\/\/.*$/, '')).join('\n');
    const i = codeOnly.indexOf('if (msg.finished)');
    assert.notEqual(i, -1, 'finished branch not found');
    const branch = codeOnly.slice(i, i + 400);
    assert.match(branch, /this\.closeFinishedSession\(\)/,
      'the finished branch must use the shared teardown, or the two paths drift apart again');
    assert.doesNotMatch(branch, /this\.ws\s*=\s*null/,
      'the finished branch must not null this.ws itself — that is what defeats the close handler');
  });
});
