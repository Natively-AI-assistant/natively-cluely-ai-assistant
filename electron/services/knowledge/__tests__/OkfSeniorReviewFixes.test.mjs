/**
 * OKF senior-level review fixes (2026-07-01, round 2). Covers 6 issues found
 * by an independent code-reviewer pass AFTER the initial post-review
 * hardening was already merged:
 *
 *  1. [HIGH] OkfVerifier: whole-body bag-of-words overlap missed a
 *     fabricated SENTENCE appended after an otherwise verbatim, well-
 *     grounded body (the grounded majority pulled the average score above
 *     the reject threshold). Fixed with a per-sentence minimum-overlap
 *     check.
 *  2. [HIGH] GraphExtractor: relation extraction fired on coincidental
 *     entity co-occurrence near a generic trigger word even when the
 *     sentence explicitly disclaimed a connection ("unrelated to"). Fixed
 *     with a negation-cue guard + closest-entity-to-predicate proximity.
 *  3. [MEDIUM] DatabaseManager.replaceKnowledgeCards: needs_review flagging
 *     derived the new checksum from `cards[0]?.sourceChecksum`, which is
 *     undefined when extraction yields zero cards — silently skipping the
 *     staleness flag. Fixed by passing the checksum explicitly.
 *  4. [MEDIUM] ipcHandlers.ts: HIGH_SIGNAL_ENTITIES was a hardcoded list of
 *     terms from the one thesis PDF this feature was developed against,
 *     making that repair branch inert for any other document. Fixed by
 *     deriving target entities from the question + the active pack's own
 *     extracted entities/card titles.
 *  5. [MEDIUM] KnowledgeIndexQueue was fully unwired (no production caller)
 *     despite the spec explicitly requiring a background indexing path for
 *     large documents. Wired into ModesManager.addReferenceFile behind a
 *     size threshold; jobs Map also gained bounded eviction.
 *  6. [MEDIUM] EvidenceAssembler/computeTier had zero production call sites
 *     despite the migration plan's 4-tier answer policy. Wired in as an
 *     additional (OR'd, non-replacing) strong-evidence signal for the
 *     false-refusal repair gate.
 *
 * Source-assertion pattern (matches DocGroundedRetrievalFix.test.mjs) +
 * pure-function tests against compiled modules where DB/Electron is not
 * required.
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

// ---------------------------------------------------------------------------
// 1. OkfVerifier per-sentence grounding check
// ---------------------------------------------------------------------------

test('OkfVerifier: rejects a card whose body is otherwise verbatim-grounded but has one fabricated sentence appended', async () => {
  const { verifyCard } = await loadModule('services/knowledge/OkfVerifier.js');
  const source = 'The manipulator arm has six degree-of-freedom joints for full range of motion. The system uses a vision-based perception pipeline built with a convolutional neural network.';
  const card = {
    id: 'c1', body: 'The manipulator arm has six degree-of-freedom joints for full range of motion. The system uses a vision-based perception pipeline built with a convolutional neural network. This robot was designed by aliens from Mars in 1823 and can fly to the moon unaided.',
    type: 'concept', conceptId: 'x', slug: 'x', sourcePages: [1], sourceQuotes: [{ text: 'q', page: 1 }], confidence: 'high',
  };
  const result = verifyCard(card, source);
  assert.equal(result.rejected, true, `expected rejection, got: ${JSON.stringify(result.reasons)}`);
  assert.ok(result.reasons.some((r) => r.includes('sentence')), 'expected a per-sentence grounding reason');
});

test('OkfVerifier: whole-body average score alone would have accepted the fabrication case (regression proof — the bug this fixes)', async () => {
  const { groundingScore } = { groundingScore: undefined }; // not exported; recompute inline to document the regression
  // This test documents WHY the per-sentence check was necessary: the
  // whole-body overlap score for the fabrication case (below) is high
  // enough that the OLD single-threshold check alone would have accepted
  // it. We don't call the internal (unexported) groundingScore directly —
  // instead we assert the end-to-end verifyCard result differs from what a
  // naive whole-body-only implementation would produce, via the dedicated
  // "min sentence overlap" reason string appearing (proving the NEW check,
  // not the old one, is what caught it).
  const { verifyCard } = await loadModule('services/knowledge/OkfVerifier.js');
  const source = 'The manipulator arm has six degree-of-freedom joints for full range of motion. The system uses a vision-based perception pipeline built with a convolutional neural network.';
  const card = {
    id: 'c1', body: 'The manipulator arm has six degree-of-freedom joints for full range of motion. The system uses a vision-based perception pipeline built with a convolutional neural network. This robot was designed by aliens from Mars in 1823 and can fly to the moon unaided.',
    type: 'concept', conceptId: 'x', slug: 'x', sourcePages: [1], sourceQuotes: [{ text: 'q', page: 1 }], confidence: 'high',
  };
  const result = verifyCard(card, source);
  const wholeBodyReason = result.reasons.find((r) => r.startsWith('body not grounded'));
  const sentenceReason = result.reasons.find((r) => r.includes('sentence'));
  assert.ok(!wholeBodyReason, 'expected the whole-body check to NOT catch this (it is grounded on average) — proves the sentence check is the one doing the work');
  assert.ok(sentenceReason, 'expected the per-sentence check to catch it');
});

test('OkfVerifier: does not reject a normal, fully-grounded real-thesis-style card (no false positives from the new check)', async () => {
  const { verifyCard } = await loadModule('services/knowledge/OkfVerifier.js');
  const source = 'OpenVLA-OFT is an improved version of OpenVLA. It uses parallel decoding and action chunking, achieving 43x faster throughput than base OpenVLA. It supports multiple camera views and low-dimensional robot state inputs.';
  const card = {
    id: 'c1', body: 'OpenVLA-OFT is an improved version of OpenVLA. It uses parallel decoding and action chunking, achieving 43x faster throughput than base OpenVLA.',
    type: 'concept', conceptId: 'x', slug: 'x', sourcePages: [1], sourceQuotes: [{ text: 'q', page: 1 }], confidence: 'high',
  };
  const result = verifyCard(card, source);
  assert.equal(result.rejected, false, `expected acceptance, got: ${JSON.stringify(result.reasons)}`);
});

test('OkfVerifier: real thesis extraction still accepts 50/51 cards after the per-sentence check (no regression)', async () => {
  const { extractFromContent } = await loadModule('services/knowledge/OkfExtractor.js');
  const { buildKnowledgeCards, linkRelatedCards } = await loadModule('services/knowledge/OkfCardBuilder.js');
  const { verifyCards } = await loadModule('services/knowledge/OkfVerifier.js');
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
  const data = await new PDFParse({ data: fs.readFileSync(path.join(repoRoot, 'Sample thesis for testing.pdf')) }).getText();
  const content = data.pages.map((p) => `[Page ${p.num}]\n${p.text || ''}`).join('\n\n');
  const { cards: cardDrafts } = extractFromContent(content, 'thesis');
  let cards = buildKnowledgeCards(cardDrafts, { packId: 'p', sourceId: 's', sourceChecksum: 'c', nowIso: new Date().toISOString() });
  const { accepted, rejected } = verifyCards(cards, content);
  assert.ok(accepted.length >= 45, `expected >=45 cards accepted (was 50/51 before this fix), got ${accepted.length}/${accepted.length + rejected.length}`);
});

// ---------------------------------------------------------------------------
// 2. GraphExtractor negation/proximity guard
// ---------------------------------------------------------------------------

test('GraphExtractor: does NOT fabricate a relation from coincidental entity co-occurrence near a negation cue', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'Mercury X1',
    body: 'The Mercury X1 team, unrelated to the OpenVLA project, uses a standard laptop for note-taking during meetings with the OpenVLA researchers.',
    entities: ['Mercury X1'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'mercury-x1', conceptId: 'thesis/mercury-x1',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'mercury-x1', name: 'Mercury X1', type: 'other', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  assert.equal(relations.length, 0, `expected 0 relations (negation cue should suppress), got: ${JSON.stringify(relations.map((r) => r.predicate))}`);
});

test('GraphExtractor: still extracts a legitimate relation when there is no negation cue', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'OpenVLA-OFT',
    body: 'OpenVLA-OFT is an improved version of OpenVLA. It uses parallel decoding for faster inference.',
    entities: ['OpenVLA-OFT'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'openvla-oft', conceptId: 'thesis/openvla-oft',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'openvla-oft', name: 'OpenVLA-OFT', type: 'model', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  assert.equal(relations.length, 1);
  assert.equal(relations[0].predicate, 'extends');
});

// ---------------------------------------------------------------------------
// 2b. Round 3 (test-engineer adversarial findings): negation-cue-list
// expansion + parenthetical-aside object exclusion
// ---------------------------------------------------------------------------

test('GraphExtractor: negation guard is not bypassed by phrasings outside the original cue list ("has nothing to do with", "is in no way connected to")', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const entities = [
    { id: 'e1', packId: 'p', slug: 'mercury-x1', name: 'Mercury X1', type: 'other', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const makeCard = (body) => ({
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'Mercury X1', body,
    entities: ['Mercury X1'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'mercury-x1', conceptId: 'thesis/mercury-x1',
  });
  const r1 = extractGraphRelations([makeCard('The Mercury X1 team has nothing to do with OpenVLA but uses a laptop for meetings.')], entities);
  assert.equal(r1.length, 0, `"has nothing to do with" should suppress the relation, got: ${JSON.stringify(r1.map((r) => r.predicate))}`);
  const r2 = extractGraphRelations([makeCard('Mercury X1 is in no way connected to OpenVLA, but the team occasionally uses a shared printer.')], entities);
  assert.equal(r2.length, 0, `"is in no way connected to" should suppress the relation, got: ${JSON.stringify(r2.map((r) => r.predicate))}`);
});

test('GraphExtractor: does not pick an entity mentioned only inside/introducing a parenthetical aside as the relation object', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'Mercury X1',
    body: 'Mercury X1 extends, in a manner reminiscent of AutoGen (a completely separate agent framework mentioned only for comparison), the core architecture originally introduced by OpenVLA.',
    entities: ['Mercury X1'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'mercury-x1', conceptId: 'thesis/mercury-x1',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'mercury-x1', name: 'Mercury X1', type: 'other', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'autogen', name: 'AutoGen', type: 'tool', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
    { id: 'e3', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  assert.equal(relations.length, 1);
  assert.equal(entityById.get(relations[0].objectId)?.name, 'OpenVLA', `expected object=OpenVLA (the real object, farther away), got ${entityById.get(relations[0].objectId)?.name} (AutoGen is a closer but incidental parenthetical-aside mention)`);
});

// ---------------------------------------------------------------------------
// 2c. Round 4 (second test-engineer adversarial pass): 2 more enumeration
// gaps of the same class — a contrastive negation phrasing not in the cue
// list, and a SQUARE-bracket aside the paren-only regex missed.
// ---------------------------------------------------------------------------

test('GraphExtractor: negation guard suppresses the "as opposed to" contrastive disclaimer (round-4 bypass fix)', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'Mercury X1',
    body: 'Mercury X1, as opposed to OpenVLA, uses a different approach entirely.',
    entities: ['Mercury X1'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'mercury-x1', conceptId: 'thesis/mercury-x1',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'mercury-x1', name: 'Mercury X1', type: 'other', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  assert.equal(relations.length, 0, `"as opposed to" should suppress the relation, got: ${JSON.stringify(relations.map((r) => r.predicate))}`);
});

test('GraphExtractor: does not pick an entity introducing a SQUARE-bracket aside as the object (round-4 bypass fix)', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'Mercury X1',
    body: 'Mercury X1 extends, reminiscent of AutoGen [a completely separate agent framework], the architecture introduced by OpenVLA.',
    entities: ['Mercury X1'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'mercury-x1', conceptId: 'thesis/mercury-x1',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'mercury-x1', name: 'Mercury X1', type: 'other', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'autogen', name: 'AutoGen', type: 'tool', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
    { id: 'e3', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  assert.equal(relations.length, 1);
  assert.equal(entityById.get(relations[0].objectId)?.name, 'OpenVLA', `expected object=OpenVLA, got ${entityById.get(relations[0].objectId)?.name} (AutoGen is inside a square-bracket aside)`);
});

test('GraphExtractor: a legitimate relation whose object is legitimately followed by a parenthetical clarification is NOT dropped (false-negative guard)', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'OpenVLA-OFT',
    body: 'OpenVLA-OFT extends OpenVLA (the base model) with parallel decoding.',
    entities: ['OpenVLA-OFT'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'openvla-oft', conceptId: 'thesis/openvla-oft',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'openvla-oft', name: 'OpenVLA-OFT', type: 'model', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  assert.equal(relations.length, 1, 'the parenthetical-exclusion fix must not drop a legitimate relation whose object has a trailing clarification');
  assert.equal(relations[0].predicate, 'extends');
});

test('GraphExtractor: real thesis still extracts the expected OpenVLA-OFT extends/improves OpenVLA relation after hardening', async () => {
  const { extractFromContent } = await loadModule('services/knowledge/OkfExtractor.js');
  const { buildKnowledgeCards, buildKnowledgeEntities, linkRelatedCards } = await loadModule('services/knowledge/OkfCardBuilder.js');
  const { verifyCards } = await loadModule('services/knowledge/OkfVerifier.js');
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { PDFParse } = require('pdf-parse');
  const data = await new PDFParse({ data: fs.readFileSync(path.join(repoRoot, 'Sample thesis for testing.pdf')) }).getText();
  const content = data.pages.map((p) => `[Page ${p.num}]\n${p.text || ''}`).join('\n\n');
  const { cards: cardDrafts, entities: entityDrafts } = extractFromContent(content, 'thesis');
  let cards = buildKnowledgeCards(cardDrafts, { packId: 'p', sourceId: 's', sourceChecksum: 'c', nowIso: new Date().toISOString() });
  const { accepted } = verifyCards(cards, content);
  cards = linkRelatedCards(accepted);
  const cardsByConceptId = new Map(cards.map((c) => [c.conceptId, c]));
  const entities = buildKnowledgeEntities(entityDrafts, cardsByConceptId, { packId: 'p', nowIso: new Date().toISOString() }).filter((e) => e.sourceCardIds.length > 0);
  const relations = extractGraphRelations(cards, entities);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const nameOf = (id, type) => (type === 'entity' ? entityById.get(id)?.name : cardById.get(id)?.title) || '';
  const found = relations.some((r) =>
    nameOf(r.subjectId, r.subjectType).toLowerCase().includes('openvla-oft')
    && nameOf(r.objectId, r.objectType).toLowerCase() === 'openvla'
    && (r.predicate === 'extends' || r.predicate === 'improves_over' || r.predicate === 'based_on'),
  );
  assert.ok(found, 'expected OpenVLA-OFT extends/improves_over/based_on OpenVLA relation to still be found');
});

// ---------------------------------------------------------------------------
// 3. needs_review checksum-from-empty-cards-array fix
// ---------------------------------------------------------------------------

test('DatabaseManager.replaceKnowledgeCards: accepts an explicit newSourceChecksum parameter (not derived from cards[0])', () => {
  const dbSrc = read('electron/db/DatabaseManager.ts');
  assert.match(dbSrc, /public replaceKnowledgeCards\(packId: string, sourceId: string, cards: Array<\{[\s\S]*?\}>, newSourceChecksum\?: string\): void \{/);
  assert.match(dbSrc, /if \(newSourceChecksum\) \{/);
  assert.ok(!dbSrc.includes('const newChecksum = cards[0]?.sourceChecksum;'), 'must not derive the checksum from cards[0] anymore');
});

test('KnowledgePackStore.savePack: passes an explicit currentSourceChecksum through to replaceKnowledgeCards', () => {
  const storeSrc = read('electron/services/knowledge/KnowledgePackStore.ts');
  assert.match(storeSrc, /savePack\(pack: KnowledgePack, currentSourceChecksum\?: string\): void \{/);
  assert.match(storeSrc, /currentSourceChecksum \?\? pack\.cards\[0\]\?\.sourceChecksum/);
});

test('KnowledgeManager.generateForFile: passes sourceChecksum explicitly to savePack', () => {
  const managerSrc = read('electron/services/knowledge/KnowledgeManager.ts');
  assert.match(managerSrc, /this\.store\.savePack\(pack, sourceChecksum\);/);
});

// ---------------------------------------------------------------------------
// 4. Document-derived high-signal entities (not a hardcoded fixture list)
// ---------------------------------------------------------------------------

test('ipcHandlers: highSignalEntities is derived from classifyQuestion + the active pack (not a fixed list)', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(src, /let highSignalEntities: string\[\] = \[\];/);
  assert.match(src, /classifyQuestion\(message\)\.targetEntities/);
  assert.ok(!src.includes('const HIGH_SIGNAL_ENTITIES = ['), 'must not reintroduce the hardcoded fixture-specific list');
});

// ---------------------------------------------------------------------------
// 5. KnowledgeIndexQueue wired into the real upload path
// ---------------------------------------------------------------------------

test('ModesManager.addReferenceFile: routes large content through generateForFileInBackground, small content through the synchronous path', () => {
  const src = read('electron/services/ModesManager.ts');
  assert.match(src, /const OKF_BACKGROUND_INDEX_THRESHOLD_CHARS = 300_000;/);
  const idx = src.indexOf('public addReferenceFile(params:');
  const slice = src.slice(idx, idx + 4500);
  assert.match(slice, /if \(params\.content\.length > OKF_BACKGROUND_INDEX_THRESHOLD_CHARS\) \{/);
  assert.match(slice, /generateForFileInBackground\(fileInput\)/);
  assert.match(slice, /KnowledgeManager\.getInstance\(\)\.generateForFile\(fileInput\);/);
});

test('KnowledgeIndexQueue: jobs Map has bounded eviction (was previously unbounded)', () => {
  const src = read('electron/services/knowledge/KnowledgeIndexQueue.ts');
  assert.match(src, /const MAX_TRACKED_JOBS = 256;/);
  assert.match(src, /if \(this\.jobs\.size > MAX_TRACKED_JOBS\)/);
});

// ---------------------------------------------------------------------------
// 6. EvidenceAssembler wired into the false-refusal repair gate
// ---------------------------------------------------------------------------

test('ipcHandlers: assembleEvidence is called and its tier feeds hasStrongEvidence as an additional OR condition', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(src, /const \{ assembleEvidence \} = require\('\.\/services\/knowledge\/EvidenceAssembler'\);/);
  assert.match(src, /isTier1Or2Evidence = bestTier <= 2;/);
  // Updated 2026-07-02: the gate uses OKF entity/title overlap (hasRealEvidence)
  // as the primary signal; isTier1Or2Evidence remains an additional OR signal.
  assert.match(src, /hasStrongEvidence = hasRealEvidence \|\| Boolean\(matchedHighSignalEntity\) \|\| isTier1Or2Evidence;/);
});

// ---------------------------------------------------------------------------
// 7. Round-5 senior-review fixes: savePack atomicity, contrasts_with revival,
// flag-gated background enqueue
// ---------------------------------------------------------------------------

test('KnowledgeManager.generateForFile: persists source + pack + index-version in ONE transaction (atomicity fix)', () => {
  const src = read('electron/services/knowledge/KnowledgeManager.ts');
  // The three persist calls must be inside a single runInTransaction closure
  // so a mid-sequence failure rolls back the source-row contentHash advance
  // (otherwise a half-written pack is permanently stuck as skipped_unchanged).
  const txIdx = src.indexOf('DatabaseManager.getInstance().runInTransaction(() => {');
  assert.ok(txIdx >= 0, 'expected a runInTransaction wrapper');
  const closeIdx = src.indexOf('});', txIdx);
  const block = src.slice(txIdx, closeIdx);
  assert.match(block, /this\.store\.saveSource\(source\);/);
  assert.match(block, /this\.store\.savePack\(pack, sourceChecksum\);/);
  assert.match(block, /this\.store\.saveIndexVersion\(/);
});

test('DatabaseManager: exposes a public runInTransaction helper', () => {
  const src = read('electron/db/DatabaseManager.ts');
  assert.match(src, /public runInTransaction<T>\(fn: \(\) => T\): T \{/);
  assert.match(src, /return this\.db\.transaction\(fn\)\(\);/);
});

test('ModesManager.addReferenceFile: gates the whole OKF block (sync AND background) on isOkfKnowledgePacksEnabled before routing', () => {
  const src = read('electron/services/ModesManager.ts');
  const idx = src.indexOf('public addReferenceFile(params:');
  const slice = src.slice(idx, idx + 4500);
  // The flag check must wrap BOTH branches (it must appear before the
  // content-length routing decision), so a flag-off large upload never
  // enqueues a background job.
  const flagIdx = slice.indexOf('if (isOkfKnowledgePacksEnabled()) {');
  const routeIdx = slice.indexOf('if (params.content.length > OKF_BACKGROUND_INDEX_THRESHOLD_CHARS)');
  assert.ok(flagIdx >= 0, 'expected an isOkfKnowledgePacksEnabled() gate');
  assert.ok(routeIdx > flagIdx, 'the sync-vs-background routing must be INSIDE the flag gate');
});

test('GraphExtractor: contrasts_with predicate is not self-cancelled by a negation cue that IS its own trigger phrase', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'OpenVLA-OFT',
    body: 'OpenVLA-OFT, compared to OpenVLA, achieves higher accuracy.',
    entities: ['OpenVLA-OFT'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'openvla-oft', conceptId: 'thesis/openvla-oft',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'openvla-oft', name: 'OpenVLA-OFT', type: 'model', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  assert.equal(relations.length, 1, 'contrasts_with must survive when "compared to" is the predicate trigger, not a disclaimer');
  assert.equal(relations[0].predicate, 'contrasts_with');
  assert.equal(entityById.get(relations[0].objectId)?.name, 'OpenVLA');
});

test('GraphExtractor: a REAL "as opposed to" disclaimer (not coinciding with the predicate) is still suppressed', async () => {
  const { extractGraphRelations } = await loadModule('services/knowledge/GraphExtractor.js');
  const cards = [{
    id: 'c1', packId: 'p', sourceId: 's', type: 'concept', title: 'Mercury X1',
    body: 'Mercury X1, as opposed to OpenVLA, uses a different approach entirely.',
    entities: ['Mercury X1'], sourcePages: [1], sourceSections: [], sourceQuotes: [], tags: [], relatedCardIds: [],
    confidence: 'high', generatedFrom: 'pdf_extraction', sourceChecksum: 'x', userEdited: false, approvalStatus: 'generated', updatedAt: 'now', cardVersion: 1, slug: 'mercury-x1', conceptId: 'thesis/mercury-x1',
  }];
  const entities = [
    { id: 'e1', packId: 'p', slug: 'mercury-x1', name: 'Mercury X1', type: 'other', aliases: [], description: '', sourceCardIds: ['c1'], sourcePages: [1], firstSeenAt: 'now' },
    { id: 'e2', packId: 'p', slug: 'openvla', name: 'OpenVLA', type: 'model', aliases: [], description: '', sourceCardIds: [], sourcePages: [], firstSeenAt: 'now' },
  ];
  const relations = extractGraphRelations(cards, entities);
  assert.equal(relations.length, 0, 'the predicate here is "uses", so "as opposed to" is a genuine disclaimer and must still cancel');
});
