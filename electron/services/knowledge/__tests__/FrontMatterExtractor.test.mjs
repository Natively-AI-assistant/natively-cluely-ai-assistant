// electron/services/knowledge/__tests__/FrontMatterExtractor.test.mjs
//
// Context OS production-readiness Phase 4/5 regression guard. Fixtures MAY carry
// document values (per the plan); PRODUCTION FrontMatterExtractor.ts may not.
//
// These cases assert the generic Label→Value front-matter extractor decomposes a
// scholarly metadata block — including a FUSED single line ("Date … Number of
// pages … Language …") — into atomic facts. The real-backend benchmark refused
// every one of these metadata questions before this extractor existed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFrontMatter,
  parseFrontMatterLine,
  splitListValue,
} from '../../../../dist-electron/electron/services/knowledge/FrontMatterExtractor.js';

// The real thesis metadata block (fixture-allowed content). Mirrors page 3 of
// the committed benchmark PDF, including the fused Date/pages/Language line.
const THESIS_FRONT_MATTER = [
  '[Page 3]',
  'Author Alberto Dian',
  'Title Towards Connected Intelligence: Empowering Robotic Applications with',
  'Agentic AI Frameworks',
  'Degree programme ICT Innovation',
  'Major Autonomous systems and Intelligent Robots',
  'Supervisor Prof. Ville Kyrki',
  'Advisors Dr. Massimiliano Maule, Prof. Davide Brunelli',
  'Collaborative partner Huawei Munich Research Center',
  'Date 21 June 2025 Number of pages 67 Language English',
  'Keywords Embodied AI, Robotics, Vision-Language-Action, Agentic AI',
  'Abstract',
  'This thesis explores the integration of Agentic Artificial Intelligence ...',
].join('\n');

test('splits a fused Date/pages/Language line into three atomic pairs', () => {
  const pairs = parseFrontMatterLine('Date 21 June 2025 Number of pages 67 Language English');
  const byProp = Object.fromEntries(pairs.map((p) => [p.property, p.value]));
  assert.equal(byProp.date, '21 June 2025');
  assert.equal(byProp.page_count, '67');
  assert.equal(byProp.language, 'English');
});

test('extracts each canonical metadata property from the block', () => {
  const facts = extractFrontMatter(THESIS_FRONT_MATTER);
  const byProp = Object.fromEntries(facts.map((f) => [f.property, f]));

  assert.equal(byProp.author.value, 'Alberto Dian');
  assert.ok(byProp.title.value.startsWith('Towards Connected Intelligence'));
  assert.equal(byProp.degree_program.value, 'ICT Innovation');
  assert.equal(byProp.supervisor.value, 'Prof. Ville Kyrki');
  assert.equal(byProp.date.value, '21 June 2025');
  assert.equal(byProp.page_count.value, '67');
  assert.equal(byProp.language.value, 'English');
});

test('advisors split into atomic list items', () => {
  const facts = extractFrontMatter(THESIS_FRONT_MATTER);
  const advisor = facts.find((f) => f.property === 'advisor');
  assert.ok(advisor, 'advisor fact present');
  assert.deepEqual(advisor.items, ['Dr. Massimiliano Maule', 'Prof. Davide Brunelli']);
});

test('keywords split into atomic list items', () => {
  const facts = extractFrontMatter(THESIS_FRONT_MATTER);
  const keywords = facts.find((f) => f.property === 'keywords');
  assert.ok(keywords, 'keywords fact present');
  assert.ok(keywords.items.includes('Embodied AI'));
  assert.ok(keywords.items.includes('Robotics'));
});

test('records the page number when [Page N] markers are present', () => {
  const facts = extractFrontMatter(THESIS_FRONT_MATTER);
  assert.ok(facts.every((f) => f.page === 3));
});

test('returns [] for a document with no metadata block (safe to always run)', () => {
  const prose = [
    '[Page 1]',
    'The quick brown fox jumps over the lazy dog. This paragraph has no',
    'label-value metadata whatsoever, only ordinary sentences about animals.',
  ].join('\n');
  assert.deepEqual(extractFrontMatter(prose), []);
});

test('does NOT mine metadata-looking words from deep body pages', () => {
  const body = [
    '[Page 30]',
    'Language English is discussed here as a natural-language modeling target,',
    'but this is prose, not a title-page label.',
  ].join('\n');
  // Page 30 is past the front-matter window — nothing extracted.
  assert.deepEqual(extractFrontMatter(body), []);
});

test('splitListValue keeps honorifics and handles "and"/"&" separators', () => {
  assert.deepEqual(splitListValue('Dr. A. Maule and Prof. D. Brunelli'), ['Dr. A. Maule', 'Prof. D. Brunelli']);
  assert.deepEqual(splitListValue('X, Y & Z'), ['X', 'Y', 'Z']);
});
