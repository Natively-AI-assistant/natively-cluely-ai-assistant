// F-413 repro: an OKF card was admitted on its confidence boost alone.
//
// CONFIDENCE_BOOST.high is 0.15 and the default minScore floor is 0.12, so a
// high-confidence card cleared the floor with ZERO title/body/entity/tag
// overlap. OkfCardBuilder marks every metadata card and every sectioned card
// with >=30 body words 'high', so essentially every real pack contains them —
// which meant queryOkfCards returned a non-empty set for any question with a
// content word, EvidenceAssembler's tier 4 ("no cards AND no chunks") became
// unreachable at the repair-gate call site (which passes rawChunkText:''), and
// every off-topic question looked evidenced.
//
// Drives the REAL queryOkfCards from the built bundle.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../dist-electron/electron/services/knowledge/OkfRetriever.js');
const { queryOkfCards } = await import(pathToFileURL(dist).href);

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
// IMPORTANT: test the NON-synthesis path. A whole-document synthesis question
// (isSynthesis && no target entities) deliberately short-circuits to the first
// N content cards with score 1 — that is by design, so "what is the
// conclusion?" returns the document's conclusion rather than depending on word
// overlap. The confidence-boost-vs-minScore defect this finding is about lives
// on the SCORED path, which is where it must be measured.
const factual = { type: 'entity_lookup', isSynthesis: false, targetEntities: [] };

const offTopic = queryOkfCards(pack, 'Kyoto Protocol treaty emissions targets', factual);
const onTopic  = queryOkfCards(pack, 'manipulation policy throughput benchmarks', factual);

console.log('[F-413] off-topic cards:', offTopic.length, offTopic.map((c) => c.score?.toFixed?.(3)));
console.log('[F-413] on-topic  cards:', onTopic.length, onTopic.map((c) => c.score?.toFixed?.(3)));

let bad = false;
if (offTopic.length > 0) {
  console.error('[F-413] FAIL: an off-topic question still retrieves cards on boosts alone — tier 4 stays unreachable (F-413 reproduced).');
  bad = true;
}
if (onTopic.length === 0) {
  console.error('[F-413] FAIL: a genuinely on-topic question retrieves nothing — the fix over-reached.');
  bad = true;
}
if (bad) process.exit(1);
console.log('[F-413] PASS: boosts rank relevant cards; they no longer admit irrelevant ones.');
process.exit(0);
