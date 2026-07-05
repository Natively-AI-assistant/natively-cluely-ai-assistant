/**
 * OKF Phase 2 (2026-07-01): Knowledge Pack generation, verification, and
 * Markdown export tests against the real "Sample thesis for testing.pdf".
 *
 * Runs the pure (no-DB) extraction pipeline directly against compiled
 * dist-electron output — does not require ELECTRON_RUN_AS_NODE or a real
 * Electron app instance (OkfExtractor/OkfCardBuilder/OkfVerifier/
 * OkfMarkdownExporter/OkfConformance have zero Electron/DB dependencies).
 *
 * Requires: npm run build:electron (dist-electron/electron/services/knowledge/*.js)
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
      const workerPath = (await import('node:module')).createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
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

let cachedContent = null;
async function getThesisContent() {
  if (cachedContent) return cachedContent;
  cachedContent = await ingestPdfText(PDF_PATH);
  return cachedContent;
}

async function buildPack() {
  const content = await getThesisContent();
  const { extractFromContent } = await loadModule('services/knowledge/OkfExtractor.js');
  const { buildKnowledgeCards, buildKnowledgeEntities, linkRelatedCards } = await loadModule('services/knowledge/OkfCardBuilder.js');
  const { verifyCards } = await loadModule('services/knowledge/OkfVerifier.js');

  const bundleDir = 'thesis';
  const sourceChecksum = crypto.createHash('sha256').update(content).digest('hex');
  const { cards: cardDrafts, entities: entityDrafts } = extractFromContent(content, bundleDir);
  const nowIso = new Date().toISOString();

  let cards = buildKnowledgeCards(cardDrafts, { packId: 'pack_test', sourceId: 'src_test', sourceChecksum, nowIso });
  const { accepted, rejected } = verifyCards(cards, content);
  cards = linkRelatedCards(accepted);
  const cardsByConceptId = new Map(cards.map((c) => [c.conceptId, c]));
  const entities = buildKnowledgeEntities(entityDrafts, cardsByConceptId, { packId: 'pack_test', nowIso }).filter((e) => e.sourceCardIds.length > 0);

  return {
    content, cards, entities, rejected, bundleDir, sourceChecksum, nowIso,
    pack: {
      id: 'pack_test', sourceId: 'src_test', modeId: 'mode_test', fileName: 'Sample thesis for testing.pdf',
      cards, entities, relations: [], indexMd: '',
      stats: { cardCount: cards.length, entityCount: entities.length, relationCount: 0, sourcePages: 0, sourceSections: 0, avgConfidence: 0, extractionMs: 0 },
      packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: nowIso,
    },
  };
}

test('PDF exists for this benchmark', () => {
  assert.ok(fs.existsSync(PDF_PATH), `Expected "Sample thesis for testing.pdf" at repo root: ${PDF_PATH}`);
});

test('OKF pack generation: produces >=20 cards from the 66-page thesis', async () => {
  const { cards } = await buildPack();
  assert.ok(cards.length >= 20, `expected >=20 cards, got ${cards.length}`);
});

test('OKF pack generation: every card has a non-empty type', async () => {
  const { cards } = await buildPack();
  for (const c of cards) assert.ok(c.type && c.type.length > 0, `card "${c.title}" missing type`);
});

test('OKF pack generation: every card has source pages and at least one citation-worthy quote', async () => {
  const { cards } = await buildPack();
  for (const c of cards) {
    assert.ok(c.sourcePages.length > 0, `card "${c.title}" missing source pages`);
    assert.ok(c.sourceQuotes.length > 0 && c.sourceQuotes[0].text.trim().length > 0, `card "${c.title}" missing source quote`);
  }
});

test('OKF pack generation: OpenVLA-OFT card mentions parallel decoding or 43x faster', async () => {
  const { cards } = await buildPack();
  const card = cards.find((c) => c.title === 'OpenVLA-OFT');
  assert.ok(card, 'expected an OpenVLA-OFT card');
  assert.match(card.body, /parallel decoding|43x faster|43× faster/i);
});

test('OKF pack generation: Research Questions card mentions RQ1/RQ2', async () => {
  const { cards } = await buildPack();
  const card = cards.find((c) => c.title === 'Research Questions');
  assert.ok(card, 'expected a Research Questions card');
  assert.match(card.body, /RQ1/);
  assert.match(card.body, /RQ2/);
});

test('OKF pack generation: Agentic AI card mentions Model, Tools, and Instructions (three core components)', async () => {
  const { cards } = await buildPack();
  const card = cards.find((c) => c.title === 'Agentic AI');
  assert.ok(card, 'expected an Agentic AI card');
  assert.match(card.body, /Model:/);
  assert.match(card.body, /Tools:/);
  assert.match(card.body, /Instructions:/);
});

test('OKF pack generation: AutoGen is mentioned in at least one card body', async () => {
  const { cards } = await buildPack();
  const mentioning = cards.filter((c) => c.body.toLowerCase().includes('autogen'));
  assert.ok(mentioning.length > 0, 'expected at least one card mentioning AutoGen');
});

test('OKF pack generation: OpenVLA card mentions 7B-parameter', async () => {
  const { cards } = await buildPack();
  const card = cards.find((c) => c.title === 'OpenVLA');
  assert.ok(card, 'expected an OpenVLA card');
  assert.match(card.body, /7B-parameter/i);
});

test('OKF verifier: rejected cards have a non-empty reasons list', async () => {
  const { rejected } = await buildPack();
  for (const r of rejected) {
    assert.ok(r.result.reasons.length > 0);
    assert.equal(r.result.rejected, true);
  }
});

test('OKF entities: high-signal entities (VLA, OpenVLA-OFT, AgenticVLA, AutoGen) are extracted', async () => {
  const { entities } = await buildPack();
  const names = entities.map((e) => e.name);
  assert.ok(names.includes('VLA'), 'expected VLA entity');
  assert.ok(names.some((n) => n.includes('OpenVLA-OFT')), 'expected OpenVLA-OFT entity');
  assert.ok(names.some((n) => n.includes('AgenticVLA')), 'expected AgenticVLA entity');
  assert.ok(names.includes('AutoGen'), 'expected AutoGen entity');
});

test('OKF Markdown export: produces an index.md and log.md at bundle root', async () => {
  const { pack } = await buildPack();
  const { exportBundleRoot } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const files = exportBundleRoot([pack]);
  assert.ok(files.some((f) => f.path === 'index.md'));
  assert.ok(files.some((f) => f.path === 'log.md'));
});

test('OKF Markdown export: bundle-root index.md declares okf_version "0.1"', async () => {
  const { pack } = await buildPack();
  const { exportBundleRoot } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const files = exportBundleRoot([pack]);
  const index = files.find((f) => f.path === 'index.md');
  assert.match(index.content, /okf_version: "0\.1"/);
});

test('OKF Markdown export: every card file has YAML frontmatter with a non-empty type', async () => {
  const { pack } = await buildPack();
  const { exportPack } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const files = exportPack(pack, { sourceFileId: 'ref_test', sourceFileName: pack.fileName, bundleDirOverride: 'thesis' });
  const cardFiles = files.filter((f) => f.path.endsWith('.md') && !f.path.endsWith('/index.md') && !f.path.endsWith('/log.md'));
  assert.ok(cardFiles.length > 0);
  for (const f of cardFiles) {
    assert.match(f.content, /^---\n/);
    assert.match(f.content, /\ntype: .+\n/);
  }
});

test('OKF Markdown export: exported bundle passes OkfConformance', async () => {
  const { pack } = await buildPack();
  const { exportPack, exportBundleRoot } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const files = [...exportBundleRoot([pack]), ...exportPack(pack, { sourceFileId: 'ref_test', sourceFileName: pack.fileName, bundleDirOverride: 'thesis' })];
  const result = checkConformance(files);
  assert.equal(result.conformant, true, `violations: ${JSON.stringify(result.violations)}`);
});

test('OKF Markdown export: every card file includes a Citations section', async () => {
  const { pack } = await buildPack();
  const { exportPack } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const files = exportPack(pack, { sourceFileId: 'ref_test', sourceFileName: pack.fileName, bundleDirOverride: 'thesis' });
  const cardFiles = files.filter((f) => f.path.endsWith('.md') && !f.path.endsWith('/index.md') && !f.path.endsWith('/log.md'));
  for (const f of cardFiles) {
    assert.match(f.content, /# Citations/);
  }
});

test('OkfConformance: a file missing the `type` field is flagged as a violation', async () => {
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const files = [{ path: 'thesis/bad.md', content: '---\ntitle: No Type\n---\n\nBody.\n' }];
  const result = checkConformance(files);
  assert.equal(result.conformant, false);
  assert.equal(result.violations.length, 1);
});

test('OkfConformance: a file with unknown extra frontmatter keys is NOT flagged (permissive per spec)', async () => {
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const files = [{ path: 'thesis/ok.md', content: '---\ntype: Concept\nweird_field: 123\n---\n\nBody.\n' }];
  const result = checkConformance(files);
  assert.equal(result.conformant, true);
});

test('OkfSlugger: slugify produces a stable, filename-safe slug', async () => {
  const { slugify } = await loadModule('services/knowledge/OkfSlugger.js');
  assert.equal(slugify('OpenVLA-OFT'), 'openvla-oft');
  assert.equal(slugify('What is AgenticVLA?'), 'agenticvla');
});

test('OkfSlugger: uniqueSlug avoids collisions', async () => {
  const { uniqueSlug } = await loadModule('services/knowledge/OkfSlugger.js');
  const taken = new Set();
  const a = uniqueSlug('Introduction', taken);
  const b = uniqueSlug('Introduction', taken);
  assert.equal(a, 'introduction');
  assert.equal(b, 'introduction-2');
});

// ---------------------------------------------------------------------------
// Regression: entity dedup key must match the DB id derivation (2026-07-01
// incident — "Mercury X1"/"The Mercury X1" and "Meta Quest"/"The Meta Quest"
// in the real thesis collided on `slugify(name)`-derived DB ids because
// OkfExtractor.extractEntityCards deduped by `name.toLowerCase()` instead,
// which sees them as distinct. That produced two BuiltEntityDraft objects
// that OkfCardBuilder.buildKnowledgeEntities then gave the SAME `id` (both
// hash `packId:slugify(name)`), and DatabaseManager.replaceKnowledgeEntities'
// bare INSERT (no ON CONFLICT) threw "UNIQUE constraint failed:
// knowledge_entities.id", aborting generateForFile after cards had already
// committed — every knowledge_entities/knowledge_relations row for that pack
// silently ended up empty. Fixed by deduping in extractEntityCards by
// slugify(name) instead of name.toLowerCase().
// ---------------------------------------------------------------------------

test('OkfExtractor: extractEntityCards never emits two entities whose names collide under slugify (regression for the 2026-07-01 entity-id UNIQUE-constraint incident)', async () => {
  const { entities } = await buildPack();
  const { slugify } = await loadModule('services/knowledge/OkfSlugger.js');
  const bySlug = new Map();
  for (const e of entities) {
    const slug = slugify(e.name);
    assert.ok(!bySlug.has(slug), `two entities collide on slug "${slug}": "${bySlug.get(slug)}" and "${e.name}"`);
    bySlug.set(slug, e.name);
  }
});

test('OkfExtractor: "Mercury X1" and "The Mercury X1" merge into one canonical entity, keeping the shorter name', async () => {
  const { entities } = await buildPack();
  const mercuryMatches = entities.filter((e) => /^(the )?mercury x1$/i.test(e.name));
  assert.equal(mercuryMatches.length, 1, `expected exactly 1 canonical "Mercury X1" entity, got: ${JSON.stringify(mercuryMatches.map((e) => e.name))}`);
  assert.equal(mercuryMatches[0].name, 'Mercury X1');
});

test('OkfExtractor: "Meta Quest" and "The Meta Quest" merge into one canonical entity, keeping the shorter name', async () => {
  const { entities } = await buildPack();
  const questMatches = entities.filter((e) => /^(the )?meta quest$/i.test(e.name));
  assert.equal(questMatches.length, 1, `expected exactly 1 canonical "Meta Quest" entity, got: ${JSON.stringify(questMatches.map((e) => e.name))}`);
  assert.equal(questMatches[0].name, 'Meta Quest');
});

test('OkfCardBuilder: buildKnowledgeEntities never produces two entities with the same id (would violate the knowledge_entities PRIMARY KEY)', async () => {
  const { entities } = await buildPack();
  const seenIds = new Set();
  for (const e of entities) {
    assert.ok(!seenIds.has(e.id), `duplicate entity id: ${e.id} ("${e.name}")`);
    seenIds.add(e.id);
  }
});

test('DatabaseManager: replaceKnowledgeEntities/replaceKnowledgeRelations INSERT statements have ON CONFLICT DO UPDATE (defense-in-depth against a future extraction-side dedup regression)', async () => {
  const dbSrc = fs.readFileSync(path.join(repoRoot, 'electron/db/DatabaseManager.ts'), 'utf8');
  const entIdx = dbSrc.indexOf('public replaceKnowledgeEntities(');
  const entSlice = dbSrc.slice(entIdx, entIdx + 2000);
  assert.match(entSlice, /INSERT INTO knowledge_entities/);
  assert.match(entSlice, /ON CONFLICT\(id\) DO UPDATE SET/);

  const relIdx = dbSrc.indexOf('public replaceKnowledgeRelations(');
  const relSlice = dbSrc.slice(relIdx, relIdx + 2000);
  assert.match(relSlice, /INSERT INTO knowledge_relations/);
  assert.match(relSlice, /ON CONFLICT\(id\) DO UPDATE SET/);
});
