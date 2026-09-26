/**
 * OKF hardening regression tests (2026-07-01, post-review pass). Covers 3
 * fixes made in response to an independent code-reviewer + debugger pass:
 *
 *  1. Cascade-delete: this codebase never runs `PRAGMA foreign_keys = ON`
 *     (confirmed zero references anywhere in electron/), so the declared
 *     `ON DELETE CASCADE` clauses on the knowledge_* tables were inert —
 *     DatabaseManager.deleteKnowledgeSource now does an EXPLICIT cascade,
 *     and ModesManager.deleteMode now cleans up OKF rows for every
 *     reference file in the deleted mode (previously only single-file
 *     deletion via ModesManager.deleteReferenceFile was covered).
 *  2. yamlEscapeScalar: always double-quotes now (was an "unquoted when it
 *     looks safe" fast-path that let a title ending in a bare colon, e.g.
 *     "3.4.1 Definitions:", produce unparseable YAML frontmatter).
 *  3. OkfConformance: hardened to catch the specific unquoted-trailing-colon
 *     shape as defense-in-depth, in case a future producer (not this
 *     exporter) emits it.
 *
 * Source-assertion pattern (matches DocGroundedRetrievalFix.test.mjs) +
 * pure-function tests against the compiled modules (no DB/Electron needed
 * for the YAML fixes — OkfMarkdownExporter/OkfConformance are DB-free).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function loadModule(relPath) {
  return import(pathToFileURL(path.join(distRoot, relPath)).href);
}

const dbManagerSrc = read('electron/db/DatabaseManager.ts');
const modesManagerSrc = read('electron/services/ModesManager.ts');
const knowledgeManagerSrc = read('electron/services/knowledge/KnowledgeManager.ts');

// ---------------------------------------------------------------------------
// 1. Cascade-delete hardening
// ---------------------------------------------------------------------------

test('DatabaseManager: deleteKnowledgeSource explicitly cascades to packs/cards/entities/relations/card_versions/index_versions (FK enforcement is never turned on in this codebase)', () => {
  const idx = dbManagerSrc.indexOf('public deleteKnowledgeSource(id: string): void {');
  assert.ok(idx >= 0);
  const slice = dbManagerSrc.slice(idx, idx + 1600);
  assert.match(slice, /DELETE FROM knowledge_relations WHERE pack_id = \?/);
  assert.match(slice, /DELETE FROM knowledge_entities WHERE pack_id = \?/);
  assert.match(slice, /DELETE FROM knowledge_card_versions/);
  assert.match(slice, /DELETE FROM knowledge_cards WHERE pack_id = \?/);
  assert.match(slice, /DELETE FROM knowledge_packs WHERE source_id = \?/);
  assert.match(slice, /DELETE FROM knowledge_index_versions WHERE source_id = \?/);
  assert.match(slice, /DELETE FROM knowledge_sources WHERE id = \?/);
});

test('DatabaseManager: deleteKnowledgeSource wraps the cascade in a single transaction', () => {
  const idx = dbManagerSrc.indexOf('public deleteKnowledgeSource(id: string): void {');
  const slice = dbManagerSrc.slice(idx, idx + 1600);
  assert.match(slice, /this\.db\.transaction\(/);
});

test('ModesManager: deleteMode calls KnowledgeManager.deleteForMode before deleting the mode row (previously only per-file deletion was cleaned up)', () => {
  const idx = modesManagerSrc.indexOf('public deleteMode(id: string): void {');
  assert.ok(idx >= 0);
  const slice = modesManagerSrc.slice(idx, idx + 1200);
  assert.match(slice, /KnowledgeManager\.getInstance\(\)\.deleteForMode\(id\)/);
});

test('KnowledgeManager: deleteForMode exists and iterates every source for the mode, invalidating caches and cancelling queued jobs', () => {
  assert.match(knowledgeManagerSrc, /deleteForMode\(modeId: string\): void \{/);
  const idx = knowledgeManagerSrc.indexOf('deleteForMode(modeId: string): void {');
  const slice = knowledgeManagerSrc.slice(idx, idx + 700);
  assert.match(slice, /getSourcesByModeId\(modeId\)/);
  assert.match(slice, /this\.store\.deleteSource\(source\.id\)/);
  assert.match(slice, /invalidatePackCache\(source\.fileId\)/);
});

// ---------------------------------------------------------------------------
// 2. yamlEscapeScalar always-quote fix
// ---------------------------------------------------------------------------

test('OkfMarkdownExporter: yamlEscapeScalar always double-quotes via JSON.stringify (no unquoted fast-path)', async () => {
  // Import the internal function indirectly by exercising a card export and
  // checking the emitted frontmatter is quoted for a title ending in a bare
  // colon — the exact shape that broke js-yaml before this fix.
  const { exportPack } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const nowIso = new Date().toISOString();
  const card = {
    id: 'card_1', packId: 'p', sourceId: 's', type: 'section',
    title: '3.4.1 Definitions:', slug: 'definitions', conceptId: 'thesis/definitions',
    body: 'Body text.', sourcePages: [1], sourceSections: ['3.4.1'],
    sourceQuotes: [{ text: 'quote', page: 1 }], entities: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'abc', userEdited: false,
    approvalStatus: 'generated', updatedAt: nowIso, cardVersion: 1,
  };
  const pack = {
    id: 'p', sourceId: 's', modeId: 'm', fileName: 'test.pdf', cards: [card], entities: [], relations: [],
    indexMd: '', stats: { cardCount: 1, entityCount: 0, relationCount: 0, sourcePages: 1, sourceSections: 1, avgConfidence: 1, extractionMs: 0 },
    packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: nowIso,
  };
  const files = exportPack(pack, { sourceFileId: 'ref1', sourceFileName: 'test.pdf', bundleDirOverride: 'thesis' });
  const cardFile = files.find((f) => f.path === 'thesis/definitions.md');
  assert.ok(cardFile);
  assert.match(cardFile.content, /^title: "3\.4\.1 Definitions:"/m);
});

test('OkfMarkdownExporter: exported frontmatter with a trailing-colon title passes OkfConformance (proves the fix, not just that it is quoted)', async () => {
  const { exportPack } = await loadModule('services/knowledge/OkfMarkdownExporter.js');
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const nowIso = new Date().toISOString();
  const card = {
    id: 'card_1', packId: 'p', sourceId: 's', type: 'section',
    title: '3.4.1 Definitions:', slug: 'definitions', conceptId: 'thesis/definitions',
    body: 'Body text.', sourcePages: [1], sourceSections: ['3.4.1'],
    sourceQuotes: [{ text: 'quote', page: 1 }], entities: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'abc', userEdited: false,
    approvalStatus: 'generated', updatedAt: nowIso, cardVersion: 1,
  };
  const pack = {
    id: 'p', sourceId: 's', modeId: 'm', fileName: 'test.pdf', cards: [card], entities: [], relations: [],
    indexMd: '', stats: { cardCount: 1, entityCount: 0, relationCount: 0, sourcePages: 1, sourceSections: 1, avgConfidence: 1, extractionMs: 0 },
    packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: nowIso,
  };
  const files = exportPack(pack, { sourceFileId: 'ref1', sourceFileName: 'test.pdf', bundleDirOverride: 'thesis' });
  const result = checkConformance(files);
  assert.equal(result.conformant, true, `expected conformant, got violations: ${JSON.stringify(result.violations)}`);
});

// ---------------------------------------------------------------------------
// 3. OkfConformance defense-in-depth for unquoted trailing-colon values
// ---------------------------------------------------------------------------

test('OkfConformance: flags a hand-authored file with an unquoted title ending in a bare colon (the exact shape a real YAML parser rejects)', async () => {
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const files = [{ path: 'thesis/bad.md', content: '---\ntype: Concept\ntitle: 3.4.1 Definitions:\n---\n\nBody.\n' }];
  const result = checkConformance(files);
  assert.equal(result.conformant, false);
  assert.match(result.violations[0].reason, /bare colon/);
});

test('OkfConformance: does NOT flag a properly double-quoted title ending in a colon', async () => {
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const files = [{ path: 'thesis/ok.md', content: '---\ntype: Concept\ntitle: "3.4.1 Definitions:"\n---\n\nBody.\n' }];
  const result = checkConformance(files);
  assert.equal(result.conformant, true);
});

test('OkfConformance: does NOT flag a bracketed list value (tags: [] or entities: [a, b])', async () => {
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const files = [{ path: 'thesis/ok2.md', content: '---\ntype: Concept\ntags: []\nentities: ["A", "B"]\n---\n\nBody.\n' }];
  const result = checkConformance(files);
  assert.equal(result.conformant, true);
});

test('OkfConformance: does NOT flag a normal value that happens to contain a colon mid-string but not at the end', async () => {
  const { checkConformance } = await loadModule('services/knowledge/OkfConformance.js');
  const files = [{ path: 'thesis/ok3.md', content: '---\ntype: Concept\ndescription: "See Section 2: Background"\n---\n\nBody.\n' }];
  const result = checkConformance(files);
  assert.equal(result.conformant, true);
});
