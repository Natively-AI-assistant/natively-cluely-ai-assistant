/**
 * Behaviour check for NvidiaNimStreamingSTT's stream lifecycle: a gRPC stream
 * that dies mid-meeting must reconnect, the audio buffered across the gap must
 * stay bounded, a dead stream's late events must not clobber its replacement,
 * and stop() must not leave a reconnect queued.
 */
const path = require('path'); const fs = require('fs'); const os = require('os');
const Module = require('module'); const esbuild = require('esbuild');
const loader = require('@grpc/proto-loader');

const ROOT = path.resolve(__dirname, '../..');
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riva-recon-'));
const outFile = path.join(tmp, 'electron', 'NvidiaNimStreamingSTT.js');
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'electron/audio/NvidiaNimStreamingSTT.ts')],
  outfile: outFile, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['@grpc/grpc-js', '@grpc/proto-loader', 'electron'], logLevel: 'error',
});
fs.mkdirSync(path.join(tmp, 'electron', 'audio'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'electron/audio/riva_asr.proto'), path.join(tmp, 'electron', 'audio', 'riva_asr.proto'));

const streams = [];
const grpcStub = {
  Metadata: class { add() {} },
  credentials: { createSsl: () => ({}) },
  loadPackageDefinition: () => ({ nvidia: { riva: { asr: { RivaSpeechRecognition: class {
    streamingRecognize() {
      const h = {};
      const s = { h, written: [], ended: false,
        on: (e, cb) => { h[e] = cb; }, write: (o) => s.written.push(o),
        end: () => { s.ended = true; }, cancel: () => {} };
      streams.push(s); return s;
    }
  } } } } }),
};
const realLoad = Module._load;
Module._load = function (r, p, m) {
  if (r === '@grpc/grpc-js') return grpcStub;
  if (r === '@grpc/proto-loader') return loader;
  return realLoad.call(this, r, p, m);
};
const { NvidiaNimStreamingSTT } = require(outFile);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (n) => Buffer.alloc(n, 7);

(async () => {
  const stt = new NvidiaNimStreamingSTT('nvapi-test', 'nemotron-asr-streaming');
  const errors = [];
  stt.on('error', (e) => errors.push(e.message));
  stt.start();
  check('connects on start()', streams.length === 1, `${streams.length} stream(s)`);
  stt.write(frame(100));
  check('audio goes to the live stream', streams[0].written.filter((w) => w.audioContent).length === 1);

  // ── The stream dies mid-meeting ──
  streams[0].h.error(new Error('14 UNAVAILABLE: connection closed'));
  check('surfaces the stream error', errors.length === 1, errors[0]);

  // ── Audio during the gap must be buffered, but BOUNDED ──
  for (let i = 0; i < 400; i++) stt.write(frame(32 * 1024)); // ~12.8 MB offered
  const buffered = stt.buffer.reduce((n, b) => n + b.length, 0);
  check('gap buffer stays bounded', buffered <= 160 * 1024, `${(buffered / 1024).toFixed(0)} KB retained of 12800 KB offered`);
  check('still only one stream before the backoff elapses', streams.length === 1, `${streams.length}`);

  // ── Reconnect fires after the 1s base backoff ──
  await sleep(1300);
  check('reconnected after backoff', streams.length === 2, `${streams.length} stream(s)`);
  const cfg = streams[1].written.filter((w) => w.streamingConfig);
  check('re-sends the recognition config on the new stream', cfg.length === 1, JSON.stringify(cfg[0] && cfg[0].streamingConfig.config));
  stt.write(frame(64));
  check('audio flows on the new stream', streams[1].written.filter((w) => w.audioContent).length >= 1);

  // ── A dead stream's late events must not clobber the live one ──
  streams[0].h.end();
  streams[0].h.error(new Error('late error from the dead stream'));
  stt.write(frame(64));
  const onNew = streams[1].written.filter((w) => w.audioContent).length;
  check('late events from the dead stream are ignored', onNew >= 2, `${onNew} frames on the live stream`);
  check('no spurious error from the dead stream', errors.length === 1, JSON.stringify(errors));

  // ── stop() must not leave a reconnect queued ──
  streams[1].h.error(new Error('dies again'));
  stt.stop();
  const before = streams.length;
  await sleep(1300);
  check('stop() cancels the pending reconnect', streams.length === before, `${streams.length} vs ${before}`);
  check('stop() ends the stream and clears the buffer', stt.buffer.length === 0);

  Module._load = realLoad;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
