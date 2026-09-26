// PHASE 0 FORENSICS probe — reproduce the REAL manual doc-grounded retrieval
// path against the LIVE polluted DB, capturing all [FIX2-TRACE] lines.
//
// Runs under real Electron (better-sqlite3 ABI). Points DatabaseManager at the
// real natively userData via NATIVELY_TEST_USERDATA so we retrieve against the
// ACTUAL Seminar mode + its live reference file(s).
//
// Usage:
//   NATIVELY_LIVE_EMBED=1 ./node_modules/.bin/electron tests/e2e-modes/_livetrace.js
//   (NATIVELY_LIVE_EMBED unset → force lexical-only, embeddings disabled)
const path = require('path');
const os = require('os');
const { app } = require('electron');

// Point the DB at the REAL live natively userData (not bare-electron "Electron").
const REAL_USERDATA = path.join(os.homedir(), 'Library', 'Application Support', 'natively');
process.env.NATIVELY_TEST_USERDATA = REAL_USERDATA;

const HARD_TIMEOUT_MS = 60000;
setTimeout(() => { console.error('[PROBE] hard timeout'); process.exit(3); }, HARD_TIMEOUT_MS);

const QUERIES = [
  { tag: 'FAIL-1 phases', q: 'What are the four main phases of the project?' },
  { tag: 'FAIL-2 research-qs', q: 'What are the two research questions?' },
  { tag: 'FAIL-3 models', q: 'What models were compared in the experiments?' },
  { tag: 'PASS-1 methodology', q: 'Explain the research methodology' },
  { tag: 'PASS-2 mercury-specs', q: 'What are the specifications of the Mercury X1 robot?' },
  { tag: 'C2 hyperparams', q: 'What hyperparameters were used to finetune the model?' },
];

const MODE_ID = 'mode_dd5765eb-f83b-487f-930a-0ffdd3eb6e04';
const GOOD_FILE = 'ref_9b5fe304-e51a-4e94-bced-d50bd291a10e';

async function main() {
  const dist = path.join(__dirname, '..', '..', 'dist-electron', 'electron');
  const { DatabaseManager } = require(path.join(dist, 'db', 'DatabaseManager'));
  const { ModesManager } = require(path.join(dist, 'services', 'ModesManager'));
  const { CredentialsManager } = require(path.join(dist, 'services', 'CredentialsManager'));

  const dbm = DatabaseManager.getInstance();
  const db = dbm.getDb();
  console.log('[PROBE] dbPath=', dbm.getDbPath(), 'dbOpen=', !!db);

  // Confirm live state.
  const files = db.prepare('SELECT id, file_name, LENGTH(content) len FROM mode_reference_files WHERE mode_id=?').all(MODE_ID);
  console.log('[PROBE] live reference files for mode:', files.map(f => ({ id: f.id.slice(0,12), name: f.file_name, len: f.len })));
  const idxRows = db.prepare('SELECT file_id, chunk_count, status, embedding_space FROM mode_reference_index_state').all();
  console.log('[PROBE] index_state rows:', idxRows.map(r => ({ id: r.file_id.slice(0,12), chunks: r.chunk_count, status: r.status, space: r.embedding_space })));

  // Wire embeddings. Try to load real credentials; if the keyring can't decrypt
  // (bare electron identity), the pipeline falls back to local — which is what
  // a keyless user experiences. NATIVELY_LIVE_EMBED gates whether we even try.
  let geminiPresent = false;
  try { CredentialsManager.getInstance().init(); const k = CredentialsManager.getInstance().getGeminiApiKey(); geminiPresent = !!k && k.length > 0; } catch (e) { console.log('[PROBE] cred init err:', e && e.message); }
  console.log('[PROBE] geminiKeyPresent(from credentials)=', geminiPresent);

  const wantEmbed = process.env.NATIVELY_LIVE_EMBED === '1';
  const mm = ModesManager.getInstance();

  if (wantEmbed) {
    try {
      const { VectorStore } = require(path.join(dist, 'rag', 'VectorStore'));
      const { EmbeddingPipeline } = require(path.join(dist, 'rag', 'EmbeddingPipeline'));
      const vs = new VectorStore(db, dbm.getDbPath(), dbm.getExtPath ? dbm.getExtPath() : '');
      const ep = new EmbeddingPipeline(db, vs);
      const geminiKey = (() => { try { return CredentialsManager.getInstance().getGeminiApiKey(); } catch { return undefined; } })()
        || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      await ep.initialize({ geminiKey, geminiKeys: geminiKey ? [geminiKey] : [], ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434' });
      try { await ep.waitForReady(8000); } catch (e) { console.log('[PROBE] waitForReady:', e && e.message); }
      console.log('[PROBE] embed pipeline ready=', ep.isReady(), 'space=', ep.getActiveSpaceKey && ep.getActiveSpaceKey(), 'provider=', ep.getActiveProviderName && ep.getActiveProviderName());
      mm.setSharedEmbeddingPipeline(ep);
    } catch (e) {
      console.log('[PROBE] embed wiring failed:', e && e.message);
    }
  } else {
    console.log('[PROBE] NATIVELY_LIVE_EMBED not set — no embedder wired (lexical-only path).');
  }

  // Activate the mode (mirrors setActiveMode on the live app).
  try { db.prepare('UPDATE modes SET is_active = CASE WHEN id=? THEN 1 ELSE 0 END').run(MODE_ID); } catch (e) { console.log('[PROBE] activate err', e && e.message); }
  const grounding = mm.getActiveModeDocumentGroundingInfo ? mm.getActiveModeDocumentGroundingInfo() : null;
  console.log('[PROBE] grounding info:', grounding);

  for (const { tag, q } of QUERIES) {
    console.log('\n==================== QUERY [' + tag + '] : ' + q + ' ====================');
    try {
      // EXACT live call shape from LLMHelper.ts:4310 (main answer path).
      const block = await mm.buildRetrievedActiveModeContextBlockHybrid(
        q, undefined, undefined, 'lecture_answer', true, undefined, /*allowRerank*/ true,
        { forceDocumentGrounding: true },
      );
      const snippetCount = (block.match(/<snippet>/g) || []).length;
      const secsInBlock = [...block.matchAll(/\[Section\s+([\d.]+)/g)].map(m => m[1]);
      console.log('[PROBE] MAIN(hybrid) block snippetCount=' + snippetCount + ' blockLen=' + block.length + ' sectionsInBlock=' + JSON.stringify(secsInBlock));

      // EXACT completeness-validator call shape from ipcHandlers.ts:2252 (sync lexical).
      const vBlock = mm.buildRetrievedActiveModeContextBlock(
        q, undefined, 3600, 'lecture_answer', true, undefined, { forceDocumentGrounding: true },
      ) || '';
      const vSecs = [...vBlock.matchAll(/\[Section\s+([\d.]+)/g)].map(m => m[1]);
      console.log('[PROBE] VALIDATOR(lexical) block snippets=' + ((vBlock.match(/<snippet>/g) || []).length) + ' sectionsInBlock=' + JSON.stringify(vSecs));
    } catch (e) {
      console.log('[PROBE] query threw:', e && e.stack || e);
    }
  }

  console.log('\n[PROBE] DONE');
  app.exit(0);
}

app.whenReady().then(() => main().catch(e => { console.error('[PROBE] fatal', e && e.stack || e); app.exit(2); }));
