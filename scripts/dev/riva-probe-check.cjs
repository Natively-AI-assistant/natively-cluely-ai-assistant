/**
 * probeNvidiaNimStt must settle on every terminal outcome a real Riva stream
 * can produce. The bug this covers: it only listened for 'data', so a valid key
 * (which yields a clean half-close and no results for 100ms of silence) sat for
 * the full 15s timeout and was reported to the user as a connection failure.
 */
const path = require('path'); const fs = require('fs'); const os = require('os');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '../..');
let failures = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) failures++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riva-probe-'));
const outFile = path.join(tmp, 'probe.cjs');
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'electron/audio/nvidiaNimSttProbe.ts')],
  outfile: outFile, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['@grpc/grpc-js', '@grpc/proto-loader', 'electron'], logLevel: 'error',
});
const { probeNvidiaNimStt } = require(outFile);

/** A stub stream that fires `event` on the next tick, like grpc-js would. */
const stubStream = (script) => {
  const h = {};
  const s = {
    writes: [], cancelled: false,
    once: (e, cb) => { h[e] = cb; },
    write: (o) => s.writes.push(o),
    end: () => { setImmediate(() => script(h)); },
    cancel: () => { s.cancelled = true; },
  };
  return s;
};

const run = async (name, script, expect) => {
  let captured;
  const started = Date.now();
  const res = await probeNvidiaNimStt('nvapi-key', 'nemotron-asr-streaming', (key, fnId) => {
    captured = { key, fnId };
    return stubStream(script);
  });
  const ms = Date.now() - started;
  check(`${name}: ${expect.success ? 'succeeds' : 'fails'}`, res.success === expect.success, JSON.stringify(res));
  if (expect.error) check(`${name}: reports the server's reason`, (res.error || '').includes(expect.error), res.error);
  check(`${name}: settles promptly (no 15s timeout)`, ms < 2000, `${ms}ms`);
  return captured;
};

(async () => {
  // The regression: server accepts the key, sends no results, closes cleanly.
  const cap = await run('clean close with no results', (h) => h.end(), { success: true });
  check('probe used the selected model\'s function-id', cap.fnId === 'bb0837de-8c7b-481f-9ec8-ef5663e9c1fa', cap.fnId);
  check('probe forwarded the api key', cap.key === 'nvapi-key', cap.key);

  await run('OK status with no data', (h) => h.status({ code: 0 }), { success: true });
  await run('a result arrives', (h) => h.data({ results: [] }), { success: true });
  await run('bad credentials', (h) => h.error(Object.assign(new Error('16 UNAUTHENTICATED'), { details: 'invalid bearer token' })),
    { success: false, error: 'invalid bearer token' });
  await run('non-OK status', (h) => h.status({ code: 7, details: 'PERMISSION_DENIED: bad function-id' }),
    { success: false, error: 'PERMISSION_DENIED' });

  // Config the probe puts on the wire.
  let stream;
  await probeNvidiaNimStt('k', 'parakeet-1.1b-rnnt-multilingual-asr', (key, fnId) => {
    stream = stubStream((h) => h.end()); stream.fnId = fnId; return stream;
  });
  check('probe targets parakeet\'s own function-id', stream.fnId === '71203149-d3b7-4460-8231-1be2543a1fca', stream.fnId);
  const cfg = stream.writes.find((w) => w.streamingConfig)?.streamingConfig?.config;
  check('probe sends a non-empty language_code', !!cfg?.languageCode, JSON.stringify(cfg?.languageCode));
  check('probe sends audio as audioContent', stream.writes.some((w) => Buffer.isBuffer(w.audioContent)), JSON.stringify(Object.keys(stream.writes[1] || {})));
  check('probe cancels the stream when done', stream.cancelled === true);

  // An unknown model must not blow up.
  const unknown = await probeNvidiaNimStt('k', 'not-a-model', () => stubStream((h) => h.end()));
  check('unknown model falls back instead of throwing', unknown.success === true, JSON.stringify(unknown));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
