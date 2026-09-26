// scripts/okf-export-thesis-bundle.js
//
// OKF Phase 2 — generates a Knowledge Pack from the real thesis PDF (pure
// extraction pipeline, no DB) and exports it as an OKF v0.1-compatible
// Markdown bundle to debug-artifacts/okf-thesis-benchmark/okf-bundle/,
// including a references/ subdirectory with the source citation stub.
// Verifies conformance before writing.
//
// Run: node scripts/okf-export-thesis-bundle.js
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const PDF_PATH = path.join(repoRoot, 'Sample thesis for testing.pdf');
const OUT_DIR = path.join(repoRoot, 'debug-artifacts', 'okf-thesis-benchmark', 'okf-bundle');

async function ingestPdfText(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  if (pdfjsLib) {
    try {
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = require('node:url').pathToFileURL(workerPath).href;
    } catch { /* best effort */ }
  }
  const { PDFParse } = require('pdf-parse');
  const data = await new PDFParse({ data: fs.readFileSync(pdfPath) }).getText();
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    return { content: data.pages.map((p) => `[Page ${p.num}]\n${typeof p.text === 'string' ? p.text : ''}`).join('\n\n'), pageCount: data.pages.length };
  }
  return { content: data.text || '', pageCount: 0 };
}

function sha256(text) {
  return require('node:crypto').createHash('sha256').update(text).digest('hex');
}

async function main() {
  const { content, pageCount } = await ingestPdfText(PDF_PATH);
  console.log(`[okf-export] ingested ${content.length} chars, ${pageCount} pages`);

  const { extractFromContent } = require(path.join(distRoot, 'services/knowledge/OkfExtractor.js'));
  const { buildKnowledgeCards, buildKnowledgeEntities, linkRelatedCards } = require(path.join(distRoot, 'services/knowledge/OkfCardBuilder.js'));
  const { verifyCards } = require(path.join(distRoot, 'services/knowledge/OkfVerifier.js'));
  const { exportPack, exportBundleRoot } = require(path.join(distRoot, 'services/knowledge/OkfMarkdownExporter.js'));
  const { checkConformance } = require(path.join(distRoot, 'services/knowledge/OkfConformance.js'));

  const bundleDir = 'thesis';
  const sourceChecksum = sha256(content);
  const { cards: cardDrafts, entities: entityDrafts } = extractFromContent(content, bundleDir);
  const nowIso = new Date().toISOString();

  let cards = buildKnowledgeCards(cardDrafts, { packId: 'pack_thesis', sourceId: 'src_thesis', sourceChecksum, nowIso });
  const { accepted, rejected } = verifyCards(cards, content);
  cards = linkRelatedCards(accepted);
  console.log(`[okf-export] ${cards.length} cards accepted, ${rejected.length} rejected`);

  const cardsByConceptId = new Map(cards.map((c) => [c.conceptId, c]));
  const entities = buildKnowledgeEntities(entityDrafts, cardsByConceptId, { packId: 'pack_thesis', nowIso }).filter((e) => e.sourceCardIds.length > 0);

  const sourcePages = new Set();
  const sourceSections = new Set();
  for (const c of cards) {
    c.sourcePages.forEach((p) => sourcePages.add(p));
    c.sourceSections.forEach((s) => sourceSections.add(s));
  }

  const pack = {
    id: 'pack_thesis', sourceId: 'src_thesis', modeId: 'mode_thesis_bench', fileName: 'Sample thesis for testing.pdf',
    cards, entities, relations: [], indexMd: '',
    stats: { cardCount: cards.length, entityCount: entities.length, relationCount: 0, sourcePages: sourcePages.size, sourceSections: sourceSections.size, avgConfidence: 0.9, extractionMs: 0 },
    packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: nowIso,
  };

  const sourceFileId = 'ref_sample_thesis_001';
  const packFiles = exportPack(pack, { sourceFileId, sourceFileName: pack.fileName, bundleDirOverride: bundleDir });
  const rootFiles = exportBundleRoot([pack]);

  // references/ subdirectory: a stub citation file pointing back at the
  // original uploaded source (per the spec's target tree).
  const referencesFile = {
    path: 'references/sample-thesis-for-testing.md',
    content: [
      '---',
      'type: Reference Source',
      `title: "${pack.fileName}"`,
      `description: "Original uploaded reference file backing the thesis/ knowledge bundle."`,
      `resource: natively://reference-file/${sourceFileId}`,
      `source_checksum: ${sourceChecksum}`,
      `source_pages: [${[...sourcePages].sort((a, b) => a - b).join(', ')}]`,
      `timestamp: ${nowIso}`,
      '---',
      '',
      `# ${pack.fileName}`,
      '',
      `Original source document for the [[thesis]] knowledge bundle. ${pack.stats.cardCount} cards extracted across ${pageCount} pages.`,
      '',
    ].join('\n'),
  };

  const allFiles = [...rootFiles, ...packFiles, referencesFile];

  const conformance = checkConformance(allFiles);
  console.log(`[okf-export] conformant=${conformance.conformant} violations=${conformance.violations.length}`);
  if (!conformance.conformant) {
    console.error(conformance.violations);
    process.exit(1);
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  for (const f of allFiles) {
    const fp = path.join(OUT_DIR, f.path);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, f.content);
  }
  console.log(`[okf-export] wrote ${allFiles.length} files to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('[okf-export] FATAL', err);
  process.exit(2);
});
