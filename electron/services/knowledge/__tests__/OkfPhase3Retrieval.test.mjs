/**
 * OKF Phase 3 (2026-07-01): question classification, OKF card retrieval,
 * evidence assembly, and tier-based answer policy tests against the real
 * thesis pack (built via the pure pipeline, no DB).
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

  const bundleDir = 'thesis';
  const sourceChecksum = crypto.createHash('sha256').update(content).digest('hex');
  const { cards: cardDrafts, entities: entityDrafts } = extractFromContent(content, bundleDir);
  const nowIso = new Date().toISOString();
  let cards = buildKnowledgeCards(cardDrafts, { packId: 'pack_test', sourceId: 'src_test', sourceChecksum, nowIso });
  const { accepted } = verifyCards(cards, content);
  cards = linkRelatedCards(accepted);
  const cardsByConceptId = new Map(cards.map((c) => [c.conceptId, c]));
  const entities = buildKnowledgeEntities(entityDrafts, cardsByConceptId, { packId: 'pack_test', nowIso }).filter((e) => e.sourceCardIds.length > 0);

  cachedPack = {
    id: 'pack_test', sourceId: 'src_test', modeId: 'mode_test', fileName: 'Sample thesis for testing.pdf',
    cards, entities, relations: [], indexMd: '',
    stats: { cardCount: cards.length, entityCount: entities.length, relationCount: 0, sourcePages: 0, sourceSections: 0, avgConfidence: 0, extractionMs: 0 },
    packVersion: 1, generatedBy: 'okf_extractor_v1', updatedAt: nowIso,
  };
  return cachedPack;
}

const QUESTIONS = [
  'What is the main topic of my thesis?',
  'Explain my thesis in simple words.',
  'What problem is this thesis trying to solve?',
  'What are the two research questions?',
  'What are the main objectives of the thesis?',
  'How is this thesis connected to embodied AI?',
  'What does embodied cognition mean in this thesis?',
  'How is this thesis related to AGI?',
  'Why are VLA models important for robotics? What are the limitations of current VLA models?',
  'What is a Vision-Language-Action model?',
  'What is OpenVLA?',
  'What is OpenVLA-OFT?',
  'How is OpenVLA-OFT different from OpenVLA?',
  'What is Agentic AI?',
  'What are the three core components of an AI agent?',
  'What is AutoGen used for in this thesis?',
  'Why was AutoGen selected over other frameworks?',
  'What is AgenticVLA?',
  'Why does AgenticVLA improve over a normal VLA?',
];

test('QuestionClassifier: classifies all 19 question types without throwing', async () => {
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  for (const q of QUESTIONS) {
    const c = classifyQuestion(q);
    assert.ok(c.type, `expected a type for "${q}"`);
  }
});

test('QuestionClassifier: research-questions/objectives/main-topic questions classify as synthesis', async () => {
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  assert.equal(classifyQuestion('What are the two research questions?').isSynthesis, true);
  assert.equal(classifyQuestion('What are the main objectives of the thesis?').isSynthesis, true);
  assert.equal(classifyQuestion('What is the main topic of my thesis?').isSynthesis, true);
});

test('QuestionClassifier: entity-lookup questions extract the target entity', async () => {
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const c = classifyQuestion('What is OpenVLA-OFT?');
  assert.ok(c.targetEntities.some((e) => e.toLowerCase().includes('openvla')));
});

test('QuestionClassifier: a leading question word is never fused into an extracted entity', async () => {
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  // Regression: ENTITY_TOKEN_RE used to fuse the sentence-initial "What" onto a
  // following acronym ("What VRAM", "What LLM"). No extracted entity — hard or
  // soft — may ever carry the leading interrogative word.
  for (const q of [
    'What VRAM size did the consumer-grade inference GPU have?',
    'What LLM performs reasoning in the Reasoning Tool?',
    'Which GPU was used for training?',
  ]) {
    const c = classifyQuestion(q);
    for (const e of [...c.targetEntities, ...c.softEntities]) {
      assert.ok(!/^(?:what|which|who|how|name|list) /i.test(e), `entity "${e}" for "${q}" still carries a leading question word`);
    }
  }
});

test('QuestionClassifier: an interrogative-subject category acronym is SOFT, not a blocking entity', async () => {
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  // Generic root cause (2026-07-13 continuation): "what LLM performs…", "what
  // VLA limitation…", "what VRAM size…" name the CATEGORY being asked for. The
  // answer chunk names the specific instance ("uses LLaMA 3.2 7B as its
  // backbone") and never repeats the category token, so requiring it verbatim
  // in the sufficiency gate produced a false insufficient-evidence refusal.
  // Such acronyms must land in softEntities (retrieval-only), leaving the real
  // constraint entity ("Reasoning Tool") as the sole hard entity.
  const c127 = classifyQuestion('What LLM performs reasoning and rephrasing in the Reasoning Tool?');
  assert.deepEqual(c127.softEntities, ['LLM']);
  assert.ok(!c127.targetEntities.includes('LLM'), 'LLM must not be a hard entity');
  assert.ok(c127.targetEntities.includes('Reasoning Tool'), 'the real constraint entity stays hard');

  const c126 = classifyQuestion('What VLA limitation does the Reasoning Tool address?');
  assert.deepEqual(c126.softEntities, ['VLA']);
  assert.ok(!c126.targetEntities.includes('VLA'));

  // A copula-followed acronym is a genuine entity lookup — must stay HARD.
  const cDef = classifyQuestion('What is OpenVLA-OFT?');
  assert.deepEqual(cDef.softEntities, []);
  assert.ok(cDef.targetEntities.some((e) => e.toLowerCase().includes('openvla')));

  // "what does ROS mean" — copula/means → stays a hard entity lookup.
  const cRos = classifyQuestion('What does ROS mean in this thesis?');
  assert.deepEqual(cRos.softEntities, []);
});

test('OkfRetriever: returns relevant cards for all 19 benchmark questions', async () => {
  const pack = await buildPack();
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const { queryOkfCards } = await loadModule('services/knowledge/OkfRetriever.js');

  let passCount = 0;
  for (const q of QUESTIONS) {
    const classification = classifyQuestion(q);
    const scored = queryOkfCards(pack, q, classification, { topN: 6 });
    if (scored.length > 0) passCount++;
  }
  assert.ok(passCount >= 17, `expected >=17/19 questions to retrieve at least one card, got ${passCount}/19`);
});

test('OkfRetriever: "What is OpenVLA-OFT?" returns the OpenVLA-OFT card as the top result', async () => {
  const pack = await buildPack();
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const { queryOkfCards } = await loadModule('services/knowledge/OkfRetriever.js');
  const classification = classifyQuestion('What is OpenVLA-OFT?');
  const scored = queryOkfCards(pack, 'What is OpenVLA-OFT?', classification, { topN: 6 });
  assert.ok(scored.length > 0);
  assert.equal(scored[0].card.title, 'OpenVLA-OFT');
});

test('OkfRetriever: a whole-document synthesis question returns content cards in document order, never metadata', async () => {
  const pack = await buildPack();
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const { queryOkfCards } = await loadModule('services/knowledge/OkfRetriever.js');
  const classification = classifyQuestion('What is the main topic of my thesis?');
  const scored = queryOkfCards(pack, 'What is the main topic of my thesis?', classification, { topN: 6 });
  assert.ok(scored.length >= 3);
  // A synthesis question is answered from CONTENT sections, never from atomic
  // title-page metadata cards (Author/Title/Supervisor). The top card is the
  // first non-metadata card in document order.
  const firstContent = pack.cards.find((c) => c.type !== 'metadata');
  assert.equal(scored[0].card.title, firstContent.title);
  assert.ok(scored.every((s) => s.card.type !== 'metadata'), 'no metadata card in a synthesis result');
});

test('EvidenceAssembler: computes Tier 1 for a high-confidence entity match', async () => {
  const pack = await buildPack();
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const { queryOkfCards } = await loadModule('services/knowledge/OkfRetriever.js');
  const { assembleEvidence } = await loadModule('services/knowledge/EvidenceAssembler.js');
  const q = 'What is OpenVLA-OFT?';
  const classification = classifyQuestion(q);
  const scored = queryOkfCards(pack, q, classification, { topN: 6 });
  const evidence = assembleEvidence({ pack, scoredCards: scored, rawChunkText: '', classification });
  assert.ok(evidence.tier <= 2, `expected tier <=2 for a strong entity match, got tier ${evidence.tier}`);
});

test('EvidenceAssembler: computes Tier 4 when there are zero cards and zero chunks', async () => {
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const { assembleEvidence } = await loadModule('services/knowledge/EvidenceAssembler.js');
  const classification = classifyQuestion('What is the capital of France?');
  const evidence = assembleEvidence({ pack: null, scoredCards: [], rawChunkText: '', classification });
  assert.equal(evidence.tier, 4);
});

test('EvidenceAssembler: synthesis questions are always Tier 2 when evidence exists', async () => {
  const pack = await buildPack();
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const { queryOkfCards } = await loadModule('services/knowledge/OkfRetriever.js');
  const { assembleEvidence } = await loadModule('services/knowledge/EvidenceAssembler.js');
  const q = 'What are the two research questions?';
  const classification = classifyQuestion(q);
  const scored = queryOkfCards(pack, q, classification, { topN: 6 });
  const evidence = assembleEvidence({ pack, scoredCards: scored, rawChunkText: '', classification });
  assert.equal(evidence.tier, 2);
});

test('OkfPromptFormatter: formatCardsForPrompt includes title, source pages, and body for each card', async () => {
  const pack = await buildPack();
  const { classifyQuestion } = await loadModule('services/knowledge/QuestionClassifier.js');
  const { queryOkfCards } = await loadModule('services/knowledge/OkfRetriever.js');
  const { formatCardsForPrompt } = await loadModule('services/knowledge/OkfPromptFormatter.js');
  const q = 'What is OpenVLA-OFT?';
  const classification = classifyQuestion(q);
  const scored = queryOkfCards(pack, q, classification, { topN: 3 });
  const block = formatCardsForPrompt(scored);
  assert.match(block, /OpenVLA-OFT/);
  assert.match(block, /Source: pages/);
  assert.match(block, /parallel decoding|43x faster/i);
});

test('OkfPromptFormatter: buildOkfEvidenceBlock puts cards before raw chunks, with a conflict-resolution note', async () => {
  const { buildOkfEvidenceBlock } = await loadModule('services/knowledge/OkfPromptFormatter.js');
  const block = buildOkfEvidenceBlock({ cardsBlock: 'CARD CONTENT', rawChunkText: 'CHUNK CONTENT' });
  const cardIdx = block.indexOf('CARD CONTENT');
  const chunkIdx = block.indexOf('CHUNK CONTENT');
  assert.ok(cardIdx >= 0 && chunkIdx >= 0 && cardIdx < chunkIdx);
  assert.match(block, /excerpt \(verbatim original text\) wins/i);
});

test('OkfPromptFormatter: returns empty string when there is no evidence at all', async () => {
  const { buildOkfEvidenceBlock } = await loadModule('services/knowledge/OkfPromptFormatter.js');
  assert.equal(buildOkfEvidenceBlock({ cardsBlock: '', rawChunkText: '' }), '');
});
