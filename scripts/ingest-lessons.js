// scripts/ingest-lessons.js
//
// Bulk-ingest system-design lesson files into the persistent LESSON corpus.
// Uses the REAL prod userData dir so lessons survive app restarts.
//
// Setup:
//   npm run build:electron
//
// Run:
//   NATIVELY_E2E=1 NATIVELY_API_KEY=<key> \
//     ./node_modules/.bin/electron scripts/ingest-lessons.js \
//     [/path/to/lesson-dir]
//
// Defaults to lessons/hellointerview-system-design in the repo root.
// Pass NATIVELY_LESSONS_USERDATA=<path> to override the userData directory.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

if (!process.env.NATIVELY_API_KEY) {
  console.error('[ingest-lessons] ERROR: NATIVELY_API_KEY is required');
  process.exit(1);
}
if (process.env.NATIVELY_E2E !== '1') {
  console.error('[ingest-lessons] ERROR: must be run with NATIVELY_E2E=1');
  process.exit(1);
}

const lessonDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'lessons', 'hellointerview-system-design');

if (!fs.existsSync(lessonDir)) {
  console.error(`[ingest-lessons] ERROR: lesson dir not found: ${lessonDir}`);
  process.exit(1);
}

if (process.env.NATIVELY_LESSONS_USERDATA) {
  app.setPath('userData', process.env.NATIVELY_LESSONS_USERDATA);
}

function walkMd(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkMd(full));
    else if (/\.(md|txt)$/i.test(entry.name) && entry.name !== 'README.md') results.push(full);
  }
  return results;
}

app.whenReady().then(async () => {
  try {
    const mainMod = require(path.join(distRoot, 'main.js'));
    const { AppState } = mainMod;
    if (!AppState) {
      console.error('[ingest-lessons] ERROR: AppState not exported from main.js');
      app.exit(1);
      return;
    }

    // Give main.ts time to boot DB, RAGManager, and KnowledgeOrchestrator.
    console.log('[ingest-lessons] Waiting for app to initialize...');
    await new Promise((r) => setTimeout(r, 6000));

    const appState = AppState.getInstance();
    const orchestrator = appState.getKnowledgeOrchestrator();
    if (!orchestrator) {
      console.error('[ingest-lessons] ERROR: KnowledgeOrchestrator not initialized (check NATIVELY_API_KEY and embedding provider)');
      app.exit(1);
      return;
    }

    const { DocType } = require(path.join(distRoot, 'knowledge', 'types.js'));
    const files = walkMd(lessonDir);
    console.log(`[ingest-lessons] Found ${files.length} lesson files in ${lessonDir}`);

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = path.relative(lessonDir, f);
      process.stdout.write(`[${i + 1}/${files.length}] ${rel} ... `);
      const result = await orchestrator.ingestDocument(f, DocType.LESSON);
      if (result?.success) {
        ok++;
        process.stdout.write('OK\n');
      } else {
        fail++;
        process.stdout.write(`FAIL: ${result?.error || 'unknown'}\n`);
      }
    }

    console.log(`\n[ingest-lessons] Done: ${ok} ingested, ${fail} failed`);
    app.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('[ingest-lessons] fatal:', e);
    app.exit(1);
  }
});
