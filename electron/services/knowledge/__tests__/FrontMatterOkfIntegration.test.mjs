// electron/services/knowledge/__tests__/FrontMatterOkfIntegration.test.mjs
//
// Context OS production-readiness Phase 4/5 integration guard. Proves the full
// document-identity chain the real-backend benchmark exercises:
//   question → document_metadata property → front-matter atomic card proves it
//   → OKF ranks the matching card first.
//
// Before the front-matter extractor, every one of these metadata questions
// refused on the real backend ("I could not find that in the retrieved
// sections"). Fixtures MAY carry doc values; production code may not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromContent } from '../../../../dist-electron/electron/services/knowledge/OkfExtractor.js';
import { queryOkfCards } from '../../../../dist-electron/electron/services/knowledge/OkfRetriever.js';
import { classifyQuestion } from '../../../../dist-electron/electron/services/knowledge/QuestionClassifier.js';
import { detectRequestedProperty } from '../../../../dist-electron/electron/intelligence/context-os/requestedPropertyDetector.js';
import { textCanProveProperty } from '../../../../dist-electron/electron/intelligence/context-os/requestedProperty.js';

const CONTENT = [
  '[Page 3]',
  'Author Alberto Dian',
  'Title Towards Connected Intelligence: Empowering Robotic Applications with Agentic AI Frameworks',
  'Degree programme ICT Innovation',
  'Supervisor Prof. Ville Kyrki',
  'Advisors Dr. Massimiliano Maule, Prof. Davide Brunelli',
  'Date 21 June 2025 Number of pages 67 Language English',
  'Keywords Embodied AI, Robotics, Vision-Language-Action',
  '[Page 5]',
  '1 Introduction',
  'This chapter mentions language grounding and the dates of experiments and',
  'authors of prior work at length, to create competing lexical matches in prose.',
].join('\n');

function buildPack() {
  const { cards } = extractFromContent(CONTENT, 'bundle-test');
  return {
    packVersion: 1,
    // Mirror OkfCardBuilder: a BuiltCardDraft gains confidence/tags at build
    // time. Front-matter cards are high-confidence atomic facts.
    cards: cards.map((c) => ({ ...c, confidence: c.confidence || 'high', approvalStatus: 'generated', tags: [], entities: c.entities || [] })),
  };
}

test('front-matter produces one atomic metadata card per property', () => {
  const { cards } = extractFromContent(CONTENT, 'bundle-test');
  const meta = cards.filter((c) => c.type === 'metadata').map((c) => c.title);
  for (const expected of ['Author', 'Document Title', 'Supervisor', 'Advisors', 'Date', 'Number of Pages', 'Language', 'Keywords']) {
    assert.ok(meta.includes(expected), `expected a "${expected}" metadata card, got ${meta.join(', ')}`);
  }
});

test('each identity question detects document_metadata and a card proves it', () => {
  const { cards } = extractFromContent(CONTENT, 'bundle-test');
  const meta = cards.filter((c) => c.type === 'metadata');
  const questions = [
    'What is the full title of the thesis?',
    'Name one advisor listed on the thesis title page.',
    'What date is listed for the thesis?',
    'What language is the thesis written in?',
    'Name two keywords listed for the thesis.',
  ];
  for (const q of questions) {
    const prop = detectRequestedProperty(q);
    assert.equal(prop, 'document_metadata', `"${q}" should detect document_metadata, got ${prop}`);
    const proving = meta.filter((c) => textCanProveProperty(c.body, prop));
    assert.ok(proving.length > 0, `no metadata card proves document_metadata for "${q}"`);
  }
});

test('OKF ranks the exactly-matching metadata card first for specific labels', () => {
  const pack = buildPack();
  const expectTop = [
    ['What language is the thesis written in?', 'Language'],
    ['What date is listed for the thesis?', 'Date'],
    ['What is the full title of the thesis?', 'Document Title'],
  ];
  for (const [q, top] of expectTop) {
    const cl = classifyQuestion(q);
    const scored = queryOkfCards(pack, q, cl, { topN: 3 });
    assert.ok(scored.length > 0, `no cards returned for "${q}"`);
    assert.equal(scored[0].card.title, top, `"${q}" should rank "${top}" first, got "${scored[0].card.title}"`);
  }
});

test('the advisor card is retrieved (present in top-3) for an advisor question', () => {
  const pack = buildPack();
  const cl = classifyQuestion('Name one advisor listed on the thesis title page.');
  const scored = queryOkfCards(pack, 'Name one advisor listed on the thesis title page.', cl, { topN: 3 });
  const titles = scored.map((s) => s.card.title);
  assert.ok(titles.includes('Advisors'), `advisor card missing from top-3: ${titles.join(', ')}`);
});

test('a programming-language question does NOT read as document_metadata', () => {
  // Regression: "language" the metadata property must not swallow a software
  // question about a programming language used in the implementation.
  const prop = detectRequestedProperty('What programming language was the controller written in?');
  assert.notEqual(prop, 'document_metadata');
});
