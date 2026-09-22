#!/usr/bin/env node
// scripts/embedding-live-format-track.mjs
//
// R&D ONLY. The FORMAT track (docs/local-embedding-benchmark.md §18): does the
// file format a reference document arrives in change what Natively retrieves?
//
// embedding-benchmark/corpus/formats/ holds the SAME eight documents in eight
// formats. One real app session; one mode per format; the eight files uploaded
// through the real parser (pdf-parse for .pdf, mammoth for .docx, htmlToText for
// .html) and indexed by the real ModesManager with the bundled embedder. The
// same 24 questions (embedding-benchmark/queries/formats_track.json) are asked
// in every mode through __e2e__:inspect-retrieval, the path a real turn takes.
//
// Relevance: a returned snippet is relevant when it contains the question's
// answer sentence, both reduced to lowercase letters and digits, so PDF line
// breaks, hyphenation and markup cannot hide a correct snippet. Unsupported
// formats (.doc, .rtf, .odt) are uploaded too, and must be REFUSED.
//
//   LIVE_MODEL=default node scripts/embedding-live-format-track.mjs
//   CATALOG_MODEL=e5-small-v2 FORMATS=md node scripts/embedding-live-format-track.mjs
//     (installs a local-catalog model through the app's own IPC: real download,
//      sha256-verified; then tests it, switches to it, and runs the track on it)

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMATS_DIR = path.join(REPO, 'embedding-benchmark', 'corpus', 'formats');
const CACHE = path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');
const MODEL = process.env.LIVE_MODEL || 'default';
const PORT = Number(process.env.CDP_PORT || 9871);
const USERDATA = path.join(os.tmpdir(), `natively-live-formats-${MODEL}-${Date.now()}`);
const CATALOG_MODEL = process.env.CATALOG_MODEL || null;
const FORMAT_FILTER = process.env.FORMATS ? new Set(process.env.FORMATS.split(',')) : null;
const SUPPORTED = [['md', '.md'], ['txt', '.txt'], ['html', '.html'], ['pdf', '.pdf'], ['docx', '.docx']]
  .filter(([f]) => !FORMAT_FILTER || FORMAT_FILTER.has(f));
const UNSUPPORTED = [['doc', '.doc'], ['rtf', '.rtf'], ['odt', '.odt']];
const dirOf = (fmt) => path.join(FORMATS_DIR, fmt === 'html' ? '_html' : fmt);

