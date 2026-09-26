#!/usr/bin/env node
// scripts/embedding-live-corpus-compare.mjs
//
// R&D ONLY. Compare embedding models INSIDE A REAL NATIVELY SESSION on a corpus
// big enough to tell them apart.
//
// The per-model live check (embedding-live-session.mjs) proves each model works
// end to end, but its fixture — six small files, three direct questions — is
// too easy: every model scores 3/3. This driver uploads the full benchmark
// corpus (59 files, 872 chunks) through the real parser into a real mode, lets
// the real ModesManager index it, and asks all 503 benchmark questions through
// the real `__e2e__:inspect-retrieval` path: hybrid lexical + dense fusion, the
// confidence-gated local cross-encoder, the token budget, the formatted block
// the LLM would actually receive. What is scored is the FINAL ranked evidence
// the app hands the model.
//
// Relevance is the benchmark's deterministic ground truth. The app chunks with
// the same semanticChunker (CHUNKER_VERSION 4) that built
// results/corpus-snapshot.json, so each returned snippet is matched to its
// snapshot chunk by normalised text; the unmatched rate is reported so that
// assumption is measured, not trusted.
//
// Usage:
//   LIVE_MODEL=minilm      node scripts/embedding-live-corpus-compare.mjs
//   LIVE_MODEL=default     node scripts/embedding-live-corpus-compare.mjs   (the shipped default)
//   LIVE_MODEL=e5-base     node scripts/embedding-live-corpus-compare.mjs
//   LIVE_MODEL=e5-small-v2 node scripts/embedding-live-corpus-compare.mjs

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(REPO, 'embedding-benchmark', 'corpus');
const CACHE = path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');
const MODEL = process.env.LIVE_MODEL || 'e5-base';
const PORT = Number(process.env.CDP_PORT || 9801);
const QUERY_LIMIT = Number(process.env.QUERY_LIMIT || 0);   // 0 = all 503
const USERDATA = path.join(os.tmpdir(), `natively-live-corpus-${MODEL}-${Date.now()}`);

// How each model is launched. `e5-base` is the SHIPPED configuration: no
// experiment variable, bundled model resolved from resources/models exactly as
// a real install resolves it.
const MODELS = {
  'minilm':      { env: { NATIVELY_EMBEDDING_EXPERIMENT: 'minilm-baseline', NATIVELY_LOCAL_MODELS_PATH: path.join(CACHE, 'minilm-baseline') }, expectLoad: 'Xenova/all-MiniLM-L6-v2' },
  // The SHIPPED configuration: no experiment variable, bundled model resolved
  // from resources/models exactly as a real install resolves it. Since
  // 2026-09-22 that is multilingual-e5-small.
  'default':     { env: {}, expectLoad: 'Xenova/multilingual-e5-small' },
  // multilingual-e5-base was the shipped default when results/live-corpus/e5-base.json
  // was recorded; it is now reached through the experiment registry instead.
  'e5-base':     { env: { NATIVELY_EMBEDDING_EXPERIMENT: 'multilingual-e5-base', NATIVELY_LOCAL_MODELS_PATH: path.join(CACHE, 'multilingual-e5-base') }, expectLoad: 'Xenova/multilingual-e5-base' },
  'e5-small-v2': { env: { NATIVELY_EMBEDDING_EXPERIMENT: 'e5-small-v2', NATIVELY_LOCAL_MODELS_PATH: path.join(CACHE, 'e5-small-v2') }, expectLoad: 'Xenova/e5-small-v2' },
  'multilingual-e5-small': { env: { NATIVELY_EMBEDDING_EXPERIMENT: 'multilingual-e5-small', NATIVELY_LOCAL_MODELS_PATH: path.join(CACHE, 'multilingual-e5-small') }, expectLoad: 'Xenova/multilingual-e5-small' },
  // HOSTED. Pinned manually, so the resolver's candidate list is Gemini alone
  // and no boot-time auto resolve can substitute anything (§9d). Needs the key
  // from the repo .env, so this model launches from the repo CWD. The failure
  // mode flips: a Gemini outage/quota would fall back to the LOCAL model, so
  // ANY local embedding load or non-Gemini selection invalidates the run.
  'gemini':      { env: {}, hosted: 'gemini', expectLoad: null,
                   settings: { mode: 'manual', provider: 'gemini', model: 'gemini-embedding-2' } },
};
const cfg = MODELS[MODEL];
if (!cfg) throw new Error(`unknown LIVE_MODEL ${MODEL}; one of ${Object.keys(MODELS).join(', ')}`);

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const snap = JSON.parse(fs.readFileSync(path.join(REPO, 'results', 'corpus-snapshot.json'), 'utf8'));
const chunkByNorm = new Map(snap.chunks.map((c) => [c.normText, c.id]));
// QUERY_FILE swaps in another question set over the SAME chunks (the
// cross-language track's Hindi questions carry the snapshot's chunk ids).
const QUERY_FILE = process.env.QUERY_FILE ? path.resolve(process.env.QUERY_FILE) : null;
const allQueries = QUERY_FILE ? JSON.parse(fs.readFileSync(QUERY_FILE, 'utf8')) : snap.queries;
const queries = QUERY_LIMIT ? allQueries.slice(0, QUERY_LIMIT) : allQueries;
const OUT_NAME = process.env.OUT_NAME || MODEL;

