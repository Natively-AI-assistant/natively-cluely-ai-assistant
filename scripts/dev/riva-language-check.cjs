/**
 * language_code is documented Required by Riva. This asserts every
 * model x recognition-language combination the UI can produce sends a
 * non-empty code, and that 'auto' resolves to the model's own default
 * ('multi' auto-detect for the multilingual profiles).
 */
const path = require('path'); const fs = require('fs'); const os = require('os');
const Module = require('module'); const esbuild = require('esbuild');
const loader = require('@grpc/proto-loader');

const ROOT = path.resolve(__dirname, '../..');
let failures = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) failures++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riva-lang-'));
const outFile = path.join(tmp, 'electron', 'NvidiaNimStreamingSTT.js');
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'electron/audio/NvidiaNimStreamingSTT.ts')],
  outfile: outFile, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['@grpc/grpc-js', '@grpc/proto-loader', 'electron'], logLevel: 'error',
});
fs.mkdirSync(path.join(tmp, 'electron', 'audio'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'electron/audio/riva_asr.proto'), path.join(tmp, 'electron', 'audio', 'riva_asr.proto'));

let last = null;
const grpcStub = {
  Metadata: class { constructor() { this.m = {}; } add(k, v) { this.m[k] = v; } },
  credentials: { createSsl: () => ({}) },
  loadPackageDefinition: () => ({ nvidia: { riva: { asr: { RivaSpeechRecognition: class {
    streamingRecognize(md) { last = { md, writes: [] };
      return { on: () => {}, write: (o) => last.writes.push(o), end: () => {}, cancel: () => {} }; }
  } } } } }),
};
const realLoad = Module._load;
Module._load = function (r, p, m) {
  if (r === '@grpc/grpc-js') return grpcStub;
  if (r === '@grpc/proto-loader') return loader;
  return realLoad.call(this, r, p, m);
};
const mod = require(outFile);
const { NvidiaNimStreamingSTT, NVIDIA_NIM_STT_MODELS } = mod;

const sent = (model, lang) => {
  const stt = new NvidiaNimStreamingSTT('k', model);
  stt.on('error', () => {});
  if (lang !== undefined) stt.setRecognitionLanguage(lang);
  stt.start();
  return last.writes.find((w) => w.streamingConfig).streamingConfig.config;
};

check('catalogue is non-empty', NVIDIA_NIM_STT_MODELS.length > 0, `${NVIDIA_NIM_STT_MODELS.length} models`);

// Every function-id must be a real uuid and must not be duplicated except by the
// two Nemotron profiles, which deliberately share one NIM.
const byFn = {};
for (const m of NVIDIA_NIM_STT_MODELS) {
  check(`${m.id}: function-id is a uuid`, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.functionId), m.functionId);
  (byFn[m.functionId] = byFn[m.functionId] || []).push(m.id);
}
for (const [fn, ids] of Object.entries(byFn)) {
  if (ids.length > 1) check(`shared function-id ${fn.slice(0,8)} is the Nemotron pair only`, ids.every((i) => i.startsWith('nemotron')), ids.join(' + '));
}

for (const m of NVIDIA_NIM_STT_MODELS) {
  for (const lang of [undefined, 'auto', 'english-us', 'spanish', 'nonsense-key']) {
    const cfg = sent(m.id, lang);
    check(`${m.id} / lang=${lang ?? '(unset)'} sends a non-empty language_code`,
      typeof cfg.languageCode === 'string' && cfg.languageCode.length > 0, JSON.stringify(cfg.languageCode));
  }
  const auto = sent(m.id, 'auto');
  check(`${m.id} / auto uses the model default`, auto.languageCode === m.languageCode, `${auto.languageCode} (expected ${m.languageCode})`);
  if (m.singleLocale) {
    // A pin must NOT override a single-locale deployment.
    const pinned = sent(m.id, 'spanish');
    check(`${m.id} ignores a language pin (single locale)`, pinned.languageCode === m.languageCode, `${pinned.languageCode} (expected ${m.languageCode})`);
  }
  check(`${m.id} uses its own function-id`, last.md.m['function-id'] === m.functionId, last.md.m['function-id']);
}

const multi = NVIDIA_NIM_STT_MODELS.filter((m) => m.multilingual);
check('multilingual profiles default to Riva auto-detect', multi.every((m) => m.languageCode === 'multi'), multi.map((m) => `${m.id}=${m.languageCode}`).join(', '));
const en = sent('nemotron-asr-streaming', 'auto');
check('English profile defaults to en-US', en.languageCode === 'en-US', en.languageCode);
const pinned = sent('parakeet-1.1b-rnnt-multilingual-asr', 'spanish');
check('a pinned language overrides the default on a MULTILINGUAL model', pinned.languageCode === 'es-ES', pinned.languageCode);
const unknownLang = sent('parakeet-1.1b-rnnt-multilingual-asr', 'nonsense-key');
check('an unknown language key falls back to the model default', unknownLang.languageCode === 'multi', unknownLang.languageCode);
const unknownModel = sent('not-a-model', 'auto');
check('unknown model falls back without crashing', unknownModel.languageCode === 'en-US', unknownModel.languageCode);

Module._load = realLoad;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
