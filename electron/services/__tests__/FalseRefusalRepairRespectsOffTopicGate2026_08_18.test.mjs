// F-412 regression test (audit/autopilot-2026-08-18).
//
// The false-refusal repair's off-topic gate exists so an honest "not in the
// document" refusal STANDS for an off-topic question — its own comment says
// "Off-topic questions match neither a whole name nor >=2 distinct tokens, so
// their honest refusal stands."
//
// isTier1Or2Evidence was OR'd in as an independent third disjunct, and
// EvidenceAssembler.computeTier is TOPIC-BLIND: tier 2 comes back for ANY
// synthesis-classified question as soon as the pack yields >=1 card, and
// OkfRetriever's type/confidence boosts clear the score floor with zero
// query-word overlap. The gate could therefore never veto, and an off-topic
// synthesis question discarded a correct refusal and re-prompted the model
// with a stronger-synthesis instruction — the hallucination pressure the gate
// was built to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

function shippedExpression() {
  const i = src.indexOf('const hasStrongEvidence');
  assert.notEqual(i, -1, 'hasStrongEvidence not found');
  return src.slice(i, src.indexOf(';', i) + 1).replace(/\s+/g, ' ');
}

test('the tier signal may only corroborate topical relevance, never replace it', () => {
  const expr = shippedExpression();
  // SELF-REVIEW CORRECTION: the first fix wrote
  // `|| (isTier1Or2Evidence && hasEntityEvidence)` and this test asserted it.
  // That disjunct was provably DEAD — hasRealEvidence IS hasEntityEvidence, so
  // it could only be true when the first disjunct had already fired. The real
  // contract is that the topic-blind tier does not participate in the gate AT
  // ALL; assert that instead of a shape that only looked correct.
  assert.ok(!/isTier1Or2Evidence/.test(expr),
    'the topic-blind tier must not appear in the repair gate — it cannot veto or admit (F-412)');
  assert.ok(/hasRealEvidence\s*\|\|\s*Boolean\(matchedHighSignalEntity\)/.test(expr),
    'the gate must admit only on topical evidence or a whole-entity hit');
});

test('the decision keeps off-topic refusals and still repairs on-topic answers', () => {
  // Mirrors the shipped expression: the tier is absent by design.
  const decide = (c) => c.hasEntityEvidence || Boolean(c.matchedHighSignalEntity);

  // Off-topic synthesis question against an unrelated pack (the measured case).
  assert.equal(decide({ hasEntityEvidence: false, matchedHighSignalEntity: false, isTier1Or2Evidence: true }), false,
    'an off-topic question must keep its honest refusal');
  // On-topic question, tier confident.
  assert.equal(decide({ hasEntityEvidence: true, matchedHighSignalEntity: false, isTier1Or2Evidence: true }), true);
  // On-topic but tier-poor — must still repair via the real-evidence path.
  assert.equal(decide({ hasEntityEvidence: true, matchedHighSignalEntity: false, isTier1Or2Evidence: false }), true);
  // A whole-entity hit present in the retrieved context still repairs.
  assert.equal(decide({ hasEntityEvidence: false, matchedHighSignalEntity: true, isTier1Or2Evidence: false }), true);
});
