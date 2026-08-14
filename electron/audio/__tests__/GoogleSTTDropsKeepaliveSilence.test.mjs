// Regression test for the "Google STT transcribes chipmunk 'he he hehehe'" bug.
//
// Symptom: after switching the STT provider to Google (service-account JSON),
// audio transcribed as garbled tiny fragments — "he", "heh", "hehehe" — while
// the SAME audio devices produced correct transcripts on Deepgram/Natively.
//
// Root cause (verified against native-module/src/): the Rust DSP injects pure
// zero-filled keepalive frames into the emitted PCM stream
// (FrameAction::SendSilence -> `vec![0u8; chunk_size*2]`, lib.rs). For SYSTEM
// audio the suppressor runs with VAD disabled and a permissive RMS floor, so it
// oscillates between real low-amplitude `Send` frames and these silent
// keepalives. Deepgram/Natively endpoint cleanly on the zero frames; Google's
// streamingRecognize instead hallucinates short interim tokens from the
// real-audio/silence interleaving. The audio sample RATE is correct and
// declared correctly to Google — the keepalive interleaving is the defect.
//
// Fix: GoogleSTT.write() drops all-zero chunks before they reach the gRPC
// stream (and before they can drive the lazy-reconnect / writeCount path).
// Google holds the stream open via its own 10s idle timeout and write()
// lazily reconnects on the next real chunk, so the keepalive is pure poison
// here with no upside.
//
// Strategy: load the compiled GoogleSTT.js. With no stream started, real chunks
// take the buffering branch (this.buffer grows, this.writeCount increments).
// An all-zero keepalive chunk must be dropped *before* either happens. We assert
// on this.buffer.length and this.writeCount — the directly observable effects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// GoogleSTT's ctor does `new SpeechClient({ keyFilename })`. With NO credentials,
// google-auth-library probes the GCE metadata server to discover a project — a
// background lookup that rejects asynchronously, AFTER these synchronous tests
// finish, and (depending on timing) aborts the shared test process with exit 13,
// flakily poisoning sibling test files. We only exercise the pure write()/
// keepalive logic and never make a real RPC, so the deterministic fix is to give
// google-auth a syntactically valid dummy service-account key file: with a key
// file present it uses it directly and NEVER probes the metadata server. No
// network, no async rejection, no flakiness. Belt-and-braces: also swallow any
// stray auth rejection (real ones can't occur — we never call an RPC).
const DUMMY_KEY = path.join(os.tmpdir(), `natively-stt-test-sa-${process.pid}.json`);
fs.writeFileSync(
  DUMMY_KEY,
  JSON.stringify({
    type: 'service_account',
    project_id: 'natively-stt-test',
    private_key_id: 'test',
    // Not a real key — never used because no RPC is issued in these tests.
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADAN\n-----END PRIVATE KEY-----\n',
    client_email: 'test@natively-stt-test.iam.gserviceaccount.com',
    client_id: '0',
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
);
process.env.GOOGLE_APPLICATION_CREDENTIALS = DUMMY_KEY;
process.env.GOOGLE_SDK_NODE_LOGGING = 'off';
process.on('unhandledRejection', (err) => {
  const msg = String(err && (err.message || err));
  if (/metadata|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|could not load the default credentials|GoogleAuth|fetch failed|network timeout|invalid_grant|DECODER|private key/i.test(msg)) {
    return; // expected: stray SpeechClient auth artifact; no RPC is ever made
  }
  throw err;
});
process.on('exit', () => { try { fs.unlinkSync(DUMMY_KEY); } catch { /* ignore */ } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const { GoogleSTT } = await import(path.join(distRoot, 'GoogleSTT.js'));

// A realistic system-audio chunk size: 5760 bytes = 2880 i16 samples.
const CHUNK_BYTES = 5760;

function makeStt() {
  const stt = new GoogleSTT('test');
  // Mark active so write() proceeds past the isActive guard, but DON'T start a
  // real gRPC stream — we want write() to take the buffering branch where the
  // observable effects (buffer growth, writeCount) live.
  stt.isActive = true;
  // Stub startStream so the lazy-connect inside the buffering branch never
  // constructs a real SpeechClient stream / touches the network.
  stt.startStream = function patchedStartStream() { /* no-op */ };
  return stt;
}

test('GoogleSTT.write() drops an all-zero keepalive chunk (not buffered, writeCount unchanged)', () => {
  const stt = makeStt();
  const silence = Buffer.alloc(CHUNK_BYTES, 0);

  stt.write(silence);

  assert.equal(
    stt.buffer.length,
    0,
    'BUG: an all-zero keepalive chunk was buffered/forwarded to Google. It must be dropped — ' +
    'interleaving zero frames with real audio is what makes Google emit "hehehe" fragments.',
  );
  assert.equal(
    stt.writeCount,
    0,
    'BUG: a keepalive chunk incremented writeCount — it must be dropped before the write path so ' +
    'it cannot drive lazy-reconnect or be counted as real audio.',
  );

  stt.stop?.();
});

test('GoogleSTT.write() forwards real (non-zero) audio — even a single non-zero sample is enough', () => {
  const stt = makeStt();

  // A chunk that is all zero EXCEPT one non-zero sample. Real audio is never
  // bit-exactly zero across a whole frame (noise floor / dither), so the drop
  // must be conservative: any non-zero byte => real audio => forward.
  const almostSilent = Buffer.alloc(CHUNK_BYTES, 0);
  almostSilent[CHUNK_BYTES - 2] = 1; // one non-zero i16 LSB near the end

  stt.write(almostSilent);

  assert.equal(
    stt.buffer.length,
    1,
    'BUG: a chunk containing real audio (one non-zero sample) was dropped as if it were a keepalive. ' +
    'The all-zero check must scan the WHOLE buffer and never strided — dropping real audio loses transcript.',
  );
  assert.equal(stt.writeCount, 1, 'real audio must increment writeCount');

  stt.stop?.();
});

test('GoogleSTT.write() keeps real audio while dropping interleaved keepalives (the actual runtime pattern)', () => {
  const stt = makeStt();
  const real = Buffer.alloc(CHUNK_BYTES, 7);     // non-zero throughout
  const silence = Buffer.alloc(CHUNK_BYTES, 0);  // keepalive

  // Mimic the system-audio oscillation: real, silence, real, silence, real.
  stt.write(real);
  stt.write(silence);
  stt.write(real);
  stt.write(silence);
  stt.write(real);

  assert.equal(
    stt.buffer.length,
    3,
    `BUG: expected exactly the 3 real chunks to be buffered and both keepalives dropped — got ${stt.buffer.length}.`,
  );
  assert.equal(stt.writeCount, 3, 'only the 3 real chunks should count toward writeCount');

  stt.stop?.();
});

test('GoogleSTT.write() treats an empty buffer as silence (defensive, dropped)', () => {
  const stt = makeStt();
  stt.write(Buffer.alloc(0));
  assert.equal(stt.buffer.length, 0, 'an empty chunk carries no audio and must not be forwarded');
  assert.equal(stt.writeCount, 0, 'an empty chunk must not count as real audio');
  stt.stop?.();
});
