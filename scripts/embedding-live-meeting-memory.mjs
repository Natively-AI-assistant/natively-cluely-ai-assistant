#!/usr/bin/env node
// scripts/embedding-live-meeting-memory.mjs
//
// R&D ONLY. Memory under a REAL meeting with every local ONNX model resident at
// once. That concurrency is what the nine historical macOS ONNX crash reports
// came from, and the one thing the embedding benchmark had not load-tested
// (docs/local-embedding-benchmark.md §12b, §14).
//
// The real app, in production mode with an isolated profile:
//   1. local Whisper selected as STT, a real meeting started (audio capture
//      and the Whisper worker are live);
//   2. the full benchmark corpus uploaded and indexed during the meeting
//      (embedder worker under ingest load);
//   3. QUERY_COUNT reranked retrievals during the meeting (embedQuery plus
//      the ms-marco cross-encoder);
//   4. the meeting ended.
//
// Throughout, it samples the RSS of the WHOLE process tree (main, renderer,
// GPU, utility helpers) and system available memory (vm_stat's
// free+inactive+speculative, the same metric the ONNX gate uses). Reported:
// per-phase peaks, gate refusals, crashes, sentinel self-poison.
//
// Usage (macOS; the sampler uses ps and vm_stat):
//   LIVE_MODEL=default WHISPER_MODEL=onnx-community/moonshine-base-ONNX node scripts/embedding-live-meeting-memory.mjs
//   LIVE_MODEL=minilm  WHISPER_MODEL=... node scripts/embedding-live-meeting-memory.mjs   (the old default, for the delta)

import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

if (process.platform !== 'darwin') throw new Error('this sampler is macOS-only (ps/vm_stat); Windows needs its own');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(REPO, 'embedding-benchmark', 'corpus');
const MODEL = process.env.LIVE_MODEL || 'default';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'Xenova/whisper-tiny';
const QUERY_COUNT = Number(process.env.QUERY_COUNT || 120);
const PORT = Number(process.env.CDP_PORT || 9811);
const USERDATA = path.join(os.tmpdir(), `natively-live-meeting-${MODEL}-${Date.now()}`);
const CACHE = path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');
const REAL_WHISPER = path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'whisper-models');

const MODELS = {
  default: { env: {}, expectLoad: 'Xenova/multilingual-e5-small' },
  minilm: { env: { NATIVELY_EMBEDDING_EXPERIMENT: 'minilm-baseline', NATIVELY_LOCAL_MODELS_PATH: path.join(CACHE, 'minilm-baseline') }, expectLoad: 'Xenova/all-MiniLM-L6-v2' },
};
const cfg = MODELS[MODEL];
if (!cfg) throw new Error(`unknown LIVE_MODEL ${MODEL}`);

