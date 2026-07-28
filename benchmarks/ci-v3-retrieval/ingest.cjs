/**
 * Phase 2 bake-off — corpus ingestion.
 *
 * Loads the labelled corpus into a real mode so the production retrievers can
 * see it. Uses ModesManager.addReferenceFile (text already in memory) rather
 * than ingestModeReferenceFile, because the latter fires indexing in a
 * FLOATING promise (ModeReferenceFileIngestion.ts:75-88) that a harness cannot
 * await — indexing would race the first query and configs would read a
 * half-built index.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(REPO_ROOT, 'dist-electron');
const d = (rel) => require(path.join(DIST, rel));

/**
 * @param {{pipe:any, spaceKey:string}} boot
 * @param {Array<{path:string, label:string}>} docs
 */
async function ingestCorpus({ pipe, spaceKey }, docs, { modeName = 'CIv3 Bench', verbose = true } = {}) {
  const log = verbose ? (...a) => console.log('[ingest]', ...a) : () => {};
  const { ModesManager } = d('electron/services/ModesManager.js');
  const { extractSafeDocumentText } = d('electron/services/SafeDocumentTextExtractor.js');
  const mm = ModesManager.getInstance();

  // A "custom mode" in this codebase is templateType 'general' with a name that
  // is NOT the literal 'General' (ModesManager.isCustomMode). Using a distinct
  // name is what makes document-grounding eligible.
  const mode = mm.createMode({ name: modeName, templateType: 'general' });
  log('mode', mode.id, 'custom =', mm.isCustomMode ? mm.isCustomMode(mode) : 'n/a');

  // MUST precede indexing — otherwise ModesManager builds its own uninitialised
  // pipeline and every chunk is written with a null embedding (§4A.1).
  mm.setSharedEmbeddingPipeline(pipe);

  const ingested = [];
  for (const doc of docs) {
    const abs = path.join(REPO_ROOT, doc.path);
    if (!fs.existsSync(abs)) { log('SKIP missing', doc.path); continue; }

    let content;
    let pageCount;
    try {
      const res = await extractSafeDocumentText(abs);
      content = typeof res === 'string' ? res : (res?.content ?? '');
      pageCount = typeof res === 'object' ? res?.pageCount : undefined;
    } catch (e) {
      log('SKIP unextractable', doc.path, '·', e.message);
      continue;
    }

    // An empty file is a REAL corpus case (§7.9 #26), not an error. Record it
    // and let the benchmark observe what the pipeline reports for it.
    if (!content.trim()) {
      log('EMPTY (kept as a test case)', doc.path);
      ingested.push({ label: doc.label, path: doc.path, file: null, empty: true });
      continue;
    }

    const file = mm.addReferenceFile({
      modeId: mode.id,
      fileName: path.basename(doc.path),
      content,
      pageCount,
    });
    await mm.indexReferenceFile(file);
    ingested.push({ label: doc.label, path: doc.path, file, empty: false, chars: content.length });
    log('indexed', path.basename(doc.path), `${content.length} chars`);
  }

  return { mode, ingested, files: mm.getReferenceFiles ? mm.getReferenceFiles(mode.id) : [] };
}

module.exports = { ingestCorpus };
