#!/usr/bin/env node
/**
 * R-04 repro — F-413's admission guard over-reached and deleted evidence for
 * legitimate questions.
 *
 * F-413 correctly observed that CONFIDENCE_BOOST.high (0.15) alone cleared the
 * 0.12 minScore floor, so ANY card was admitted with zero query overlap and
 * tier 4 ("no cards AND no chunks") became unreachable. But its fix —
 * `if (relevance <= 0) return 0` — also excluded `typeBoost`, and the two
 * boosts are not alike:
 *
 *   - confidenceBoost is card-INTRINSIC: every card carries it regardless of
 *     the question. It can never be evidence of relevance.
 *   - typeBoost is QUERY-DERIVED: a sparse table keyed on the question's own
 *     classification.type crossed with card.type. TYPE_BOOST[result].result
 *     exists precisely to surface the one `result` card for a `result`
 *     question whose wording differs.
 *
 * Excluding typeBoost made the whole table dead as an admission mechanism, and
 * separately deleted the profile path's deliberate 0.15 floor — blanking the
 * candidate's entire OKF resume-card layer for broad interview questions that
 * the intent-seed rescue does not cover.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-04-repro.cjs
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { queryOkfCards } = require(path.join(REPO, 'dist-electron', 'electron', 'services', 'knowledge', 'OkfRetriever.js'));

let failures = 0;
const check = (label, actual, pred, expected) => {
  const ok = pred(actual);
  if (!ok) failures++;
  console.log(`[R-04] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
};

const card = (id, type, title, body) => ({
  id, packId: 'p', sourceId: 's', type, title, slug: id, conceptId: id,
  body, entities: [], tags: [], quotes: [], confidence: 'high',
  approvalStatus: 'generated',
});

const classification = (type, isSynthesis = false, targetEntities = []) => ({
  type, isSynthesis, targetEntities, categoryEntities: [],
});

// --- Document pack: wording deliberately shares no tokens with the questions ---
const docPack = {
  packId: 'p', packVersion: 1,
  cards: [
    card('r1', 'result', 'Table 3', 'Throughput reached 41.2 units per cycle across all trials.'),
    card('m1', 'methodology', 'Apparatus', 'A calibrated rig was assembled from off-the-shelf parts.'),
    card('d1', 'definition', 'Nomenclature', 'A cycle denotes one complete actuation of the gripper.'),
  ],
};

// 1. A `result`-typed question against the one `result` card. This is exactly
//    what TYPE_BOOST_FOR_QUESTION_TYPE.result exists for.
const res = queryOkfCards(docPack, 'How did the evaluation turn out?', classification('result'), { topN: 6 });
check('result question admits the result card', res.length, (n) => n > 0, '> 0');
if (res.length) {
  check('  top card is r1                    ', res[0].card.id, (v) => v === 'r1', 'r1');
}

// 2. A `method`-typed question against the one `methodology` card.
const meth = queryOkfCards(docPack, 'How was it carried out?', classification('method'), { topN: 6 });
check('method question admits methodology  ', meth.length, (n) => n > 0, '> 0');

// 3. F-413's ORIGINAL intent must survive: an off-topic question whose type
//    matches NOTHING in the pack must admit nothing, so tier 4 stays reachable.
const offTopic = queryOkfCards(
  docPack, 'What is the refund policy for annual subscriptions?', classification('metadata'), { topN: 6 });
check('off-topic question admits nothing   ', offTopic.length, (n) => n === 0, '0');

// 4. Confidence alone must NOT admit on the document path.
const confOnly = queryOkfCards(
  docPack, 'Zzzz qqqq wwww vvvv?', classification('conclusion'), { topN: 6 });
check('confidence alone does not admit     ', confOnly.length, (n) => n === 0, '0');

// --- Profile pack: the path that deliberately relies on the 0.15 floor ---
const profilePack = {
  packId: 'pp', packVersion: 1,
  cards: [
    card('c1', 'section', 'Senior Engineer, Acme', 'Led the billing platform rewrite.'),
    card('c2', 'section', 'Staff Engineer, Globex', 'Owned the ingestion pipeline.'),
    card('c3', 'concept', 'Leadership', 'Mentored four engineers to senior.'),
    card('c4', 'concept', 'Impact', 'Cut p99 latency by 60 percent.'),
  ],
};

// 5. Broad interview question: no lexical overlap, no matching type boost, and
//    (verified by the reviewer) no INTENT_TYPE_BOOSTS regex match either. The
//    profile path opts in to confidence-floor admission for exactly this.
const prof = queryOkfCards(profilePack, 'Why should we hire you?', classification('conclusion'),
  { topN: 12, minScore: 0.1, admitOnConfidenceAlone: true });
check('profile floor keeps resume cards    ', prof.length, (n) => n === 4, '4');

// 6. Same question WITHOUT the opt-in admits ONLY the type-matched cards.
//    classification.type 'conclusion' maps to { conclusion: 0.25, section: 0.1 },
//    so the two `section` cards are admitted on the query-derived boost while the
//    two `concept` cards — which have no lexical overlap and no type match — are
//    not. That is the difference the opt-in makes explicit: 2 strict vs 4 floored.
const profStrict = queryOkfCards(profilePack, 'Why should we hire you?', classification('conclusion'),
  { topN: 12, minScore: 0.1 });
check('strict admits only type-matched     ', profStrict.length, (n) => n === 2, '2');
check('  and they are the section cards    ',
  profStrict.map((s) => s.card.type).sort().join(','), (v) => v === 'section,section', 'section,section');

if (failures) {
  console.error(`[R-04] FAIL: ${failures} assertion(s) failed — retrieval is dropping evidence it should return.`);
  process.exit(1);
}
console.log('[R-04] PASS: typeBoost admits, confidence-alone is opt-in, off-topic still admits nothing.');