const snap = JSON.parse(fs.readFileSync(path.join(REPO, 'results', 'corpus-snapshot.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── memory sampling ─────────────────────────────────────────────────────────
function availableGB() {
  const out = execFileSync('vm_stat', { encoding: 'utf8' });
  const page = Number((out.match(/page size of (\d+)/) || [])[1] || 16384);
  const n = (k) => Number((out.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1] || 0);
  return ((n('Pages free') + n('Pages inactive') + n('Pages speculative')) * page) / 1024 ** 3;
}
function treeRssMB(rootPid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' })
    .trim().split('\n').map((l) => l.trim().split(/\s+/)).map(([pid, ppid, rss, ...c]) => ({ pid: +pid, ppid: +ppid, rss: +rss, comm: c.join(' ') }));
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  let total = 0; let main = 0; const stack = [rootPid]; const seen = new Set();
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  while (stack.length) {
    const p = stack.pop(); if (seen.has(p)) continue; seen.add(p);
    const r = byPid.get(p); if (r) { total += r.rss; if (p === rootPid) main = r.rss; }
    for (const k of kids.get(p) || []) stack.push(k.pid);
  }
  return { totalMB: total / 1024, mainMB: main / 1024, processes: seen.size };
}

let phase = 'boot';
const samples = [];
let sampler = null;
function startSampler(pid) {
  sampler = setInterval(() => {
    try { samples.push({ t: Date.now(), phase, ...treeRssMB(pid), availGB: availableGB() }); } catch { /* process gone */ }
  }, 500);
}

// ── profile: isolated, Whisper models cloned copy-on-write ───────────────────
fs.mkdirSync(USERDATA, { recursive: true });
fs.writeFileSync(path.join(USERDATA, 'settings.json'), JSON.stringify({ embedding: { mode: 'manual', provider: 'local' } }));
const whisperSrc = path.join(REAL_WHISPER, ...WHISPER_MODEL.split('/'));
if (!fs.existsSync(whisperSrc)) throw new Error(`Whisper model not cached at ${whisperSrc}`);
fs.mkdirSync(path.join(USERDATA, 'whisper-models', WHISPER_MODEL.split('/')[0]), { recursive: true });
execFileSync('cp', ['-c', '-R', whisperSrc, path.join(USERDATA, 'whisper-models', ...WHISPER_MODEL.split('/'))]);

// ── debug log backup (a launch truncates it) ─────────────────────────────────
const DEBUG_LOG = path.join(os.homedir(), 'Documents', 'natively_debug.log');
const DEBUG_BAK = `${DEBUG_LOG}.livemeeting-${process.pid}.bak`;
const hadLog = fs.existsSync(DEBUG_LOG);
if (hadLog) fs.copyFileSync(DEBUG_LOG, DEBUG_BAK);
const restoreLog = () => { try { if (hadLog) { fs.copyFileSync(DEBUG_BAK, DEBUG_LOG); fs.rmSync(DEBUG_BAK, { force: true }); } } catch { /* */ } };

// ── launch: production mode, clean CWD (no dotenv cloud keys), keys stripped ─
const env = { ...process.env, NODE_ENV: 'production', NATIVELY_E2E: '1', NATIVELY_E2E_REFERENCE_ROOT: CORPUS, NATIVELY_TEST_USERDATA: USERDATA, NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL: '0', ...cfg.env };
delete env.ELECTRON_RUN_AS_NODE;
if (MODEL === 'default') { delete env.NATIVELY_EMBEDDING_EXPERIMENT; delete env.NATIVELY_LOCAL_MODELS_PATH; }
for (const k of Object.keys(env)) {
  if (/(_API_KEY|_API_TOKEN|_AUTH_TOKEN|_SECRET)$/i.test(k) || /^(OPENAI|GEMINI|GOOGLE|VOYAGE|OPENROUTER|ANTHROPIC|GROQ|DEEPSEEK|NVIDIA|NATIVELY_API)/i.test(k)) delete env[k];
}
const CLEAN_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-clean-cwd-'));
const child = spawn(path.join(REPO, 'node_modules/.bin/electron'), [REPO, `--remote-debugging-port=${PORT}`, `--user-data-dir=${USERDATA}`], { cwd: CLEAN_CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
// The app log is STREAMED to disk: the first Parakeet run aborted the app
// (SIGABRT in an ONNX worker) and an in-memory log died with the hung harness.
const OUT_DIR = path.join(REPO, 'results', 'live-meeting-memory');
fs.mkdirSync(OUT_DIR, { recursive: true });
const LIVE_LOG = path.join(OUT_DIR, `${MODEL}.${WHISPER_MODEL.replace(/\//g, '_')}.app.log`);
const logStream = fs.createWriteStream(LIVE_LOG);
const appLog = [];
const onData = (b) => { const t = b.toString(); appLog.push(t); logStream.write(t); };
child.stdout.on('data', onData);
child.stderr.on('data', onData);
let exited = null;
const exitWaiters = [];
child.on('exit', (code, signal) => { exited = { code, signal, phase, at: Date.now() }; for (const w of exitWaiters) w(); });
const whenExited = new Promise((r) => exitWaiters.push(r));

// node_modules/.bin/electron is a node shim; the real Electron main process is
// its child. Sample from the shim: the tree includes everything below it.
startSampler(child.pid);

let target = null;
for (let i = 0; i < 90 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* */ }
  if (!target) await sleep(1000);
}
if (!target) { child.kill('SIGKILL'); restoreLog(); throw new Error('no CDP target'); }
const { default: WS } = await import('ws');
const ws = new WS(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let nextId = 1; const waiters = new Map();
ws.on('message', (d) => { const m = JSON.parse(d.toString()); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } });
const send = (method, params) => new Promise((res) => { const id = nextId++; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function invoke(channel, ...args) {
  // Race the call against the app exiting: a crashed app never answers, and
  // the first Parakeet run hung here forever.
  const call = send('Runtime.evaluate', { expression: `window.electronAPI.e2eInvoke(${JSON.stringify(channel)}${args.map((a) => ',' + JSON.stringify(a)).join('')})`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  const r = await Promise.race([call, whenExited.then(() => { throw new Error(`app exited (${JSON.stringify(exited)}) during ${channel}`); })]);
  if (r.error) throw new Error(`CDP: ${r.error.message}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
for (let i = 0; i < 60; i++) { try { await invoke('__e2e__:index-status', 'x'); break; } catch { await sleep(1000); } }

const report = { model: MODEL, whisperModel: WHISPER_MODEL, queryCount: QUERY_COUNT, machine: { totalGB: +(os.totalmem() / 1024 ** 3).toFixed(1), cpu: os.cpus()[0]?.model }, steps: {} };
const step = async (name, fn) => { phase = name; const t = Date.now(); try { report.steps[name] = { ok: true, value: await fn(), ms: Date.now() - t }; } catch (e) { report.steps[name] = { ok: false, error: String(e.message || e), ms: Date.now() - t }; } console.log(`[meeting:${MODEL}] ${name}: ${JSON.stringify(report.steps[name]).slice(0, 220)}`); };

try {
  phase = 'idle'; await sleep(8000);
  await step('enable-pro', () => invoke('__e2e__:enable-pro'));
  await step('stt-local-whisper', async () => {
    await invoke('local-whisper-set-model', WHISPER_MODEL);
    return invoke('set-stt-provider', 'local-whisper');
  });
  let modeId;
  await step('mode', async () => {
    const m = await invoke('modes:create', { name: `LiveMeeting ${MODEL}`, templateType: 'team-meet' });
    modeId = m?.mode?.id || m?.id; await invoke('modes:set-active', modeId); return modeId;
  });
  await step('start-meeting', () => invoke('start-meeting', { title: 'memory test' }));
  phase = 'meeting-warm';
  await Promise.race([sleep(20000), whenExited]);   // STT worker load + capture settles
  if (exited) throw new Error(`app exited during meeting-warm: ${JSON.stringify(exited)}`);
  await step('upload', async () => {
    let ok = 0; for (const f of snap.perFile) { const r = await invoke('__e2e__:upload-reference-file-from-path', { modeId, filePath: path.join(CORPUS, f.file) }); if (r?.success) ok++; }
    return { ok, of: snap.perFile.length };
  });
  await step('index-during-meeting', async () => {
    await invoke('__e2e__:reindex-embeddings', modeId);
    const TERMINAL = new Set(['ready', 'lexical_only', 'failed', 'ocr_required']);
    const t = Date.now(); let st = [];
    while (Date.now() - t < 900_000) { st = (await invoke('__e2e__:index-status', modeId))?.statuses || []; if (st.length && st.every((x) => TERMINAL.has(x.status))) break; await sleep(2000); }
    return { byStatus: st.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {}), chunks: st.reduce((a, x) => a + (x.chunkCount || 0), 0), embedded: st.reduce((a, x) => a + (x.embeddedChunkCount || 0), 0) };
  });
  await step('queries-during-meeting', async () => {
    let ok = 0; let dense = 0;
    for (const q of snap.queries.slice(0, QUERY_COUNT)) {
      const r = await invoke('__e2e__:inspect-retrieval', { modeId, query: q.text, forceDocumentGrounding: true });
      if (r?.success) ok++;
      if (/"vectorScore":\s*-?\d/.test(r?.block || '')) dense++;
    }
    return { ok, dense, of: QUERY_COUNT };
  });
  await step('end-meeting', () => invoke('end-meeting'));
  phase = 'after'; await sleep(5000);
} catch (e) {
  report.error = String(e.message || e);
}
clearInterval(sampler);

const log = appLog.join('');
report.exited = exited;
report.embedderLoaded = (log.match(/Loading feature-extraction model \(([^,)]+)/) || [])[1] || null;
report.whisperEvidence = (log.match(/\[(LocalWhisperSTT|ModelPreloader|WhisperWorker)[^\n]{0,140}/g) || []).slice(0, 8);
report.rerankerLoaded = /Cross-encoder loaded successfully/.test(log);
// STT must actually be RESIDENT, or the run measures nothing. The first attempt
// used a truncated distil-large-v3 cache: both workers failed to load and the
// run still "passed".
report.sttReady = (log.match(/\[LocalWhisperSTT\/[^\]]*\] worker ready in \d+ms/g) || []);
report.sttLoadErrors = (log.match(/Worker error: Failed to load model[^\n]{0,120}/g) || []);
report.gateRefusals = (log.match(/insufficient available memory[^\n]{0,160}/g) || []);
report.meetingStops = (log.match(/[^\n]{0,40}(meeting (stopped|ended)|endMeeting|stopMeeting)[^\n]{0,100}/gi) || []).slice(0, 5);
report.selfPoison = (log.match(/Recovered from a local embedding crash|previous launch poisoned/g) || []).length;
report.crashes = (log.match(/SIGTRAP|SIGABRT|SIGSEGV|worker exited unexpectedly|Worker crashed[^\n]{0,80}/gi) || []);
report.cloudSelected = (log.match(/Selected provider: (?!local)\w+/g) || []);
report.transcriptSegments = (log.match(/\[(LocalWhisperSTT)\][^\n]*(transcript|segment)/gi) || []).length;

const phases = [...new Set(samples.map((s) => s.phase))];
report.byPhase = Object.fromEntries(phases.map((p) => {
  const xs = samples.filter((s) => s.phase === p);
  return [p, { samples: xs.length, peakTreeMB: Math.round(Math.max(...xs.map((s) => s.totalMB))), peakMainMB: Math.round(Math.max(...xs.map((s) => s.mainMB))), minAvailGB: +Math.min(...xs.map((s) => s.availGB)).toFixed(2) }];
}));
report.peakTreeMB = Math.round(Math.max(...samples.map((s) => s.totalMB)));
report.minAvailGB = +Math.min(...samples.map((s) => s.availGB)).toFixed(2);
if (report.embedderLoaded !== cfg.expectLoad) report.invalid = `embedder loaded ${report.embedderLoaded}, expected ${cfg.expectLoad}`;
if (report.cloudSelected.length) report.invalid = `cloud provider selected: ${report.cloudSelected.join(', ')}`;
if (!report.sttReady.length) report.invalid = `no STT worker reached ready (${report.sttLoadErrors.length} load errors)`;
if (report.sttLoadErrors.length) report.invalid = `STT model failed to load: ${report.sttLoadErrors[0]}`;
if (!report.rerankerLoaded) report.invalid = (report.invalid ? report.invalid + '; ' : '') + 'reranker never loaded';

const outDir = OUT_DIR;
fs.writeFileSync(path.join(outDir, `${MODEL}.${WHISPER_MODEL.replace(/\//g, '_')}.json`), JSON.stringify({ ...report, samples }, null, 1));
/* the log stream stays open through shutdown: see the quit block below */
console.log(`\n[meeting:${MODEL}] embedder=${report.embedderLoaded} whisper=${WHISPER_MODEL} reranker=${report.rerankerLoaded} sttReady=${report.sttReady.length} peakTree=${report.peakTreeMB}MB minAvail=${report.minAvailGB}GB refusals=${report.gateRefusals.length} crashes=${report.crashes.length} poison=${report.selfPoison} exited=${JSON.stringify(exited)}${report.invalid ? ' INVALID: ' + report.invalid : ''}`);
for (const [p, v] of Object.entries(report.byPhase)) console.log(`  ${p.padEnd(24)} peakTree=${String(v.peakTreeMB).padStart(5)}MB  peakMain=${String(v.peakMainMB).padStart(5)}MB  minAvail=${v.minAvailGB}GB`);

try { ws.close(); } catch { /* */ }
// Shutdown is part of the test. Two of the first five runs ABORTED at quit
// (SIGABRT in an ONNX worker thread: Napi::Error thrown from InferenceSession),
// and the log had already been closed, so it did not show which worker. Keep
// logging until the process is gone and record how it died.
const quitAt = Date.now();
child.kill('SIGTERM');
await Promise.race([whenExited, sleep(15000)]);
const shutdown = { exitedAfterMs: exited ? exited.at - quitAt : null, code: exited?.code ?? null, signal: exited?.signal ?? null };
if (!exited) { try { child.kill('SIGKILL'); } catch { /* */ } shutdown.forcedKill = true; }
await sleep(500);
logStream.end();
const shutLog = appLog.join('').slice(log.length);
shutdown.lastLines = shutLog.trim().split('\n').slice(-12);
shutdown.aborted = shutdown.signal === 'SIGABRT' || /terminating due to uncaught exception|Napi::Error/.test(shutLog);
report.shutdown = shutdown;
fs.writeFileSync(path.join(outDir, `${MODEL}.${WHISPER_MODEL.replace(/\//g, '_')}.json`), JSON.stringify({ ...report, samples }, null, 1));
console.log(`[meeting:${MODEL}] shutdown: ${JSON.stringify({ ...shutdown, lastLines: undefined })}`);
if (shutdown.aborted) console.log(shutdown.lastLines.map((l) => '   | ' + l.slice(0, 200)).join('\n'));
if (process.env.KEEP_USERDATA !== '1') { try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch { /* */ } }
restoreLog();
process.exit(report.invalid || report.error || exited ? 1 : 0);
