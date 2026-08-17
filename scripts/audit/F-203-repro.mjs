// F-203 repro: Google/Soniox/Deepgram lack the stale-connection identity
// guard that NativelyProSTT documents as CRITICAL.
//
// NativelyProSTT wraps every handler in `if (ws !== this.ws) return;` because
// "a delayed event from a previously-closed WebSocket can mutate
// this.isConnected / this.isConnecting / fire scheduleReconnect against the
// new ws's state". Google, Soniox and Deepgram close over `this` only.
//
// GoogleSTT is the universal fallback (six no-API-key paths in
// createSTTProvider land on it). Its restart paths — setSampleRate /
// setAudioChannelCount / setRecognitionLanguage and the 270s proactive
// restart — all do a SYNCHRONOUS stop()+start(): stop() destroys the old
// gRPC stream, start() assigns a brand-new one, and then the destroyed
// stream's 'close'/'end' fires one tick later and runs
// `this.stream = null; this.isStreaming = false;` — nulling the FRESH
// stream. The new stream is orphaned (still open, never ended) and writes
// fall into the lazy-reconnect path, opening a third. main.ts calls
// setSampleRate on the first audio chunk of EVERY meeting.
//
// Harness: the real GoogleSTT class from the dist bundle with its private
// `client` swapped for a fake whose streamingRecognize() returns a
// controllable stream (no credentials, no network).
//
// Expected (correct): after the restart, this.stream is the live NEW stream
// → exit 0. Bug (F-203): the stale close handler nulls it → exit 1.
//
// Run: node scripts/audit/F-203-repro.mjs   (requires npm run build:electron)
import Module from 'node:module';
import path from 'node:path';
import { EventEmitter } from 'node:events';
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

const created = [];
class FakeStream extends EventEmitter {
  constructor(id) { super(); this.id = id; this.destroyed = false; this.ended = false; }
  write() { return true; }
  end() { this.ended = true; }
  destroy() {
    this.destroyed = true;
    // Real gRPC/Node streams emit 'close' ASYNCHRONOUSLY after destroy().
    setImmediate(() => this.emit('close'));
  }
}
const fakeClient = {
  streamingRecognize() {
    const s = new FakeStream(created.length + 1);
    created.push(s);
    return s;
  },
};

const { GoogleSTT } = await import(path.join(distRoot, 'GoogleSTT.js'));
const stt = new GoogleSTT('audit');
stt.on('error', () => {});
stt.client = fakeClient; // swap transport, keep all real logic

stt.start();
const first = stt.stream;
if (!first || created.length !== 1) {
  console.error('[F-203] Inconclusive: initial stream not created', { created: created.length });
  process.exit(2);
}

// The restart path main.ts triggers on the first audio chunk of every meeting.
stt.setSampleRate(48000);

const freshRightAfter = stt.stream;
const freshId = freshRightAfter?.id ?? null;
if (!freshRightAfter || freshRightAfter === first) {
  console.error('[F-203] Inconclusive: restart did not create a new stream', { freshId });
  process.exit(2);
}

// Let the destroyed stream's async 'close' land.
await new Promise((r) => setImmediate(() => setImmediate(r)));

const after = stt.stream;
console.log('[F-203] streams created:', created.length,
  '| fresh stream id after restart:', freshId,
  '| this.stream after stale close fired:', after ? `stream#${after.id}` : 'NULL',
  '| isStreaming:', stt.isStreaming);

try { stt.stop(); } catch { /* teardown */ }

if (after === null || after === undefined) {
  console.error(`[F-203] FAIL: the discarded stream's close handler nulled the LIVE stream#${freshId} — it is orphaned (open, never ended) and the next write opens a third (F-203 reproduced).`);
  process.exit(1);
}
if (after !== freshRightAfter) {
  console.error('[F-203] FAIL: this.stream was replaced by stale-handler side effects.');
  process.exit(1);
}
console.log('[F-203] PASS: the stale close handler left the live stream intact.');
process.exit(0);
