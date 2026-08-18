// F-412 repro: the false-refusal repair bypassed its own off-topic gate.
//
// The gate (wholeNameHit || tokenHits.size >= 2) exists so an honest
// "not in the document" refusal STANDS for an off-topic question — its own
// comment says "Off-topic questions match neither a whole name nor >=2
// distinct tokens, so their honest refusal stands."
//
// But isTier1Or2Evidence was OR'd in as an independent third disjunct, and
// EvidenceAssembler.computeTier is TOPIC-BLIND: it returns tier 2 for any
// synthesis-classified question the moment the pack yields >=1 card, and
// OkfRetriever's type/confidence boosts clear the score floor with ZERO
// query-word overlap. So the gate could never veto, and an off-topic
// synthesis question discarded a correct refusal and re-prompted the model
// with a stronger-synthesis instruction — the exact hallucination pressure
// the gate was built to prevent.
//
// Models the decision exactly as the handler computes it, and cross-checks the
// real source so the harness cannot drift from the shipped expression.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../electron/ipcHandlers.ts'), 'utf8');

const i = src.indexOf('const hasStrongEvidence');
const expr = i === -1 ? '' : src.slice(i, src.indexOf(';', i) + 1);
console.log('[F-412] shipped expression:\n   ', expr.replace(/\s+/g, ' ').trim());

// The off-topic case the explorer measured against a real robotics pack:
// a synthesis-typed question sharing no content word with the document.
const offTopic = { hasEntityEvidence: false, matchedHighSignalEntity: false, isTier1Or2Evidence: true };
// A genuine on-topic question.
const onTopic  = { hasEntityEvidence: true,  matchedHighSignalEntity: false, isTier1Or2Evidence: true };
// On-topic but tier-poor: must still repair via the real-evidence path.
const onTopicNoTier = { hasEntityEvidence: true, matchedHighSignalEntity: false, isTier1Or2Evidence: false };

const decide = (c) => c.hasEntityEvidence || Boolean(c.matchedHighSignalEntity) || (c.isTier1Or2Evidence && c.hasEntityEvidence);

let bad = false;
if (!/isTier1Or2Evidence\s*&&\s*hasEntityEvidence/.test(expr)) {
  console.error('[F-412] the shipped expression still uses isTier1Or2Evidence as an INDEPENDENT disjunct — the off-topic gate cannot veto (F-412 reproduced)');
  bad = true;
}
if (decide(offTopic)) { console.error('[F-412] an off-topic synthesis question would still be repaired'); bad = true; }
if (!decide(onTopic)) { console.error('[F-412] an on-topic question is no longer repaired — the fix over-reached'); bad = true; }
if (!decide(onTopicNoTier)) { console.error('[F-412] an on-topic, tier-poor question is no longer repaired — the fix over-reached'); bad = true; }

console.log('[F-412] off-topic repaired?', decide(offTopic), '| on-topic repaired?', decide(onTopic), '| on-topic tier-poor repaired?', decide(onTopicNoTier));
if (bad) { console.error('[F-412] FAIL'); process.exit(1); }
console.log('[F-412] PASS: the tier only corroborates topical relevance; off-topic refusals stand, on-topic repairs still fire.');
process.exit(0);
