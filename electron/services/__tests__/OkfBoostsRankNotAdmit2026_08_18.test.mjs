// F-413 regression test (audit/autopilot-2026-08-18).
//
// CONFIDENCE_BOOST.high (0.15) exceeded the default minScore floor (0.12), so a
// high-confidence card cleared the floor with ZERO title/body/entity/tag
// overlap — measured pre-fix at exactly 0.150. OkfCardBuilder marks every
// metadata card and every sectioned card with >=30 body words 'high', so
// essentially every real pack contains them: queryOkfCards returned a
// non-empty set for any question with a content word, and EvidenceAssembler's
// tier 4 ("no cards AND no chunks") became unreachable at the repair-gate call
// site, which passes rawChunkText:''.
//
// SCOPE: this covers the SCORED path only. A whole-document synthesis question
// (isSynthesis with no target entities) deliberately short-circuits to the
// first N content cards with score 1 so "what is the conclusion?" returns the
// document's conclusion rather than depending on word overlap. That is by
// design and is left alone; the harm it could cause at the repair gate was
// removed separately by F-412, which stopped the tier signal overriding the
// off-topic refusal gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { queryOkfCards } = await import(
  path.resolve(__dirname, '../../../dist-electron/electron/services/knowledge/OkfRetriever.js'));

const pack = {
  packVersion: 1,
  cards: [
    { id: 'c1', type: 'conclusion', title: 'Discussion and Future Work',
      body: 'The robot policy generalises across manipulation tasks and the OpenVLA-OFT variant improves throughput substantially in our benchmarks.',
      entities: ['OpenVLA-OFT'], tags: ['robotics'], confidence: 'high' },
    { id: 'c2', type: 'section', title: 'System Architecture',
      body: 'We describe the perception stack, the controller, and the simulation harness used for evaluation of the manipulation policy.',
      entities: [], tags: [], confidence: 'high' },
  ],
};
const factual = { type: 'entity_lookup', isSynthesis: false, targetEntities: [] };

test('a high-confidence card is NOT admitted on its boost alone', () => {
  const cards = queryOkfCards(pack, 'Kyoto Protocol treaty emissions targets', factual);
  assert.equal(cards.length, 0,
    'zero query overlap must retrieve nothing — the confidence boost (0.15) must not clear the 0.12 floor by itself (F-413)');
});

test('genuinely relevant cards are still retrieved and still ranked by the boosts', () => {
  const cards = queryOkfCards(pack, 'manipulation policy throughput benchmarks', factual);
  assert.ok(cards.length > 0, 'an on-topic question must still retrieve cards (the fix must not over-reach)');
  assert.ok(cards[0].score > 0.15,
    'a relevant card should score above the bare confidence boost, i.e. relevance still contributes');
  for (let i = 1; i < cards.length; i++) {
    assert.ok(cards[i - 1].score >= cards[i].score, 'results must stay ordered by score');
  }
});

test('whole-document synthesis retains its deliberate short-circuit', () => {
  const synth = { type: 'conclusion', isSynthesis: true, targetEntities: [] };
  const cards = queryOkfCards(pack, 'What is the conclusion?', synth);
  assert.ok(cards.length > 0,
    'a synthesis question must still return the document cards by design — F-413 must not change this path');
});
