/**
 * OKF Phase 4 (2026-07-01): graph relation extraction + expansion tests
 * against the real thesis pack.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const PDF_PATH = path.join(repoRoot, 'Sample thesis for testing.pdf');

async function loadModule(relPath) {
  return import(pathToFileURL(path.join(distRoot, relPath)).href);
}

async function ingestPdfText(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  if (pdfjsLib) {
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    } catch { /* best effort */ }
  }
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { PDFParse } = require('pdf-parse');
  const data = await new PDFParse({ data: fs.readFileSync(pdfPath) }).getText();
  if (Array.isArray(data.pages) && data.pages.length > 0) {
    return data.pages.map((p) => `[Page ${p.num}]\n${typeof p.text === 'string' ? p.text : ''}`).join('\n\n');
  }
  return data.text || '';
}

let cachedPack = null;
async function buildPack() {
  if (cachedPack) return cachedPack;
  const content = await ingestPdfText(PDF_PATH);
  const { extractFromContent } = await loadModule('services/knowledge/OkfExtractor.js');
  const { buildKnowledgeCards, buildKnowledgeEntities, linkRelatedCards } = await loadModule('services/knowledge/OkfCardBuilder.js');
  const { verifyCards } = await loadModule('services/knowledge/OkfVerifier.js');
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');

  const sourceChecksum = crypto.createHash('sha256').update(content).digest('hex');
  const { cards: cardDrafts, entities: entityDrafts } = extractFromContent(content, 'thesis');
  const nowIso = new Date().toISOString();
  let cards = buildKnowledgeCards(cardDrafts, { packId: 'pack_test', sourceId: 'src_test', sourceChecksum, nowIso });
  const { accepted } = verifyCards(cards, content);
  cards = linkRelatedCards(accepted);
  const cardsByConceptId = new Map(cards.map((c) => [c.conceptId, c]));
  const entities = buildKnowledgeEntities(entityDrafts, cardsByConceptId, { packId: 'pack_test', nowIso }).filter((e) => e.sourceCardIds.length > 0);
  const relations = extractGraphRelations(cards, entities);

  cachedPack = {
    id: 'pack_test', sourceId: 'src_test', modeId: 'mode_test', fileName: 'Sample thesis for testing.pdf',
    cards, entities, relations, indexMd: '',
    stats: { cardCount: cards.length, entityCount: entities.length, relationCount: relations.length, sourcePages: 0, sourceSections: 0, avgConfidence: 0, extractionMs: 0 },
    packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: nowIso,
  };
  return cachedPack;
}

test('GraphExtractor: produces at least one relation from the real thesis', async () => {
  const pack = await buildPack();
  assert.ok(pack.relations.length > 0, `expected >0 relations, got ${pack.relations.length}`);
});

test('GraphExtractor: every relation has sourceCardIds and sourcePages', async () => {
  const pack = await buildPack();
  for (const r of pack.relations) {
    assert.ok(r.sourceCardIds.length > 0, `relation ${r.id} missing sourceCardIds`);
    assert.ok(r.sourcePages.length > 0, `relation ${r.id} missing sourcePages`);
    assert.ok(['high', 'medium', 'low'].includes(r.confidence));
  }
});

test('GraphExtractor: extracts OpenVLA-OFT extends/improves OpenVLA', async () => {
  const pack = await buildPack();
  const entityById = new Map(pack.entities.map((e) => [e.id, e]));
  const cardById = new Map(pack.cards.map((c) => [c.id, c]));
  const nameOf = (id, type) => (type === 'entity' ? entityById.get(id)?.name : cardById.get(id)?.title) || '';
  const found = pack.relations.some((r) =>
    nameOf(r.subjectId, r.subjectType).toLowerCase().includes('openvla-oft')
    && nameOf(r.objectId, r.objectType).toLowerCase() === 'openvla'
    && (r.predicate === 'extends' || r.predicate === 'improves_over' || r.predicate === 'based_on'),
  );
  assert.ok(found, 'expected an OpenVLA-OFT extends/improves_over/based_on OpenVLA relation');
});

