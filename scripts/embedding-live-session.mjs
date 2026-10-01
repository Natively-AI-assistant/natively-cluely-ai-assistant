#!/usr/bin/env node
// scripts/embedding-live-session.mjs
//
// R&D ONLY. §9/§27 of the bake-off: prove a candidate works inside a REAL
// running Natively application, not just in a harness.
//
// This launches the actual Electron app against an ISOLATED userData directory,
// attaches over CDP, and drives the real E2E IPC surface:
//
//   modes:create                            real mode
//   __e2e__:upload-reference-file-from-path real parser (pdf-parse / mammoth / text)
//                                           → real ModeReferenceFileIngestion
//                                           → real ModesManager index
//   __e2e__:prewarm-mode                    real embedding of every chunk
//   __e2e__:index-status                    real index counts
//   __e2e__:inspect-retrieval               real ModeHybridRetriever, real
//                                           lexical+dense fusion, real
//                                           confidence-gated cross-encoder
//
// Nothing is stubbed: the embedding provider is the real LocalEmbeddingProvider
// running the candidate model, and the retrieval block is what the LLM would
// actually receive.
//
// ISOLATED userData, and NOT Playwright. A Playwright-launched Electron writes
// credentials a normally-launched app cannot decrypt, and driving the real
// userData directory risks the user's own profile. Plain spawn + CDP against a
// throwaway directory avoids both.
//
// Usage:
//   NATIVELY_EMBEDDING_EXPERIMENT=e5-small-v2 node scripts/embedding-live-session.mjs

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.NATIVELY_EMBEDDING_EXPERIMENT || 'minilm-baseline';
const CACHE = process.env.NATIVELY_EMBEDDING_EXPERIMENT_CACHE
  || path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');
const PORT = Number(process.env.CDP_PORT || 9411);
const FIXTURES = path.join(REPO, 'results', 'live-fixtures');
// UPGRADE-TEST FLAGS (2026-09-22). Two launches against ONE profile reproduce a
// real upgrade: launch 1 as a pre-flip install (KEY=minilm-baseline), launch 2
// as the new build (KEY=default, no experiment) without re-uploading anything.
//   LIVE_USERDATA    persistent profile dir; never deleted at the end
//   REUSE_MODE=1     find the mode by MODE_NAME instead of creating + uploading
//   SKIP_SET_CONFIG=1  keep whatever embedding selection the profile has saved
//   SET_LOCAL_MODEL  model id to save with the `local` selection (e.g. the old
//                    'Xenova/all-MiniLM-L6-v2', to exercise the saved-id hazard)
const LIVE_USERDATA = process.env.LIVE_USERDATA || null;
const USERDATA = LIVE_USERDATA || path.join(os.tmpdir(), `natively-emb-live-${KEY}-${Date.now()}`);
const MODE_NAME = process.env.MODE_NAME || `EmbBench ${KEY}`;
const REUSE_MODE = process.env.REUSE_MODE === '1';

// Each query carries the literal fact the answering snippet must contain, so a
// run records whether the model put a CORRECT chunk first — not just that a
// block came back. Deterministic, no LLM judge.
const QUERIES = [
  { q: 'Where do we stop a plan the customer already asked to end from being charged again?', answer: /cancel_?at_?period_?end|cancelAtPeriodEnd|shouldRenew/i },
  { q: 'What are the project and document caps on the free tier?', answer: /\b250\b/ },
  { q: 'How long are entitlement cache entries held?', answer: /\b90\b/ },
];

/**
 * Parse the ranked evidence snippets out of the real context block.
 *
 * Each snippet is `<snippet><source>{citation}</source><text>…</text></snippet>`
 * where the citation JSON carries fileName, chunkIndex, ftsScore and
 * vectorScore (ModeHybridRetriever.formatContext). A non-null vectorScore is
 * direct proof the DENSE arm scored that chunk — the evidence that this run
 * exercised the embedding model rather than lexical retrieval alone.
 */
