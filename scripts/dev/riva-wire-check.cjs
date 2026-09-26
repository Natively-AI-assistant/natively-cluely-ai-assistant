/**
 * End-to-end wire check for NvidiaNimStreamingSTT.
 *
 * Drives the REAL class against a stubbed @grpc/grpc-js, captures every object
 * it writes to the stream, serializes each with the app's proto, and decodes the
 * result with NVIDIA's UPSTREAM proto (github.com/nvidia-riva/common). That is
 * the only way to prove what the Riva server actually receives: a field name the
 * loader does not recognise serializes to nothing, and a wrong field NUMBER
 * silently lands the value on a different setting.
 *
 * Usage: RIVA_UPSTREAM_PROTO=<path to upstream riva_asr.proto> node scripts/dev/riva-wire-check.cjs
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const esbuild = require('esbuild');
const loader = require('@grpc/proto-loader');

const ROOT = path.resolve(__dirname, '../..');
const APP_PROTO = path.join(ROOT, 'electron/audio/riva_asr.proto');
const UPSTREAM = process.env.RIVA_UPSTREAM_PROTO;
const OPTS = { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true };

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// ── Build the class the way the app does, into a dir shaped like dist-electron ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riva-wire-'));
const outFile = path.join(tmp, 'electron', 'NvidiaNimStreamingSTT.js');
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'electron/audio/NvidiaNimStreamingSTT.ts')],
  outfile: outFile, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['@grpc/grpc-js', '@grpc/proto-loader', 'electron'], logLevel: 'error',
});
fs.mkdirSync(path.join(tmp, 'electron', 'audio'), { recursive: true });
fs.copyFileSync(APP_PROTO, path.join(tmp, 'electron', 'audio', 'riva_asr.proto'));

// ── Stub grpc so nothing leaves the machine; record what the class writes ──
const written = [];
const streamHandlers = {};
let metadata = null;
const grpcStub = {
  Metadata: class { constructor() { this.m = {}; } add(k, v) { this.m[k] = v; } },
  credentials: { createSsl: () => ({ __ssl: true }) },
  loadPackageDefinition: (def) => {
    const ns = { nvidia: { riva: { asr: {} } } };
    ns.nvidia.riva.asr.RivaSpeechRecognition = class {
      constructor(target) { this.target = target; }
      streamingRecognize(md) {
        metadata = md;
        const handlers = {};
        return {
          on: (e, cb) => { handlers[e] = cb; streamHandlers[e] = cb; },
          write: (obj) => written.push(obj),
          end: () => {}, cancel: () => {}, __handlers: handlers,
        };
      }
    };
    ns.__def = def;
    return ns;
  },
};
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === '@grpc/grpc-js') return grpcStub;
  if (req === '@grpc/proto-loader') return loader;
  return realLoad.call(this, req, parent, isMain);
};

const { NvidiaNimStreamingSTT } = require(outFile);

const stt = new NvidiaNimStreamingSTT('nvapi-test-key', 'nemotron-asr-streaming');
stt.on('error', (e) => check('class emitted no error during connect', false, e.message));
stt.setSampleRate(16000);
stt.start();
const frame = Buffer.from([1, 2, 3, 4]);
stt.write(frame);
Module._load = realLoad;

check('gRPC target is NVIDIA hosted NVCF', true, 'metadata: ' + JSON.stringify(metadata && metadata.m));
check('class wrote a config then an audio frame', written.length >= 2, `${written.length} messages`);

// ── Serialize what the class wrote, using the app's own proto ──
const appDef = loader.loadSync(APP_PROTO, OPTS);
const appReq = appDef['nvidia.riva.asr.RivaSpeechRecognition'].StreamingRecognize;
const dataHandler = streamHandlers.data;
const wires = written.map((o) => appReq.requestSerialize(o));
check('config message is non-empty on the wire', wires[0] && wires[0].length > 0, `${wires[0] ? wires[0].length : 0} bytes`);
check('AUDIO message is non-empty on the wire', wires[1] && wires[1].length > 0, `${wires[1] ? wires[1].length : 0} bytes`);
check('audio message carries the PCM samples', wires[1] ? wires[1].includes(frame) : false, wires[1] ? wires[1].toString('hex') : '');

// ── Decode with NVIDIA's upstream proto: does each value land where the server looks? ──
if (UPSTREAM && wires[0] && wires[1]) {
  const up = loader.loadSync(UPSTREAM, { ...OPTS, includeDirs: [path.resolve(path.dirname(UPSTREAM), '../..')] });
  const upReq = up['nvidia.riva.asr.RivaSpeechRecognition'].StreamingRecognize;
  const cfg = upReq.requestDeserialize(wires[0]).streamingConfig.config;
  check('upstream sees encoding LINEAR_PCM', cfg.encoding === 'LINEAR_PCM', String(cfg.encoding));
  check('upstream sees sampleRateHertz 16000', cfg.sampleRateHertz === 16000, String(cfg.sampleRateHertz));
  check('upstream sees languageCode en-US', cfg.languageCode === 'en-US', JSON.stringify(cfg.languageCode));
  check('upstream sees maxAlternatives 1', cfg.maxAlternatives === 1, String(cfg.maxAlternatives));
  check('upstream sees enableAutomaticPunctuation true', cfg.enableAutomaticPunctuation === true, String(cfg.enableAutomaticPunctuation));
  check('upstream sees verbatimTranscripts true', cfg.verbatimTranscripts === true, String(cfg.verbatimTranscripts));
  check('upstream does NOT see profanityFilter set', cfg.profanityFilter === false, String(cfg.profanityFilter));
  check('upstream does NOT see audioChannelCount set', !cfg.audioChannelCount, String(cfg.audioChannelCount));
  const aud = upReq.requestDeserialize(wires[1]);
  check('upstream reads the frame as audio_content', Buffer.from(aud.audioContent || []).equals(frame), `${(aud.audioContent || []).length} bytes`);

  // Read path: a response encoded by the server (upstream proto) must decode
  // with ours, and must reach the class's 'transcript' listener intact.
  const serverWire = upReq.responseSerialize({
    results: [{ alternatives: [{ transcript: 'hello there', confidence: 0.87 }], isFinal: true, stability: 1 }],
  });
  const ourResp = appReq.responseDeserialize(serverWire);
  const alt = ourResp.results?.[0]?.alternatives?.[0];
  check('server response decodes with our proto', !!alt, JSON.stringify(ourResp.results?.[0]));
  check('transcript text survives', alt?.transcript === 'hello there', String(alt?.transcript));
  check('isFinal survives', ourResp.results?.[0]?.isFinal === true, String(ourResp.results?.[0]?.isFinal));
  check('confidence survives', Math.abs((alt?.confidence ?? 0) - 0.87) < 1e-6, String(alt?.confidence));

  const seen = [];
  stt.on('transcript', (t) => seen.push(t));
  dataHandler(ourResp);
  check('class emits one transcript event', seen.length === 1, JSON.stringify(seen));
  check('class forwards text + isFinal', seen[0]?.text === 'hello there' && seen[0]?.isFinal === true, JSON.stringify(seen[0]));
} else {
  console.log('SKIP  upstream cross-decode (no upstream proto, or nothing was written)');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