test('GraphExtractor: extracts a relation mentioning AutoGen', async () => {
  const pack = await buildPack();
  const entityById = new Map(pack.entities.map((e) => [e.id, e]));
  const cardById = new Map(pack.cards.map((c) => [c.id, c]));
  const nameOf = (id, type) => (type === 'entity' ? entityById.get(id)?.name : cardById.get(id)?.title) || '';
  const found = pack.relations.some((r) =>
    nameOf(r.subjectId, r.subjectType).toLowerCase().includes('autogen')
    || nameOf(r.objectId, r.objectType).toLowerCase().includes('autogen'),
  );
  assert.ok(found, 'expected at least one relation mentioning AutoGen');
});

test('GraphRetriever: resolveStartNodeIds resolves a known entity name to a node id', async () => {
  const pack = await buildPack();
  const { resolveStartNodeIds } = await loadModule('services/knowledge/GraphRetriever.js');
  const ids = resolveStartNodeIds(pack, ['AgenticVLA']);
  assert.ok(ids.length > 0, 'expected AgenticVLA to resolve to at least one node id');
});

test('GraphRetriever: expandGraph respects the depth cap (max 2)', async () => {
  const pack = await buildPack();
  const { resolveStartNodeIds, expandGraph } = await loadModule('services/knowledge/GraphRetriever.js');
  const ids = resolveStartNodeIds(pack, ['AgenticVLA']);
  const hits = expandGraph(pack, ids, 2);
  for (const h of hits) assert.ok(h.depth === 1 || h.depth === 2, `unexpected depth ${h.depth}`);
});

test('GraphRetriever: expandGraph returns no hits for an unknown entity (empty startNodeIds)', async () => {
  const pack = await buildPack();
  const { expandGraph } = await loadModule('services/knowledge/GraphRetriever.js');
  const hits = expandGraph(pack, [], 2);
  assert.equal(hits.length, 0);
});

test('GraphRetriever: formatGraphHintsForPrompt labels output as hints, not facts', async () => {
  const pack = await buildPack();
  const { resolveStartNodeIds, expandGraph, formatGraphHintsForPrompt } = await loadModule('services/knowledge/GraphRetriever.js');
  const ids = resolveStartNodeIds(pack, ['AgenticVLA']);
  const hits = expandGraph(pack, ids, 2);
  const block = formatGraphHintsForPrompt(hits);
  if (hits.some((h) => h.relatedCard)) {
    assert.match(block, /retrieval hints only — not citable facts on their own/i);
  }
});

test('GraphRetriever: formatGraphHintsForPrompt returns empty string for zero hits', async () => {
  const { formatGraphHintsForPrompt } = await loadModule('services/knowledge/GraphRetriever.js');
  assert.equal(formatGraphHintsForPrompt([]), '');
});

test('KnowledgeManager: relations are empty when okfGraphExpansion flag is off (default)', () => {
  // Source-assertion: the flag gate exists in KnowledgeManager.ts.
  const src = fs.readFileSync(path.join(repoRoot, 'electron/services/knowledge/KnowledgeManager.ts'), 'utf8');
  assert.match(src, /isOkfGraphExpansionEnabled\(\) \? extractGraphRelations\(cards, entities\) : \[\]/);
});

test('LLMHelper: graph expansion is gated behind isOkfGraphExpansionEnabled and only runs with target entities', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/LLMHelper.ts'), 'utf8');
  assert.match(src, /isOkfGraphExpansionEnabled\(\) && classification\.targetEntities\.length > 0/);
});

test('LLMHelper: graph hints are appended AFTER the cards block, never replacing it', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/LLMHelper.ts'), 'utf8');
  assert.match(src, /const combinedCardsBlock = graphHints \? `\$\{cardsBlock\}\\n\\n\$\{graphHints\}` : cardsBlock;/);
});
