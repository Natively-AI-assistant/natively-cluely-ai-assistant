/**
 * Phase 2 retrieval bake-off — bootstrap.
 *
 * Loads the REAL compiled retrieval stack from dist-electron and brings it to a
 * state where vector retrieval genuinely works. Every step here exists because
 * skipping it fails SILENTLY (see docs/context-intelligence-v3/02_RETRIEVAL_BENCHMARK.md §4A).
 *
 * MUST be run as:
 *   NATIVELY_TEST_USERDATA=<dir> ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <script>
 *
 * Not system node: better-sqlite3 and sqlite-vec are built for Electron's ABI.
 * We deliberately do NOT install the node:sqlite shim that
 * benchmarks/profile-intelligence/harness.cjs uses — that shim exists only
 * because that harness runs under system node, and it would silently disable
 * loadExtension (i.e. kill sqlite-vec) here.
 */
'use strict';

const Module = require('module');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(REPO_ROOT, 'dist-electron');

// ── 1. electron stub ────────────────────────────────────────────────────────
// Required even under ELECTRON_RUN_AS_NODE=1: in that mode require('electron')
// returns a PATH STRING, so EmbeddingPipeline's resolveModelPath blows up on
// `app.isPackaged` (dist-electron/electron/rag/EmbeddingPipeline.js:738).
function installElectronStub() {
  const noop = () => {};
  const userData = process.env.NATIVELY_TEST_USERDATA;
  if (!userData) throw new Error('NATIVELY_TEST_USERDATA must be set before bootstrap');
  fs.mkdirSync(userData, { recursive: true });

  const stub = {
    app: {
      getPath: (k) => (k === 'userData' ? userData : path.join(userData, k)),
      getAppPath: () => REPO_ROOT,
      isPackaged: false,
      getName: () => 'natively-bench',
      getVersion: () => '0.0.0-bench',
      on: noop, whenReady: () => Promise.resolve(), quit: noop,
    },
    BrowserWindow: class { static getAllWindows() { return []; } },
    ipcMain: { handle: noop, on: noop, removeHandler: noop, removeAllListeners: noop },
    shell: { openExternal: noop },
    dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
    Tray: class {},
    globalShortcut: { register: noop, unregister: noop, unregisterAll: noop },
    desktopCapturer: { getSources: () => Promise.resolve([]) },
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    powerMonitor: { on: noop },
    session: { defaultSession: { webRequest: { onHeadersReceived: noop } } },
    nativeTheme: { on: noop, shouldUseDarkColors: false },
  };

  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return stub;
    return origLoad.apply(this, arguments);
  };
}

const d = (rel) => require(path.join(DIST, rel));

// ── 2. bring up DB + embeddings ─────────────────────────────────────────────
async function boot({ verbose = true } = {}) {
  installElectronStub();
  const log = verbose ? (...a) => console.log('[boot]', ...a) : () => {};

  // First getInstance() fixes the DB path from NATIVELY_TEST_USERDATA.
  const { DatabaseManager } = d('electron/db/DatabaseManager.js');
  const db = DatabaseManager.getInstance();
  log('db ready');

  const { VectorStore } = d('electron/rag/VectorStore.js');
  const { EmbeddingPipeline } = d('electron/rag/EmbeddingPipeline.js');

  // Mirror main.ts:2106-2114 exactly: RAGManager is handed the RAW sqlite handle
  // plus dbPath/extPath — not the DatabaseManager wrapper. Passing the wrapper
  // makes EmbeddingPipeline throw `this.db.prepare is not a function`, which it
  // CATCHES and downgrades to "local-only mode" — embeddings then never persist
  // and every vector config silently reads back null. (§4A.1)
  const raw = db.getDb();
  if (!raw || typeof raw.prepare !== 'function') {
    throw new Error('DatabaseManager.getDb() did not yield a raw sqlite handle');
  }
  const vectorStore = new VectorStore(raw, db.getDbPath(), db.getExtPath());

  const pipe = new EmbeddingPipeline(raw, vectorStore);
  await pipe.initialize({});           // {} → bundled local MiniLM, fully offline
  await pipe.waitForReady(60_000);     // provider RESOLUTION only — not model load

  // THE critical step. Without this first real embedding, isReady() stays false
  // and every vector config silently degrades to lexical (§4A.1).
  await pipe.getEmbeddingForQuery('warmup');

  if (!pipe.isReady()) throw new Error('embedding pipeline not ready after warm-up — vector configs would be void');
  const spaceKey = pipe.getActiveSpaceKey ? pipe.getActiveSpaceKey() : null;
  log('embeddings ready · space =', spaceKey);

  return { db, raw, vectorStore, pipe, spaceKey, d };
}

// ── 3. validity assertions ──────────────────────────────────────────────────
// A benchmark run that violates either of these is VOID, not merely poor —
// it would report lexical numbers under a vector label.
// mode_reference_chunks is keyed by file_id, not mode_id
// (ModeHybridRetriever.ts:254-263) — scope via mode_reference_files.
function assertVectorRunValid({ db, spaceKey, fileIds }) {
  const raw = db.getDb();
  if (!Array.isArray(fileIds) || !fileIds.length) throw new Error('VOID: no fileIds supplied');
  const placeholders = fileIds.map(() => '?').join(',');
  const rows = raw.prepare(
    `SELECT file_id, chunk_index, embedding IS NOT NULL AS hasVec, embedding_space
       FROM mode_reference_chunks
      WHERE file_id IN (${placeholders}) LIMIT 500`,
  ).all(...fileIds);

  if (!rows.length) throw new Error(`VOID: no mode_reference_chunks for files ${fileIds.join(',')}`);
  const noVec = rows.filter((r) => !r.hasVec);
  if (noVec.length) throw new Error(`VOID: ${noVec.length}/${rows.length} chunks have no embedding`);
  const mismatched = rows.filter((r) => r.embedding_space !== spaceKey);
  if (mismatched.length) {
    throw new Error(
      `VOID: embedding_space mismatch — pipeline="${spaceKey}" chunks="${mismatched[0].embedding_space}". ` +
      'loadPersistedEmbeddings filters on exact match, so every vectorScore would be 0.',
    );
  }
  return { chunkCount: rows.length, spaceKey };
}

module.exports = { boot, assertVectorRunValid, installElectronStub, DIST, REPO_ROOT, d };