function parseSnippets(block) {
  const out = [];
  const re = /<snippet>\s*<source>([\s\S]*?)<\/source>\s*<text>([\s\S]*?)<\/text>\s*<\/snippet>/g;
  let m;
  while ((m = re.exec(block))) {
    let c = {};
    try { c = JSON.parse(m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')); } catch { /* keep {} */ }
    out.push({
      fileName: c.fileName ?? null, chunkIndex: c.chunkIndex ?? null,
      score: c.score ?? null, ftsScore: c.ftsScore ?? null, vectorScore: c.vectorScore ?? null,
      text: m[2],
    });
  }
  return out;
}

// The debug log at ~/Documents/natively_debug.log is truncated by every launch,
// and AdversarialNewInstall asserts packaged-launch markers in it. Earlier runs
// of this harness clobbered it. Back it up here and restore it on exit so a
// benchmark run leaves the user's log exactly as it found it.
const DEBUG_LOG = path.join(os.homedir(), 'Documents', 'natively_debug.log');
const DEBUG_LOG_BACKUP = DEBUG_LOG + `.embbench-${process.pid}.bak`;
const hadDebugLog = fs.existsSync(DEBUG_LOG);
if (hadDebugLog) fs.copyFileSync(DEBUG_LOG, DEBUG_LOG_BACKUP);
function restoreDebugLog() {
  try {
    if (hadDebugLog) { fs.copyFileSync(DEBUG_LOG_BACKUP, DEBUG_LOG); fs.rmSync(DEBUG_LOG_BACKUP, { force: true }); }
  } catch (e) { console.error(`[live] could not restore debug log from ${DEBUG_LOG_BACKUP}: ${e.message}`); }
}

// ── fixtures: one file per MAJOR supported category (§27) ───────────────────
fs.mkdirSync(FIXTURES, { recursive: true });
const BILLING_MD = `# Meridian billing

## Billing model
Every workspace has exactly one subscription. Seats are billed monthly in
arrears. A workspace that cancels keeps access until the end of the paid
period, then drops to the free tier. The free tier caps a workspace at three
active projects and 250 stored documents.

## Revocation
The subscription reconciler runs every fifteen minutes. It walks every account
whose plan is flagged cancel_at_period_end, compares the stored period end
against the current time, and when the period has elapsed it writes a
revocation record and clears the cached entitlement set.

## Caching
Entitlement cache entries are held for 90 seconds, which is why a downgrade can
take up to a minute and a half to take effect for an active session.
`;
const fixtures = [
  { name: 'billing-notes.md', category: 'markdown', content: BILLING_MD },
  { name: 'billing-notes.txt', category: 'plain text', content: BILLING_MD.replace(/^#+ /gm, '') },
  { name: 'subscriptions.ts', category: 'code', content:
`// Guards a cancelled plan against renewal.
export function shouldRenew(sub: Subscription, now: Date): boolean {
  if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd <= now) return false;
  return sub.status === 'active';
}
export const ENTITLEMENT_CACHE_TTL_SECONDS = 90;
` },
  { name: 'limits.json', category: 'json', content: JSON.stringify({ freeTier: { projects: 3, documents: 250 }, entitlementCacheTtlSeconds: 90 }, null, 2) },
  { name: 'plans.csv', category: 'csv', content: 'plan,projects,documents\nfree,3,250\npro,unlimited,unlimited\n' },
  { name: 'overview.html', category: 'html', content: '<html><body><h1>Billing</h1><table><tr><td>Free tier projects</td><td>3</td></tr><tr><td>Free tier documents</td><td>250</td></tr></table></body></html>' },
];
for (const f of fixtures) fs.writeFileSync(path.join(FIXTURES, f.name), f.content);

// ── launch ──────────────────────────────────────────────────────────────────
const env = {
  ...process.env,
  // PRODUCTION mode, deliberately. In development mode every window loads the
  // Vite dev server at http://127.0.0.1:5180; this harness does not run one, so
  // windows kept failing (ERR_CONNECTION_REFUSED) and RELOADING underneath the
  // CDP session. A reload mid-call surfaces as "Inspected target navigated or
  // closed", which the first sweeps silently recorded as a retrieval that
  // returned zero snippets — a harness artifact that looked like a model defect
  // and hit the slower-starting 768/1024-dim models hardest. Production mode
  // loads dist/index.html over file://, with nothing to retry, and is also what
  // a real user runs. e2eInvoke is gated on NATIVELY_E2E alone, so it still works.
  NODE_ENV: 'production',
  NATIVELY_E2E: '1',
  NATIVELY_E2E_REFERENCE_ROOT: FIXTURES,
  NATIVELY_TEST_USERDATA: USERDATA,
  // Exercise the DENSE path, which is what a real no-meeting turn takes.
  //
  // ModeHybridRetriever.shouldUseLexicalForLocalManualQuery() deliberately
  // forces lexical-only when the active provider is `local` AND the meeting
  // state is not explicitly "no meeting" — an ONNX-arena-pressure guard for
  // live meetings, narrowed on 2026-09-19 so `meetingActive === false` lifts
  // it. The `__e2e__:inspect-retrieval` channel has no way to pass
  // `meetingActive`, so it arrives `undefined`, the conservative branch holds,
  // and the run measured LEXICAL retrieval while reporting an embedding model.
  // First observed as `embedded 0/9 chunks` with
  // `[ModeHybridRetriever] Local ONNX provider active for manual query`.
  //
  // This is a HARNESS limitation, not a product defect — and turning the guard
  // off here is what makes the live numbers reflect the dense path a real
  // key-less user gets outside a meeting.
  NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL: '0',
  NATIVELY_EMBEDDING_EXPERIMENT: KEY,
  NATIVELY_LOCAL_MODELS_PATH: path.join(CACHE, KEY),
};
// KEY=default is the SHIPPED configuration: no experiment, bundled model resolved
// from resources/models exactly as a real install resolves it.
if (KEY === 'default') {
  delete env.NATIVELY_EMBEDDING_EXPERIMENT;
  delete env.NATIVELY_LOCAL_MODELS_PATH;
}
delete env.ELECTRON_RUN_AS_NODE;

console.log(`[live:${KEY}] userData=${USERDATA}`);
console.log(`[live:${KEY}] models=${env.NATIVELY_LOCAL_MODELS_PATH}`);
const child = spawn(path.join(REPO, 'node_modules/.bin/electron'),
  ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USERDATA}`],
  { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });

const appLog = [];
const cap = (b) => { const s = b.toString(); appLog.push(s); if (process.env.VERBOSE === '1') process.stdout.write(s); };
child.stdout.on('data', cap);
child.stderr.on('data', cap);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return null;
}

const target = await findTarget();
if (!target) {
  console.error(`[live:${KEY}] no CDP target after 90s. App log tail:\n${appLog.join('').slice(-3000)}`);
  child.kill('SIGKILL');
  restoreDebugLog();
  process.exit(1);
}
console.log(`[live:${KEY}] CDP attached: ${target.url}`);

// ── minimal CDP client ──────────────────────────────────────────────────────
const { default: WS } = await import('ws').catch(() => ({ default: null }));
let ws, nextId = 1;
const waiters = new Map();
if (WS) {
  ws = new WS(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const w = waiters.get(m.id);
    if (w) { waiters.delete(m.id); w(m); }
  });
} else {
  console.error('ws module unavailable'); child.kill('SIGKILL'); restoreDebugLog(); process.exit(1);
}

function send(method, params) {
  const id = nextId++;
  return new Promise((res) => { waiters.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}

const cdpErrors = [];
async function evaluate(expr, timeoutMs = 300000) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
  // A CDP-level error (e.g. the renderer navigated and its execution context was
  // destroyed mid-call) arrives as `r.error`, NOT as an exception, and used to be
  // silently read as `undefined` — which the harness then recorded as a
  // retrieval that returned zero snippets. Surface it instead.
  if (r.error) { cdpErrors.push(r.error.message || JSON.stringify(r.error)); throw new Error(`CDP: ${r.error.message}`); }
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
}

const invoke = (channel, ...args) =>
  evaluate(`window.electronAPI.e2eInvoke(${JSON.stringify(channel)}${args.map((a) => ',' + JSON.stringify(a)).join('')})`);

// Wait for the preload bridge.
let bridgeReady = false;
for (let i = 0; i < 60; i++) {
  try { if (await evaluate('!!(window.electronAPI && window.electronAPI.e2eInvoke)')) { bridgeReady = true; break; } } catch { /* reloading */ }
  await sleep(1000);
}
if (!bridgeReady) { console.error(`[live:${KEY}] e2eInvoke never appeared`); child.kill('SIGKILL'); restoreDebugLog(); process.exit(1); }
console.log(`[live:${KEY}] e2eInvoke bridge ready`);

const report = { model_id: KEY, userData: USERDATA, uploads: [], queries: [], errors: [] };

try {
  // Modes are a Pro feature; `modes:create` answers `pro_required` otherwise.
  // This is the E2E harness's own entitlement switch, registered only under
  // NATIVELY_E2E=1 and writing to the throwaway userData, so it grants nothing
  // in a shipped app and nothing in the user's real profile.
  const pro = await invoke('__e2e__:enable-pro');
  report.proEnabled = pro?.success !== false;
  console.log(`[live:${KEY}] pro enabled: ${report.proEnabled}`);

  // Pin the app to the BUNDLED LOCAL embedder.
  //
  // Without this the first run indexed every file `lexical_only` with
  // embeddedChunkCount 0: a fresh userData has no cloud credentials, the
  // resolver yields no candidate, and reference files index without vectors.
  // `local-embedding ready` in the log is only "the asset loads" — it does not
  // mean anything was embedded. Worth stating plainly because it is a real
  // property of a credential-less install, not an artefact of this harness.
  const cfg = process.env.SKIP_SET_CONFIG === '1'
    ? { skipped: true }
    : await invoke('embedding:set-config', {
        mode: 'manual', provider: 'local',
        ...(process.env.SET_LOCAL_MODEL ? { model: process.env.SET_LOCAL_MODEL } : {}),
      });
  report.embeddingConfig = cfg;
  console.log(`[live:${KEY}] embedding:set-config local → ${JSON.stringify(cfg).slice(0, 160)}`);

  // FORCE THE LAZY LOAD before anything is indexed.
  //
  // The resolver registers the bundled model "for lazy load" and
  // LocalEmbeddingProvider.isLoaded() deliberately reports false until the
  // first real embed, so EmbeddingPipeline.isReady() is false and every
  // indexing path correctly declines to block on it — which left the index at
  // `embedded 0/9` with no error anywhere. `embedding:test` performs a real
  // embed, which loads the ONNX worker; after it, indexing writes vectors.
  const warm = await invoke('embedding:test', { provider: 'local' });
  report.providerWarmup = warm;
  console.log(`[live:${KEY}] embedding:test → ${JSON.stringify(warm).slice(0, 200)}`);

  let modeId;
  if (REUSE_MODE) {
    const all = await invoke('modes:get-all');
    const found = (Array.isArray(all) ? all : all?.modes || []).find((m) => m.name === MODE_NAME);
    modeId = found?.id;
    report.reusedMode = { name: MODE_NAME, referenceFileCount: found?.referenceFileCount ?? null };
  } else {
    const mode = await invoke('modes:create', { name: MODE_NAME, templateType: 'team-meet' });
    modeId = mode?.mode?.id || mode?.id || mode?.data?.id;
  }
  if (!modeId) throw new Error(REUSE_MODE ? `no existing mode named "${MODE_NAME}" in ${USERDATA}` : 'no mode id from modes:create');
  report.modeId = modeId;
  console.log(`[live:${KEY}] mode ${modeId}`);
  await invoke('modes:set-active', modeId);
  report.embeddingStatusAtStart = await invoke('embedding:get-status');
  // What the app has done ON ITS OWN by now — before this harness calls any
  // __e2e__ reindex. For an upgrade run this is the honest migration state.
  report.indexStatusAtStart = (await invoke('__e2e__:index-status', modeId))?.statuses || [];
  console.log(`[live:${KEY}] index at start: [${report.indexStatusAtStart.map((x) => `${x.status}:${x.embeddedChunkCount}/${x.chunkCount}`).join(' ')}]`);
  console.log(`[live:${KEY}] embedding status: ${JSON.stringify(report.embeddingStatusAtStart?.active ?? report.embeddingStatusAtStart).slice(0, 220)}`);

  // ── real uploads, one per major supported category ───────────────────────
  for (const f of (REUSE_MODE ? [] : fixtures)) {
    const t0 = Date.now();
    const res = await invoke('__e2e__:upload-reference-file-from-path', { modeId, filePath: path.join(FIXTURES, f.name) });
    const row = {
      file: f.name, category: f.category, ok: !!res?.success,
      error: res?.error ?? null, ms: Date.now() - t0,
      extractedChars: res?.file?.content?.length ?? res?.file?.charCount ?? null,
    };
    report.uploads.push(row);
    console.log(`[live:${KEY}] upload ${f.name.padEnd(20)} ${row.ok ? 'OK' : 'FAIL ' + row.error} (${row.ms}ms, ${row.extractedChars ?? '?'} chars)`);
  }

  // `__e2e__:prewarm-mode` alone is NOT enough: it re-indexes files whose
  // status is not 'ready', but a file ingested before the embedding pipeline
  // was wired is already recorded 'lexical_only', and prewarm returned in 20ms
  // having embedded nothing. `reindex-embeddings` is the channel that wires the
  // shared pipeline, waits for it, and calls retryAllLexicalOnlyFiles().
  const tPre = Date.now();
  const reindex = await invoke('__e2e__:reindex-embeddings', modeId);
  report.prewarmMs = Date.now() - tPre;
  report.reindex = reindex;
  // QUERY DURING INDEXING — measured, not avoided.
  //
  // `reindex-embeddings` can return while the upload-time indexing job is still
  // running (a per-file in-flight guard makes the retry a no-op), so a user who
  // asks right after uploading hits a half-built index. The first sweep read the
  // counts at exactly that moment and reported larger models as `0/5 embedded`
  // when they were merely unfinished. That moment is real UX, so probe it once,
  // record it separately, and only THEN wait for the index to settle.
  {
    const probeQ = QUERIES[1];
    const t0 = Date.now();
    const r = await invoke('__e2e__:inspect-retrieval', { modeId, query: probeQ.q, forceDocumentGrounding: true });
    const snippets = parseSnippets(r?.block || '');
    const st = (await invoke('__e2e__:index-status', modeId))?.statuses || [];
    report.duringIndexing = {
      query: probeQ.q, ms: Date.now() - t0, snippetCount: snippets.length,
      denseScoredSnippets: snippets.filter((sn) => typeof sn.vectorScore === 'number').length,
      top1Correct: !!snippets[0] && probeQ.answer.test(snippets[0].text),
      statusesAtProbe: st.map((x) => `${x.status}:${x.embeddedChunkCount}/${x.chunkCount}`),
    };
    console.log(`[live:${KEY}] during-indexing probe ${report.duringIndexing.ms}ms snippets=${snippets.length} ` +
      `correct=${report.duringIndexing.top1Correct} [${report.duringIndexing.statusesAtProbe.join(' ')}]`);
  }

  // Wait until every file reaches a TERMINAL index state before reading counts.
  const TERMINAL = new Set(['ready', 'lexical_only', 'failed', 'ocr_required']);
  const settleT0 = Date.now();
  let settled = false;
  while (Date.now() - settleT0 < 180_000) {
    const st = (await invoke('__e2e__:index-status', modeId))?.statuses || [];
    if (st.length && st.every((x) => TERMINAL.has(x.status))) { settled = true; break; }
    await sleep(500);
  }
  report.indexSettled = settled;
  report.indexSettleMs = Date.now() - settleT0;
  if (!settled) report.errors.push('index did not reach a terminal state within 180s');

  report.indexStatus = await invoke('__e2e__:index-status', modeId);
  const statuses = report.indexStatus?.statuses || [];
  report.embeddedChunkTotal = statuses.reduce((a, s) => a + (s.embeddedChunkCount || 0), 0);
  report.chunkTotal = statuses.reduce((a, s) => a + (s.chunkCount || 0), 0);
  // A live run that embedded nothing proves nothing about the model.
  report.vectorsActuallyWritten = report.embeddedChunkTotal > 0;
  console.log(`[live:${KEY}] settled=${report.indexSettled} after +${report.indexSettleMs}ms  embedded ${report.embeddedChunkTotal}/${report.chunkTotal} chunks  vectorsWritten=${report.vectorsActuallyWritten}  [${statuses.map((x) => x.status).join(',')}]`);

  // ── real retrieval ───────────────────────────────────────────────────────
  for (const { q, answer } of QUERIES) {
    appLog.push(`\n===== EMBBENCH QUERY START: ${q} =====\n`);
    const t0 = Date.now();
    let r, invokeError = null;
    try { r = await invoke('__e2e__:inspect-retrieval', { modeId, query: q, forceDocumentGrounding: true }); }
    catch (e) { invokeError = String(e.message || e); }
    if (!r?.success && !invokeError) invokeError = r ? `handler error: ${r.error}` : 'invoke returned undefined';
    const ms = Date.now() - t0;
    const block = r?.block || '';
    const snippets = parseSnippets(block);
    const top = snippets[0] || null;
    const firstCorrect = snippets.findIndex((sn) => answer.test(sn.text));
    const denseScored = snippets.filter((sn) => typeof sn.vectorScore === 'number').length;
    report.queries.push({
      query: q, ms, ok: !!r?.success, invokeError,
      retrievalConfidence: r?.retrievalConfidence ?? null,
      blockLength: r?.blockLength ?? block.length,
      snippetCount: snippets.length,
      denseScoredSnippets: denseScored,
      top1Correct: firstCorrect === 0,
      firstCorrectRank: firstCorrect === -1 ? null : firstCorrect + 1,
      ranked: snippets.map(({ text, ...rest }) => ({ ...rest, preview: text.replace(/\s+/g, ' ').slice(0, 120) })),
    });
    console.log(`[live:${KEY}] "${q.slice(0, 44)}…" ${ms}ms  snippets=${snippets.length} dense=${denseScored}  ` +
      `top=${top ? top.fileName + "#" + top.chunkIndex : "-"}  correct@${firstCorrect === -1 ? "MISS" : firstCorrect + 1}${invokeError ? "  INVOKE-FAILED: " + invokeError.slice(0, 90) : ""}`);
  }
} catch (e) {
  report.errors.push(String(e.message || e));
  console.error(`[live:${KEY}] ERROR ${e.message}`);
}

// Evidence that the live app really used this model.
const fullLog = appLog.join('');
const loadLine = (fullLog.match(/Loading feature-extraction model \(([^,)]+)/) || [])[1] || null;
report.modelLoadedInApp = loadLine;
report.cdpErrors = cdpErrors;
report.expectedModelId = KEY === 'minilm-baseline' ? 'Xenova/all-MiniLM-L6-v2' : null;
report.appLogEvidence = fullLog
  .split('\n')
  .filter((l) => /LocalEmbeddingWorker|local-embedding|embedding_space|Ensured vec0|ProviderStatus/.test(l))
  .slice(0, 40);

const outDir = path.join(REPO, 'results', 'live-session');
// Full app log beside the JSON, so an unexpected result can be diagnosed from
// what the app actually did rather than from the filtered evidence lines.
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${KEY}${process.env.RUN_TAG ? '.' + process.env.RUN_TAG : ''}.app.log`), fullLog);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${KEY}.json`), JSON.stringify(report, null, 2));
console.log(`[live:${KEY}] written results/live-session/${KEY}.json`);

try { ws.close(); } catch { /* */ }
child.kill('SIGTERM');
await sleep(1500);
try { child.kill('SIGKILL'); } catch { /* */ }
if (!LIVE_USERDATA) { try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch { /* */ } }
restoreDebugLog();
process.exit(report.errors.length ? 1 : 0);