/** Map a returned snippet to its snapshot chunk id by normalised text. */
function matchChunk(snippetText) {
  const t = norm(unescapeXml(snippetText));
  if (chunkByNorm.has(t)) return chunkByNorm.get(t);
  // Tolerate a trimmed/prefixed snippet: unique containment either way.
  let hit = null;
  for (const c of snap.chunks) {
    if (c.normText.length > 40 && (t.includes(c.normText) || c.normText.includes(t))) {
      if (hit && hit !== c.id) return null; // ambiguous — do not guess
      hit = c.id;
    }
  }
  return hit;
}

function parseSnippets(block) {
  const out = [];
  const re = /<snippet>\s*<source>([\s\S]*?)<\/source>\s*<text>([\s\S]*?)<\/text>\s*<\/snippet>/g;
  let m;
  while ((m = re.exec(block))) {
    let c = {};
    try { c = JSON.parse(m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')); } catch { /* keep {} */ }
    out.push({ fileName: c.fileName ?? null, vectorScore: c.vectorScore ?? null, fts: c.ftsScore ?? null, score: c.score ?? null, rerank: c.rerankScore ?? null, text: m[2] });
  }
  return out;
}

// ── debug log: back up and restore (a launch truncates it) ──────────────────
const DEBUG_LOG = path.join(os.homedir(), 'Documents', 'natively_debug.log');
const DEBUG_BAK = `${DEBUG_LOG}.livecorpus-${process.pid}.bak`;
const hadLog = fs.existsSync(DEBUG_LOG);
if (hadLog) fs.copyFileSync(DEBUG_LOG, DEBUG_BAK);
const restoreLog = () => { try { if (hadLog) { fs.copyFileSync(DEBUG_BAK, DEBUG_LOG); fs.rmSync(DEBUG_BAK, { force: true }); } } catch { /* reported by absence */ } };

// ── launch (production mode: no Vite dev server to reload under CDP) ────────
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NATIVELY_E2E: '1',
  NATIVELY_E2E_REFERENCE_ROOT: CORPUS,
  NATIVELY_TEST_USERDATA: USERDATA,
  // Exercise the dense path a real no-meeting turn takes (the e2e channel
  // cannot pass meetingActive=false; see embedding-live-session.mjs).
  NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL: '0',
  ...cfg.env,
};
delete env.ELECTRON_RUN_AS_NODE;
if (MODEL === 'default') { delete env.NATIVELY_EMBEDDING_EXPERIMENT; delete env.NATIVELY_LOCAL_MODELS_PATH; }
// Strip cloud credentials. The first e5-base run skipped the manual/local
// selection to "mimic a default install", and with keys in the shell env the
// resolver — correctly — chose Gemini (3072d) and never loaded the local model.
// This is a local-vs-local comparison, so no cloud provider may be reachable.
for (const k of (cfg.hosted ? [] : Object.keys(env))) {
  if (/(_API_KEY|_API_TOKEN|_AUTH_TOKEN|_SECRET)$/i.test(k) || /^(OPENAI|GEMINI|GOOGLE|VOYAGE|OPENROUTER|ANTHROPIC|GROQ|DEEPSEEK|NVIDIA|NATIVELY_API)/i.test(k)) delete env[k];
}

// Launch from a CLEAN working directory, passing the app path explicitly.
// main.ts runs `require('dotenv').config()`, which reads `.env` from the CWD —
// with cwd = the repo it injected 68 vars including cloud keys, so stripping
// them from `env` above changed nothing. With no cloud key reachable, neither
// the boot resolve nor any later one can select a cloud provider, which is what
// a local-vs-local comparison requires (see the init race in the report, §9d).
const CLEAN_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-clean-cwd-'));
// Pre-seed the profile with the SAVED selection a real user would have:
// embedding = manual / local. The BOOT init then resolves manual-local itself
// and filters every other provider out. Selecting it only at runtime left a
// window where the slower boot "auto" resolve (Ollama on this machine, cloud
// keys on the first attempt) finished last and overwrote it — see §9d.
fs.mkdirSync(USERDATA, { recursive: true });
fs.writeFileSync(path.join(USERDATA, 'settings.json'), JSON.stringify({ embedding: cfg.settings || { mode: 'manual', provider: 'local' } }));
// APP_BINARY runs a PACKAGED build (…/Natively.app/Contents/MacOS/Natively)
// instead of the dev tree: the model then resolves from Contents/Resources,
// the workers from app.asar.unpacked, exactly as an installed app does.
const APP_BINARY = process.env.APP_BINARY || null;
const child = APP_BINARY
  ? spawn(APP_BINARY, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USERDATA}`],
    { cwd: CLEAN_CWD, env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn(path.join(REPO, 'node_modules/.bin/electron'),
    [REPO, `--remote-debugging-port=${PORT}`, `--user-data-dir=${USERDATA}`],
    { cwd: cfg.hosted ? REPO : CLEAN_CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
const appLog = [];
child.stdout.on('data', (b) => appLog.push(b.toString()));
child.stderr.on('data', (b) => appLog.push(b.toString()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bail = (msg) => { console.error(`[corpus:${MODEL}] ${msg}`); child.kill('SIGKILL'); restoreLog(); process.exit(1); };

let target = null;
for (let i = 0; i < 90 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* not up */ }
  if (!target) await sleep(1000);
}
if (!target) bail('no CDP target after 90s');

const { default: WS } = await import('ws');
const ws = new WS(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let nextId = 1; const waiters = new Map();
ws.on('message', (d) => { const m = JSON.parse(d.toString()); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } });
const send = (method, params) => new Promise((res) => { const id = nextId++; waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function invoke(channel, ...args) {
  const r = await send('Runtime.evaluate', {
    expression: `window.electronAPI.e2eInvoke(${JSON.stringify(channel)}${args.map((a) => ',' + JSON.stringify(a)).join('')})`,
    awaitPromise: true, returnByValue: true, timeout: 600000,
  });
  if (r.error) throw new Error(`CDP: ${r.error.message}`);   // never read a lost call as an empty result
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
for (let i = 0; i < 60; i++) {
  try { if (await invoke('__e2e__:index-status', 'x').then(() => true)) break; } catch { /* reloading */ }
  await sleep(1000);
}

const report = { model: MODEL, userData: USERDATA, uploads: { ok: 0, failed: [] }, queries: [] };
try {
  await invoke('__e2e__:enable-pro');
  // The local selection is pre-seeded in settings.json (see launch); no runtime
  // set-config, which is what opened the init race.
  const mode = await invoke('modes:create', { name: `LiveCorpus ${MODEL}`, templateType: 'team-meet' });
  const modeId = mode?.mode?.id || mode?.id;
  if (!modeId) throw new Error('no mode id');
  await invoke('modes:set-active', modeId);
  report.embeddingStatus = (await invoke('embedding:get-status'))?.active ?? null;
  console.log(`[corpus:${MODEL}] status: ${JSON.stringify(report.embeddingStatus).slice(0, 180)}`);

  // Real uploads, real parser, one file at a time.
  const tUp = Date.now();
  for (const f of snap.perFile) {
    const r = await invoke('__e2e__:upload-reference-file-from-path', { modeId, filePath: path.join(CORPUS, f.file) });
    if (r?.success) report.uploads.ok++; else report.uploads.failed.push({ file: f.file, error: r?.error });
  }
  report.uploads.ms = Date.now() - tUp;
  console.log(`[corpus:${MODEL}] uploaded ${report.uploads.ok}/${snap.perFile.length} in ${(report.uploads.ms / 1000).toFixed(1)}s`);

  // Index until every file is terminal.
  const tIdx = Date.now();
  await invoke('__e2e__:reindex-embeddings', modeId);
  const TERMINAL = new Set(['ready', 'lexical_only', 'failed', 'ocr_required']);
  let st = [];
  while (Date.now() - tIdx < 900_000) {
    st = (await invoke('__e2e__:index-status', modeId))?.statuses || [];
    if (st.length && st.every((x) => TERMINAL.has(x.status))) break;
    await sleep(2000);
  }
  report.index = {
    ms: Date.now() - tIdx,
    files: st.length,
    byStatus: st.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {}),
    chunks: st.reduce((a, x) => a + (x.chunkCount || 0), 0),
    embedded: st.reduce((a, x) => a + (x.embeddedChunkCount || 0), 0),
  };
  console.log(`[corpus:${MODEL}] indexed in ${(report.index.ms / 1000).toFixed(1)}s: ${report.index.embedded}/${report.index.chunks} chunks embedded ${JSON.stringify(report.index.byStatus)}`);

  // All benchmark questions through the real retrieval path.
  let done = 0; let unmatched = 0; let returned = 0;
  for (const q of queries) {
    const t0 = Date.now();
    let r, err = null;
    try { r = await invoke('__e2e__:inspect-retrieval', { modeId, query: q.text, forceDocumentGrounding: true }); } catch (e) { err = String(e.message || e); }
    const ms = Date.now() - t0;
    const snippets = parseSnippets(r?.block || '');
    const rel = new Set(q.relevantChunkIds);
    const ids = snippets.map((s) => matchChunk(s.text));
    unmatched += ids.filter((x) => x === null).length; returned += ids.length;
    const firstHit = ids.findIndex((id) => id && rel.has(id));
    report.queries.push({
      ...(process.env.STORE_CITATIONS === '1' ? { top: snippets.slice(0, 6).map((sn, i) => ({ rank: i + 1, chunk: ids[i], vec: sn.vectorScore, fts: sn.fts, score: sn.score })) } : {}),
      query_id: q.query_id, track: q.track, categories: q.categories, ms, ok: !!r?.success, err,
      returned: snippets.length, dense: snippets.filter((s) => typeof s.vectorScore === 'number').length,
      reranked: snippets.some((s) => typeof s.rerank === 'number'),
      ...(process.env.DUMP_UNMATCHED === '1' ? { unmatched: snippets.map((sn, i) => ({ sn, id: ids[i] })).filter((x) => !x.id).slice(0, 4).map(({ sn }) => ({ file: sn.fileName, vec: sn.vectorScore, fts: sn.fts, text: sn.text.slice(0, 160) })) } : {}),
      firstHitRank: firstHit === -1 ? null : firstHit + 1,
    });
    if (++done % 50 === 0) process.stdout.write(`\r[corpus:${MODEL}] ${done}/${queries.length} queries`);
  }
  report.matchedSnippetRate = returned ? +(1 - unmatched / returned).toFixed(4) : null;
  // Status AFTER the work: the start-of-run snapshot is taken before the boot
  // init has finished resolving, and read null for the hosted provider.
  report.embeddingStatusAtEnd = (await invoke('embedding:get-status'))?.active ?? null;
  process.stdout.write('\n');
} catch (e) {
  report.error = String(e.message || e);
  console.error(`[corpus:${MODEL}] ERROR ${report.error}`);
}

const log = appLog.join('');
report.modelLoadedInApp = (log.match(/Loading feature-extraction model \(([^,)]+)/) || [])[1] || null;
report.expectedModel = cfg.expectLoad;
report.selfPoison = (log.match(/Recovered from a local embedding crash|previous launch poisoned/g) || []).length;
report.cloudProviderSelected = (log.match(/Selected provider: (?!local)\w+/g) || []);
report.dotenvInjected = (log.match(/injected env \((\d+)\)/g) || []);
// Any non-local provider at ANY point invalidates the run: the retrieval could
// have been served by it (that is exactly what happened on the first attempt).
const selected = log.match(/Selected provider: \w+/g) || [];
report.providersSelected = selected;
if (cfg.hosted) {
  // Every selection must be the hosted provider, and the local embedder must
  // never have loaded (a fallback would have served some of the vectors).
  const others = selected.filter((x) => !x.endsWith(cfg.hosted));
  report.fallbackEvidence = (log.match(/promot\w* .{0,60}fallback|falling back to the bundled|still on the fallback|re-probe failed/gi) || []).slice(0, 5);
  if (!selected.length) report.error = `INVALID RUN: no provider selection logged`;
  else if (others.length) report.error = `INVALID RUN: non-${cfg.hosted} provider selected (${others.join(', ')})`;
  else if (report.modelLoadedInApp) report.error = `INVALID RUN: local model ${report.modelLoadedInApp} loaded — a fallback served some vectors`;
  else if (report.fallbackEvidence.length) report.error = `INVALID RUN: fallback activity (${report.fallbackEvidence[0]})`;
  else if (!String(report.embeddingStatusAtEnd?.space || '').startsWith(cfg.hosted)) report.error = `INVALID RUN: active space at end ${report.embeddingStatusAtEnd?.space}`;
} else {
  if (report.cloudProviderSelected.length) report.error = `INVALID RUN: a cloud provider was selected (${report.cloudProviderSelected.join(', ')})`;
  if (report.modelLoadedInApp !== cfg.expectLoad) report.error = `INVALID RUN: loaded ${report.modelLoadedInApp}, expected ${cfg.expectLoad}`;
}

report.appBinary = APP_BINARY;
report.modelPathEvidence = (log.match(/[^\n]{0,80}(Contents\/Resources\/models|resources\/models)[^\n]{0,80}/g) || []).slice(0, 3);
const outDir = path.join(REPO, 'results', APP_BINARY ? 'live-corpus-packaged' : 'live-corpus');
fs.mkdirSync(outDir, { recursive: true });
report.queryFile = QUERY_FILE;
// How often the confidence-gated local reranker actually ran, per the app log.
report.rerankEvents = (log.match(/\[(LocalReranker|ModeHybridRetriever)\][^\n]*rerank[^\n]*/gi) || []).length;
fs.writeFileSync(path.join(outDir, `${OUT_NAME}.json`), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(outDir, `${OUT_NAME}.app.log`), log);

const qs = report.queries;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const hit = (k) => mean(qs.map((q) => (q.firstHitRank !== null && q.firstHitRank <= k ? 1 : 0)));
console.log(`[corpus:${MODEL}] loaded=${report.modelLoadedInApp} (expected ${cfg.expectLoad})  selfPoison=${report.selfPoison}  matchedSnippets=${report.matchedSnippetRate}`);
console.log(`[corpus:${MODEL}] n=${qs.length}  hit@1=${hit(1).toFixed(4)}  hit@3=${hit(3).toFixed(4)}  hit@returned=${hit(999).toFixed(4)}  ` +
  `MRR=${mean(qs.map((q) => (q.firstHitRank ? 1 / q.firstHitRank : 0))).toFixed(4)}  failedCalls=${qs.filter((q) => !q.ok).length}`);

try { ws.close(); } catch { /* */ }
child.kill('SIGTERM'); await sleep(2000); try { child.kill('SIGKILL'); } catch { /* */ }
if (process.env.KEEP_USERDATA !== '1') { try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch { /* */ } } else console.log(`[corpus:${MODEL}] kept userData ${USERDATA}`);
restoreLog();
process.exit(report.error ? 1 : 0);
