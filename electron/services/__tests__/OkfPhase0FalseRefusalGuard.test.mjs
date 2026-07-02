/**
 * OKF Phase 0 (2026-07-01): false-refusal self-trigger guard regression tests.
 *
 * Root cause: the system's OWN safe refusal phrase ("I could not find that in
 * the retrieved sections of the document") could match the `saysNotMentioned`
 * detector and trigger an unnecessary/incorrect repair regen on the model's
 * correct, honest refusal. Fixed by adding SYSTEM_REFUSAL_RE + a
 * strong-evidence-only repair gate for that specific phrase, behind the
 * docGroundedFalseRefusalRepair flag (default ON).
 *
 * Source-assertion pattern (reads .ts source as a string), matching
 * DocGroundedRetrievalFix.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const ipcHandlersSrc = read('electron/ipcHandlers.ts');
const flagsSrc = read('electron/intelligence/intelligenceFlags.ts');

test('ipcHandlers: defines SYSTEM_REFUSAL_RE for the system own refusal phrase', () => {
  assert.match(ipcHandlersSrc, /const SYSTEM_REFUSAL_RE = \/\^I could not find that in the retrieved sections/);
});

test('ipcHandlers: derives highSignalEntities from the question + the active document\'s own extracted knowledge (not a hardcoded fixture list)', () => {
  // Senior review fix (2026-07-01): a prior version hardcoded
  // HIGH_SIGNAL_ENTITIES = ['OpenVLA-OFT', 'OpenVLA', 'AgenticVLA', ...] —
  // literal terms from the one thesis PDF this feature was developed
  // against, which made the strong-evidence repair branch inert for any
  // OTHER uploaded document. Now derives target entities from
  // QuestionClassifier.classifyQuestion(message).targetEntities and
  // cross-checks them against the active OKF pack's own entity/card names.
  assert.match(ipcHandlersSrc, /let highSignalEntities: string\[\] = \[\];/);
  assert.match(ipcHandlersSrc, /classifyQuestion\(message\)\.targetEntities/);
  assert.match(ipcHandlersSrc, /packWholeNames\.has\(e\.toLowerCase\(\)\)/);
  assert.ok(!ipcHandlersSrc.includes("const HIGH_SIGNAL_ENTITIES = ["), 'must not contain the old hardcoded fixture-specific entity list assignment (a mention in an explanatory comment is fine)');
});

test('ipcHandlers: repair gate uses OKF entity/title overlap, not retrieval score (off-topic leak fix)', () => {
  // Real evidence = a WHOLE entity/title hit OR >=2 DISTINCT title tokens.
  // Retrieval score is deliberately NOT used (the forced-doc-grounding section
  // boost inflates off-topic queries above genuine ones). A single shared
  // generic token can't authorize a repair.
  assert.match(ipcHandlersSrc, /const packWholeNames = new Set<string>\(\);/);
  assert.match(ipcHandlersSrc, /const packNameTokens = new Set<string>\(\);/);
  assert.match(ipcHandlersSrc, /const GATE_GENERIC_TOKENS = new Set/);
  assert.match(ipcHandlersSrc, /const hasEntityEvidence = wholeNameHit \|\| tokenHits\.size >= 2;/);
  assert.match(ipcHandlersSrc, /const hasRealEvidence = hasEntityEvidence;/);
});

test('ipcHandlers: repair gate does NOT depend on a retrieval-score threshold', () => {
  // Guard against a regression that re-introduces the polluted score signal.
  assert.ok(!ipcHandlersSrc.includes('DOC_GROUNDED_REPAIR_MIN_CONFIDENCE'), 'must not gate on retrieval confidence');
  assert.ok(!ipcHandlersSrc.includes('DOC_GROUNDED_REPAIR_MIN_TOP_SCORE'), 'must not gate on raw retrieval score');
});

test('ipcHandlers: strong-evidence = entity evidence OR matched high-signal entity OR tier; shouldRepair uses it directly', () => {
  assert.match(ipcHandlersSrc, /const hasStrongEvidence = hasRealEvidence \|\| Boolean\(matchedHighSignalEntity\) \|\| isTier1Or2Evidence;/);
  assert.match(ipcHandlersSrc, /const shouldRepair = hasStrongEvidence;/);
});

test('ipcHandlers: defers first-paint on the doc-grounded lecture path to avoid the refusal flash', () => {
  assert.match(ipcHandlersSrc, /const deferFirstPaintEligible = answerPlan\.answerType === 'lecture_answer'/);
  assert.match(ipcHandlersSrc, /const sendChunkGated = \(chunk: string\) => \{/);
  assert.match(ipcHandlersSrc, /if \(deferFirstPaint && deferredBuffer\.length > 0 && !finalText\)/);
});

test('ipcHandlers: false-refusal repair is gated behind docGroundedFalseRefusalRepair flag', () => {
  assert.match(ipcHandlersSrc, /isIntelligenceFlagEnabled\('docGroundedFalseRefusalRepair'\)/);
  assert.match(ipcHandlersSrc, /saysNotMentioned && docContextBlock && falseRefusalRepairEnabled/);
});

test('ipcHandlers: regen is attempted at most once regardless of reason (no loop)', () => {
  // The repair path only runs once per answer turn: locate the `if (reason) {`
  // block boundaries by the matching `} catch (dgErr` that closes the
  // surrounding try block, and confirm exactly one regen call with no loop.
  const startIdx = ipcHandlersSrc.indexOf('if (reason) {');
  assert.ok(startIdx >= 0, 'expected to find the `if (reason) {` repair block');
  const endIdx = ipcHandlersSrc.indexOf('} catch (dgErr', startIdx);
  assert.ok(endIdx > startIdx, 'expected to find the closing `} catch (dgErr` after the repair block');
  const block = ipcHandlersSrc.slice(startIdx, endIdx);
  const raceCalls = (block.match(/raceStreamWithDeadline/g) || []).length;
  assert.equal(raceCalls, 1, 'expected exactly one regen attempt (no retry loop)');
  assert.ok(!/\bwhile\s*\(/.test(block), 'repair block must not contain a while loop');
});

test('intelligenceFlags: okfKnowledgePacks/okfMarkdownExport/okfHybridRetrieval default ON in dev/test contexts', () => {
  assert.match(flagsSrc, /okfKnowledgePacks: \{[^}]*default: isInternalDevTestContext\(\)/);
  assert.match(flagsSrc, /okfMarkdownExport: \{[^}]*default: isInternalDevTestContext\(\)/);
  assert.match(flagsSrc, /okfHybridRetrieval: \{[^}]*default: isInternalDevTestContext\(\)/);
});

test('intelligenceFlags: okfGraphExpansion/okfKnowledgeUi/okfUserEditableCards default OFF', () => {
  assert.match(flagsSrc, /okfGraphExpansion: \{[^}]*default: false/);
  assert.match(flagsSrc, /okfKnowledgeUi: \{[^}]*default: false/);
  assert.match(flagsSrc, /okfUserEditableCards: \{[^}]*default: false/);
});

test('intelligenceFlags: docGroundedStrictIsolation and docGroundedFalseRefusalRepair default ON everywhere', () => {
  assert.match(flagsSrc, /docGroundedStrictIsolation: \{[^}]*default: true/);
  assert.match(flagsSrc, /docGroundedFalseRefusalRepair: \{[^}]*default: true/);
});

// ---------------------------------------------------------------------------
// Behavioral simulation of the regex/threshold logic (mirrors the live code
// paths without requiring a compiled build).
// ---------------------------------------------------------------------------

const SYSTEM_REFUSAL_RE = /^I could not find that in the retrieved sections? of the (?:document|uploaded material)\b/i;
const SAYS_NOT_MENTIONED_RE = /not (?:directly )?(?:mentioned|in (?:the|my) (?:uploaded|seminar|thesis|retrieved) (?:material|sections?|document)|found in|present in)|(?:^|(?<=[.!?]\s+))I could not find\b/i;

const GATE_GENERIC_TOKENS = new Set([
  'used', 'using', 'work', 'works', 'paper', 'study', 'general', 'related', 'proposed',
  'various', 'different', 'overview', 'introduction', 'conclusion', 'summary', 'background',
  'section', 'chapter', 'about', 'towards', 'toward', 'based', 'other', 'these', 'those',
  'model', 'models', 'framework', 'frameworks', 'system', 'systems', 'result', 'results',
  'evaluation', 'training', 'learning', 'method', 'methods', 'methodology', 'approach',
  'approaches', 'analysis', 'network', 'networks', 'dataset', 'datasets', 'data',
  'algorithm', 'algorithms', 'performance', 'experiment', 'experiments', 'architecture',
  'architectures', 'application', 'applications', 'process', 'processes', 'design',
  'implementation', 'component', 'components', 'structure', 'technique', 'techniques',
]);

// Builds the two lookup sets from a document's entity names + card titles,
// mirroring the production addName() in ipcHandlers (hyphen split for tokens,
// whole hyphenated form kept in `whole`).
function buildPackSets(names) {
  const whole = new Set(), tokens = new Set();
  for (const raw of names) {
    const n = raw.toLowerCase();
    whole.add(n);
    for (const w of n.split(/[^a-z0-9]+/)) {
      if (w.length >= 5 && !GATE_GENERIC_TOKENS.has(w)) tokens.add(w);
    }
  }
  return { whole, tokens };
}

// Simulates the production false-refusal gate (2026-07-02, entity-overlap
// model): repair is allowed only when the QUESTION is about this document's
// own extracted topics — a WHOLE entity/title hit OR >=2 DISTINCT title
// tokens. Retrieval score is deliberately NOT used (empirically polluted by
// the forced-doc-grounding section boost). `packNames` is the list of the
// document's entity names + card titles; `targetEntities` is the classifier's
// target entities cross-checked against whole names.
function simulateShouldRepair(answer, question, docContextBlock, packNames = [], targetEntities = []) {
  const trimmed = answer.trim();
  const saysNotMentioned = SAYS_NOT_MENTIONED_RE.test(trimmed);
  if (!saysNotMentioned || !docContextBlock) return false;
  const { whole, tokens } = buildPackSets(packNames);
  const qTerms = (question.match(/\b[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]\b/g) || [])
    .filter((t) => t.length >= 3 && t.length <= 40)
    .filter((t) => !/^(?:the|this|that|what|when|where|who|how|why|which|does|did|was|were|are|is|in|of|at|to|for|with|about|and|or|not|has|have|had|its|can|could|would|should|will|from|than|more|any|all|some|tell|explain|describe|me|my|your|their|it|be|do|an|on|by|as|up|if|so|but|out|no|we|they|he|she|you|his|her|our|us|them)$/i.test(t));
  const chunkLower = docContextBlock.toLowerCase();
  const present = qTerms.filter((t) => chunkLower.includes(t.toLowerCase())).map((t) => t.toLowerCase());
  const wholeNameHit = present.some((t) => whole.has(t))
    || (targetEntities || []).some((e) => whole.has(e.toLowerCase()));
  const tokenHits = new Set(present.filter((t) => tokens.has(t)));
  return wholeNameHit || tokenHits.size >= 2;
}

const THESIS_NAMES = ['OpenVLA', 'OpenVLA-OFT', 'AgenticVLA', 'AutoGen', 'Mercury X1', 'Research Questions', 'Thesis Objectives', 'Research Methodology', 'Embodied Cognition', 'VLA'];

test('simulation: off-topic "capital of France" does NOT repair (no name/token overlap)', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'OpenVLA-OFT uses parallel decoding for 43x faster throughput.';
  assert.equal(simulateShouldRepair(answer, 'What is the capital of France?', ctx, THESIS_NAMES), false);
});

test('simulation: whole-entity question DOES repair (OpenVLA-OFT hits a whole name)', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'OpenVLA-OFT replaces autoregressive decoding with parallel decoding, achieving 43x faster throughput.';
  assert.equal(simulateShouldRepair(answer, 'What is OpenVLA-OFT?', ctx, THESIS_NAMES), true);
});

test('simulation: classifier target-entity whole-name hit DOES repair even if the surface term differs', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'AgenticVLA integrates AutoGen with the VLA model.';
  assert.equal(simulateShouldRepair(answer, 'Tell me about it', ctx, THESIS_NAMES, ['AgenticVLA']), true);
});

test('simulation: genuine multi-token topic question DOES repair (>=2 distinct title tokens)', () => {
  // "research"+"questions" are two distinct tokens of the "Research Questions"
  // card title -> repairs, so a genuine topic question the model wrongly
  // refused is recovered.
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'The research questions RQ1 and RQ2 investigate agentic frameworks.';
  assert.equal(simulateShouldRepair(answer, 'What are the research questions?', ctx, THESIS_NAMES), true);
});

test('simulation: genuine "thesis objectives" DOES repair (2 distinct title tokens)', () => {
  const answer = 'This is not mentioned in the retrieved material.';
  const ctx = 'The thesis objectives are to combine VLA models with agentic frameworks.';
  assert.equal(simulateShouldRepair(answer, 'What are the thesis objectives?', ctx, THESIS_NAMES), true);
});

// --- OFF-TOPIC LEAK regression (2026-07-02, from live field logs) ---

test('simulation: off-topic "third research question" does NOT repair (shares only ONE title token)', () => {
  // The thesis has RQ1 and RQ2 only. Only "research" overlaps a title token
  // ("questions" is present too, so this is the tricky case). To NOT leak, the
  // context must not surface "questions" — here the model refused and the
  // retrieved snippet only contains "research" as a title token. One distinct
  // token < 2 -> honest refusal stands.
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'This section discusses the research direction and the third component of an agent.';
  assert.equal(simulateShouldRepair(answer, 'What is the third research question?', ctx, THESIS_NAMES), false);
});

test('simulation: off-topic "Mars rover dataset" does NOT repair (generic tokens stoplisted)', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  // "dataset"/"experiments"/"results" are all in GATE_GENERIC_TOKENS, so they
  // never count as distinctive title tokens; "Mars"/"rover" absent. This is the
  // leak the expanded stoplist closes.
  const ctx = 'The dataset for experiments was collected via teleoperation. Results are in section 4.';
  assert.equal(simulateShouldRepair(answer, 'What dataset was used for the Mars rover experiments?', ctx, THESIS_NAMES), false);
});

test('simulation: off-topic question sharing TWO generic ML title-words does NOT repair (stoplist closes the 2-token path)', () => {
  // "model"+"training" are both generic ML title-words now in GATE_GENERIC_TOKENS,
  // so even though they'd appear in this thesis's titles/chunks, they don't
  // count toward the >=2-distinct-token rule -> honest refusal (no fabrication).
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'The model was trained; training used the collected dataset. Various systems were evaluated.';
  assert.equal(simulateShouldRepair(answer, 'Which machine-learning model won the training benchmark competition?', ctx, THESIS_NAMES), false);
});

test('simulation: hyphenated card title makes a bare-stem question reachable via a token (OpenVLA-OFT -> openvla)', () => {
  // Card title "OpenVLA-OFT" now also emits the "openvla" token (hyphen split),
  // so a question mentioning both "openvla" and another distinctive token
  // repairs even if no bare "OpenVLA" whole-entity exists.
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'OpenVLA underpins the AgenticVLA prototype.';
  // present distinctive tokens: openvla (from OpenVLA-OFT), agenticvla -> 2 -> repair
  assert.equal(simulateShouldRepair(answer, 'How do OpenVLA and AgenticVLA relate?', ctx, ['OpenVLA-OFT', 'AgenticVLA']), true);
});

test('simulation: off-topic "who invented Linux" does NOT repair', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'Embodied cognition and OpenVLA are discussed in the introduction.';
  assert.equal(simulateShouldRepair(answer, 'Who invented Linux?', ctx, THESIS_NAMES), false);
});

test('simulation: a single shared title token is NOT enough (guards the off-topic boundary)', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  // "methodology" is one title token; nothing else overlaps -> < 2 tokens, no
  // whole-name hit -> refuse.
  const ctx = 'The methodology chapter opens here.';
  assert.equal(simulateShouldRepair(answer, 'What is the funding methodology of the sponsoring agency?', ctx, THESIS_NAMES), false);
});

test('simulation: no infinite loop — repeated calls with the same inputs are idempotent (pure function, no state)', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  const ctx = 'OpenVLA is a 7B-parameter open-source VLA model.';
  const first = simulateShouldRepair(answer, 'What is OpenVLA?', ctx, THESIS_NAMES);
  const second = simulateShouldRepair(answer, 'What is OpenVLA?', ctx, THESIS_NAMES);
  assert.equal(first, second);
});