const questions = JSON.parse(fs.readFileSync(path.join(REPO, 'embedding-benchmark', 'queries', 'formats_track.json'), 'utf8'));
const squash = (s) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseSnippets(block) {
  const out = []; const re = /<snippet>\s*<source>([\s\S]*?)<\/source>\s*<text>([\s\S]*?)<\/text>\s*<\/snippet>/g; let m;
  while ((m = re.exec(block))) {
    let c = {}; try { c = JSON.parse(m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')); } catch { /* */ }
    out.push({ fileName: c.fileName ?? null, vectorScore: c.vectorScore ?? null, text: unescapeXml(m[2]) });
  }
  return out;
}

const MODELS = {
  default: { env: {}, expectLoad: 'Xenova/multilingual-e5-small' },
  minilm: { env: { NATIVELY_EMBEDDING_EXPERIMENT: 'minilm-baseline', NATIVELY_LOCAL_MODELS_PATH: path.join(CACHE, 'minilm-baseline') }, expectLoad: 'Xenova/all-MiniLM-L6-v2' },
};
const cfg = CATALOG_MODEL ? { env: {}, expectLoad: null } : MODELS[MODEL];
if (!cfg) throw new Error(`unknown LIVE_MODEL ${MODEL}`);
const RUN_NAME = CATALOG_MODEL ? `catalog-${CATALOG_MODEL}` : MODEL;

const DEBUG_LOG = path.join(os.homedir(), 'Documents', 'natively_debug.log');
const DEBUG_BAK = `${DEBUG_LOG}.formats-${process.pid}.bak`;
const hadLog = fs.existsSync(DEBUG_LOG);
if (hadLog) fs.copyFileSync(DEBUG_LOG, DEBUG_BAK);
const restoreLog = () => { try { if (hadLog) { fs.copyFileSync(DEBUG_BAK, DEBUG_LOG); fs.rmSync(DEBUG_BAK, { force: true }); } } catch { /* */ } };

const env = { ...process.env, NODE_ENV: 'production', NATIVELY_E2E: '1', NATIVELY_E2E_REFERENCE_ROOT: FORMATS_DIR, NATIVELY_TEST_USERDATA: USERDATA, NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL: '0', ...cfg.env };
delete env.ELECTRON_RUN_AS_NODE;
if (MODEL === 'default' || CATALOG_MODEL) { delete env.NATIVELY_EMBEDDING_EXPERIMENT; delete env.NATIVELY_LOCAL_MODELS_PATH; }
for (const k of Object.keys(env)) if (/(_API_KEY|_API_TOKEN|_AUTH_TOKEN|_SECRET)$/i.test(k) || /^(OPENAI|GEMINI|GOOGLE|VOYAGE|OPENROUTER|ANTHROPIC|GROQ|DEEPSEEK|NVIDIA|NATIVELY_API)/i.test(k)) delete env[k];
// Refuse to start while anything already listens on the debug port. An orphan
// holding it means this launch gets NO debug endpoint and the harness would
// silently drive the OLD app (it did: two runs measured a previous instance).
try {
  await fetch(`http://127.0.0.1:${PORT}/json/version`);
  throw new Error(`port ${PORT} is already in use (an orphaned app?); refusing to measure the wrong instance`);
} catch (e) {
  if (String(e.message).includes('already in use')) throw e;
}
fs.mkdirSync(USERDATA, { recursive: true });
fs.writeFileSync(path.join(USERDATA, 'settings.json'), JSON.stringify({ embedding: { mode: 'manual', provider: 'local' } }));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-clean-cwd-'));
const child = spawn(path.join(REPO, 'node_modules/.bin/electron'), [REPO, `--remote-debugging-port=${PORT}`, `--user-data-dir=${USERDATA}`], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
let exited = null; const whenExited = new Promise((r) => child.on('exit', (code, signal) => { exited = { code, signal }; r(); }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 90 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* */ } if (!target) await sleep(1000); }
if (!target) { child.kill('SIGKILL'); restoreLog(); throw new Error('no CDP target'); }
const { default: WS } = await import('ws');
const ws = new WS(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let nextId = 1; const waiters = new Map();
ws.on('message', (d) => { const m = JSON.parse(d.toString()); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } });
const send = (method, params) => new Promise((res) => { const id = nextId++; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function invoke(channel, ...args) {
  const call = send('Runtime.evaluate', { expression: `window.electronAPI.e2eInvoke(${JSON.stringify(channel)}${args.map((a) => ',' + JSON.stringify(a)).join('')})`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  const r = await Promise.race([call, whenExited.then(() => { throw new Error(`app exited during ${channel}`); })]);
  if (r.error) throw new Error(`CDP: ${r.error.message}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
// Wait for the preload bridge itself, not for a call that cannot fail.
for (let i = 0; i < 60; i++) {
  const r = await send('Runtime.evaluate', { expression: `typeof window.electronAPI?.e2eInvoke === 'function'`, returnByValue: true });
  if (r.result?.result?.value === true) break;
  await sleep(1000);
}
await sleep(3000);

const report = { model: RUN_NAME, questions: questions.length, formats: {}, unsupported: {} };
try {
  await invoke('__e2e__:enable-pro');
  if (CATALOG_MODEL) {
    const t0 = Date.now();
    report.install = await invoke('embedding:install-local-model', CATALOG_MODEL);
    report.install.ms = Date.now() - t0;
    console.log(`[formats:${RUN_NAME}] install: ${JSON.stringify(report.install).slice(0, 240)}`);
    if (!report.install?.success) throw new Error(`install failed: ${report.install?.error} ${report.install?.message ?? ''}`);
    report.test = await invoke('embedding:test-local-model', CATALOG_MODEL);
    console.log(`[formats:${RUN_NAME}] test: ${JSON.stringify(report.test).slice(0, 240)}`);
    report.use = await invoke('embedding:use-local-model', CATALOG_MODEL);
    console.log(`[formats:${RUN_NAME}] use: ${JSON.stringify(report.use).slice(0, 240)}`);
    await sleep(3000);
    report.statusAfterUse = (await invoke('embedding:get-status'))?.active ?? null;
    console.log(`[formats:${RUN_NAME}] active: ${JSON.stringify(report.statusAfterUse).slice(0, 240)}`);
  }
  for (const [fmt, ext] of SUPPORTED) {
    const mode = await invoke('modes:create', { name: `Formats ${fmt}`, templateType: 'team-meet' });
    const modeId = mode?.mode?.id || mode?.id;
    if (!modeId) throw new Error(`mode for ${fmt} not created`);
    await invoke('modes:set-active', modeId);
    const files = fs.readdirSync(dirOf(fmt)).filter((f) => f.endsWith(ext));
    let uploaded = 0; const failures = [];
    for (const f of files) { const u = await invoke('__e2e__:upload-reference-file-from-path', { modeId, filePath: path.join(dirOf(fmt), f) }); if (u?.success) uploaded++; else failures.push({ f, error: u?.error }); }
    await invoke('__e2e__:reindex-embeddings', modeId);
    const TERMINAL = new Set(['ready', 'lexical_only', 'failed', 'ocr_required']);
    let st = []; const t0 = Date.now();
    while (Date.now() - t0 < 300_000) { st = (await invoke('__e2e__:index-status', modeId))?.statuses || []; if (st.length && st.every((x) => TERMINAL.has(x.status))) break; await sleep(1500); }
    const perQ = [];
    for (const q of questions) {
      const r = await invoke('__e2e__:inspect-retrieval', { modeId, query: q.text, forceDocumentGrounding: true });
      const sn = parseSnippets(r?.block || '');
      const want = squash(q.answer);
      const rank = sn.findIndex((s) => squash(s.text).includes(want));
      perQ.push({ id: q.query_id, doc: q.doc, returned: sn.length, dense: sn.filter((s) => typeof s.vectorScore === 'number').length, firstHitRank: rank === -1 ? null : rank + 1 });
    }
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const rep = {
      files: files.length, uploaded, failures,
      index: { byStatus: st.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {}), chunks: st.reduce((a, x) => a + (x.chunkCount || 0), 0), embedded: st.reduce((a, x) => a + (x.embeddedChunkCount || 0), 0) },
      hit1: +mean(perQ.map((q) => (q.firstHitRank === 1 ? 1 : 0))).toFixed(4),
      hit3: +mean(perQ.map((q) => (q.firstHitRank && q.firstHitRank <= 3 ? 1 : 0))).toFixed(4),
      anywhere: +mean(perQ.map((q) => (q.firstHitRank ? 1 : 0))).toFixed(4),
      mrr: +mean(perQ.map((q) => (q.firstHitRank ? 1 / q.firstHitRank : 0))).toFixed(4),
      perQ,
    };
    report.formats[fmt] = rep;
    console.log(`[formats:${RUN_NAME}] ${fmt.padEnd(5)} uploaded ${uploaded}/${files.length}  chunks ${rep.index.chunks} embedded ${rep.index.embedded} ${JSON.stringify(rep.index.byStatus)}  hit@1=${rep.hit1.toFixed(4)} hit@3=${rep.hit3.toFixed(4)} anywhere=${rep.anywhere.toFixed(4)} MRR=${rep.mrr.toFixed(4)}`);
  }
  // Unsupported formats must be refused, not silently indexed as garbage.
  if (!FORMAT_FILTER) {
  const probeMode = await invoke('modes:create', { name: 'Formats unsupported', templateType: 'team-meet' });
  const probeId = probeMode?.mode?.id || probeMode?.id;
  for (const [fmt, ext] of UNSUPPORTED) {
    const f = fs.readdirSync(dirOf(fmt)).find((x) => x.endsWith(ext));
    const u = await invoke('__e2e__:upload-reference-file-from-path', { modeId: probeId, filePath: path.join(dirOf(fmt), f) });
    report.unsupported[fmt] = { accepted: !!u?.success, error: u?.error ?? null };
    console.log(`[formats:${RUN_NAME}] ${fmt.padEnd(5)} (unsupported) accepted=${!!u?.success} ${u?.error ? `error="${String(u.error).slice(0, 90)}"` : ''}`);
  }
  }
  if (CATALOG_MODEL) report.statusAtEnd = (await invoke('embedding:get-status'))?.active ?? null;
} catch (e) {
  report.error = String(e.message || e);
  console.error(`[formats:${RUN_NAME}] ERROR ${report.error}`);
}
report.embedderLoaded = (log.match(/Loading (?:feature-extraction|ONNX embedding) model \(([^,)]+)/g) || []).map((l) => l.replace(/^.*\(/, ''));
report.cloudSelected = log.match(/Selected provider: (?!local)\w+/g) || [];
if (CATALOG_MODEL) {
  // Indexing must have run on the catalog model, not the bundled fallback.
  const space = String(report.statusAtEnd?.space || '');
  if (!report.embedderLoaded.includes(CATALOG_MODEL)) report.invalid = `the worker never loaded ${CATALOG_MODEL} (loaded: ${report.embedderLoaded.join(', ')})`;
  else if (/multilingual-e5-small/.test(space)) report.invalid = `active space at end is the bundled model's (${space})`;
} else if (!report.embedderLoaded.some((m) => cfg.expectLoad && m.includes(cfg.expectLoad.split('/')[1]))) report.invalid = `embedder ${report.embedderLoaded.join(', ')}, expected ${cfg.expectLoad}`;
if (report.cloudSelected.length) report.invalid = `cloud provider selected: ${report.cloudSelected.join(', ')}`;
const outDir = path.join(REPO, 'results', 'live-formats');
fs.mkdirSync(outDir, { recursive: true });
if (report.invalid) console.error(`[formats:${RUN_NAME}] INVALID: ${report.invalid}`);
// Quit THROUGH the socket, then close it (closing first meant the quit was never
// sent). If the app is still up, kill the real Electron process, not just the
// node_modules/.bin/electron shim, which orphans it.
void invoke('quit-app').catch(() => {});
await Promise.race([whenExited, sleep(15000)]);
try { ws.close(); } catch { /* */ }
const { execFileSync } = await import('child_process');
const listeners = () => { try { return execFileSync('lsof', ['-t', '-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };
for (const pid of listeners()) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* */ } }
if (!exited) child.kill('SIGKILL');
await sleep(1000);
if (listeners().length) console.error(`[formats:${RUN_NAME}] WARNING: port ${PORT} still held after shutdown`);
report.shutdown = { exitedByItself: !!exited, ...(exited || {}) };
console.log(`[formats:${RUN_NAME}] shutdown: ${JSON.stringify(report.shutdown)}`);
// Written AFTER shutdown so the log shows the quit itself.
fs.writeFileSync(path.join(outDir, `${RUN_NAME}.json`), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(outDir, `${RUN_NAME}.app.log`), log);
try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch { /* */ }
restoreLog();
process.exit(report.invalid || report.error ? 1 : 0);
